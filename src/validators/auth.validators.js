import { z } from "zod";

export const registerSchema = {
  body: z.object({
    firstName: z
      .string({ required_error: "First name is required" })
      .trim()
      .min(2, "First name must be at least 2 characters")
      .max(30, "First name must be at most 30 characters"),
    lastName: z
      .string({ required_error: "Last name is required" })
      .trim()
      .min(2, "Last name must be at least 2 characters")
      .max(30, "Last name must be at most 30 characters"),
    email: z
      .string({ required_error: "Email is required" })
      .trim()
      .toLowerCase()
      .email("Invalid email address"),
    password: z
      .string({ required_error: "Password is required" })
      .min(8, "Password must be at least 8 characters")
      .regex(/[a-z]/, "Password must contain a lowercase letter")
      .regex(/[A-Z]/, "Password must contain an uppercase letter")
      .regex(/[0-9]/, "Password must contain a digit")
      .regex(/[^a-zA-Z0-9]/, "Password must contain a special character"),
  }),
};

export const loginSchema = {
  body: z.object({
    email: z
      .string({ required_error: "Email is required" })
      .trim()
      .toLowerCase()
      .email("Invalid email address"),
    password: z
      .string({ required_error: "Password is required" })
      .min(1, "Password is required"),
  }),
};
