import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { any, z } from "zod";
import {
	getClientDesign,
	updateDesign,
	getQAForClient,
	DESIGN_OPTIONS,
} from "./designTools.js";
import dotenv from "dotenv";
import { tool } from "@langchain/core/tools";
import { sanitizeDesignUpdates } from "./designSanitize.js";
import { LAYOUT_DEFINITIONS, OPTION_EXPLANATIONS } from "./designTools.js";

dotenv.config();
function formatLayoutDefinitions(definitions) {
  return Object.entries(definitions)
    .map(([name, details]) => `
**${name.toUpperCase()} Layout**:
- Visual Style: ${details.Visual_Style}
- Profile Section: ${details.Profile_Section}
- Navigation: ${details.Navigation}
- Best For: ${details.Best_For}
- Overall Feel: ${details.Overall_Feel}`)
    .join("\n\n");
}

// Format option explanations
function formatOptionExplanations(explanations) {
  return Object.entries(explanations)
    .map(([category, options]) => `
**${category.replace(/_/g, ' ').toUpperCase()}**:
${Object.entries(options)
  .map(([option, desc]) => `- ${option}: ${desc}`)
  .join("\n")}`)
    .join("\n\n");
}


const layoutDefinitionsText = formatLayoutDefinitions(LAYOUT_DEFINITIONS);
const optionExplanationsText = formatOptionExplanations(OPTION_EXPLANATIONS);

export const designPrompt = `
You are a Design Validation Expert for a web design system. You ONLY work with predefined design options stored in the database.

## ABSOLUTE RULES - NEVER BREAK THESE:
1. ONLY suggest changes from the USER-CONTROLLABLE ELEMENTS list below
2. NEVER mention: hover effects, animations, spacing, font sizes, padding, margin, transitions
3. NEVER ask for "component ID" - we only use client ID
4. NEVER suggest custom CSS or manual styling
5. If user requests something not in our options, explain it's not available and suggest alternatives
6. ALWAYS consider the client's onboarding/signup answers to personalize recommendations
7. If clientId is missing, you MUST ask for it

## DESIGN ELEMENT EXPLANATIONS

### LAYOUT DEFINITIONS
${layoutDefinitionsText}

### OPTION MEANINGS
${optionExplanationsText}

## USER-CONTROLLABLE ELEMENTS:
- Layout: ${DESIGN_OPTIONS.header_layout.join(", ")}
- Social Icon Style: ${DESIGN_OPTIONS.header_socialIconStyle.join(", ")}
- Background: ${DESIGN_OPTIONS.appearance_background.join(", ")}
- Card Style: ${DESIGN_OPTIONS.cardDesign_Style.join(", ")}
- Card Radius: ${DESIGN_OPTIONS.cardDesign_Radius.join(", ")}
- Button Style: ${DESIGN_OPTIONS.buttonDesign_Style.join(", ")}
- Button Radius: ${DESIGN_OPTIONS.buttonDesign_Radius.join(", ")}
- Color Palette: Customize primary, secondary, accent, and background colors

## VISUAL ANALYSIS GUIDELINES:
When evaluating design changes:
1. ALWAYS reference the client's current design configuration, analyse it based on the layout definitions, and the option explanations, understand how it looks
2. Consider how changes will affect overall visual harmony
3. Assess contrast between elements (text vs background)
4. Ensure changes align with layout characteristics
5. Verify accessibility (color contrast ratios)
6. Maintain brand consistency

Example analysis: 
"Changing from 'stroked' to 'solid' social icons would increase visual weight in the header, improving visibility but potentially competing with your profile photo in the 'imaged' layout."

## RESPONSE FORMAT:
For ALL suggestions: 
1. Describe the visual impact using layout definitions
2. Reference option explanations for clarity
3. Compare with current design
4. Mention any trade-offs
`;
// my clientId is 6 is my current color palate good is it aligning with my goals or do you have any better suggestions
const colorPalettePrompt = ` 
## COLOR PALETTE WORKFLOW:
1. When user requests color changes:
   a. If they want suggestions:
      - Suggest 2-3 complete palette sets with creative names
      - Each palette must include: primary, secondary, accent, background (with hex codes)
      - Present sets and ask user to choose
   b. If they provide specific colors:
      - Validate completeness (must have all 4 colors: primary, secondary, accent, background)
      - Verify hex format (e.g., #FFFFFF)
      - If incomplete, explain what's missing and offer to complete the palette
      - If invalid, explain proper format

2. BEFORE UPDATING ANY PALETTE:
   a. Analyze visual impact:
      - "Based on your current design (so you must analyse the current design and goals of the webpage), this change would..."
      - Evaluate color contrast ratios (text vs background)
      - Check harmony with existing design elements
      - Consider brand alignment from onboarding answers
      - Identify potential accessibility issues
   b. Verify database requirements:
      - All 4 colors must be provided
      - Colors must be valid hex codes
      - Palette name should be included (generate one if needed)

3. UPDATE CONFIRMATION:
   - Summarize changes: "Updating to [Palette Name]: Primary \${hex}, Secondary \${hex}..."
   - Show visual impact analysis
   - Ask explicit confirmation: "Should I proceed with this update?"

4. EXAMPLES:

User: "Use these colors: primary #FF0000, secondary #00FF00, accent #0000FF, background #FFFFFF"
Agent: 
"### Visual Impact Analysis:
- Your 'banner' layout features prominent header elements. The high-contrast primary (#FF0000) will draw attention but may compete with banner imagery.
- The green secondary (#00FF00) provides good balance against red, but text contrast ratio is 3.9:1 (below 4.5:1 WCAG standard) - consider adjusting.
- Accent blue (#0000FF) creates vibrant pop but may clash with red in close proximity.

### Verification:
✅ All required colors provided
✅ Valid hex formats
⏺️ Generated palette name: 'Bold Contrast'

Should I update to:
- Primary: #FF0000
- Secondary: #00FF00
- Accent: #0000FF
- Background: #FFFFFF
- Name: Bold Contrast?"

User: "Make background warmer"
Agent: 
"### Palette Suggestions:
1. Sunset Glow:
   - Primary: #E25822 (warm orange)
   - Secondary: #6D28D9 (violet contrast)
   - Accent: #FBBF24 (golden yellow)
   - Background: #FEF3C7 (warm cream)

2. Desert Heat:
   - Primary: #B45309 (rich brown)
   - Secondary: #F59E0B (amber)
   - Accent: #DC2626 (terracotta)
   - Background: #FFEDD5 (peach)

Which palette better suits your vision? I can also adjust specific colors."

User: "Just change primary to blue"
Agent:
"⚠️ Incomplete palette update. To maintain design consistency, we need all 4 colors.

Current palette:
- Primary: \${currentPrimary}
- Secondary: \${currentSecondary}
- Accent: \${currentAccent}
- Background: \${currentBackground}

Shall I:
1) Keep current colors but change primary to your blue (#0000FF)?
2) Suggest complementary colors for a complete new palette?
3) Adjust only primary and keep others (not recommended)?"

## ABSOLUTE COLOR RULES:
- NEVER accept incomplete palettes (must have all 4 colors)
- ALWAYS validate hex format (6-digit #RRGGBB)
- ALWAYS provide visual impact analysis before confirmation
- ALWAYS generate name if missing (descriptive, not "Custom Palette 1")
- ALWAYS verify contrast ratios mention potential issues
`;


export const defaultWorkflowPrompt = `
## STANDARD WORKFLOW EXAMPLES:
User: "Change social icons to solid"
Agent: "should analyse the current design and understand the impact of changing social icons from 'stroked' to 'solid'. based on the it should give recommendations with reasoning."
User: "chooses what he wants"
Agent: "summarizes the change and asks for confirmation"
User: "Yes"
Agent: [Calls updateDesign]
`;

const getClientDesignTool = tool(
	async ({ clientId }) => {
		console.log("getClientDesign", clientId);
		const result = await getClientDesign(clientId);
		console.log("result", result);
		return result;
	},
	{
		name: "getClientDesign",
		description: "Get the current design for a client",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
		}),
	}
);

const updateDesignTool = tool(
	async ({ clientId, designUpdates }) => {
		console.log("updateDesign", clientId, designUpdates);
		const result = await updateDesign(clientId, designUpdates);
		console.log("updateDesign result", result);
		return result;
	},
	{
		name: "updateDesign",
		description: "Update the design for a client",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
			designUpdates: z
				.record(z.any())
				.describe("The design updates to apply as key-value pairs"),
		}),
	}
);

const getQAForClientTool = tool(
	async ({ clientId }) => {
		console.log("getQAForClient", clientId);
		const result = await getQAForClient(clientId);
		console.log("getQAForClient result", result);
		return result;
	},
	{
		name: "getQAForClient",
		description: "Get the questions and the answers answered by a client",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
		}),
	}
);

const designLLM = new AzureChatOpenAI({
	azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
	azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
	azureOpenAIApiDeploymentName: "gpt-4o",
	azureOpenAIApiVersion: "2025-01-01-preview",
	temperature: 0,
}).bindTools([getClientDesignTool, updateDesignTool, getQAForClientTool]);

// Helper to extract clientId from messages (hybrid approach: regex only)
function extractClientId(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.content && typeof msg.content === "string") {
			// Matches: clientId: 6, clientId=6, clientId 6, client 6, for client 6
			const match = msg.content.match(/client(?:Id)?[\s:=]*([0-9]+)/i);
			if (match) return match[1];
		}
	}
	return null;
}

function formatQA(answers) {
	if (!answers || answers.length === 0)
		return "No onboarding answers are available for this client.";
	// Group by question, merge all chosen_options
	const grouped = {};
	answers.forEach((a) => {
		if (!grouped[a.question]) grouped[a.question] = new Set();
		a.chosen_options.forEach((opt) => grouped[a.question].add(opt));
	});
	return Object.entries(grouped)
		.map(
			([q, opts], i) =>
				`Q${i + 1}: ${q}\nA${i + 1}: ${Array.from(opts).join(", ")}`
		)
		.join("\n\n");
}

async function callDesignModel(state) {
	console.log("🧠 DesignAgent\t: Processing messages...");
	console.log("📨 Messages count:", state.messages.length);

	const lastHumanMessage = state.messages
		.filter((m) => m._getType() === "human")
		.pop();

	// if (lastHumanMessage) {
	// 	console.log("💬 Last human message:", lastHumanMessage.content);
	// }

	// Hybrid clientId extraction (regex only)
	const clientId = extractClientId(state.messages);
	const contextMessages = [];

	if (clientId) {
		try {
			const [design, qa] = await Promise.all([
				getClientDesign({ clientId }),
				getQAForClient({ clientId }),
			]);
			contextMessages.push({
				role: "system",
				content: `Current design configuration for client ${clientId}:\n${JSON.stringify(
					design,
					null,
					2
				)}`,
			});
			contextMessages.push({
				role: "system",
				content: `Onboarding/Signup Answers for client ${clientId}:\n${formatQA(
					qa.answers
				)}`,
			});
		} catch (err) {
			console.error("Error fetching design or Q&A context:", err);
		}
	}
	 let workflowPrompt = defaultWorkflowPrompt;
	 const userContent = lastHumanMessage?.content?.toLowerCase() || "";
  
	if (/color|colour|palette|hue|tone|shade|vibrant|muted|warm|cool/.test(userContent)) {
		console.log("Injecting color workflow instructions");
		workflowPrompt = colorPalettePrompt;
	}
  
  // Compose final prompt
  const fullPrompt = designPrompt + workflowPrompt;
	// Compose messages: [system prompt, context, ...existing, user]
	const messages = [
		{ role: "system", content: fullPrompt },
		...contextMessages,
		...state.messages.filter((m) => m._getType() !== "system"),
	];

	function toOpenAIMsg(m) {
		if (m._getType) return { role: m._getType(), content: m.content, ...m };
		if (m.constructor && m.constructor.name === "ToolMessage") {
			return {
				role: "tool",
				content: m.content,
				name: m.name,
				tool_call_id: m.tool_call_id,
				...m,
			};
		}
		if (m.constructor && m.constructor.name === "AIMessage") {
			return { role: "assistant", content: m.content, ...m };
		}
		if (m.role && m.content) return m;
		if (m.kwargs && m.kwargs.content) {
			return {
				role: m.kwargs.role || m.type || "user",
				content: m.kwargs.content,
			};
		}
		return null;
	}
	const openAIMessages = messages.map(toOpenAIMsg).filter(Boolean);

	const response = await designLLM.invoke(openAIMessages);

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

	return { messages: [response] };
}

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
				if (toolCall.name === "getClientDesign") {
					toolResult = await getClientDesign(toolCall.args);
				} else if (toolCall.name === "updateDesign") {
					const rawUpdates = toolCall.args.designUpdates || {};
					const sanitized = sanitizeDesignUpdates(rawUpdates);
					toolCall.args.designUpdates = sanitized;
					console.log("🧽 Sanitized Design Updates:", sanitized);
					toolResult = await updateDesign(toolCall.args);
				} else if (toolCall.name === "getQAForClient") {
					toolResult = await getQAForClient(toolCall.args);
				} else {
					toolResult = { error: `Unknown tool: ${toolCall.name}` };
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
				role: "tool",
				tool_call_id: toolCall.id,
				name: toolCall.name,
				content: JSON.stringify(toolResult),
			};
		})
	);

	console.log("📝 Tool messages created:", toolMessages.length);
	return { messages: toolMessages };
}

function shouldContinueDesign(state) {
	const lastMessage = state.messages[state.messages.length - 1];
	console.log(
		"🤔 DesignAgent should continue? Last message type:",
		lastMessage.type || lastMessage._getType()
	);

	if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
		console.log("➡️ Going to tools");
		return "tools";
	}

	console.log("➡️ Ending");
	return "__end__";
}

export const DesignAgent = new StateGraph(MessagesAnnotation)
	.addNode("llmCall", callDesignModel)
	.addNode("tools", callDesignTools)
	.addEdge("__start__", "llmCall")
	.addConditionalEdges("llmCall", shouldContinueDesign)
	.addEdge("tools", "llmCall")
	.compile();
