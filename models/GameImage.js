const mongoose = require("mongoose");

const GameImageSchema = new mongoose.Schema({
  gameId: { type: String, required: true },
  id_hash: { type: String, required: true, unique: true },
  name: { type: String, required: true, index:true},
  category: { type: String, required: true },
  type: { type: String, required: true },
  subcategory: { type: String },
  details: { type: Object }, // Stores optional data in JSON format
  new: { type: Boolean },
  system: { type: String },
  position: { type: String },
  mobile: { type: Boolean },
  id_parent: { type: String },
  id_hash_parent: { type: String },
  freerounds_supported: { type: Boolean },
  featurebuy_supported: { type: Boolean },
  has_jackpot: { type: Boolean },
  play_for_fun_supported: { type: Boolean },
  image: { type: String },
  image_preview: { type: String },
  image_filled: { type: String },
  image_portrait: { type: String },
  image_square: { type: String },
  image_background: { type: String },
  image_bw: { type: String },
  currency: { type: String },

  // Additional game details
  aspect_ratio: { type: String },
  width: { type: String },
  height: { type: String },
  scale_up: { type: Boolean },
  scale_down: { type: Boolean },
  stretching: { type: Boolean },
  html5: { type: Boolean },
  volatility: { type: String }, // low, medium, high
  max_exposure: { type: String }, // Maximum bet multiplier
  megaways: { type: Boolean },
  bonusbuy: { type: Boolean },
  jackpot_type: { type: String }, // Non-Jackpot, Progressive, etc.

  // Provider details
  provider: { type: String },
  provider_name: { type: String },
  providerLogos: { type: Object },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("GameImage", GameImageSchema);
