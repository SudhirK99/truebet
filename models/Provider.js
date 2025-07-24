const mongoose = require('mongoose');

const ProviderSchema = new mongoose.Schema(
  {
    provider: { type: String, default: null },
    provider_name: { type: String, default: null },
    providerLogos: {
      image_black: { type: String, default: null },
      image_white: { type: String, default: null },
      image_colored: { type: String, default: null },
    },
  },
  { timestamps: true }
);

const Provider = mongoose.model('Provider', ProviderSchema);

module.exports = Provider;
