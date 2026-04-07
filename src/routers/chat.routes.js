import express from "express";
import authMiddleware from "../middleware/auth-middleware.js";
import { validate } from "../middleware/validate.js";
import {
  createConversationSchema,
  sendMessageSchema,
  conversationParamsSchema,
  getConversationSchema,
} from "../validators/chat.validators.js";
import {
  createConversation,
  createConversationStream,
  getConversations,
  getConversation,
  deleteConversation,
  sendMessage,
  sendMessageStream,
} from "../controllers/chat.controller.js";

const chatRouter = express.Router();

// All chat routes require authentication
chatRouter.use(authMiddleware);

chatRouter.post(
  "/conversations",
  validate(createConversationSchema),
  createConversation,
);
chatRouter.post(
  "/conversations/stream",
  validate(createConversationSchema),
  createConversationStream,
);
chatRouter.get("/conversations", getConversations);
chatRouter.get(
  "/conversations/:id",
  validate(getConversationSchema),
  getConversation,
);
chatRouter.delete(
  "/conversations/:id",
  validate(conversationParamsSchema),
  deleteConversation,
);
chatRouter.post(
  "/conversations/:id/messages",
  validate({ ...conversationParamsSchema, ...sendMessageSchema }),
  sendMessage,
);
chatRouter.post(
  "/conversations/:id/messages/stream",
  validate({ ...conversationParamsSchema, ...sendMessageSchema }),
  sendMessageStream,
);

export default chatRouter;
