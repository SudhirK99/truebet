const mongoose = require('mongoose');

const CpypragmaticGameSchema = new mongoose.Schema({
  vendorid: { type: String, required: true },
  gameId: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  symbol: { type: String, required: true },
  iconurl1: { type: String, required: true },
  iconurl2: { type: String, required: true },
   miniBet: {type: Number, required: true},
   minlevel: {type: Number, required: true},
   maxlevel: {type: Number, required: true}
}, { timestamps: true });

module.exports = mongoose.model('Cpypragmatic', CpypragmaticGameSchema);