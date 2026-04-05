import express from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  refreshToken,
  getUser,
} from "../controllers/auth-controles.js";
import authMiddleware from "../middleware/auth-middleware.js";

const authRouters = express.Router();

/**
 *  @route POST /api/auth/register
 *  @desc Register a new user
 *  @access Public
 */

authRouters.post("/register", registerUser);

authRouters.post("/login", loginUser);

authRouters.get("/logout", authMiddleware, logoutUser);

authRouters.get("/refresh-token", refreshToken);

authRouters.get("/get-user", authMiddleware, getUser);

export default authRouters;
