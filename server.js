import app from "./src/app.js";
import connectDB from "./src/config/database.js";
import config from "./src/config/config.js";

const startServer = async () => {
  try {
    await connectDB();
    app.listen(config.PORT || 3000, () => {
      console.log(`Server is running on port ${config.PORT || 3000}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
