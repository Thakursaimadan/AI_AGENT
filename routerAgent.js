import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const routerSystemPrompt = `
You are RouterAgent. Analyze the user's input and determine the appropriate route:

## CRITICAL ROUTING RULES

### Route to "design" if ANY of these conditions match:

1. **Design Keywords**: Message contains any of these words:
   - design, designs, designing, layout, appearance, visual, style, styling
   - button, card, banner, background, color, palette, theme, radius, shadow, font
   - gradient, solid, stroked, soft-shadow, hard-shadow
   - classic, compact, banner, imaged (layout types)
   - social icon, social icons, header

2. **Design Actions**: User wants to:
   - "change [design element] to [value]"
   - "show me my design"
   - "get my design"
   - "fetch my design"
   - "see my design"
   - "current design"
   - "design configuration"
   - "design analysis"
   - "design evaluation"
   - "design recommendations"
   - "how would it look"
   - "visual impact"

3. **Design Requests**: User mentions:
   - Changing visual elements (buttons, cards, colors, etc.)
   - Design evaluation or analysis
   - Visual appearance changes
   - Layout modifications
   - Style updates

4. **Client ID + Design**: User provides client ID AND mentions design-related terms

### Route to "editor" if:
- User has specific componentId and wants CRUD operations
- User wants to list components with specific clientId
- User mentions specific components (links, images, music) with IDs
- User asks about "components" specifically with componentId

### Route to "clarify" if:
- User wants to update components but doesn't specify componentId
- User describes components vaguely without IDs
- User needs help identifying components

## DESIGN DETECTION EXAMPLES

✅ DESIGN ROUTES:
- "my client Id is 6 i want to change my social icon style to solid how would it look"
- "i want to change my social icon style to solid"
- "show me my design for client 6"
- "change button radius to full"
- "what's my current design"
- "design recommendations"
- "how would this look"
- "change background to gradient"
- "update card style"
- "client 6 design"

❌ NOT DESIGN ROUTES:
- "list components for client 6" (no design keywords)
- "update component 123 title" (specific component ID)
- "add new link component" (component operation)
- "delete component 456" (component operation)

## PRIORITY RULES
1. If message contains design keywords → design
2. If message contains componentId → editor
3. If message is vague about components → clarify
4. When in doubt about visual/styling → design

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
	const lastMessage = state.messages[state.messages.length - 1];
	const userMessage = lastMessage.content.toLowerCase();
	
	// Log the message for debugging
	console.log("🔍 Router analyzing message:", userMessage);
	
	// Pre-check for common design patterns to help the LLM
	const designKeywords = [
		'design', 'style', 'styling', 'appearance', 'visual', 'layout',
		'button', 'card', 'banner', 'background', 'color', 'palette',
		'gradient', 'solid', 'stroked', 'shadow', 'radius', 'theme',
		'social icon', 'social icons', 'header', 'how would it look',
		'change', 'update', 'modify'
	];
	
	const hasDesignKeywords = designKeywords.some(keyword => 
		userMessage.includes(keyword)
	);
	
	const hasComponentId = /component\s*\d+|componentid\s*\d+/i.test(userMessage);
	
	console.log("🔍 Router analysis:", {
		hasDesignKeywords,
		hasComponentId,
		message: userMessage.substring(0, 100) + "..."
	});

	const response = await routerLLM.invoke(state.messages);
	
	// Log the routing decision
	const toolCall = response.tool_calls?.[0];
	if (toolCall) {
		console.log("🛣️ Router decision:", toolCall.args.route);
	}
	
	return { messages: [response] };
}

export const RouterAgent = new StateGraph(MessagesAnnotation)
	.addNode("llmCall", callModel)
	.addEdge("__start__", "llmCall")
	.addEdge("llmCall", "__end__")
	.compile();