import readline from "readline";
import { RouterAgent, routerSystemPrompt } from "./routerAgent.js";
import { EditorAgent, editorSystemPrompt } from "./editorAgent.js";
import { DesignAgent, designPrompt } from "./designAgent.js";
import { ClarifierAgent, clarifierSystemPrompt } from "./clarifierAgent.js";
import {
	SystemMessage,
	HumanMessage,
	AIMessage,
} from "@langchain/core/messages";
import dotenv from "dotenv";

dotenv.config();

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
let conversation = [];
let pendingOperation = null; // Store operation details from clarifier

async function handleInput(text) {
	try {
		// Check if we have a pending operation from clarifier (user is selecting componentId)
		if (
			pendingOperation &&
			pendingOperation.componentIds &&
			pendingOperation.componentIds.length > 1
		) {
			const selectedIndex = parseInt(text.trim()) - 1;
			if (
				selectedIndex >= 0 &&
				selectedIndex < pendingOperation.componentIds.length
			) {
				const selectedComponentId =
					pendingOperation.componentIds[selectedIndex];

				// Now call editor with the selected componentId
				const editorResult = await EditorAgent.invoke({
					messages: [
						new SystemMessage(editorSystemPrompt),
						...conversation,
						new HumanMessage({
							content: `Update component with clientId: ${
								pendingOperation.clientId
							}, componentId: ${selectedComponentId}, updates: ${JSON.stringify(
								pendingOperation.updates
							)}`,
						}),
					],
				});

				pendingOperation = null; // Clear pending operation
				const lastAIMessage = editorResult.messages
					.filter((m) => m._getType() === "ai")
					.pop();
				return lastAIMessage ? lastAIMessage.content : "Update completed.";
			} else {
				return "Invalid selection. Please choose a valid number from the list.";
			}
		}

		// 1) Route through supervisor
		const routeResult = await RouterAgent.invoke({
			messages: [
				new SystemMessage(routerSystemPrompt),
				...conversation,
				new HumanMessage({ content: text }),
			],
		});

		// Find the AI message with routing decision
		const aiMessage = routeResult.messages.find((m) => m._getType() === "ai");
		let route = "editor"; // default

		// console.log("🔍 Router response:", aiMessage?.content || "No content");
		// console.log("🔧 Router tool calls:", aiMessage?.tool_calls?.length || 0);

		if (aiMessage && aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
			const toolCall = aiMessage.tool_calls[0];
			route = toolCall.args.route;
			console.log("🛣️ Router tool call args:", toolCall.args);
		}

		console.log("🛣️ Router chose route:", route);

		// 2) Delegate based on route
		if (route === "editor") {
			const editorResult = await EditorAgent.invoke({
				messages: [
					new SystemMessage(editorSystemPrompt),
					...conversation,
					new HumanMessage({ content: text }),
				],
			});
			const lastAIMessage = editorResult.messages
				.filter((m) => m._getType() === "ai")
				.pop();

			// Check if editor is requesting clarification
			if (lastAIMessage && lastAIMessage.content.includes("need to clarify")) {
				route = "clarify";
			} else {
				return lastAIMessage
					? lastAIMessage.content
					: "No response from editor agent.";
			}
		}

		if (route === "design") {
			const designResult = await DesignAgent.invoke({
				messages: [
					new SystemMessage(designPrompt),
					...conversation,
					new HumanMessage({ content: text }),
				],
			});

			const lastAIMessage = designResult.messages
				.filter((m) => m._getType() === "ai")
				.pop();

			if (lastAIMessage && lastAIMessage.content.includes("Please select")) {
				pendingOperation = extractOperationDetails(text);
			}

			return lastAIMessage
				? lastAIMessage.content
				: "No response from design agent.";
		}

		if (route === "clarify") {
			const clarifierResult = await ClarifierAgent.invoke({
				messages: [
					new SystemMessage(clarifierSystemPrompt),
					...conversation,
					new HumanMessage({ content: text }),
				],
			});

			const lastAIMessage = clarifierResult.messages
				.filter((m) => m._getType() === "ai")
				.pop();

			// Check if clarifier found multiple components and is asking user to choose
			if (lastAIMessage && lastAIMessage.content.includes("Please select")) {
				// Extract operation details from the conversation for later use
				pendingOperation = extractOperationDetails(text);
			}

			return lastAIMessage
				? lastAIMessage.content
				: "No response from clarifier agent.";
		}

		return "Sorry, I can only help with component editing right now.";
	} catch (error) {
		console.error("Error in handleInput:", error);
		return "Sorry, there was an error processing your request. Please try again.";
	}
}

function extractOperationDetails(text) {
	// Extract clientId, operation type, and updates from the user's message
	const clientIdMatch = text.match(/client\s+(\d+)/i);
	const updateMatch = text.match(/update|change|modify/i);

	return {
		clientId: clientIdMatch ? clientIdMatch[1] : null,
		operation: updateMatch ? "update" : "get",
		updates: {}, // This would need more sophisticated parsing
		componentIds: [], // Will be populated by clarifier
	};
}

console.log("🚀 StateGraph Multi‑Agent CLI is ready. Type your prompt.");
rl.prompt();
rl.on("line", async (line) => {
	const text = line.trim();
	if (!text) return rl.prompt();

	conversation.push(new HumanMessage({ content: text }));
	const reply = await handleInput(text);
	console.log("\n🤖", reply, "\n");
	conversation.push(new AIMessage({ content: reply }));
	rl.prompt();
});
