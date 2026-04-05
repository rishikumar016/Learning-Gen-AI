import Groq from "groq-sdk";
import { tavily } from "@tavily/core";
import { AppError } from "../middleware/error.js";
import config from "../config/config.js";

const MAX_TOOL_ROUNDS = 5; // Prevent infinite ReAct loops
const MAX_INPUT_LENGTH = 10000; // Max characters per user message

groq = new Groq({ apiKey: config.GROQ_API_KEY });

tavilyClient = tavily({ apiKey: config.TAVILY_API_KEY });

const tools = [
  {
    type: "function",
    function: {
      name: "webSearch",
      description:
        "Search the latest information and realtime data from the web",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to perform search on.",
          },
        },
        required: ["query"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are a helpful assistant that can perform web search to answer user queries.
\`webSearch\` tool can be used to perform web search. Always use the tool when you need to search for information on the web.`;

/**
 * Send a chat completion request with tool-use (ReAct loop).
 * @param {Array<{role: string, content: string}>} conversationHistory - Previous messages
 * @param {string} userMessage - The new user message
 * @returns {{ content: string, tokensUsed: number }}
 */
export async function getChatCompletion(conversationHistory, userMessage) {
  if (!userMessage || typeof userMessage !== "string") {
    throw new AppError("Message content is required", 400);
  }

  if (userMessage.length > MAX_INPUT_LENGTH) {
    throw new AppError(
      `Message too long. Maximum ${MAX_INPUT_LENGTH} characters allowed`,
      400,
    );
  }

  const client = groq;

  // Build messages array: system prompt + conversation history + new user message
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let totalTokensUsed = 0;
  let rounds = 0;

  // ReAct Loop: keep calling the model until it stops requesting tools
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let completion;
    try {
      completion = await client.chat.completions.create({
        model: config.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 4096,
        temperature: 0.7,
      });
    } catch (error) {
      if (error.status === 429) {
        throw new AppError(
          "AI service rate limit reached. Please try again later.",
          429,
        );
      }
      if (error.status === 401) {
        throw new AppError("AI service authentication failed", 500);
      }
      throw new AppError(
        `AI service error: ${error.message || "Unknown error"}`,
        502,
      );
    }

    // Track token usage
    if (completion.usage) {
      totalTokensUsed +=
        (completion.usage.prompt_tokens || 0) +
        (completion.usage.completion_tokens || 0);
    }

    const assistantMessage = completion.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new AppError("No response from AI service", 502);
    }

    messages.push(assistantMessage);
    const toolCalls = assistantMessage.tool_calls;

    // If no tool calls, the model is done — return the final answer
    if (!toolCalls || toolCalls.length === 0) {
      return {
        content: assistantMessage.content || "",
        tokensUsed: totalTokensUsed,
      };
    }

    // Execute each requested tool and push results back into messages
    for (const toolCall of toolCalls) {
      if (toolCall.function?.name === "webSearch") {
        try {
          const args = JSON.parse(toolCall.function.arguments || "{}");
          const response = await webSearch({ query: args.query });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(response),
          });
        } catch (toolError) {
          // Push error back to model so it can handle gracefully
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: "Web search failed. Please answer without search.",
            }),
          });
        }
      }
    }
  }

  // If we exhausted all rounds, return what we have
  const lastAssistant = messages
    .filter((m) => m.role === "assistant" && m.content)
    .pop();
  return {
    content:
      lastAssistant?.content ||
      "I was unable to complete the response. Please try again.",
    tokensUsed: totalTokensUsed,
  };
}

async function webSearch({ query }) {
  const client = getTavilyClient();
  const response = await client.search(query);
  return response.results;
}
