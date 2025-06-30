// Fixed design agent with proper validation and cleaner prompts
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { getClientDesignTool, updateDesignTool } from "./designTools.js";

import {
    SystemMessage,
    HumanMessage,
    AIMessage,
} from "@langchain/core/messages";
import {
    getClientDesign,
    DESIGN_OPTIONS,
    OPTION_EXPLANATIONS,
    LAYOUT_DEFINITIONS,
} from "./designTools.js";
import dotenv from "dotenv";

dotenv.config();

// FIXED: Cleaner, more focused prompt with stronger prohibitions
export const designPrompt = `
You are a Design Validation Expert for a web design system. You ONLY work with predefined design options stored in the database.

## ABSOLUTE RULES - NEVER BREAK THESE:
1. ONLY suggest changes from the USER-CONTROLLABLE ELEMENTS list below
2. NEVER mention: hover effects, animations, spacing, font sizes, padding, margin, transitions
3. NEVER ask for "component ID" - we only use client ID
4. NEVER suggest custom CSS or manual styling
5. If user requests something not in our options, explain it's not available and suggest alternatives

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
For VALID requests: Analyze visual impact using ONLY the controllable elements above
For design viewing: Show current configuration

REMEMBER: You can ONLY recommend changes to the elements listed above. Everything else is not user-controllable.
`;

// Map user-friendly terms to database fields (same as before)
const fieldMapping = {
    "layout": "header_design.layout",
    "header layout": "header_design.layout",
    "background": "appearance.background",
    "card style": "card_design.style",
    "card radius": "card_design.radius",
    "card corners": "card_design.radius",
    "button style": "button_design.style",
    "button radius": "button_design.radius",
    "button corners": "button_design.radius",
    "social icons": "header_design.socialIconStyle",
    "social icon": "header_design.socialIconStyle",
    "social icon style": "header_design.socialIconStyle",
    "social icons style": "header_design.socialIconStyle",
    "icon style": "header_design.socialIconStyle",
    "icons": "header_design.socialIconStyle",
};

// Get design options key from field name
function getOptionsKey(fieldName) {
    const mappings = {
        "header_design.layout": "header_layout",
        "appearance.background": "appearance_background",
        "card_design.style": "cardDesign_Style",
        "card_design.radius": "cardDesign_Radius",
        "button_design.style": "buttonDesign_Style",
        "button_design.radius": "buttonDesign_Radius",
        "header_design.socialIconStyle": "header_socialIconStyle",
    };
    return mappings[fieldName];
}

// SAME: Request parsing (keep your existing implementation)
function parseUserRequest(userMessage) {
    const message = userMessage.toLowerCase();

    const changePatterns = [
        { 
            pattern: /(?:change|set|make|update)\s+(?:my\s+)?(.+?)\s+(?:to|from\s+\w+\s+to)\s+(.+?)(?:\s|$)/i, 
            type: "specific_change" 
        },
        { 
            pattern: /(?:want|need)\s+(?:to\s+)?(?:change|set|make|update)\s+(?:my\s+)?(.+?)\s+(?:to|style\s+to)\s+(.+?)(?:\s|$)/i, 
            type: "specific_change" 
        },
        { 
            pattern: /(.+?)\s+(?:should\s+be|to\s+be)\s+(.+?)(?:\s|$)/i, 
            type: "specific_change" 
        }
    ];

    for (const { pattern, type } of changePatterns) {
        const match = userMessage.match(pattern);
        if (match) {
            return {
                type,
                field: match[1].trim(),
                value: match[2].trim(),
                originalRequest: userMessage,
            };
        }
    }

    // Check for design viewing requests
    if (
        message.includes("show") && message.includes("design") ||
        message.includes("see") && message.includes("design") ||
        message.includes("get") && message.includes("design") ||
        message.includes("fetch") && message.includes("design") ||
        message.includes("current design") ||
        message.includes("my design")
    ) {
        return {
            type: "view_design",
            originalRequest: userMessage,
        };
    }

    return {
        type: "unclear",
        originalRequest: userMessage,
    };
}

// SAME: Validation function (keep your existing implementation)
function validateChangeRequest(field, value) {
    console.log(`🔍 Validating request - Field: "${field}", Value: "${value}"`);
    
    const mappedField = fieldMapping[field.toLowerCase()];
    
    if (!mappedField) {
        console.log(`❌ Field mapping failed for: "${field}"`);
        return {
            valid: false,
            reason: `Field '${field}' is not recognized. Available fields: ${Object.keys(fieldMapping).join(", ")}`,
            suggestions: Object.keys(fieldMapping).filter(key => 
                key.includes(field.toLowerCase()) || field.toLowerCase().includes(key)
            )
        };
    }

    const optionsKey = getOptionsKey(mappedField);
    
    if (!optionsKey || !DESIGN_OPTIONS[optionsKey]) {
        console.log(`❌ Options key not found for: "${mappedField}"`);
        return {
            valid: false,
            reason: `Internal error: Options not found for field '${field}'`,
        };
    }

    const allowedValues = DESIGN_OPTIONS[optionsKey];
    const normalizedValue = value.toLowerCase();
    const normalizedAllowedValues = allowedValues.map(v => v.toLowerCase());
    
    if (!normalizedAllowedValues.includes(normalizedValue)) {
        console.log(`❌ Value validation failed. "${value}" not in [${allowedValues.join(", ")}]`);
        return {
            valid: false,
            reason: `Value '${value}' is not allowed for ${field}. Available options: [${allowedValues.join(", ")}]`,
            field: field,
            requestedValue: value,
            allowedValues: allowedValues,
            mappedField,
            optionsKey
        };
    }

    console.log(`✅ Validation successful for: "${field}" = "${value}"`);
    return {
        valid: true,
        mappedField,
        optionsKey,
        allowedValues,
        actualValue: allowedValues[normalizedAllowedValues.indexOf(normalizedValue)]
    };
}

// SAME: Pre-processing (keep your existing implementation)
async function preprocessUserRequest(userMessage, clientId) {
    const parsed = parseUserRequest(userMessage);
    
    if (parsed.type === "specific_change") {
        const validation = validateChangeRequest(parsed.field, parsed.value);
        
        if (!validation.valid) {
            return {
                type: "validation_error",
                error: validation.reason,
                field: parsed.field,
                requestedValue: parsed.value,
                allowedValues: validation.allowedValues,
                suggestions: validation.suggestions,
                originalRequest: userMessage
            };
        }
        
        return {
            type: "valid_change",
            field: parsed.field,
            value: parsed.value,
            validation: validation,
            originalRequest: userMessage
        };
    }
    
    return {
        type: parsed.type,
        originalRequest: userMessage,
        parsed: parsed
    };
}

// FIXED: Much cleaner and focused prompt template
const designEvaluationPromptTemplate = `
## CURRENT DESIGN STATE
{currentDesignAnalysis}

## USER REQUEST
{userRequest}

## REQUEST ANALYSIS
{requestAnalysis}

## STRICT RESPONSE RULES:
1. ONLY recommend changes from USER-CONTROLLABLE ELEMENTS
2. NEVER mention hover effects, animations, spacing, or CSS
3. NEVER ask for component ID (we use client ID only)

## RESPONSE FORMATS:

### For VALIDATION ERRORS:
**VALIDATION**: ❌ Invalid Request

**ERROR**: Value '{requestedValue}' is not allowed for {field}. Available options: [{availableOptions}]

**AVAILABLE OPTIONS for {field}**:
{optionsList}

**SUGGESTION**: Try one of these instead:
- {suggestion1}
- {suggestion2}

### For VALID REQUESTS:
**VALIDATION**: ✅ Valid Request

**CHANGE**: {field} → {requestedValue}

**VISUAL IMPACT**: 
- Current Look: [describe current]
- New Look: [describe after change]
- Overall Effect: [positive/negative impact]

**RECOMMENDATION**: 👍 Great choice / ⚠️ Consider carefully / ❌ Not recommended

**REASONING**: [2-3 sentences explaining why, focusing ONLY on visual design impact]

**WHAT HAPPENS NEXT**: Confirm if you want to proceed with this change to your design.

### For DESIGN VIEWING:
**CURRENT DESIGN CONFIGURATION**:
{currentDesign}

REMEMBER: Only suggest changes to the predefined options. No hover effects, animations, or custom styling, always analyse current design before giving recommendation.
`;

// FIXED: Main agent function with better error handling
async function callEvaluationModel(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    console.log("📝 DesignAgent: Last message:", lastMessage.content);

    try {
        // Extract client ID
        const clientId = extractClientId(lastMessage.content);
        console.log("🔍 Extracted client ID:", clientId);

        // PRE-PROCESS the request for validation
        const preprocessResult = await preprocessUserRequest(lastMessage.content, clientId);
        console.log("🔍 Preprocess result:", preprocessResult);

        // FIXED: Better validation error response
        if (preprocessResult.type === "validation_error") {
            const optionsList = preprocessResult.allowedValues 
                ? preprocessResult.allowedValues.map(opt => {
                    const explanation = OPTION_EXPLANATIONS[getOptionsKey(fieldMapping[preprocessResult.field.toLowerCase()])]?.[opt] || 'Standard option';
                    return `- ${opt}: ${explanation}`;
                }).join('\n')
                : 'No options available';

            const suggestions = preprocessResult.allowedValues ? preprocessResult.allowedValues.slice(0, 2) : [];

            const errorResponse = `**VALIDATION**: ❌ Invalid Request

**ERROR**: Value '${preprocessResult.requestedValue}' is not allowed for ${preprocessResult.field}. Available options: [${preprocessResult.allowedValues?.join(', ') || 'none'}]

**AVAILABLE OPTIONS for ${preprocessResult.field}**:
${optionsList}

**SUGGESTION**: Try one of these instead:
${suggestions.map(opt => `- ${opt}: This might achieve the visual effect you're looking for`).join('\n')}

**NOTE**: We can only modify predefined design options stored in our database. Custom styling is not available.`;

            return {
                messages: [
                    new AIMessage({
                        content: errorResponse,
                    }),
                ],
            };
        }

        // Get design data if needed
        const promptContent = await generatePromptContent(clientId, lastMessage.content);

        // FIXED: Simpler request analysis
        const requestAnalysis = `
**Request Type**: ${preprocessResult.type}
**Status**: ${preprocessResult.type === "valid_change" ? "✅ Valid - proceeding with analysis" : "📋 Analyzing request"}
${preprocessResult.field ? `**Target Field**: ${preprocessResult.field}` : ''}
${preprocessResult.value ? `**Requested Value**: ${preprocessResult.value}` : ''}
        `;

        // FIXED: Cleaner prompt generation
        const dynamicPrompt = designEvaluationPromptTemplate
            .replace("{currentDesignAnalysis}", promptContent.currentDesignAnalysis)
            .replace("{userRequest}", promptContent.userRequest)
            .replace("{requestAnalysis}", requestAnalysis);

        const updatedMessages = [
            new SystemMessage(dynamicPrompt),
            new HumanMessage(lastMessage.content),
        ];

        const response = await evaluationLLM.invoke(updatedMessages);

        console.log("🤖 DesignAgent LLM response:");
        console.log("  - Content:", response.content);
        console.log("  - Tool calls:", response.tool_calls?.length || 0);

        return {
            messages: [
                new AIMessage({
                    content: response.content,
                    tool_calls: response.tool_calls || [],
                }),
            ],
        };
    } catch (error) {
        console.error("Error in callEvaluationModel:", error);
        return {
            messages: [
                new AIMessage({
                    content: `Error evaluating design change: ${error.message}`,
                }),
            ],
        };
    }
}

// Helper to extract client ID from messages (same as before)
function extractClientId(messageContent) {
    const patterns = [
        /client\s*id\s*is\s*(\d+)/i,
        /client\s*id\s*(\d+)/i,
        /client\s+(\d+)/i,
        /clientId\s*(\d+)/i,
        /\bclient\s*:\s*(\d+)/i,
    ];

    for (const pattern of patterns) {
        const match = messageContent.match(pattern);
        if (match) return match[1];
    }

    const numberMatch = messageContent.match(/\b(\d+)\b/);
    if (numberMatch) return numberMatch[1];

    return null;
}

// FIXED: Simpler design analysis
function analyzeCurrentDesign(designData) {
    if (!designData) {
        return "No design data available - using default configuration";
    }

    let analysis = "## CURRENT DESIGN CONFIGURATION\n\n";

    const headerLayout = designData.header_design?.layout || designData.header_design?.Layout || "classic";
    const socialIconStyle = designData.header_design?.['social-icon-style'] || designData.header_design?.socialIconStyle || "solid";
    
    analysis += `**Header Layout**: ${headerLayout}\n`;
    analysis += `**Social Icon Style**: ${socialIconStyle}\n`;
    
    // Add other current settings
    if (designData.appearance?.background) {
        analysis += `**Background**: ${designData.appearance.background}\n`;
    }
    if (designData.card_design?.style) {
        analysis += `**Card Style**: ${designData.card_design.style}\n`;
    }
    if (designData.button_design?.style) {
        analysis += `**Button Style**: ${designData.button_design.style}\n`;
    }

    console.log("\n\nCurrent Design Analysis:\n", analysis, "\n");
    return analysis;
}

// FIXED: Simpler options formatting
function formatAllowedOptions() {
    let formatted = "## AVAILABLE DESIGN OPTIONS\n\n";
    for (const [category, options] of Object.entries(DESIGN_OPTIONS)) {
        const categoryName = category.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
        formatted += `**${categoryName}**: ${options.join(', ')}\n`;
    }
    return formatted;
}

async function generatePromptContent(clientId, userMessage) {
    let currentDesignAnalysis = "No design data available - will be fetched when needed";
    let userRequest = userMessage;

    if (clientId) {
        try {
            const designData = await getClientDesign(clientId);
            currentDesignAnalysis = analyzeCurrentDesign(designData);
        } catch (error) {
            console.error("Error fetching design data:", error);
            currentDesignAnalysis = `Error fetching design data: ${error.message}`;
        }
    }

    return {
        currentDesignAnalysis,
        userRequest,
        allowedOptionsSummary: formatAllowedOptions(),
    };
}

// LLM setup (same as before but without tools since you haven't created CRUD tools yet)
const evaluationLLM = new AzureChatOpenAI({
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiDeploymentName: "gpt-4o",
    azureOpenAIApiVersion: "2025-01-01-preview",
    temperature: 0.3,
});
// REMOVED: .bindTools([getClientDesignTool, updateDesignTool]) since you haven't created CRUD tools yet

// FIXED: Simplified flow since no tools yet
function shouldContinueDesign(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    console.log("Design should continue? Last message type:", lastMessage.type || lastMessage._getType());
    console.log("Last message tool_calls:", lastMessage.tool_calls);

    // Since no CRUD tools yet, always end
    console.log("Ending design evaluation (no CRUD tools implemented yet)");
    return "__end__";
}

// PLACEHOLDER: Tool function for when you implement CRUD
async function callDesignTools(state) {
    console.log("🛠️ DesignAgent: Tools not implemented yet");
    return { messages: [] };
}

export const DesignEvaluationAgent = new StateGraph(MessagesAnnotation)
    .addNode("evaluate", callEvaluationModel)
    // REMOVED: tools node since you haven't implemented CRUD yet
    .addEdge("__start__", "evaluate")
    .addConditionalEdges("evaluate", shouldContinueDesign)
    // REMOVED: tools edges
    .compile();

export { parseUserRequest, validateChangeRequest, analyzeCurrentDesign };