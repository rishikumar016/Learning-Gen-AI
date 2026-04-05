import config from "./config.js";
import mongoose from "mongoose";

const connectDB = async () => {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log(`Database Connected successfully`);
  } catch (error) {
    console.error(`Database connection failed: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on("error", (err) => {
  console.error(`Database error: ${err.message}`);
});

export default connectDB;
