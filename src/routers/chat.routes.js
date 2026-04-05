import express from "express";
import authMiddleware from "../middleware/auth-middleware.js";
import {
  createConversation,
  getConversations,
  getConversation,
  deleteConversation,
  sendMessage,
} from "../controllers/chat.controller.js";

const chatRouter = express.Router();

// All chat routes require authentication
chatRouter.use(authMiddleware);

chatRouter.post("/conversations", createConversation);
chatRouter.get("/conversations", getConversations);
chatRouter.get("/conversations/:id", getConversation);
chatRouter.delete("/conversations/:id", deleteConversation);
chatRouter.post("/conversations/:id/messages", sendMessage);

export default chatRouter;
