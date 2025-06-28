import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { getClientDesignTool, updateDesignTool } from "./designTools.js";

import {
	SystemMessage,
	HumanMessage,
	AIMessage,
} from "@langchain/core/messages";
import {
	getClientDesign,
	DESIGN_OPTIONS,
	OPTION_EXPLANATIONS,
	LAYOUT_DEFINITIONS,
} from "./designTools.js";
import dotenv from "dotenv";

dotenv.config();

const designEvaluationPromptTemplate = `
You are a Design Evaluation Expert. Your job is to analyze design change requests and provide expert recommendations.

## CRITICAL INSTRUCTION
When a user asks to see their design, you MUST call the getClientDesign tool first. You cannot provide design information without fetching it from the database.

## AVAILABLE TOOLS
You have access to the following tools:
- **getClientDesign**: Use this tool to fetch the current design configuration for a client
- **updateDesign**: Use this tool to update design configuration for a client

## WHEN TO USE TOOLS
- **ALWAYS use getClientDesign** when a user asks to see their design, current design configuration, or design details
- Use updateDesign when the user wants to make specific design changes
- **IMPORTANT**: If the user mentions a client ID (like "client 6"), extract it and use it in the tool call
- **IMPORTANT**: If the user asks to "show", "see", "get", or "fetch" their design, you MUST use the getClientDesign tool first
- **CRITICAL**: You CANNOT provide design information without first calling getClientDesign tool. The current design state shows "No design data available" because you need to fetch it first

## CURRENT DESIGN STATE
{currentDesignAnalysis}

## USER REQUEST
{userRequest}

## ALLOWED DESIGN OPTIONS
{allowedOptionsSummary}

## LAYOUT DEFINITIONS
{layoutDefinitionsSummary}

## YOUR ANALYSIS PROCESS
1. **FETCH DESIGN DATA**: If user wants to see their design, use getClientDesign tool first
2. **UNDERSTAND CURRENT STATE**: Analyze how the webpage currently looks based on the design configuration
3. **VALIDATE REQUEST**: Check if the requested change is within allowed options
4. **VISUALIZE IMPACT**: Predict how this change will affect the overall design harmony
5. **EVALUATE COMPATIBILITY**: Consider how this change works with existing elements
6. **PROVIDE RECOMMENDATION**: Give clear advice with reasoning

## RESPONSE FORMAT

### For Design Viewing Requests:
When user asks to see their design, use getClientDesign tool and then provide:
**CURRENT DESIGN CONFIGURATION**:
- Layout: [Current layout type]
- Background: [Current background style]
- Cards: [Current card style and radius]
- Buttons: [Current button style and radius]
- Colors: [Current color palette]
- Media: [Banner/background images if any]

**DESIGN ANALYSIS**:
- Overall Style: [Description of current aesthetic]
- Strengths: [What works well]
- Improvement Opportunities: [What could be enhanced]

### For Specific Change Requests:
**CHANGE REQUEST**: [Summarize what user wants to change]

**VALIDATION**: ✅ Valid / ❌ Invalid
- [Explain if the option exists in allowed choices]

**CURRENT vs PROPOSED**:
- Current: [How it looks now]
- Proposed: [How it will look after change]

**VISUAL IMPACT ANALYSIS**:
- Layout harmony: [How it affects overall balance]
- Element relationship: [How it interacts with other elements]
- User experience: [Impact on usability]

**RECOMMENDATION**: 👍 Good Choice / ⚠️ Consider Alternatives / ❌ Not Recommended
**REASONING**: [Detailed explanation of why]

**ALTERNATIVE SUGGESTIONS** (if applicable):
- [Better options with reasons]

### For General Suggestions:
**CURRENT DESIGN OVERVIEW**: [Summary of current state]

**IMPROVEMENT OPPORTUNITIES**:
1. [Area]: [Specific suggestion]
   - Why: [Reasoning]
   - Impact: [Expected visual result]

2. [Area]: [Specific suggestion]
   - Why: [Reasoning]
   - Impact: [Expected visual result]

**PRIORITY RECOMMENDATIONS**: [Most important changes first]

## EXAMPLES

Example 1 - Design Viewing:
User: "Show me my design for client 6"
→ You MUST call getClientDesign tool with clientId: "6"
→ Wait for the tool response
→ Then provide current design configuration and analysis

Example 2 - Design Viewing (Alternative):
User: "My clientId is 6 and I want to see my current design"
→ You MUST call getClientDesign tool with clientId: "6"
→ Wait for the tool response
→ Then provide current design configuration and analysis

Example 3 - Specific Change:
**CHANGE REQUEST**: Change button style from 'solid' to 'soft-shadow'

**VALIDATION**: ✅ Valid
- 'soft-shadow' is available in buttonDesign_Style options

**CURRENT vs PROPOSED**:
- Current: Flat buttons with solid fill, clean but basic appearance
- Proposed: Buttons with subtle drop shadows, more dimensional and premium feel

**VISUAL IMPACT ANALYSIS**:
- Layout harmony: Adds depth without disrupting the clean layout structure
- Element relationship: Shadow will create visual hierarchy, making buttons more prominent
- User experience: Enhanced button visibility improves interaction clarity

**RECOMMENDATION**: 👍 Good Choice
**REASONING**: Soft shadows add sophistication without overwhelming the design. Works well with your current clean aesthetic and improves user interaction cues.

Example 4 - Invalid Change:
**CHANGE REQUEST**: Change layout to 'modern-grid'

**VALIDATION**: ❌ Invalid
- 'modern-grid' is not available. Allowed layouts: classic, compact, banner, imaged

**ALTERNATIVE SUGGESTIONS**:
- 'compact': Space-efficient with modern feel
- 'banner': Balanced modern aesthetic with banner capability
`;
export const designPrompt = designEvaluationPromptTemplate;

function analyzeCurrentDesign(designData) {
	if (!designData) {
		return "No design data available - using default configuration";
	}

	let analysis = "## CURRENT DESIGN BREAKDOWN\n\n";

	// Header Analysis
	const headerLayout = designData.header_design?.layout || "classic";
	const headerDef = LAYOUT_DEFINITIONS[headerLayout];
	analysis += `**Layout**: ${headerLayout}\n`;
	analysis += `- Structure: ${
		headerDef?.Layout_Structure || "Standard flow"
	}\n`;
	analysis += `- Visual Style: ${
		headerDef?.Visual_Style || "Not specified"
	}\n\n`;

	// Appearance Analysis
	const background = designData.appearance?.background || "none";
	analysis += `**Background**: ${background}\n`;
	analysis += `- Type: ${
		OPTION_EXPLANATIONS.appearance_background?.[background] || "Default"
	}\n`;
	if (designData.background_mediaUrl) {
		analysis += `- Has background media: Yes\n`;
	}
	if (designData.banner_mediaUrl) {
		analysis += `- Has banner image: Yes\n`;
	}
	analysis += "\n";

	// Card Design Analysis
	const cardStyle = designData.card_design?.style || "solid";
	const cardRadius = designData.card_design?.radius || "medium";
	analysis += `**Cards**: ${cardStyle} with ${cardRadius} corners\n`;
	analysis += `- Appearance: ${
		OPTION_EXPLANATIONS.cardDesign_Style?.[cardStyle] || "Standard"
	}\n`;
	analysis += `- Corner Style: ${
		OPTION_EXPLANATIONS.cardDesign_Radius?.[cardRadius] || "Standard"
	}\n\n`;

	// Button Design Analysis
	const buttonStyle = designData.button_design?.style || "solid";
	const buttonRadius = designData.button_design?.radius || "medium";
	analysis += `**Buttons**: ${buttonStyle} with ${buttonRadius} corners\n`;
	analysis += `- Appearance: ${
		OPTION_EXPLANATIONS.buttonDesign_Style?.[buttonStyle] || "Standard"
	}\n`;
	analysis += `- Corner Style: ${
		OPTION_EXPLANATIONS.buttonDesign_Radius?.[buttonRadius] || "Standard"
	}\n\n`;

	// Color Analysis
	if (designData.color_palate) {
		analysis += `**Color Palette**: Custom colors defined\n`;
		if (designData.color_palate.primary) {
			analysis += `- Primary: ${designData.color_palate.primary}\n`;
		}
	}

	console.log(
		"\n\nCurrent Design Analysis for testing purpose:\n",
		analysis,
		"\n"
	);

	return analysis;
}

// Helper to parse user request and identify intent
function parseUserRequest(userMessage) {
	const message = userMessage.toLowerCase();

	// Check for specific change patterns
	const changePatterns = [
		{ pattern: /change\s+(.+?)\s+to\s+(.+)/i, type: "specific_change" },
		{ pattern: /set\s+(.+?)\s+to\s+(.+)/i, type: "specific_change" },
		{ pattern: /make\s+(.+?)\s+(.+)/i, type: "specific_change" },
		{ pattern: /update\s+(.+?)\s+to\s+(.+)/i, type: "specific_change" },
	];

	for (const { pattern, type } of changePatterns) {
		const match = userMessage.match(pattern);
		if (match) {
			return {
				type,
				field: match[1].trim(),
				value: match[2].trim(),
				originalRequest: userMessage,
			};
		}
	}

	// Check for general suggestion requests
	if (
		message.includes("suggest") ||
		message.includes("recommend") ||
		message.includes("improve")
	) {
		return {
			type: "general_suggestion",
			originalRequest: userMessage,
		};
	}

	return {
		type: "unclear",
		originalRequest: userMessage,
	};
}

// Map user-friendly terms to database fields
const fieldMapping = {
	layout: "header_design.layout",
	"header layout": "header_design.layout",
	background: "appearance.background",
	"card style": "card_design.style",
	"card radius": "card_design.radius",
	"card corners": "card_design.radius",
	"button style": "button_design.style",
	"button radius": "button_design.radius",
	"button corners": "button_design.radius",
	"social icons": "header_design.socialIconStyle",
};

// Get design options key from field name
function getOptionsKey(fieldName) {
	const mappings = {
		"header_design.layout": "header_layout",
		"appearance.background": "appearance_background",
		"card_design.style": "cardDesign_Style",
		"card_design.radius": "cardDesign_Radius",
		"button_design.style": "buttonDesign_Style",
		"button_design.radius": "buttonDesign_Radius",
		"header_design.socialIconStyle": "header_socialIconStyle",
	};
	return mappings[fieldName];
}

function validateChangeRequest(field, value) {
	const mappedField = fieldMapping[field.toLowerCase()] || field;
	const optionsKey = getOptionsKey(mappedField);

	if (!optionsKey || !DESIGN_OPTIONS[optionsKey]) {
		return {
			valid: false,
			reason: `Field '${field}' is not recognized. Available fields: ${Object.keys(
				fieldMapping
			).join(", ")}`,
		};
	}

	const allowedValues = DESIGN_OPTIONS[optionsKey];
	if (!allowedValues.includes(value)) {
		return {
			valid: false,
			reason: `Value '${value}' is not allowed for ${field}. Allowed values: ${allowedValues.join(
				", "
			)}`,
		};
	}

	return {
		valid: true,
		mappedField,
		optionsKey,
		allowedValues,
	};
}

// Helper functions
function formatAllowedOptions() {
	let formatted = "";
	for (const [category, options] of Object.entries(DESIGN_OPTIONS)) {
		formatted += `### ${category}\n`;
		options.forEach((option) => {
			const explanation =
				OPTION_EXPLANATIONS[category]?.[option] || "No description available";
			formatted += `- ${option}: ${explanation}\n`;
		});
		formatted += "\n";
	}
	return formatted;
}

function formatLayoutDefinitions() {
	return Object.entries(LAYOUT_DEFINITIONS)
		.map(
			([name, def]) =>
				`**${name}**: ${def.Visual_Style}\n` +
				`- Structure: ${def.Layout_Structure}\n` +
				`- Best for: ${def.Best_For}`
		)
		.join("\n\n");
}

async function generatePromptContent(clientId, userMessage) {
	let currentDesignAnalysis =
		"No design data available - will be fetched when needed";
	let userRequest = userMessage;

	if (clientId) {
		try {
			const designData = await getClientDesign(clientId);
			currentDesignAnalysis = analyzeCurrentDesign(designData);
		} catch (error) {
			console.error("Error fetching design data:", error);
			currentDesignAnalysis = `Error fetching design data: ${error.message}`;
		}
	}

	return {
		currentDesignAnalysis,
		userRequest,
		allowedOptionsSummary: formatAllowedOptions(),
		layoutDefinitionsSummary: formatLayoutDefinitions(),
	};
}

const evaluationLLM = new AzureChatOpenAI({
	azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
	azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
	azureOpenAIApiDeploymentName: "gpt-4o",
	azureOpenAIApiVersion: "2025-01-01-preview",
	temperature: 0.3, // Lower temperature for more consistent analysis
}).bindTools([getClientDesignTool, updateDesignTool]);

console.log("🔧 DesignAgent: Tools bound to LLM:", {
	getClientDesignTool: !!getClientDesignTool,
	updateDesignTool: !!updateDesignTool,
});

async function callEvaluationModel(state) {
	const lastMessage = state.messages[state.messages.length - 1];
	console.log("📝 DesignAgent: Last message:", lastMessage.content);

	try {
		const promptContent = await generatePromptContent(
			null,
			lastMessage.content
		);

		const dynamicPrompt = designEvaluationPromptTemplate
			.replace("{currentDesignAnalysis}", promptContent.currentDesignAnalysis)
			.replace("{userRequest}", promptContent.userRequest)
			.replace("{allowedOptionsSummary}", promptContent.allowedOptionsSummary)
			.replace(
				"{layoutDefinitionsSummary}",
				promptContent.layoutDefinitionsSummary
			);

		const updatedMessages = [
			new SystemMessage(dynamicPrompt),
			new HumanMessage(lastMessage.content),
		];

		const response = await evaluationLLM.invoke(updatedMessages);

		console.log("🤖 DesignAgent LLM response:");
		console.log("  - Content:", response.content);
		console.log("  - Tool calls:", response.tool_calls?.length || 0);
		if (response.tool_calls) {
			response.tool_calls.forEach((toolCall, index) => {
				console.log(`  - Tool call ${index + 1}:`, {
					name: toolCall.name,
					args: toolCall.args,
				});
			});
		}

		return {
			messages: [
				new AIMessage({
					content: response.content,
					tool_calls: response.tool_calls || [],
				}),
			],
		};
	} catch (error) {
		console.error("Error in callEvaluationModel:", error);
		return {
			messages: [
				new AIMessage({
					content: `Error evaluating design change: ${error.message}`,
				}),
			],
		};
	}
}

function shouldContinueDesign(state) {
	const lastMessage = state.messages[state.messages.length - 1];

	console.log(
		"Design should continue? Last message type:",
		lastMessage.type || lastMessage._getType()
	);

	console.log("Last message tool_calls:", lastMessage.tool_calls);

	if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
		console.log("Going to tools node");
		return "tools";
	}

	console.log("Ending design evaluation");
	return "__end__";
}

// Helper to extract client ID from messages
function extractClientId(messageContent) {
	// First try to find client ID in the current message
	const match = messageContent.match(/client\s+(\d+)/i);
	if (match) return match[1];

	// If not found, look for patterns like "client 6" or "clientId 6" in the message
	const clientIdMatch = messageContent.match(/client(?:Id)?\s*(\d+)/i);
	if (clientIdMatch) return clientIdMatch[1];

	// Look for just a number that might be a client ID (common pattern)
	const numberMatch = messageContent.match(/\b(\d+)\b/);
	if (numberMatch) return numberMatch[1];

	return null;
}

// Tool calling function for design tools
async function callDesignTools(state) {
	console.log("🛠️ DesignAgent: Calling tools...");

	const lastMessage = state.messages[state.messages.length - 1];
	const toolCalls = lastMessage.tool_calls || [];

	console.log("🔧 Tool calls found:", toolCalls.length);

	const toolMessages = await Promise.all(
		toolCalls.map(async (toolCall) => {
			console.log("⚡ Executing tool:", toolCall.name);
			console.log("⚡ Tool args:", toolCall.args);

			let toolResult;
			try {
				// Execute the appropriate tool
				if (toolCall.name === "getClientDesign") {
					toolResult = await getClientDesignTool.invoke(toolCall.args);
				} else if (toolCall.name === "updateDesign") {
					toolResult = await updateDesignTool.invoke(toolCall.args);
				} else {
					throw new Error(`Unknown tool: ${toolCall.name}`);
				}
				console.log("✅ Tool execution successful");
			} catch (error) {
				console.error("❌ Tool execution failed:", error);
				toolResult = {
					success: false,
					error: "Tool execution failed",
					details: error.message,
				};
			}

			return {
				type: "tool",
				tool_call_id: toolCall.id,
				name: toolCall.name,
				content: JSON.stringify(toolResult),
			};
		})
	);

	console.log("📝 Tool messages created:", toolMessages.length);
	return { messages: toolMessages };
}

export const DesignEvaluationAgent = new StateGraph(MessagesAnnotation)
	.addNode("evaluate", callEvaluationModel)
	.addNode("tools", callDesignTools)
	.addEdge("__start__", "evaluate")
	.addConditionalEdges("evaluate", shouldContinueDesign)
	.addEdge("tools", "evaluate")
	.compile();

// Export helper functions for external use
export { parseUserRequest, validateChangeRequest, analyzeCurrentDesign };
