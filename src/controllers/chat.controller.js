import NodeCache from "node-cache";
import Conversation from "../models/conversation.model.js";
import { getChatCompletion } from "../service/service-ai.js";
import { AppError } from "../middleware/error.js";

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

/**
 * Build a cache key scoped to the user to prevent cross-user access.
 */
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
    const { title } = req.body;

    const conversation = await Conversation.create({
      userId: req.user._id,
      title: title || "New Chat",
    });

    return res.status(201).json({
      id: conversation._id,
      title: conversation.title,
      messages: [],
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
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
 * Get a single conversation with messages
 */
export const getConversation = async (req, res, next) => {
  try {
    const conversation = await getOrLoadConversation(
      req.user._id,
      req.params.id,
    );

    if (!conversation) {
      return next(new AppError("Conversation not found", 404));
    }

    return res.status(200).json(conversation);
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

    if (!content || typeof content !== "string" || !content.trim()) {
      return next(new AppError("Message content is required", 400));
    }

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

    // Auto-generate title from first user message
    if (conversation.messages.length === 1) {
      conversation.title =
        content.trim().slice(0, 50) + (content.length > 50 ? "..." : "");
    }

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
