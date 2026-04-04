import "dotenv/config";
import express from "express";
import { getGroqChatCompletion } from "./src/service-ai.js";

const app = express();
app.get("/", (req, res) => {
  res.send("Hello, World!");
});

getGroqChatCompletion();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
