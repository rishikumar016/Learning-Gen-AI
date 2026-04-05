import config from "./config.js";
import mongoose from "mongoose";

const connectDB = async () => {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log(`Database Connected successfully`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
};

export default connectDB;
