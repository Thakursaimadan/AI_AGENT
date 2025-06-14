import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { searchComponent } from "./searchTool.js";
import dotenv from "dotenv";

dotenv.config();

export const clarifierSystemPrompt = `
You are ClarifierAgent. Your role is to help users identify the specific component they want to work with.

Process:
1. Extract the clientId from the user's message
2. Parse the component description into search criteria (e.g., "cards" → component_type: "cards", "title" → props.title, etc.)
3. Call searchComponent with the criteria. The tool input must be in this form:
   {
     "clientId": "<client ID as string>",
     "criteria": {
       "<field>": "<value>",
       ...
     }
   }
   Ensure "criteria" is included with meaningful keys like "component_type", "props.title", "props.layout", etc.
4. Based on results:
   - If 0 results: Tell user no matching components found, suggest they check their description
   - If 1 result: Return the componentId and brief description
   - If multiple results: Show numbered list and ask user to select one

Important: Always extract and use the clientId from the user's message. Look for patterns like "client 123", "clientId 123", or "for client 123".
`;

const clarifierLLM = new AzureChatOpenAI({
	azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
	azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
	azureOpenAIApiDeploymentName: "gpt-4o",
	azureOpenAIApiVersion: "2025-01-01-preview",
	temperature: 0,
}).bindTools([searchComponent]);

async function callClarifierModel(state) {
	const response = await clarifierLLM.invoke(state.messages);
	return { messages: [response] };
}

async function callClarifierTools(state) {
	const lastMessage = state.messages[state.messages.length - 1];
	const toolCalls = lastMessage.tool_calls || [];

	const toolMessages = await Promise.all(
		toolCalls.map(async (toolCall) => {
			console.log("Args:", toolCall.args);
			const toolResult = await searchComponent.invoke(toolCall.args);
			return {
				type: "tool",
				tool_call_id: toolCall.id,
				name: toolCall.name,
				content: JSON.stringify(toolResult),
			};
		})
	);

	return { messages: toolMessages };
}

function shouldContinue(state) {
	const lastMessage = state.messages[state.messages.length - 1];
	if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
		return "tools";
	}
	return "__end__";
}

export const ClarifierAgent = new StateGraph(MessagesAnnotation)
	.addNode("llmCall", callClarifierModel)
	.addNode("tools", callClarifierTools)
	.addEdge("__start__", "llmCall")
	.addConditionalEdges("llmCall", shouldContinue)
	.addEdge("tools", "llmCall")
	.compile();
