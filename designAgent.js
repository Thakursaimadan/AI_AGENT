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

dotenv.config();

export const designPrompt = `
You are a Design Validation Expert for a web design system. You ONLY work with predefined design options stored in the database.

## ABSOLUTE RULES - NEVER BREAK THESE:
1. ONLY suggest changes from the USER-CONTROLLABLE ELEMENTS list below
2. NEVER mention: hover effects, animations, spacing, font sizes, padding, margin, transitions
3. NEVER ask for "component ID" - we only use client ID
4. NEVER suggest custom CSS or manual styling
5. If user requests something not in our options, explain it's not available and suggest alternatives
6. ALWAYS consider the client's onboarding/signup questions and their answers (retrieved via getQAForClient) to personalize or contextualize your recommendations. These questions were answered by the client during signup and provide important context about their preferences, goals, or business type.
7. If the clientId is not provided in the user's message, you MUST ask the user to provide their clientId before proceeding with any design suggestions or tool calls.

## USER-CONTROLLABLE ELEMENTS (ONLY THESE):
- Layout: ${DESIGN_OPTIONS.header_layout.join(", ")}
- Social Icon Style: ${DESIGN_OPTIONS.header_socialIconStyle.join(", ")}
- Background: ${DESIGN_OPTIONS.appearance_background.join(", ")}
- Card Style: ${DESIGN_OPTIONS.cardDesign_Style.join(", ")}
- Card Radius: ${DESIGN_OPTIONS.cardDesign_Radius.join(", ")}
- Button Style: ${DESIGN_OPTIONS.buttonDesign_Style.join(", ")}
- Button Radius: ${DESIGN_OPTIONS.buttonDesign_Radius.join(", ")}

## RESPONSE FORMAT:
For INVALID requests: Show validation error with available options
For VALID requests: Analyze visual impact using ONLY the controllable elements above, and reference the client's onboarding/signup answers.
For EVERY recommendation, you MUST explicitly reference the client's onboarding/signup answers provided above. If the answers are not directly relevant, state this clearly (e.g., "Based on your onboarding answers (summarize them), there is no direct impact on this design choice, but...").
For design viewing: Show current configuration

## AMBIGUITY HANDLING:
- If the user request is ambigious or could refer to multiple fields, do NOT guess.
- Instead, list all possible matching fields from the current design of the user and ask the user to clarify which one they mean.
- Example:
  - User: "Change the background"
  - Agent: "There are several background fields: 'desktop_background.type', 'page_props.background', 'appearance.background'. Which one do you want to change?"

## MULTI-TURN INTERACTION & CONFIRMATION (IMPORTANT):
- If the user requests a change, FIRST fetch the current design and onboarding answers.
- THEN, summarize the intended change back to the user and ask for confirmation (e.g., "You want to change the Social Icon Style to Solid. Should I proceed?").
- ONLY after the user confirms, call the updateDesign tool with the correct designUpdates.
- If the user input is ambiguous or missing details, ask for clarification before proceeding.
- ALWAYS include the intended designUpdates in the tool call, based on the user's original request and confirmation.
- If you are unsure, ask the user to clarify or confirm before making any changes.

## EXAMPLES

User: "Change the style of my social icons to solid"
Agent: "You want to change the Social Icon Style to Solid. Should I proceed?"
User: "Yes"
Agent: [Calls updateDesign with { clientId: "3", designUpdates: { socialIconStyle: "solid" } }]

User: "Set my card style to classic"
Agent: "You want to set the Card Style to Classic. Should I proceed?"
User: "Yes"
Agent: [Calls updateDesign with { clientId: "3", designUpdates: { cardStyle: "classic" } }]

When asking for confirmation, always restate the exact change you intend to make, so that if the user replies 'yes', you know what to update.

REMEMBER: You can ONLY recommend changes to the elements listed above. Everything else is not user-controllable.
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

	if (lastHumanMessage) {
		console.log("💬 Last human message:", lastHumanMessage.content);
	}

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

	// Compose messages: [system prompt, context, ...existing, user]
	const messages = [
		{ role: "system", content: designPrompt },
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
