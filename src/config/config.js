import dotenv from "dotenv";

dotenv.config();

if (!process.env.PORT) {
  throw new Error("PORT is not defined in the environment variables.");
}

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined in the environment variables.");
}
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined in the environment variables.");
}
if (!process.env.REFRESH_TOKEN_SECRET) {
  throw new Error(
    "REFRESH_TOKEN_SECRET is not defined in the environment variables.",
  );
}

if (!process.env.GROQ_API_KEY) {
  console.warn("GROQ_API_KEY is not defined. GROQ integration will not work.");
}

// if (!process.env.OPENAI_API_KEY) {
//   console.warn(
//     "OPENAI_API_KEY is not defined. OpenAI integration will not work.",
//   );
// }

// if (!process.env.OPENAI_MODEL) {
//   console.warn(
//     "OPENAI_MODEL is not defined. OpenAI integration will not work.",
//   );
// }

if (!process.env.TAVILY_API_KEY) {
  console.warn(
    "TAVILY_API_KEY is not defined. Tavily integration will not work.",
  );
}

const config = {
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
  PORT: process.env.PORT,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  // OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  // OPENAI_MODEL: process.env.OPENAI_MODEL,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  NODE_ENV: process.env.NODE_ENV || "development",
};

export default config;
