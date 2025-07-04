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
For VALID requests: Analyze visual impact using ONLY the controllable elements above, and reference the client's onboarding/signup answers if they are relevant to the suggestion.
For design viewing: Show current configuration

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

async function callDesignModel(state) {
	console.log("🧠 DesignAgent	: Processing messages...");
	console.log("📨 Messages count:", state.messages.length);

	const lastHumanMessage = state.messages
		.filter((m) => m._getType() === "human")
		.pop();

	if (lastHumanMessage) {
		console.log("💬 Last human message:", lastHumanMessage.content);
	}

	const response = await designLLM.invoke(state.messages);

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
					toolResult = await updateDesign(toolCall.args);
				} else if (toolCall.name === "getQAForClient") {
					toolResult = await getQAForClient(toolCall.args);
				} else {
					throw new Error(`Unknown tool : ${toolCall.name}`);
				}

				console.log("✅ Tool execution successful");
			} catch (err) {
				console.error("❌ Tool execution failed:", err);
				toolResult = {
					success: false,
					error: "Tool execution failed",
					details: err.message,
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
