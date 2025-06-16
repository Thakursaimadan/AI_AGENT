import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
	getComponent,
	updateComponent,
	addSecurityGroup,
	deleteComponent,
	removeSecurityGroup,
} from "./componentTools.js";
import { fuse, updateFieldMap } from "./fuseConfig.js";
import { sanitizeUpdates } from "./sanitizeUpdates.js";
import dotenv from "dotenv";

dotenv.config();

export const editorSystemPrompt = `
You are EditorAgent. You handle component CRUD operations and security groups management with intelligent field mapping and natural language understanding.

## DATABASE SCHEMA UNDERSTANDING:
Components table structure:
- component_id, client_id, component_type
- props (JSONB): {title, caption, subtitle, description, text}
- link_props (JSONB): {url, link, href, spacesize, spacing}
- layout_props (JSONB): {textalignment, textAlignment, alignment, filter, aspectRatio, cardType, orientation}
- sawall, sawall_content, layout, schedule_enabled, schedule_start, schedule_end
- manual_edit, is_blur, is_secured, display_order, libraryId

Manual edits table:
- properties (JSONB): {style, radius, cardcolor, cardColor, font, textcolor, textColor, backgroundColor}

## OPERATION TYPES:
1. **CREATE**: Add new components (if supported)
2. **READ**: Get component data
3. **UPDATE**: Modify existing component fields
4. **DELETE**: Remove components permanently
5. **SECURITY**: Add/remove security groups

## INTELLIGENT FIELD MAPPING:
You must map user-friendly terms to actual schema fields. Use this mapping logic:

### Content Fields (props.*):
- "title", "heading", "header" → props.title
- "caption", "subtitle", "subheading" → props.caption  
- "description", "desc", "content", "text" → props.description
- "body", "body text", "main text" → props.text

### Link Fields (link_props.*):
- "link", "url", "href", "website" → link_props.url
- "spacing", "space", "spacesize" → link_props.spacesize

### Layout Fields (layout_props.*):
- "text alignment", "alignment", "align" → layout_props.textalignment
- "filter", "image filter" → layout_props.filter
- "aspect ratio", "ratio" → layout_props.aspectRatio
- "card type", "cardtype" → layout_props.cardType
- "orientation" → layout_props.orientation

### Direct Fields:
- "layout", "template" → layout
- "order", "position", "display order" → display_order
- "blur", "blurred" → is_blur
- "secure", "secured", "security" → is_secured
- "sawall" → sawall
- "sawall content", "sawal content" → sawall_content

### Style Fields (manual_edits.properties.*):
- "border radius", "radius", "corner radius" → properties.radius
- "card color", "background", "bg color" → properties.cardcolor
- "text color", "font color", "color" → properties.textcolor
- "font", "typography" → properties.font
- "style", "custom style" → properties.style

## PROCESSING LOGIC:
1. **Parse user input** to identify operation type and requirements
2. **Check for required parameters**:
   - clientId: Always required
   - componentId: Required for UPDATE, DELETE, and SECURITY operations
3. **If missing critical info**: STOP and request ClarifierAgent assistance
4. **If all info available**: Proceed with operation
5. **Map natural language** to schema fields using the above mappings
6. **Build appropriate request** (update object, deletion, security group operation)
7. **Execute operation** and provide detailed feedback

## REQUIRED INFORMATION CHECK:
Before proceeding with any operation, verify you have:

### For UPDATE operations:
- ✅ clientId
- ✅ componentId
- ✅ At least one field to update

### For DELETE operations:
- ✅ clientId  
- ✅ componentId
- ✅ Clear confirmation intent (delete, remove, destroy)

### For SECURITY GROUP operations:
- ✅ clientId
- ✅ componentId
- ✅ security_group_title (name of the security group)
- ✅ Operation type (add/remove)

### For READ operations:
- ✅ clientId
- ✅ componentId (optional for listing all components)

## MISSING INFORMATION HANDLING:
If ANY required parameter is missing, respond with:
"I need more information to complete this operation. Let me help you identify the component you're working with."

Then STOP processing - DO NOT attempt the operation. The supervisor will route to ClarifierAgent.

## OPERATION EXAMPLES:

### UPDATE Examples:
User: "update link to facebook.com" 
→ Parse: link = facebook.com
→ Map: link → link_props.url  
→ Result: {"link_props": {"url": "facebook.com"}}

User: "change title to Hello World"
→ Parse: title = Hello World
→ Map: title → props.title
→ Result: {"props": {"title": "Hello World"}}

User: "set text alignment to center"
→ Parse: text alignment = center  
→ Map: text alignment → layout_props.textalignment
→ Result: {"layout_props": {"textalignment": "center"}}

User: "make card color blue"
→ Parse: card color = blue
→ Map: card color → properties.cardcolor (manual_edits table)
→ Result: {"properties": {"cardcolor": "blue"}}

### DELETE Examples:
User: "delete component 123"
→ Parse: operation = delete, componentId = 123
→ Execute: deleteComponent(clientId, "123")

User: "remove my card component"
→ Parse: operation = delete, description = "card component"
→ Missing: specific componentId
→ Response: "I need more information to complete this operation..."

### SECURITY GROUP Examples:
User: "add premium security group"
→ Parse: operation = add security group, name = "premium"
→ Execute: addSecurityGroup(clientId, componentId, "premium")

User: "remove admin security group"
→ Parse: operation = remove security group, name = "admin"  
→ Execute: removeSecurityGroup(clientId, componentId, "admin")

## RESPONSIBILITIES:
1. **Parameter Validation**: Always check for required parameters before proceeding
2. **Intelligent Mapping**: Map user terms to correct schema fields
3. **Operation Recognition**: Identify CREATE/READ/UPDATE/DELETE/SECURITY operations
4. **Flexible Input**: Accept various ways users might refer to the same field/operation
5. **Error Handling**: Provide clear feedback when operations fail
6. **Clarification Requests**: Request help when information is missing

## SECURITY GROUP OPERATIONS:
- "add security group [name]" → addSecurityGroup with security_group_title
- "remove/delete security group [name]" → removeSecurityGroup with security_group_title
- Handle duplicate/non-existent group scenarios

## DELETE OPERATIONS:
- "delete component [id]" → deleteComponent with specific ID
- "remove component [id]" → deleteComponent with specific ID
- "destroy component [id]" → deleteComponent with specific ID
- Always confirm deletion was successful
- Handle component not found scenarios

## ERROR SCENARIOS:
- Missing clientId: "I need your client ID to perform this operation"
- Missing componentId: "I need more information to complete this operation. Let me help you identify the component you're working with."
- Unrecognized field: "I couldn't identify which field you want to update. Could you be more specific?"
- Invalid value: "The value provided doesn't match the expected format for this field"
- Database errors: "There was an issue with the database operation. Please try again later."
- Component not found: "The specified component was not found for your client"
- Deletion confirmation: "Component [ID] has been permanently deleted"

## RESPONSE FORMAT:
Always provide:
1. **Confirmation** of what was understood
2. **Action taken** with specific details  
3. **Result status** (success/failure with reasons)
4. **Next steps** if applicable

## CRITICAL RULES:
1. **No Assumptions**: NEVER assume user intent based on conversation history. Each message should be interpreted independently.
2. **Exact Operation Matching**: Match user's exact words to operations:
   - "delete component" = DELETE operation (not security group removal)
   - "remove security group" = SECURITY operation  
   - "update title" = UPDATE operation
3. **Required Information**: If you don't have all required information (clientId + componentId for most operations), IMMEDIATELY respond with a clarification request and STOP processing.
4. **Single Operation Focus**: Process only the current user request, ignore previous operations from conversation history.
5. **Once Confirm Operation**: First, summarize the operation to be performed, ask the user confirmation If the user confirms, proceed with the operation.
## OPERATION KEYWORDS:
Remember: Users don't know the database schema. Your job is to bridge natural language to technical implementation seamlessly while ensuring all required information is available before proceeding.
`;

const getComponentTool = tool(
	async ({ clientId, componentId }) => {
		console.log("🔧 getComponentTool called with:", { clientId, componentId });
		const result = await getComponent({ clientId, componentId });
		console.log("🔧 getComponentTool result:", result);
		return result;
	},
	{
		name: "getComponent",
		description: "Get component data",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
			componentId: z
				.string()
				.optional()
				.describe("The component ID (optional for listing)"),
		}),
	}
);

const updateComponentTool = tool(
	async ({ clientId, componentId, updates }) => {
		console.log("🔧 updateComponentTool called with:");
		console.log("  - clientId:", clientId);
		console.log("  - componentId:", componentId);
		console.log("  - updates:", updates);
		console.log("  - updates type:", typeof updates);

		const result = await updateComponent({ clientId, componentId, updates });
		console.log("🔧 updateComponentTool result:", result);
		return result;
	},
	{
		name: "updateComponent",
		description: "Update component data",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
			componentId: z.string().describe("The component ID"),
			updates: z
				.record(z.any())
				.describe("The updates to apply as key-value pairs"),
		}),
	}
);

const addSecurityGroupTool = tool(
	async ({ clientId, componentId, security_group_title }) => {
		console.log("🔧 addSecurityGroupTool called with:");
		console.log("  - clientId:", clientId);
		console.log("  - componentId:", componentId);
		console.log("  - security_group_title:", security_group_title);
		const result = await addSecurityGroup({
			clientId,
			componentId,
			security_group_title,
		});
		console.log("🔧 addSecurityGroupTool result:", result);

		return result;
	},
	{
		name: "addSecurityGroup",
		description: "Add a security group to a component",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
			componentId: z.string().describe("The component ID"),
			security_group_title: z.string().describe("The security group title"),
		}),
	}
);

const removeSecurityGroupTool = tool(
	async ({ clientId, componentId, security_group_title }) => {
		console.log("🔧 removeSecurityGroupTool called with:");
		console.log("  - clientId:", clientId);
		console.log("  - componentId:", componentId);
		console.log("  - security_group_title:", security_group_title);
		const result = await removeSecurityGroup({
			clientId,
			componentId,
			security_group_title,
		});
		console.log("🔧 removeSecurityGroupTool result:", result);

		return result;
	},
	{
		name: "removeSecurityGroup",
		description: "Remove a security group from a component",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
			componentId: z.string().describe("The component ID"),
			security_group_title: z.string().describe("The security group title"),
		}),
	}
);

const deleteComponentTool = tool(
	async ({ clientId, componentId }) => {
		console.log("🔧 deleteComponentTool called with:");
		console.log("  - clientId:", clientId);
		console.log("  - componentId:", componentId);
		const result = await deleteComponent({ clientId, componentId });
		console.log("🔧 deleteComponentTool result:", result);

		return result;
	},
	{
		name: "deleteComponent",
		description: "Delete a component",
		schema: z.object({
			clientId: z.string().describe("The client ID"),
			componentId: z.string().describe("The component ID"),
		}),
	}
);

const editorLLM = new AzureChatOpenAI({
	azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
	azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
	azureOpenAIApiDeploymentName: "gpt-4o",
	azureOpenAIApiVersion: "2025-01-01-preview",
	temperature: 0,
}).bindTools([
	getComponentTool,
	updateComponentTool,
	addSecurityGroupTool,
	removeSecurityGroupTool,
	deleteComponentTool,
]);

async function callEditorModel(state) {
	console.log("🧠 EditorAgent: Processing messages...");
	console.log("📨 Messages count:", state.messages.length);

	// Log the last human message for debugging
	const lastHumanMessage = state.messages
		.filter((m) => m._getType() === "human")
		.pop();

	if (lastHumanMessage) {
		console.log("💬 Last human message:", lastHumanMessage.content);
	}

	const response = await editorLLM.invoke(state.messages);
	console.log("🤖 EditorAgent LLM response:");
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

async function callEditorTools(state) {
	console.log("🛠️ EditorAgent: Calling tools...");

	const lastMessage = state.messages[state.messages.length - 1];
	const toolCalls = lastMessage.tool_calls || [];

	console.log("🔧 Tool calls found:", toolCalls.length);

	const toolMessages = await Promise.all(
		toolCalls.map(async (toolCall) => {
			console.log("⚡ Executing tool:", toolCall.name);
			console.log("⚡ Tool args:", toolCall.args);

			let toolResult;
			try {
				if (toolCall.name === "getComponent") {
					toolResult = await getComponent(toolCall.args);
				} else if (toolCall.name === "updateComponent") {
					const rawUpdates = toolCall.args.updates || {};
					const normalized = {};

					const { sanitized, rejected } = sanitizeUpdates(rawUpdates);

					if (rejected.length > 0) {
						console.warn("⚠️ Rejected fields:", rejected.join(", "));
					}

					console.log("🔧 Sanitized updates:", sanitized);

					toolCall.args.updates = sanitized;
					console.log("🔧 Normalizing updates...");

					for (const key in rawUpdates) {
						const result = fuse.search(key.toLowerCase());

						if (result.length > 0) {
							const canonical = result[0].item;
							const mappedKey = updateFieldMap[canonical];
							normalized[mappedKey] = rawUpdates[key];
						} else {
							console.warn(`⚠️ Unrecognized field: "${key}", using as-is.`);
							normalized[key] = rawUpdates[key];
						}
					}
					toolCall.args.updates = normalized;
					console.log("🧽 Normalized Updates:", normalized);
					toolResult = await updateComponent(toolCall.args);
				} else if (toolCall.name === "addSecurityGroup") {
					toolResult = await addSecurityGroup(toolCall.args);
				} else if (toolCall.name === "removeSecurityGroup") {
					toolResult = await removeSecurityGroup(toolCall.args);
				} else if (toolCall.name === "deleteComponent") {
					toolResult = await deleteComponent(toolCall.args);
				} else {
					throw new Error(`Unknown tool: ${toolCall.name}`);
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

function shouldContinueEditor(state) {
	const lastMessage = state.messages[state.messages.length - 1];
	console.log(
		"🤔 EditorAgent should continue? Last message type:",
		lastMessage.type || lastMessage._getType()
	);

	if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
		console.log("➡️ Going to tools");
		return "tools";
	}

	console.log("➡️ Ending");
	return "__end__";
}

export const EditorAgent = new StateGraph(MessagesAnnotation)
	.addNode("llmCall", callEditorModel)
	.addNode("tools", callEditorTools)
	.addEdge("__start__", "llmCall")
	.addConditionalEdges("llmCall", shouldContinueEditor)
	.addEdge("tools", "llmCall")
	.compile();
