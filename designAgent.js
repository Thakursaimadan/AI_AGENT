import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
dotenv.config();

// ✅ Enhanced DesignAgent Prompt with Full Schema and Mapping Logic
export const designPrompt = `
You are DesignAgent. You handle design creation and modification by mapping natural language to a nested schema.

## DATABASE SCHEMA OVERVIEW:
Design includes:
- HeaderDesign: Layout, banner_image_url, social_icon_style
- ColorPalate: primary, secondary, tertiary
- Appearance: background, GradientProp(GradientType, GradientColorType), libraryID, filter, AnimationName
- Blocks: page, LinkBlock, CardBlock, desktopBackground
- Design aspects: CardDesign, ButtonDesign (style, Radius)
- Text: titles, subtitles

## OPERATION TYPES:
- CREATE, READ, UPDATE, DELETE

## FIELD MAPPING:
- "header image" → HeaderDesign.banner_image_url
- "primary color" → ColorPalate.primary
- "background type" → Appearance.background
- "gradient style" → Appearance.GradientProp.GradientType
- "gradient colors" → Appearance.GradientProp.GradientColorType
- "animation" → Appearance.AnimationName
- "card style" → CardDesign.style
- "button radius" → ButtonDesign.Radius
- "title text" → Text.titles

## REQUIRED INFO:
- clientId: always required
- target field(s) and value(s): required for update
- deletion intent must be explicit

## RESPONSE FORMAT:
- Summary of action
- Mapped fields
- Execution result (success/failure)
- Next step if needed

If info is missing, STOP and ask ClarifierAgent for help.
`;

// 🧠 LLM with updated designPrompt
const designLLM = new AzureChatOpenAI({
	azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
	azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
	azureOpenAIApiDeploymentName: "gpt-4o",
	azureOpenAIApiVersion: "2025-01-01-preview",
	temperature: 0,
});

// 🔍 Core design LLM call node
const callDesignModel = async (state) => {
	console.log("🎨 Calling Design Model with state:", state);

	const lastHumanMessage = state.messages
		.filter((m) => m._getType() === "human")
		.pop();

	if (lastHumanMessage) {
		console.log("🧠 Last human message:", lastHumanMessage.content);
	}

	const response = await designLLM.invoke(state.messages);
	console.log("🎯 Design Model response:", response.content);

	if (response.tool_calls) {
		response.tool_calls.forEach((toolCall, index) => {
			console.log(`🔧 Tool call ${index + 1}:`, {
				name: toolCall.name,
				args: toolCall.args,
			});
		});
	}

	return { messages: [response] };
};

// 🛠️ Tool execution node (placeholder to be filled in)
const callDesignTools = async (state) => {
	console.log("🛠️ Executing Design Tools with state:", state);
	// TODO: implement updateDesign, insertDesign, deleteDesign handlers
	return state;
};

// 🤖 Conditional branching
const shouldContinueDesign = (state) => {
	const lastMessage = state.messages[state.messages.length - 1];
	const type = lastMessage.type || lastMessage._getType();
	console.log("🤔 Should continue? Last message type:", type);

	if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
		console.log("➡️ Detected tool calls – going to tools");
		return "tools";
	}

	console.log("✅ No tools needed – ending");
	return "__end__";
};

// 🚀 Compile the full agent graph
export const designAgent = new StateGraph(MessagesAnnotation)
	.addNode("llmCall", callDesignModel)
	.addNode("tools", callDesignTools)
	.addEdge("__start__", "llmCall")
	.addConditionalEdges("llmCall", shouldContinueDesign)
	.addEdge("tools", "llmCall")
	.compile();
