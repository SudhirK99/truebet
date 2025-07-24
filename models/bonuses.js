const mongoose = require("mongoose");

const BonusesSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Deposit'], // Include rollback
    required: true,
  },
  name: {
    type: String,
    unique: true,
  },
  amount: {
    type: Number,
    required: true,
  },
 amount_type: {
    type: String,
    enum: ['Percentage', 'Fixed'], // Include rollback
    required: true,
   },
   is_enabled: {
    type: Boolean,
    default: false, // Default value ensures rollback field is backward-compatible
  },
  selected_users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
   }],
   is_for_all_users: {
    type: Boolean,
    default: false, 
   }
});

const Bonuses = mongoose.model('Bonuses', BonusesSchema);
module.exports = Bonuses;
