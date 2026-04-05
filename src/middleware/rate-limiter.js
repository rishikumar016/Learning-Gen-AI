import { AppError } from "./error.js";

/**
 * In-memory rate limiter per user.
 * For production, replace with Redis-backed rate limiter (e.g., rate-limit-redis).
 *
 * @param {object} options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.maxRequests - Max requests per window
 * @param {string} [options.message] - Custom error message
 */
export function rateLimiter({ windowMs, maxRequests, message }) {
  const userRequestMap = new Map();

  // Clean up expired entries every minute
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of userRequestMap) {
      if (now - data.windowStart > windowMs) {
        userRequestMap.delete(key);
      }
    }
  }, 60_000);

  // Allow garbage collection if server shuts down
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req, res, next) => {
    // Use user ID if authenticated, otherwise fall back to IP
    const key = req.user?._id || req.ip;
    const now = Date.now();

    let userData = userRequestMap.get(key);

    if (!userData || now - userData.windowStart > windowMs) {
      userData = { windowStart: now, count: 0 };
      userRequestMap.set(key, userData);
    }

    userData.count++;

    // Set rate limit headers
    res.set("X-RateLimit-Limit", String(maxRequests));
    res.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxRequests - userData.count)),
    );
    res.set(
      "X-RateLimit-Reset",
      String(Math.ceil((userData.windowStart + windowMs) / 1000)),
    );

    if (userData.count > maxRequests) {
      return next(
        new AppError(
          message || "Too many requests. Please try again later.",
          429,
        ),
      );
    }

    next();
  };
}
