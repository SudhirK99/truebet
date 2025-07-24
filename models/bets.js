const mongoose = require("mongoose");

const BetSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  type: {
    type: String,
    enum: ['debit', 'credit', 'rollback'], // Include rollback
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
  createdFrom: {
    type: String,
     enum: ['CMSWAGER', 'CASINO'],
  },
  provider:{
    type: mongoose.Schema.Types.Mixed,
     default: "",
  },
  currency:{
    type: mongoose.Schema.Types.Mixed,
     default: "TND",
  },
  jackpot_contribution_per_id:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    jackpot_contribution_ids:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    jackpot_contribution_in_amount:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    odd_factor:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    freeround_id:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    freeround_spins_remaining:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    is_freeround_bet:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    tip_in_amount:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    fee:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    game_id_hash:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    gamesession_id:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    round_id:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    gameplay_final:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    is_freeround_win:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    freeround_completed:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    is_promo_win:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    is_jackpot_win:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    jackpot_win_ids:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    jackpot_win_in_amount:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  },
    is_featurebuy_win:{
    type: mongoose.Schema.Types.Mixed,
    default: "",
  }
});

const Bet = mongoose.model('Bet', BetSchema);
module.exports = Bet;
