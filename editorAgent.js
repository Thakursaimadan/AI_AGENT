import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { AzureChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getComponent, updateComponent } from './componentTools.js';
import dotenv from 'dotenv';

dotenv.config();

export const editorSystemPrompt = `
You are EditorAgent. You handle component CRUD operations with proper validation and error handling.

Your responsibilities:
1. Validate that all required fields are present (clientId, componentId for updates)
2. If componentId is missing for update operations, respond with "I need to clarify which component you want to update"
3. Call appropriate tools (getComponent, updateComponent)
4. Handle tool results and provide clear feedback to users
5. For errors, explain what went wrong and suggest solutions

For update operations, you must extract the updates from the user's natural language:
- "update link to www.facebook.com" → {"link": "www.facebook.com"}
- "change layout to imageGrid" → {"layout": "imageGrid"}
- "update title to Hello World" → {"props.title": "Hello World"}
- "change caption to New Caption" → {"props.caption": "New Caption"}

Always provide clear, helpful responses about the operation results.
`;

const getComponentTool = tool(
  async ({ clientId, componentId }) => {
    console.log('🔧 getComponentTool called with:', { clientId, componentId });
    const result = await getComponent({ clientId, componentId });
    console.log('🔧 getComponentTool result:', result);
    return result;
  },
  {
    name: "getComponent",
    description: "Get component data",
    schema: z.object({
      clientId: z.string().describe("The client ID"),
      componentId: z.string().optional().describe("The component ID (optional for listing)")
    })
  }
);

const updateComponentTool = tool(
  async ({ clientId, componentId, updates }) => {
    console.log('🔧 updateComponentTool called with:');
    console.log('  - clientId:', clientId);
    console.log('  - componentId:', componentId);
    console.log('  - updates:', updates);
    console.log('  - updates type:', typeof updates);
    
    const result = await updateComponent({ clientId, componentId, updates });
    console.log('🔧 updateComponentTool result:', result);
    return result;
  },
  {
    name: "updateComponent",
    description: "Update component data",
    schema: z.object({
      clientId: z.string().describe("The client ID"),
      componentId: z.string().describe("The component ID"),
      updates: z.record(z.any()).describe("The updates to apply as key-value pairs")
    })
  }
);

const editorLLM = new AzureChatOpenAI({
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: "gpt-4o",
  azureOpenAIApiVersion: "2025-01-01-preview",
  temperature: 0,
}).bindTools([getComponentTool, updateComponentTool]);

async function callEditorModel(state) {
  console.log('🧠 EditorAgent: Processing messages...');
  console.log('📨 Messages count:', state.messages.length);
  
  // Log the last human message for debugging
  const lastHumanMessage = state.messages
    .filter(m => m._getType() === 'human')
    .pop();
  
  if (lastHumanMessage) {
    console.log('💬 Last human message:', lastHumanMessage.content);
  }
  
  const response = await editorLLM.invoke(state.messages);
  console.log('🤖 EditorAgent LLM response:');
  console.log('  - Content:', response.content);
  console.log('  - Tool calls:', response.tool_calls?.length || 0);
  
  if (response.tool_calls) {
    response.tool_calls.forEach((toolCall, index) => {
      console.log(`  - Tool call ${index + 1}:`, {
        name: toolCall.name,
        args: toolCall.args
      });
    });
  }
  
  return { messages: [response] };
}

async function callEditorTools(state) {
  console.log('🛠️ EditorAgent: Calling tools...');
  
  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = lastMessage.tool_calls || [];
  
  console.log('🔧 Tool calls found:', toolCalls.length);
  
  const toolMessages = await Promise.all(
    toolCalls.map(async (toolCall) => {
      console.log('⚡ Executing tool:', toolCall.name);
      console.log('⚡ Tool args:', toolCall.args);
      
      let toolResult;
      try {
        if (toolCall.name === 'getComponent') {
          toolResult = await getComponent(toolCall.args);
        } else if (toolCall.name === 'updateComponent') {
          toolResult = await updateComponent(toolCall.args);
        }
        console.log('✅ Tool execution successful');
      } catch (error) {
        console.error('❌ Tool execution failed:', error);
        toolResult = {
          success: false,
          error: 'Tool execution failed',
          details: error.message
        };
      }
      
      return {
        type: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: JSON.stringify(toolResult)
      };
    })
  );
  
  console.log('📝 Tool messages created:', toolMessages.length);
  return { messages: toolMessages };
}

function shouldContinueEditor(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  console.log('🤔 EditorAgent should continue? Last message type:', lastMessage.type || lastMessage._getType());
  
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    console.log('➡️ Going to tools');
    return "tools";
  }
  
  console.log('➡️ Ending');
  return "__end__";
}

export const EditorAgent = new StateGraph(MessagesAnnotation)
  .addNode("llmCall", callEditorModel)
  .addNode("tools", callEditorTools)
  .addEdge("__start__", "llmCall")
  .addConditionalEdges("llmCall", shouldContinueEditor)
  .addEdge("tools", "llmCall")
  .compile();