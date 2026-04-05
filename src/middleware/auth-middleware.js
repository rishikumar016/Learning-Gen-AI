import config from "../config/config.js";
import User from "../models/user.model.js";
import BlacklistedToken from "../models/blacklist.model.js";
import jwt from "jsonwebtoken";
import { AppError } from "./error.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return next(new AppError("Authentication required", 401));
    }

    const isBlacklisted = await BlacklistedToken.findOne({ token });
    if (isBlacklisted) {
      return next(new AppError("Token is invalid", 401));
    }

    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return next(new AppError("Access token expired", 401));
    }
    if (error.name === "JsonWebTokenError") {
      return next(new AppError("Invalid access token", 401));
    }
    return next(error);
  }
};

export default authMiddleware;
