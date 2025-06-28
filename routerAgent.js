import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const routerSystemPrompt = `
You are RouterAgent. Analyze the user's input and determine the appropriate route:

Route to "editor" if:
- User has specific componentId and wants to perform CRUD operations
- User wants to list components with a specific clientId
- User provides all necessary information for direct component manipulation
- User mentions specific components (links, images, music, etc.)
- User asks about "components" specifically

Route to "clarify" if:
- User wants to update/modify components but doesn't specify which component (no componentId)
- User describes a component vaguely (e.g., "update the banner", "change the title")
- User needs help identifying which component they want to work with

### Route to "design" if the user's request involves:
1. **Visual/styling changes**: Any of these keywords appear:  
   \`button, card, banner, background, color, palette, layout, spacing, theme, radius, shadow, font, style, appearance\`

2. **Design-related requests**: User mentions:
   - "design", "designs", "designing"
   - "fetch my design", "get my design", "show my design"
   - "design configuration", "design settings"
   - "visual appearance", "look and feel"
   - "design evaluation", "design analysis"
   - "I am asking about Design" (explicitly mentions design)
   - "I asked it to fetch my Design" (explicitly mentions design)
   - "Show me my design" (explicitly mentions design)
   - "current design" (explicitly mentions design)

3. **Layout and styling**: User asks about:
   - Overall webpage appearance
   - Design templates or themes
   - Visual styling options
   - Design recommendations

#### Few‑Shot Examples
User: "Change button radius to full"  
→ Route: design

User: "List all cards for client 42"  
→ Route: editor

User: "Can you suggest a new color palette?"  
→ Route: design

User: "Update component 123 title to 'Welcome'"  
→ Route: editor

User: "I am asking about Design not components"  
→ Route: design

User: "I asked it to fetch my Design"  
→ Route: design

User: "Show me my current design"  
→ Route: design

User: "What's my current design configuration?"  
→ Route: design

User: "I want to see my design"  
→ Route: design

User: "Design not components"  
→ Route: design

User: "Show me my design for client 6"  
→ Route: design

User: "Get my design configuration"  
→ Route: design

Always call the router tool with exactly one of: editor, clarify, or design.
`;
const routerTool = tool(
	async ({ route }) => {
		return `Routing to: ${route}`;
	},
	{
		name: "router",
		description: "Route the request to the appropriate agent",
		schema: z.object({
			route: z
				.enum(["editor", "clarify", "design"])
				.describe("The route to take"),
		}),
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
