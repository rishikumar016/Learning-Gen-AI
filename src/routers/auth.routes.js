import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  refreshToken,
  getUser,
} from "../controllers/auth.controller.js";
import authMiddleware from "../middleware/auth-middleware.js";
import { validate } from "../middleware/validate.js";
import {
  registerSchema,
  loginSchema,
} from "../validators/auth.validators.js";

const authRouters = express.Router();

/**
 *  @route POST /api/auth/register
 *  @desc Register a new user
 *  @access Public
 */

authRouters.post("/register", validate(registerSchema), registerUser);

authRouters.post("/login", validate(loginSchema), loginUser);

authRouters.get("/logout", authMiddleware, logoutUser);

authRouters.get("/refresh-token", refreshToken);

authRouters.get("/get-user", authMiddleware, getUser);

export default authRouters;
