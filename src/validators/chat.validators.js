import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createConversationSchema = {
  body: z.object({
    content: z
      .string()
      .trim()
      .max(10000, "Message must be at most 10,000 characters")
      .optional(),
  }),
};

export const sendMessageSchema = {
  body: z.object({
    content: z
      .string({ required_error: "Message content is required" })
      .trim()
      .min(1, "Message content is required")
      .max(10000, "Message must be at most 10,000 characters"),
  }),
};

export const conversationParamsSchema = {
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid conversation ID"),
  }),
};

export const getConversationSchema = {
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid conversation ID"),
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};
