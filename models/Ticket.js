const mongoose = require("mongoose");

const TicketSchema = new mongoose.Schema({
  ticketCode: {
    type: String,
    required: true,
    unique: true, // Ensure ticket codes are unique
  },
  userId: {
    type: Number, // Assuming userId matches the format in the payload
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ["reserved", "rollbacked", "confirmed", "canceled", "concluded", "running"],
    default: "reserved",
  },
  state: {
    type: String,
  },
  odds: [
    {
      banker: Boolean,
      isLive: Boolean,
      status: Number,
      state: String,
      match: {
        id: String,
        home: String,
        away: String,
        matchDate: Date
      },
      odd: {
        id: String,
        name: String,
        oddValue: Number
      },
      market: {
        id: String,
        name: String
      },
      sport: {
        id: String,
        name: String
      },
      category: {
        id: String,
        name: String
      },
      tournament: {
        id: String,
        name: String
      }
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Ticket = mongoose.model("Ticket", TicketSchema);
module.exports = Ticket;
