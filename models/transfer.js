const mongoose = require("mongoose");

const TransferSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function () {
      return this.type === 'withdraw'; // Required only for withdrawals
    },
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function () {
      return this.type === 'deposit'; // Required only for deposits
    },
  },
  type: {
    type: String,
    enum: ['deposit', 'withdraw', 'debit', 'credit', 'rollback'], // Include rollback
    required: true,
  },
  transaction_id: {
    type: String,
    unique: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  note: {
    type: String,
  },
  gameId: {
    type: String,
  },
  gameName: {
    type: String,
  },
  initiatorIP: {
    type: String,
  },
  initiatorID: {
    type: String,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  balanceBefore: {
    sender: { type: Number }, // Nullable if senderId is not applicable
    receiver: { type: Number }, // Nullable if receiverId is not applicable
  },
  balanceAfter: {
    sender: { type: Number }, // Nullable if senderId is not applicable
    receiver: { type: Number }, // Nullable if receiverId is not applicable
  },
  rolledBack: {
    type: Boolean,
    default: false, // Default value ensures rollback field is backward-compatible
  },
});

const Transfer = mongoose.model('Transfer', TransferSchema);
module.exports = Transfer;
