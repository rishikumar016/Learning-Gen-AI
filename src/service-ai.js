import Groq from "groq-sdk";
import { tavily } from "@tavily/core";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const tavilyClient = tavily(process.env.TAVILY_API_KEY);

export async function getGroqChatCompletion() {
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

  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant that can perform web search to answer user queries.  
          \`webSearch\` tool can be used to perform web search. Always use the tool when you need to search for information on the web.`,
    },
    {
      role: "user",
      content: "What is current weather in Delhi?",
    },
  ];

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    tools,
    tool_choice: "auto",
  });

  const assistantMessage = completion.choices[0].message;
  const toolCalls = assistantMessage.tool_calls;

  if (!toolCalls || toolCalls.length === 0) {
    console.log(`Assistant: ${assistantMessage?.content}`);
    return;
  }

  messages.push(assistantMessage);

  for (const toolCall of toolCalls) {
    if (toolCall.function?.name === "webSearch") {
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const response = await webSearch({ query: args.query });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(response),
      });
    }
  }

  const finalCompletion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    tools,
    tool_choice: "auto",
  });

  console.log(`Assistant: ${finalCompletion.choices[0].message?.content}`);
}

async function webSearch({ query }) {
  console.log("Calling tool");
  const response = await tavilyClient.search(query);
  return response.results;
}
