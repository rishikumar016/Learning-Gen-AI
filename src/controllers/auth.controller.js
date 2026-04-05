import User from "../models/user.model.js";
import BlacklistedToken from "../models/blacklist.model.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import config from "../config/config.js";
import { AppError } from "../middleware/error.js";

export const registerUser = async (req, res, next) => {
  const { firstName, lastName, email, password } = req.body;
  try {
    const isAlreadyExist = await User.findOne({
      $or: [{ email }],
    });
    if (isAlreadyExist) {
      return next(new AppError("Email already exists", 400));
    }

    const newUser = new User({
      firstName,
      lastName,
      email,
      password,
    });
    await newUser.save();

    return res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    return next(error);
  }
};

export const loginUser = async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return next(new AppError("Invalid email or password", 400));
    }
    const isPasswordValid = await user.validatePassword(password);
    if (!isPasswordValid) {
      return next(new AppError("Invalid email or password", 400));
    }

    const accessToken = user.getAccessToken();
    const refreshToken = user.getRefreshToken();

    user.refreshToken = await bcrypt.hash(refreshToken, 10);
    await user.save({ validateBeforeSave: false });

    const cookieOptions = {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    return res
      .status(200)
      .cookie("refreshToken", refreshToken, cookieOptions)
      .json({ accessToken });
  } catch (error) {
    return next(error);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return next(new AppError("Refresh token required", 401));
    }

    const decoded = jwt.verify(refreshToken, config.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded._id).select("+refreshToken");
    if (!user || !user.refreshToken) {
      return next(new AppError("Invalid refresh token", 401));
    }

    const isMatch = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!isMatch) {
      return next(new AppError("Invalid refresh token", 401));
    }

    const accessToken = user.getAccessToken();
    const newRefreshToken = user.getRefreshToken();

    user.refreshToken = await bcrypt.hash(newRefreshToken, 10);
    await user.save({ validateBeforeSave: false });

    const cookieOptions = {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    return res
      .status(200)
      .cookie("refreshToken", newRefreshToken, cookieOptions)
      .json({ accessToken });
  } catch (error) {
    return next(error);
  }
};

export const logoutUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return next(new AppError("Authentication required", 401));
    }

    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000);

    await BlacklistedToken.create({ token, expiresAt });

    await User.findByIdAndUpdate(req.user._id, {
      $unset: { refreshToken: "" },
    });

    return res
      .status(200)
      .clearCookie("refreshToken", {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "strict",
      })
      .json({ message: "Logged out successfully" });
  } catch (error) {
    return next(error);
  }
};

export const getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select(
      "-password -refreshToken",
    );
    if (!user) {
      return next(new AppError("User not found", 404));
    }
    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
};
