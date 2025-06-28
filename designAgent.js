import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { AzureChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { 
  getClientDesign,
  DESIGN_OPTIONS, 
  OPTION_EXPLANATIONS, 
  LAYOUT_DEFINITIONS 
} from "./designTools.js";
import dotenv from "dotenv";

dotenv.config();

const designEvaluationPromptTemplate = `
You are a Design Evaluation Expert. Your job is to analyze design change requests and provide expert recommendations.

## CURRENT DESIGN STATE
{currentDesignAnalysis}

## USER REQUEST
{userRequest}

## ALLOWED DESIGN OPTIONS
{allowedOptionsSummary}

## LAYOUT DEFINITIONS
{layoutDefinitionsSummary}

## YOUR ANALYSIS PROCESS
1. **UNDERSTAND CURRENT STATE**: Analyze how the webpage currently looks based on the design configuration
2. **VALIDATE REQUEST**: Check if the requested change is within allowed options
3. **VISUALIZE IMPACT**: Predict how this change will affect the overall design harmony
4. **EVALUATE COMPATIBILITY**: Consider how this change works with existing elements
5. **PROVIDE RECOMMENDATION**: Give clear advice with reasoning

## RESPONSE FORMAT

### For Specific Change Requests:
**CHANGE REQUEST**: [Summarize what user wants to change]

**VALIDATION**: ✅ Valid / ❌ Invalid
- [Explain if the option exists in allowed choices]

**CURRENT vs PROPOSED**:
- Current: [How it looks now]
- Proposed: [How it will look after change]

**VISUAL IMPACT ANALYSIS**:
- Layout harmony: [How it affects overall balance]
- Element relationship: [How it interacts with other elements]
- User experience: [Impact on usability]

**RECOMMENDATION**: 👍 Good Choice / ⚠️ Consider Alternatives / ❌ Not Recommended
**REASONING**: [Detailed explanation of why]

**ALTERNATIVE SUGGESTIONS** (if applicable):
- [Better options with reasons]

### For General Suggestions:
**CURRENT DESIGN OVERVIEW**: [Summary of current state]

**IMPROVEMENT OPPORTUNITIES**:
1. [Area]: [Specific suggestion]
   - Why: [Reasoning]
   - Impact: [Expected visual result]

2. [Area]: [Specific suggestion]
   - Why: [Reasoning]
   - Impact: [Expected visual result]

**PRIORITY RECOMMENDATIONS**: [Most important changes first]

## EXAMPLES

Example 1 - Specific Change:
**CHANGE REQUEST**: Change button style from 'solid' to 'soft-shadow'

**VALIDATION**: ✅ Valid
- 'soft-shadow' is available in buttonDesign_Style options

**CURRENT vs PROPOSED**:
- Current: Flat buttons with solid fill, clean but basic appearance
- Proposed: Buttons with subtle drop shadows, more dimensional and premium feel

**VISUAL IMPACT ANALYSIS**:
- Layout harmony: Adds depth without disrupting the clean layout structure
- Element relationship: Shadow will create visual hierarchy, making buttons more prominent
- User experience: Enhanced button visibility improves interaction clarity

**RECOMMENDATION**: 👍 Good Choice
**REASONING**: Soft shadows add sophistication without overwhelming the design. Works well with your current clean aesthetic and improves user interaction cues.

Example 2 - Invalid Change:
**CHANGE REQUEST**: Change layout to 'modern-grid'

**VALIDATION**: ❌ Invalid
- 'modern-grid' is not available. Allowed layouts: classic, compact, banner, imaged

**ALTERNATIVE SUGGESTIONS**:
- 'compact': Space-efficient with modern feel
- 'banner': Balanced modern aesthetic with banner capability
`;
export const designPrompt = designEvaluationPromptTemplate;


function analyzeCurrentDesign(designData) {
  if (!designData) {
    return "No design data available - using default configuration";
  }

  let analysis = "## CURRENT DESIGN BREAKDOWN\n\n";
  
  // Header Analysis
  const headerLayout = designData.header_design?.layout || 'classic';
  const headerDef = LAYOUT_DEFINITIONS[headerLayout];
  analysis += `**Layout**: ${headerLayout}\n`;
  analysis += `- Structure: ${headerDef?.Layout_Structure || 'Standard flow'}\n`;
  analysis += `- Visual Style: ${headerDef?.Visual_Style || 'Not specified'}\n\n`;
  
  // Appearance Analysis
  const background = designData.appearance?.background || 'none';
  analysis += `**Background**: ${background}\n`;
  analysis += `- Type: ${OPTION_EXPLANATIONS.appearance_background?.[background] || 'Default'}\n`;
  if (designData.background_mediaUrl) {
    analysis += `- Has background media: Yes\n`;
  }
  if (designData.banner_mediaUrl) {
    analysis += `- Has banner image: Yes\n`;
  }
  analysis += "\n";
  
  // Card Design Analysis
  const cardStyle = designData.card_design?.style || 'solid';
  const cardRadius = designData.card_design?.radius || 'medium';
  analysis += `**Cards**: ${cardStyle} with ${cardRadius} corners\n`;
  analysis += `- Appearance: ${OPTION_EXPLANATIONS.cardDesign_Style?.[cardStyle] || 'Standard'}\n`;
  analysis += `- Corner Style: ${OPTION_EXPLANATIONS.cardDesign_Radius?.[cardRadius] || 'Standard'}\n\n`;
  
  // Button Design Analysis
  const buttonStyle = designData.button_design?.style || 'solid';
  const buttonRadius = designData.button_design?.radius || 'medium';
  analysis += `**Buttons**: ${buttonStyle} with ${buttonRadius} corners\n`;
  analysis += `- Appearance: ${OPTION_EXPLANATIONS.buttonDesign_Style?.[buttonStyle] || 'Standard'}\n`;
  analysis += `- Corner Style: ${OPTION_EXPLANATIONS.buttonDesign_Radius?.[buttonRadius] || 'Standard'}\n\n`;
  
  // Color Analysis
  if (designData.color_palate) {
    analysis += `**Color Palette**: Custom colors defined\n`;
    if (designData.color_palate.primary) {
      analysis += `- Primary: ${designData.color_palate.primary}\n`;
    }
  }

  console.log("\n\nCurrent Design Analysis for testing purpose:\n", analysis,"\n");

  return analysis;
}


// Helper to parse user request and identify intent
function parseUserRequest(userMessage) {
  const message = userMessage.toLowerCase();
  
  // Check for specific change patterns
  const changePatterns = [
    { pattern: /change\s+(.+?)\s+to\s+(.+)/i, type: 'specific_change' },
    { pattern: /set\s+(.+?)\s+to\s+(.+)/i, type: 'specific_change' },
    { pattern: /make\s+(.+?)\s+(.+)/i, type: 'specific_change' },
    { pattern: /update\s+(.+?)\s+to\s+(.+)/i, type: 'specific_change' },
  ];
  
  for (const { pattern, type } of changePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      return {
        type,
        field: match[1].trim(),
        value: match[2].trim(),
        originalRequest: userMessage
      };
    }
  }
  
  // Check for general suggestion requests
  if (message.includes('suggest') || message.includes('recommend') || message.includes('improve')) {
    return {
      type: 'general_suggestion',
      originalRequest: userMessage
    };
  }
  
  return {
    type: 'unclear',
    originalRequest: userMessage
  };
}

// Map user-friendly terms to database fields
const fieldMapping = {
  'layout': 'header_design.layout',
  'header layout': 'header_design.layout',
  'background': 'appearance.background',
  'card style': 'card_design.style',
  'card radius': 'card_design.radius',
  'card corners': 'card_design.radius',
  'button style': 'button_design.style',
  'button radius': 'button_design.radius',
  'button corners': 'button_design.radius',
  'social icons': 'header_design.socialIconStyle'
};

// Get design options key from field name
function getOptionsKey(fieldName) {
  const mappings = {
    'header_design.layout': 'header_layout',
    'appearance.background': 'appearance_background',
    'card_design.style': 'cardDesign_Style',
    'card_design.radius': 'cardDesign_Radius',
    'button_design.style': 'buttonDesign_Style',
    'button_design.radius': 'buttonDesign_Radius',
    'header_design.socialIconStyle': 'header_socialIconStyle'
  };
  return mappings[fieldName];
}

function validateChangeRequest(field, value) {
  const mappedField = fieldMapping[field.toLowerCase()] || field;
  const optionsKey = getOptionsKey(mappedField);
  
  if (!optionsKey || !DESIGN_OPTIONS[optionsKey]) {
    return {
      valid: false,
      reason: `Field '${field}' is not recognized. Available fields: ${Object.keys(fieldMapping).join(', ')}`
    };
  }
  
  const allowedValues = DESIGN_OPTIONS[optionsKey];
  if (!allowedValues.includes(value)) {
    return {
      valid: false,
      reason: `Value '${value}' is not allowed for ${field}. Allowed values: ${allowedValues.join(', ')}`
    };
  }
  
  return {
    valid: true,
    mappedField,
    optionsKey,
    allowedValues
  };
}

// Helper functions
function formatAllowedOptions() {
  let formatted = "";
  for (const [category, options] of Object.entries(DESIGN_OPTIONS)) {
    formatted += `### ${category}\n`;
    options.forEach(option => {
      const explanation = OPTION_EXPLANATIONS[category]?.[option] || 'No description available';
      formatted += `- ${option}: ${explanation}\n`;
    });
    formatted += "\n";
  }
  return formatted;
}

function formatLayoutDefinitions() {
  return Object.entries(LAYOUT_DEFINITIONS)
    .map(([name, def]) => 
      `**${name}**: ${def.Visual_Style}\n` +
      `- Structure: ${def.Layout_Structure}\n` +
      `- Best for: ${def.Best_For}`
    )
    .join("\n\n");
}


async function generatePromptContent(clientId, userMessage) {
  let currentDesignAnalysis = "No design data available";
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
    layoutDefinitionsSummary: formatLayoutDefinitions()
  };
}

const evaluationLLM = new AzureChatOpenAI({
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: "gpt-4o",
  azureOpenAIApiVersion: "2025-01-01-preview",
  temperature: 0.3 // Lower temperature for more consistent analysis
});

async function callEvaluationModel(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  const clientId = extractClientId(lastMessage.content);
  
  if (!clientId) {
    return {
      messages: [new AIMessage({ 
        content: "Please provide a client ID for design evaluation. Format: 'Change button style to soft-shadow for client 123'" 
      })]
    };
  }
  
  try {
    const promptContent = await generatePromptContent(clientId, lastMessage.content);
    
    const dynamicPrompt = designEvaluationPromptTemplate
      .replace("{currentDesignAnalysis}", promptContent.currentDesignAnalysis)
      .replace("{userRequest}", promptContent.userRequest)
      .replace("{allowedOptionsSummary}", promptContent.allowedOptionsSummary)
      .replace("{layoutDefinitionsSummary}", promptContent.layoutDefinitionsSummary);
    
    const updatedMessages = [
      new SystemMessage(dynamicPrompt),
      new HumanMessage(lastMessage.content)
    ];
    
    const response = await evaluationLLM.invoke(updatedMessages);
    
    return {
      messages: [new AIMessage({ content: response.content })]
    };
    
  } catch (error) {
    console.error("Error in callEvaluationModel:", error);
    return {
      messages: [new AIMessage({ 
        content: `Error evaluating design change: ${error.message}` 
      })]
    };
  }
}

// Helper to extract client ID from messages
function extractClientId(messageContent) {
  const match = messageContent.match(/client\s+(\d+)/i);
  return match ? match[1] : null;
}

export const DesignEvaluationAgent = new StateGraph(MessagesAnnotation)
  .addNode("evaluate", callEvaluationModel)
  .addEdge("__start__", "evaluate")
  .addEdge("evaluate", "__end__")
  .compile();

// Export helper functions for external use
export { 
  parseUserRequest, 
  validateChangeRequest, 
  analyzeCurrentDesign 
};