const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ["Owner", "Partner", "SuperAgent", "Agent", "User"],
    default: "User"
  },
  status: {
    type: String,
    enum: ["active", "blocked"],
    default: "active"
  },
  currency: {
    type: String,
    enum: ["AED", "TRY", "MAD", "EUR", "USD", "TND"],
    default: "TND"
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  provider_password: {
    type: String,
    required: function () {
      return this.role === "User";
    },
  },
  createrid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  userdate: {
    type: Date,
    default: Date.now
  },
  remote_id: {
    type: Number,
  },

  c_id: {
    type: Number,
    unique: true,
    default: function () {
      return Math.floor(1000000 + Math.random() * 9000000); // Generates a 7-digit number
    }
  },
  sessionId: {
    type: String, // Stores the current session ID
  },
  refreshToken: {
    type: String, // Stores the refresh token
  },
  logs: [
    {
      timestamp: {
        type: Date,
        default: Date.now
      },
      action: {
        type: String,
        required: true
      },
      ip: String // Optionally log the user's IP
    }
  ],

  bonus_balance: {
    type: Number,
    default: 0,
    min: 0
  },
  bonus_history: [{
    amount: Number,
    source: String,
    bonusType: String,
    totalDeposit: Number,
    created_at: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled', 'transferred', 'revoked'],
      default: 'active'
    }
  }],
  last_bonus_date: Date,
  total_deposits: Number,
  total_wagered: {
    type: Number,
    default: 0
  }
});

UserSchema.pre("save", function (next) {
  if (typeof this.balance !== "number" || isNaN(this.balance)) {
    console.error(`Invalid balance detected for user ${this._id}: ${this.balance}`);
    this.balance = 0; // Default to 0 for invalid values
  }
  next();
});


const User = mongoose.model("User", UserSchema);
module.exports = User;
