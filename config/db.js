const mongoose = require("mongoose");
require('dotenv').config();

mongoose.Promise = global.Promise;

const connectDB = async () => {
  console.log("MONGO_URI:", process.env.MONGO_URI); 

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("Error connecting to database:", error);
    process.exit(1);
  }
};

module.exports = connectDB;
