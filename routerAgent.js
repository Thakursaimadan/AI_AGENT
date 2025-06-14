import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { AzureChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

export const routerSystemPrompt = `
You are RouterAgent. Analyze the user's input and determine the appropriate route:

Route to "editor" if:
- User has specific componentId and wants to perform CRUD operations
- User wants to list components with a specific clientId
- User provides all necessary information for direct component manipulation

Route to "clarify" if:
- User wants to update/modify components but doesn't specify which component (no componentId)
- User describes a component vaguely (e.g., "update the banner", "change the title")
- User needs help identifying which component they want to work with

Always call the router tool with the appropriate route.
`;

const routerTool = tool(
  async ({ route }) => {
    return `Routing to: ${route}`;
  },
  {
    name: "router",
    description: "Route the request to the appropriate agent",
    schema: z.object({
      route: z.enum(["editor", "clarify"]).describe("The route to take")
    })
  }
);

const routerLLM = new AzureChatOpenAI({
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: "gpt-4o",
  azureOpenAIApiVersion: "2025-01-01-preview",
  temperature: 0,
}).bindTools([routerTool]);

async function callModel(state) {
  const response = await routerLLM.invoke(state.messages);
  return { messages: [response] };
}

export const RouterAgent = new StateGraph(MessagesAnnotation)
  .addNode("llmCall", callModel)
  .addEdge("__start__", "llmCall")
  .addEdge("llmCall", "__end__")
  .compile();
