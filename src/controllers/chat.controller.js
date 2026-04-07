import NodeCache from "node-cache";
import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import {
  getChatCompletion,
  getChatCompletionStream,
} from "../service/service-ai.js";
import { AppError } from "../middleware/error.js";
import { setupSSE, sendSSEEvent } from "../middleware/sse.js";

const MAX_MESSAGES_PER_CONVERSATION = 200;

// Cache active conversations for 10 minutes; flush to MongoDB on expiry
const conversationCache = new NodeCache({
  stdTTL: 600,
  checkperiod: 120,
  useClones: false, // Avoid deep-cloning Mongoose docs on every get
});

// When a cached conversation expires, persist any unsaved messages to MongoDB
conversationCache.on("expired", async (key, conversation) => {
  try {
    if (conversation?.isModified?.()) {
      await conversation.save();
    }
  } catch (err) {
    console.error(`Failed to flush expired conversation ${key}:`, err.message);
  }
});

function cacheKey(userId, conversationId) {
  return `conv:${userId}:${conversationId}`;
}

/**
 * Load conversation from cache or MongoDB.
 * Returns a Mongoose document (not a lean object) so it can be saved.
 */
async function getOrLoadConversation(userId, conversationId) {
  const key = cacheKey(userId, conversationId);
  let conversation = conversationCache.get(key);

  if (!conversation) {
    conversation = await Conversation.findOne({
      _id: conversationId,
      userId,
    });
    if (conversation) {
      conversationCache.set(key, conversation);
    }
  }

  return conversation;
}

/**
 * Remove a conversation from cache.
 */
function evictFromCache(userId, conversationId) {
  conversationCache.del(cacheKey(userId, conversationId));
}

/**
 * POST /api/chat/conversations
 * Create a new conversation
 */
export const createConversation = async (req, res, next) => {
  try {
    const { content } = req.body;

    const conversation = await Conversation.create({
      userId: req.user._id,
    });

    // If user sends a message along with conversation creation, process it
    if (content && typeof content === "string" && content.trim()) {
      conversation.messages.push({ role: "user", content: content.trim() });

      const aiResponse = await getChatCompletion([], content.trim());

      conversation.messages.push({
        role: "assistant",
        content: aiResponse.content,
      });
      conversation.totalTokensUsed += aiResponse.tokensUsed;
      await conversation.save();

      // Cache the active conversation
      conversationCache.set(
        cacheKey(req.user._id, conversation._id),
        conversation,
      );

      const messages = conversation.messages;
      const userMsg = messages[0];
      const assistantMsg = messages[1];

      return res.status(201).json({
        id: conversation._id,
        title: conversation.title,
        userMessage: {
          id: userMsg._id,
          role: userMsg.role,
          content: userMsg.content,
          timestamp: userMsg.createdAt,
        },
        assistantMessage: {
          id: assistantMsg._id,
          role: assistantMsg.role,
          content: assistantMsg.content,
          timestamp: assistantMsg.createdAt,
        },
        tokensUsed: aiResponse.tokensUsed,
      });
    }

    return res.status(201).json({
      id: conversation._id,
      title: conversation.title,
      messages: [],
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /api/chat/conversations
 * List all conversations for the authenticated user
 */
export const getConversations = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ userId: req.user._id })
      .select("title createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json(conversations);
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /api/chat/conversations/:id
 * Get a single conversation with messages.
 * Supports optional pagination: ?page=1&limit=50
 * When no pagination params are provided, returns all messages (backward compatible).
 */
export const getConversation = async (req, res, next) => {
  try {
    const { page, limit } = req.validatedQuery || {};

    // No pagination params → load full doc from cache/DB (backward compatible)
    if (!page && !limit) {
      const conversation = await getOrLoadConversation(
        req.user._id,
        req.params.id,
      );

      if (!conversation) {
        return next(new AppError("Conversation not found", 404));
      }

      return res.status(200).json(conversation);
    }

    // ── Paginated path: use MongoDB aggregation with $slice ──────────
    const pageNum = page || 1;
    const limitNum = limit || 50;

    const userId = new mongoose.Types.ObjectId(req.user._id);
    const convId = new mongoose.Types.ObjectId(req.params.id);

    const result = await Conversation.aggregate([
      { $match: { _id: convId, userId } },
      {
        $addFields: {
          totalMessages: { $size: "$messages" },
        },
      },
      {
        $addFields: {
          // Newest-first: page 1 = last `limit` messages
          _sliceStart: {
            $max: [
              0,
              {
                $subtract: [
                  "$totalMessages",
                  { $multiply: [pageNum, limitNum] },
                ],
              },
            ],
          },
        },
      },
      {
        $project: {
          title: 1,
          totalTokensUsed: 1,
          createdAt: 1,
          updatedAt: 1,
          totalMessages: 1,
          messages: { $slice: ["$messages", "$_sliceStart", limitNum] },
        },
      },
    ]);

    if (!result.length) {
      return next(new AppError("Conversation not found", 404));
    }

    const doc = result[0];
    const totalPages = Math.ceil(doc.totalMessages / limitNum) || 1;

    return res.status(200).json({
      _id: doc._id,
      title: doc.title,
      messages: doc.messages,
      totalTokensUsed: doc.totalTokensUsed,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalMessages: doc.totalMessages,
        totalPages,
      },
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * DELETE /api/chat/conversations/:id
 * Delete a conversation
 */
export const deleteConversation = async (req, res, next) => {
  try {
    const conversation = await Conversation.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!conversation) {
      return next(new AppError("Conversation not found", 404));
    }

    // Remove from cache so stale data isn't served
    evictFromCache(req.user._id, req.params.id);

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/chat/conversations/:id/messages
 * Send a message and get an AI response
 */
export const sendMessage = async (req, res, next) => {
  try {
    const { content } = req.body;

    // Load from cache (fast) or fall back to MongoDB
    const conversation = await getOrLoadConversation(
      req.user._id,
      req.params.id,
    );

    if (!conversation) {
      return next(new AppError("Conversation not found", 404));
    }

    if (conversation.messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
      return next(
        new AppError(
          "Conversation has reached the maximum message limit. Please start a new conversation.",
          400,
        ),
      );
    }

    // Add user message
    conversation.messages.push({ role: "user", content: content.trim() });

    // Build history from cached conversation (no DB read needed)
    const historyForAI = conversation.messages
      .filter((m) => m.role !== "system")
      .slice(-20) // Keep last 20 messages for context window
      .map((m) => ({ role: m.role, content: m.content }));

    // Remove the last message (the one we just added) since getChatCompletion takes it separately
    historyForAI.pop();

    // Get AI response
    const aiResponse = await getChatCompletion(historyForAI, content.trim());

    // Add assistant message
    conversation.messages.push({
      role: "assistant",
      content: aiResponse.content,
    });

    // Track token usage
    conversation.totalTokensUsed += aiResponse.tokensUsed;

    // Persist to MongoDB (cache already has the updated reference via useClones: false)
    await conversation.save();

    // Refresh TTL — keep active conversations in cache longer
    conversationCache.ttl(cacheKey(req.user._id, req.params.id), 600);

    // Return only the new messages (user + assistant)
    const messages = conversation.messages;
    const userMsg = messages[messages.length - 2];
    const assistantMsg = messages[messages.length - 1];

    return res.status(200).json({
      userMessage: {
        id: userMsg._id,
        role: userMsg.role,
        content: userMsg.content,
        timestamp: userMsg.createdAt,
      },
      assistantMessage: {
        id: assistantMsg._id,
        role: assistantMsg.role,
        content: assistantMsg.content,
        timestamp: assistantMsg.createdAt,
      },
      tokensUsed: aiResponse.tokensUsed,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/chat/conversations/:id/messages/stream
 * Send a message and stream the AI response via SSE
 */
export const sendMessageStream = async (req, res, next) => {
  try {
    const { content } = req.body;

    const conversation = await getOrLoadConversation(
      req.user._id,
      req.params.id,
    );

    if (!conversation) {
      return next(new AppError("Conversation not found", 404));
    }

    if (conversation.messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
      return next(
        new AppError(
          "Conversation has reached the maximum message limit. Please start a new conversation.",
          400,
        ),
      );
    }

    // Add user message
    conversation.messages.push({ role: "user", content: content.trim() });
    const userMsg = conversation.messages[conversation.messages.length - 1];

    // Build history for AI
    const historyForAI = conversation.messages
      .filter((m) => m.role !== "system")
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));
    historyForAI.pop();

    // Start SSE
    setupSSE(res);

    sendSSEEvent(res, "userMessage", {
      id: userMsg._id,
      role: userMsg.role,
      content: userMsg.content,
      timestamp: userMsg.createdAt,
    });

    let fullContent = "";
    let tokensUsed = 0;

    try {
      for await (const chunk of getChatCompletionStream(
        historyForAI,
        content.trim(),
      )) {
        if (chunk.type === "token") {
          fullContent += chunk.content;
          sendSSEEvent(res, "token", { content: chunk.content });
        } else if (chunk.type === "tool_start") {
          sendSSEEvent(res, "tool_start", { name: chunk.name });
        } else if (chunk.type === "tool_result") {
          sendSSEEvent(res, "tool_result", { name: chunk.name });
        } else if (chunk.type === "done") {
          fullContent = chunk.content;
          tokensUsed = chunk.tokensUsed;
        }
      }
    } catch (streamError) {
      // Remove the user message we already pushed since the AI call failed
      conversation.messages.pop();
      sendSSEEvent(res, "error", {
        message: streamError.message || "Streaming failed",
      });
      res.end();
      return;
    }

    // Add assistant message and save
    conversation.messages.push({ role: "assistant", content: fullContent });
    conversation.totalTokensUsed += tokensUsed;
    await conversation.save();

    conversationCache.ttl(cacheKey(req.user._id, req.params.id), 600);

    const assistantMsg =
      conversation.messages[conversation.messages.length - 1];

    sendSSEEvent(res, "done", {
      userMessage: {
        id: userMsg._id,
        role: userMsg.role,
        content: userMsg.content,
        timestamp: userMsg.createdAt,
      },
      assistantMessage: {
        id: assistantMsg._id,
        role: assistantMsg.role,
        content: assistantMsg.content,
        timestamp: assistantMsg.createdAt,
      },
      tokensUsed,
    });

    res.end();
  } catch (error) {
    // If headers already sent (SSE started), send error event and close
    if (res.headersSent) {
      sendSSEEvent(res, "error", {
        message: "An unexpected error occurred",
      });
      res.end();
      return;
    }
    return next(error);
  }
};

/**
 * POST /api/chat/conversations/stream
 * Create a new conversation and stream the first AI response via SSE
 */
export const createConversationStream = async (req, res, next) => {
  try {
    const { content } = req.body;

    const conversation = await Conversation.create({
      userId: req.user._id,
    });

    // If no initial message, just return the conversation ID normally
    if (!content) {
      return res.status(201).json({
        id: conversation._id,
        title: conversation.title,
        messages: [],
      });
    }

    conversation.messages.push({ role: "user", content: content.trim() });
    const userMsg = conversation.messages[0];

    // Start SSE
    setupSSE(res);

    sendSSEEvent(res, "conversation", {
      id: conversation._id,
      title: conversation.title,
    });

    sendSSEEvent(res, "userMessage", {
      id: userMsg._id,
      role: userMsg.role,
      content: userMsg.content,
      timestamp: userMsg.createdAt,
    });

    let fullContent = "";
    let tokensUsed = 0;

    try {
      for await (const chunk of getChatCompletionStream([], content.trim())) {
        if (chunk.type === "token") {
          fullContent += chunk.content;
          sendSSEEvent(res, "token", { content: chunk.content });
        } else if (chunk.type === "tool_start") {
          sendSSEEvent(res, "tool_start", { name: chunk.name });
        } else if (chunk.type === "tool_result") {
          sendSSEEvent(res, "tool_result", { name: chunk.name });
        } else if (chunk.type === "done") {
          fullContent = chunk.content;
          tokensUsed = chunk.tokensUsed;
        }
      }
    } catch (streamError) {
      conversation.messages.pop();
      await conversation.save();
      sendSSEEvent(res, "error", {
        message: streamError.message || "Streaming failed",
      });
      res.end();
      return;
    }

    // Add assistant message and save
    conversation.messages.push({ role: "assistant", content: fullContent });
    conversation.totalTokensUsed += tokensUsed;
    await conversation.save();

    // Cache the conversation
    conversationCache.set(
      cacheKey(req.user._id, conversation._id),
      conversation,
    );

    const assistantMsg = conversation.messages[1];

    sendSSEEvent(res, "done", {
      id: conversation._id,
      title: conversation.title,
      userMessage: {
        id: userMsg._id,
        role: userMsg.role,
        content: userMsg.content,
        timestamp: userMsg.createdAt,
      },
      assistantMessage: {
        id: assistantMsg._id,
        role: assistantMsg.role,
        content: assistantMsg.content,
        timestamp: assistantMsg.createdAt,
      },
      tokensUsed,
    });

    res.end();
  } catch (error) {
    if (res.headersSent) {
      sendSSEEvent(res, "error", {
        message: "An unexpected error occurred",
      });
      res.end();
      return;
    }
    return next(error);
  }
};
