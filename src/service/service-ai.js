import Groq from "groq-sdk";
import { tavily } from "@tavily/core";
import { AppError } from "../middleware/error.js";
import config from "../config/config.js";
// import OpenAI from "openai";

const MAX_TOOL_ROUNDS = 5; // Prevent infinite ReAct loops
const MAX_INPUT_LENGTH = 10000; // Max characters per user message

// const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
const groq = new Groq({ apiKey: config.GROQ_API_KEY });

const tavilyClient = tavily({ apiKey: config.TAVILY_API_KEY });

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

const SYSTEM_PROMPT = `You are a helpful, friendly AI assistant for daily conversations and real-time information.

# Core Behavior
- Be concise and natural. Match the user's tone — casual if they're casual, detailed if they need depth.
- When you don't know something or the topic needs current data (news, weather, prices, scores, recent events), use the webSearch tool. Never guess at real-time facts.
- After searching, synthesize the results into a clear answer. Cite key details but don't dump raw data.

# When to Search
Search when the user asks about:
- Current events, news, or anything time-sensitive
- Prices, stock data, scores, or statistics that change
- People, products, or topics you're unsure about
- "Latest," "current," "today," "right now" — any recency signal

Do NOT search for:
- General knowledge, definitions, math, coding help, or personal advice
- Opinions or creative tasks (stories, poems, brainstorming)

# Response Style
- Lead with the answer, then add context if needed.
- Use short paragraphs. Avoid walls of text.
- If a question is ambiguous, give your best answer first, then ask for clarification.
- For complex topics, break things into 2-3 key points max.
- Be honest when uncertain: "Based on what I found..." rather than stating guesses as facts.

Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;

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
        model: "openai/gpt-oss-20b",
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

/**
 * Streaming version of getChatCompletion.
 * Returns an async generator that yields chunks:
 *   { type: 'token', content: string }
 *   { type: 'tool_start', name: string }
 *   { type: 'tool_result', name: string }
 *   { type: 'done', content: string, tokensUsed: number }
 */
export async function* getChatCompletionStream(
  conversationHistory,
  userMessage,
) {
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

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let totalTokensUsed = 0;
  let rounds = 0;
  let fullContent = "";

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let stream;
    try {
      stream = await client.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 4096,
        temperature: 0.7,
        stream: true,
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

    let currentContent = "";
    let toolCalls = [];
    let finishReason = null;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      finishReason = chunk.choices?.[0]?.finish_reason || finishReason;

      if (chunk.usage) {
        totalTokensUsed +=
          (chunk.usage.prompt_tokens || 0) +
          (chunk.usage.completion_tokens || 0);
      }

      if (!delta) continue;

      // Accumulate text content and yield tokens
      if (delta.content) {
        currentContent += delta.content;
        yield { type: "token", content: delta.content };
      }

      // Accumulate tool call deltas
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id || "",
              function: { name: tc.function?.name || "", arguments: "" },
            };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name)
            toolCalls[idx].function.name = tc.function.name;
          if (tc.function?.arguments) {
            toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
    }

    // If the model produced text and no tool calls, we're done
    if (
      toolCalls.length === 0 ||
      finishReason === "stop" ||
      !toolCalls.some((tc) => tc.function?.name)
    ) {
      fullContent += currentContent;
      yield {
        type: "done",
        content: fullContent,
        tokensUsed: totalTokensUsed,
      };
      return;
    }

    // Model wants to call tools — add assistant message with tool_calls, then execute
    const assistantMessage = {
      role: "assistant",
      content: currentContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    };
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.function?.name === "webSearch") {
        yield { type: "tool_start", name: "webSearch" };
        try {
          const args = JSON.parse(toolCall.function.arguments || "{}");
          const response = await webSearch({ query: args.query });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(response),
          });
        } catch (toolError) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              error: "Web search failed. Please answer without search.",
            }),
          });
        }
        yield { type: "tool_result", name: "webSearch" };
      }
    }

    // Reset for the next round (the model will continue with tool results)
    fullContent = "";
  }

  // Exhausted all rounds
  yield {
    type: "done",
    content:
      fullContent || "I was unable to complete the response. Please try again.",
    tokensUsed: totalTokensUsed,
  };
}

async function webSearch({ query }) {
  const client = tavilyClient;
  const response = await client.search(query);
  return response.results;
}
