import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: ["user", "assistant", "system"],
    },
    content: {
      type: String,
      required: true,
      maxlength: 50000,
    },
  },
  { timestamps: true },
);

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "New Chat",
      maxlength: 200,
    },
    messages: [messageSchema],
    totalTokensUsed: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

// Auto-generate title from the first user message
conversationSchema.pre("save", async function () {
  // Only set title if it's still the default and there's at least one user message
  if (this.title === "New Chat" && this.messages.length > 0) {
    const firstUserMsg = this.messages.find((m) => m.role === "user");
    if (firstUserMsg) {
      const text = firstUserMsg.content.trim();
      this.title = text.slice(0, 50) + (text.length > 50 ? "..." : "");
    }
  }
  return;
});

// Index for efficient queries: user's conversations sorted by recent
conversationSchema.index({ userId: 1, updatedAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
