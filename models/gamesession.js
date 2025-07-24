const mongoose = require("mongoose");

const GameSessionSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
    },
    gameId: {
      type: String,
      required: true,
    },
    gamesession_id: {
      type: String,
      required: true,
      unique: true,
    },
    launch_time: {
      type: Date,
      default: Date.now,
    },
    currency: {
      type: String,
      enum: ["AED", "TRY", "MAD", "EUR", "USD", "TND"],
      default: "TND"
    },
    play_for_fun: {
      type: Boolean,
      default: false,
    },
    lang: {
      type: String,
      default: "en",
    },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("GameSession", GameSessionSchema);
