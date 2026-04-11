import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import authRouters from "./routers/auth.routes.js";
import chatRouter from "./routers/chat.routes.js";
import { rateLimiter } from "./middleware/rate-limiter.js";
import { AppError, errorHandler } from "./middleware/error.js";
const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Routes
app.use("/api/auth", authRouters);
app.use(
  "/api/chat",
  rateLimiter({
    windowMs: 60_000, // 1 minute
    maxRequests: 20, // 20 AI requests per minute per user
    message:
      "Too many chat requests. Please wait before sending more messages.",
  }),
  chatRouter,
);

app.get("/", (req, res) => {
  res.status(200).json({ message: "Welcome to the AI Chat API" });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use((req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

app.use(errorHandler);

export default app;
