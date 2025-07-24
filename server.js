const express = require("express");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const http = require("http");
const connectDB = require("./config/db");
const User = require("./models/User");
const { initSocket } = require("./socket");
const { scheduleCron } = require("./controllers/cashbackController");
require("dotenv").config();

// Port
 
const port = process.env.PORT || 3001;

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
// scheduleCron()

// Initialize Socket.IO

// Initialize Socket.IO
initSocket(server, User, jwt);

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : [],
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.set("trust proxy", 1);

// Rate limiter
// const apiLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 1000,
//   message: { success: false, message: "Too many requests, please try again later." },
// });
// app.use("/api", apiLimiter);


// Connect to the database
connectDB();

// Routes
app.use("/auth", require("./routes/authRoutes"));
app.use("/tr", require("./routes/transferRoutes"));
app.use("/api", require("./routes/gameBasicflowRoutes"));
app.use("/hr", require("./routes/gameHistoryRoutes"));
app.use("/", require("./routes/CmsWagerRoutes"));
app.use("/trn", require("./routes/transactionHistoryRoutes"));
app.use("/usb", require("./routes/userBalance"));
app.use("/sb", require("./routes/ticketRoutes"));
app.use("/getProviders", require("./routes/gameProvidersRoutes"));
app.use("/prg", require("./routes/cpypragmaticRoutes"));

// Base route
app.get("/", (req, res) => res.send("Server is running"));

// Global error handler
app.use((err, req, res, next) => {
  console.error("[GLOBAL ERROR HANDLER]:", err.stack || err.message);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// Start the server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
