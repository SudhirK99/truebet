const axios = require("axios");
const User = require("../models/User");
const Transfer = require("../models/transfer");
const Bet = require("../models/bets");
const Ticket = require("../models/Ticket");
const mongoose = require("mongoose");
const { createLogger, format, transports } = require('winston');
const { GET_ODD_STATUS_STRING } = require("../config/helperFunction");


// CMS Wager API configuration
const CMS_TOKEN_BASE_URL = process.env.CMS_TOKEN_BASE_URL;
const CMS_USER_BASE_URL = process.env.CMS_USER_BASE_URL;

const credentials = {
  clientUsername: process.env.CLIENT_USER_NAME,
  clientPassword: process.env.CLIENT_PASSWORD,
};

let cachedToken = null;
let tokenExpiry = null;

exports.getCMS = async (req, res) => {
  try {
    console.log("[DEBUG] Starting CMS token request...");

    // Use cached token if still valid
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
      console.log("[DEBUG] Using cached token.");
      return res.status(200).json({
        success: true,
        token: cachedToken,
        expiresIn: (tokenExpiry - Date.now()) / 1000, // Remaining time in seconds
      });
    }

    // console.log("[INFO] Requesting a new token...");
    // console.log("[DEBUG] Sending POST request to:", `${CMS_TOKEN_BASE_URL}/get_token`);
    // console.log("[DEBUG] Payload:", JSON.stringify(credentials));

    // Make API request to fetch a new token
    const response = await axios.post(`${CMS_TOKEN_BASE_URL}/get_token`, credentials, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    // console.log("[DEBUG] Full API Response:", JSON.stringify(response.data, null, 2));

    // Validate response structure
    if (response.data && response.data.data) {
      const { token, type, expiry } = response.data.data;

      if (!token) {
        throw new Error("Token is missing from the API response.");
      }

      console.log("[INFO] Token successfully retrieved.");
      console.log("[DEBUG] Token:", token);
      console.log("[DEBUG] Expires in (seconds):", expiry);

      // Cache the token and expiry
      cachedToken = token;
      tokenExpiry = Date.now() + expiry * 1000;

      // Respond with the new token
      return res.status(200).json({
        success: true,
        token,
        tokenType: type,
        expiresIn: expiry,
      });
    } else {
      console.error("[ERROR] Unexpected response structure:", response.data);
      throw new Error("Invalid response format from CMS Wager API.");
    }
  } catch (error) {
    console.error("[ERROR] Error occurred during CMS token retrieval:", error.message);

    if (error.response) {
      // Log detailed error response from API
      console.error("[DEBUG] Response Status Code:", error.response.status);
      console.error("[DEBUG] Response Headers:", JSON.stringify(error.response.headers, null, 2));
      console.error("[DEBUG] Response Body:", JSON.stringify(error.response.data, null, 2));
    } else {
      // Log general error details
      console.error("[DEBUG] Error Details:", error.toJSON ? error.toJSON() : error);
    }

    // Respond with error message
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to authenticate with CMS Wager.",
    });
  }
};


exports.userLogin = async (req, res) => {
  try {
    console.log("[DEBUG] Starting user login/register process...");

    const { userId, currency, type } = req.body;

    if (!userId || !currency || !type) {
      console.error("[ERROR] Missing required parameters.");
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: userId, currency, or type.",
      });
    }

    console.log("[DEBUG] Checking if userId exists in the database...");
    const user = await User.findOne({ c_id: userId });
    if (!user) {
      console.error(`[ERROR] User with c_id ${userId} not found.`);
      return res.status(404).json({
        success: false,
        message: `User with ID ${userId} does not exist in the system.`,
      });
    }

    // Ensure valid CMS token
    if (!cachedToken || !tokenExpiry || Date.now() >= tokenExpiry) {
      console.log("[INFO] Token expired or not cached. Fetching new token...");
      const tokenResponse = await axios.post(`${CMS_TOKEN_BASE_URL}/get_token`, {
        clientUsername: process.env.CLIENT_USER_NAME,
        clientPassword: process.env.CLIENT_PASSWORD,
      }, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (tokenResponse.data && tokenResponse.data.data) {
        cachedToken = tokenResponse.data.data.token;
        tokenExpiry = Date.now() + tokenResponse.data.data.expiry * 1000;
      } else {
        throw new Error("Failed to retrieve token.");
      }
    }

    console.log("[INFO] Requesting user login from CMS Wager...");
    const payload = { userId, currency, type };
    const response = await axios.post(`${CMS_USER_BASE_URL}/user/login`, payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cachedToken}`,
      },
    });

    if (response.status === 200 && response.data.isSuccess) {
      const token = response.data.data?.token;

      if (!token) {
        throw new Error("Token not found in the response.");
      }

      console.log("[INFO] User login successful. Token retrieved.");
      return res.status(200).json({
        success: true,
        token,
      });
    } else {
      console.error("[ERROR] Unexpected response:");
      return res.status(500).json({
        success: false,
        message: "Unexpected response from CMS Wager API.",
      });
    }
  } catch (error) {
    console.error("[ERROR] Error during user login:", error.message);

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        message: error.response.data?.error || "Failed to log in/register user.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error occurred during user login.",
    });
  }
};
const logger = createLogger({
  level: 'info',
  format: format.combine(
      format.timestamp(),
      format.printf(({ timestamp, level, message, ...meta }) => {
        let log = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
          log += ` | ${JSON.stringify(meta)}`;
        }
        return log;
      })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/application.log' }),
  ],
});



exports.reserveTicket = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("RESERVE-TICKET: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { UserId: userId, Amount: amount, TransactionType: transactionType, Ticket: ticketPayload } = req.body;

    if (!userId || !amount || !transactionType || !ticketPayload || !ticketPayload.Code || !ticketPayload.Amount) {
      logger.error("RESERVE-TICKET: Missing required fields", {
        requestId,
        payload: req.body,
        validationCheck: {
          userIdExists: !!userId,
          amountExists: !!amount,
          transactionTypeExists: !!transactionType,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
          ticketAmountExists: !!ticketPayload?.Amount,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required fields: UserId, Amount, TransactionType, Ticket, Ticket.Code, or Ticket.Amount.",
      });
    }

    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.warn("RESERVE-TICKET: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    if (user.balance < amount) {
      logger.warn("RESERVE-TICKET: Insufficient balance", { userId, balance: user.balance, amount });
      return res.status(400).json({
        status: "error",
        balance: user.balance,
        error_code: 1004,
        error_message: "Insufficient balance.",
      });
    }

    const balanceBefore = user.balance;
    user.balance -= amount;
    await user.save({ session });

    const bet = new Bet({
      userId: user._id,
      type: "debit",
      transaction_id: ticketPayload.Code,
      amount: amount,
      note: "debit ticket sportsbook",
      balanceBefore: { receiver:parseFloat(balanceBefore?.toFixed(2)) },
      balanceAfter: { receiver: parseFloat(user.balance?.toFixed(2)) },
    });
    await bet.save({ session });



    const newTicket = new Ticket({
      ticketCode: ticketPayload.Code,
      userId,
      amount,
      status: "reserved",
    });
    await newTicket.save({ session });

    logger.info("RESERVE-TICKET: Ticket created", { ticket: newTicket });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("RESERVE-TICKET: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};



exports.rollbackTicket = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("ROLLBACK-TICKET: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { UserId: userId, Amount: amount, TransactionType: transactionType, Ticket: ticketPayload, Reason: reason } = req.body;

    if (!userId || !amount || !transactionType || !ticketPayload || !ticketPayload.Code || !ticketPayload.Amount) {
      logger.error("ROLLBACK-TICKET: Missing required fields", {
        requestId,
        payload: req.body,
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required fields: UserId, Amount, TransactionType, Ticket, Ticket.Code, or Ticket.Amount.",
      });
    }

    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);

    if (!ticketEntry || ticketEntry.status === "rollbacked") {
      logger.info("ROLLBACK-TICKET: Ticket not found or already rollbacked", {
        requestId,
        ticketCode: ticketPayload.Code,
        ticketStatus: ticketEntry ? ticketEntry.status : "not found",
      });
      return res.status(200).json({
        status: "success",
        balance: 0,
        error_code: 0,
        error_message: "Ticket not found or already rollbacked.",
      });
    }

    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.warn("ROLLBACK-TICKET: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    const balanceBefore = user.balance;
    user.balance += ticketEntry.amount;
    await user.save({ session });
    const bet = new Bet({
      userId: user._id,
      type: "rollback",
      transaction_id: ticketPayload.Code+"ROLLBACK",
      amount: ticketEntry.amount,
      note: "Rollback ticket sportsbook due to "+ reason,
      balanceBefore: { receiver: parseFloat(balanceBefore?.toFixed(2)) },
      balanceAfter: { receiver:parseFloat( user.balance?.toFixed(2)) },
    });
    await bet.save({ session });
    ticketEntry.status = "rollbacked";
    await ticketEntry.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("ROLLBACK-TICKET: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};




exports.confirmTicket = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    const { ClientId: clientId, UserId: userId, TransactionType, Ticket: ticketPayload } = req.body;

    // Log the incoming request
    logger.info("CONFIRM-TICKET: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !ticketPayload || !ticketPayload.Code) {
      logger.error("CONFIRM-TICKET: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch ticket
    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);
    if (!ticketEntry || ticketEntry.status !== "reserved") {
      logger.warn("CONFIRM-TICKET: Ticket not found or already processed", {
        requestId,
        ticketCode: ticketPayload.Code,
        ticketStatus: ticketEntry ? ticketEntry.status : "not found",
      });
      return res.status(406).json({
        status: "error",
        balance: 0,
        error_code: 2040,
        error_message: "Ticket not found or already processed.",
      });
    }

    // Calculate refund (if stake is reduced)
    const refund = ticketEntry.amount - ticketPayload.Amount;
    user = await User.findOne({ c_id: userId }).session(session);
    if (refund > 0) {
      user = await User.findOne({ c_id: userId }).session(session);
      if (!user) {
        logger.error("CONFIRM-TICKET: User not found", { requestId, userId });
        return res.status(404).json({
          status: "error",
          balance: 0,
          error_code: 1002,
          error_message: "User not found.",
        });
      }

      const balanceBefore = user.balance;
      user.balance += refund;
      await user.save({ session });

      // Log the refund
      const bet = new Bet({
        userId: user._id,
        type: "credit",
        transaction_id: ticketPayload.Code,
        amount: parseFloat(refund?.toFixed(2)),
        note: "Refund due to reduced stake",
        balanceBefore: { receiver:parseFloat(balanceBefore?.toFixed(2)) },
        balanceAfter: { receiver: parseFloat(user.balance?.toFixed(2)) },
        createdFrom: "CMSWAGER",
      });
      await bet.save({ session });

      logger.info("CONFIRM-TICKET: Refund processed", {
        requestId,
        userId,
        refund,
        balanceBefore,
        balanceAfter: user.balance,
      });
    }

    // Update ticket status
    ticketEntry.status = "confirmed";
    ticketEntry.state = "Running";

    ticketEntry.odds = ticketPayload.Odds?.map(odd => ({
      banker: odd.Banker,
      isLive: odd.IsLive,
      status: odd.Status,
      state: GET_ODD_STATUS_STRING(odd.Status),
      match: {
        id: odd.Match.Id,
        home: odd.Match.Home,
        away: odd.Match.Away,
        matchDate: odd.Match.MatchDate
      },
      odd: {
        id: odd.Odd.Id,
        name: odd.Odd.Name,
        oddValue: odd.Odd.OddValue
      },
      market: {
        id: odd.Market.Id,
        name: odd.Market.Name
      },
      sport: {
        id: odd.Sport.Id,
        name: odd.Sport.Name
      },
      category: {
        id: odd.Category.Id,
        name: odd.Category.Name
      },
      tournament: {
        id: odd.Tournament.Id,
        name: odd.Tournament.Name
      }
    }));

    await ticketEntry.save({ session });

    logger.info("CONFIRM-TICKET: Ticket confirmed", {
      requestId,
      ticketCode: ticketPayload.Code,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user ? user.balance : 0,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("CONFIRM-TICKET: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};


exports.cancelTicket = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("CANCEL-TICKET: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Amount: amount, Ticket: ticketPayload, Code: code, Reason: reason } = req.body;

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !amount || !ticketPayload || !ticketPayload.Code) {
      logger.error("CANCEL-TICKET: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          amountExists: !!amount,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch the ticket
    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);
    if (!ticketEntry || ticketEntry.status === "canceled") {
      logger.warn("CANCEL-TICKET: Ticket not found or already canceled", {
        requestId,
        ticketCode: ticketPayload.Code,
        ticketStatus: ticketEntry ? ticketEntry.status : "not found",
      });
      return res.status(406).json({
        status: "error",
        balance: 0,
        error_code: 2040,
        error_message: "Ticket not found or already canceled.",
      });
    }

    // Fetch the user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("CANCEL-TICKET: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    // Validate balance and ticket amount
    if (typeof user.balance !== "number" || isNaN(user.balance)) {
      throw new Error(`Invalid user balance: ${user.balance}`);
    }
    if (typeof ticketPayload.Amount !== "number" || isNaN(ticketPayload.Amount)) {
      throw new Error(`Invalid ticket amount: ${ticketPayload.Amount}`);
    }

    // Refund the ticket amount to the user
    const balanceBefore = user.balance;
    user.balance += ticketPayload.Amount;
    await user.save({ session });

    // Update the ticket status
    ticketEntry.status = "canceled";
    await ticketEntry.save({ session });

    // Log the transaction in the Transfer model
    const bet = new Bet({
      userId: user._id,
      type: "credit",
      transaction_id: ticketPayload.Code,
      amount: parseFloat(ticketPayload.Amount?.toFixed(2)),
      note: `Cancellation due to: ${reason}`,
      balanceBefore: { receiver:parseFloat( balanceBefore?.toFixed(2) )},
      balanceAfter: { receiver: parseFloat(user.balance?.toFixed(2) )},
      createdFrom: "CMSWAGER",
    });
    await bet.save({ session });

    logger.info("CANCEL-TICKET: Transaction completed", {
      requestId,
      userId,
      ticketCode: ticketPayload.Code,
      balanceBefore,
      balanceAfter: user.balance,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("CANCEL-TICKET: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};



exports.concludeBet = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("CONCLUDE-BET: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Amount: amount, Ticket: ticketPayload } = req.body;

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !ticketPayload || !ticketPayload.Code) {
      logger.error("CONCLUDE-BET: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch the ticket
    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);
    if (!ticketEntry) {
      logger.warn("CONCLUDE-BET: Ticket not found", {
        requestId,
        ticketCode: ticketPayload.Code,
      });
      return res.status(406).json({
        status: "error",
        balance: 0,
        error_code: 2040,
        error_message: "Ticket not found.",
      });
    }

    // Check if the ticket is already concluded
    if (ticketEntry.status === "concluded") {
      logger.warn("CONCLUDE-BET: Ticket already concluded", {
        requestId,
        ticketCode: ticketPayload.Code,
      });
      return res.status(406).json({
        status: "error",
        balance: 0,
        error_code: 2041,
        error_message: "Ticket already concluded.",
      });
    }

    // Fetch the user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("CONCLUDE-BET: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    // Optional deposit to user balance
    let balanceBefore = user.balance;
    if (ticketPayload.TotalWin && ticketPayload.TotalWin > 0) {
      user.balance += ticketPayload.TotalWin;
      await user.save({ session });

      // Log the deposit transaction
      const bet = new Bet({
        userId: user._id,
        type: "credit",
        transaction_id: ticketPayload.Code+"WIN",
        amount: parseFloat(ticketPayload.TotalWin?.toFixed(2)),
        note: "Winnings from ticket conclusion",
        balanceBefore: { receiver:parseFloat( balanceBefore?.toFixed(2)) },
        balanceAfter: { receiver: parseFloat(user.balance?.toFixed(2)) },
        createdFrom: "CMSWAGER",
      });
      await bet.save({ session });

      logger.info("CONCLUDE-BET: Winnings processed", {
        requestId,
        userId,
        ticketCode: ticketPayload.Code,
        totalWin: ticketPayload.TotalWin,
        balanceBefore,
        balanceAfter: user.balance,
      });

      balanceBefore = user.balance; // Update for logging
    }
    const statusMapping = {
      0: "running",
      1: "lost",
      2: "rollbacked",
      3: "confirmed",
      4: "concluded"
    };
    const GET_ODD_STATUS_STRING = (status) => {
      if (status === 0 || status === "0") {
        return "Running"
      } else if (status === 1 || status === "1")
      {
        return "Lost"
      }else if (status === 2 || status === "2")
      {
        return "Won"
      }else if (status === 3 || status === "3")
      {
        return "Void"
      }else if (status === 4 || status === "4")
      {
        return "Cancelled"
      }else if (status === 5 ||status === "5")
      {
        return "Rejected"
      }else if (status === 6 || status === "6")
      {
        return "Cash-Out"
      }else return status
    }
    //const newStatus = statusMapping[ticketPayload.status];
    // Update the ticket status and result date
    const stet1= ticketPayload.Status.toString();

    ticketEntry.status = "concluded";
    ticketEntry.state = GET_ODD_STATUS_STRING(stet1);
    ticketEntry.resultDate = ticketPayload.ResultDate;
    ticketEntry.totalWin = ticketPayload.TotalWin || 0;

    ticketPayload.Odds?.forEach(odd => {
      const existingOdd = ticketEntry.odds.find(o => o.odd.id === odd.Odd.Id);

      if (existingOdd) {
        existingOdd.status = odd.Status;
        const stet = odd.Status.toString();
        existingOdd.state = GET_ODD_STATUS_STRING(stet);
      }
    });


    await ticketEntry.save({ session });

    logger.info("CONCLUDE-BET: Ticket concluded", {
      requestId,
      ticketCode: ticketPayload.Code,
      resultDate: ticketPayload.ResultDate,
      totalWin: ticketPayload.TotalWin,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("CONCLUDE-BET: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};


exports.reopenTicket = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("REOPEN-TICKET: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Amount: amount, Ticket: ticketPayload, Code: code, Reason: reason } = req.body;

    // Validate inputs
    if (
        !clientId ||
        !userId ||
        TransactionType === undefined ||
        !ticketPayload ||
        !ticketPayload.Code ||
        ticketPayload.NewStatus === undefined
    ) {
      logger.error("REOPEN-TICKET: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
          newStatusExists: ticketPayload.NewStatus !== undefined,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Map the numeric status to string
    const statusMapping = {
      0: "canceled",
      1: "reserved",
      2: "rollbacked",
      3: "confirmed",
      4: "concluded",
    };

    const newStatus = statusMapping[ticketPayload.NewStatus];
    if (!newStatus) {
      logger.error("REOPEN-TICKET: Invalid new status value", {
        requestId,
        newStatus: ticketPayload.NewStatus,
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1003,
        error_message: "Invalid new status value.",
      });
    }

    // Fetch the ticket
    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);
    if (!ticketEntry) {
      logger.warn("REOPEN-TICKET: Ticket not found", {
        requestId,
        ticketCode: ticketPayload.Code,
      });
      return res.status(406).json({
        status: "error",
        balance: 0,
        error_code: 2040,
        error_message: "Ticket not found.",
      });
    }

    // Check if the status is already as requested
    if (ticketEntry.status === newStatus) {
      logger.info("REOPEN-TICKET: Ticket already in requested status", {
        requestId,
        ticketCode: ticketPayload.Code,
        currentStatus: ticketEntry.status,
      });
      return res.status(200).json({
        status: "success",
        balance: 0,
        error_code: 0,
        error_message: "Ticket already in the requested status.",
      });
    }

    // Fetch the user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("REOPEN-TICKET: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    // Deduct the balance if transactionType indicates withdrawal
    if (TransactionType === 2 && amount > 0) {
      if (user.balance < amount) {
        logger.warn("REOPEN-TICKET: Not enough balance", {
          requestId,
          userId,
          balance: user.balance,
          amount,
        });
        return res.status(406).json({
          status: "error",
          balance: user.balance,
          error_code: 2001,
          error_message: "Not enough balance.",
        });
      }

      const balanceBefore = user.balance;
      user.balance -= amount;
      await user.save({ session });

      // Log the withdrawal transaction
      const transfer = new Transfer({
        senderId: user._id,
        type: "withdraw",
        transaction_id: ticketPayload.Code,
        amount:parseFloat(amount?.toFixed(2)),
        note: `Reopening ticket due to: ${reason}`,
        balanceBefore: { sender: parseFloat(balanceBefore?.toFixed(2) )},
        balanceAfter: { sender:parseFloat( user.balance?.toFixed(2) )},
      });
      await transfer.save({ session });

      logger.info("REOPEN-TICKET: Withdrawal processed", {
        requestId,
        userId,
        amount,
        balanceBefore,
        balanceAfter: user.balance,
      });
    }

    // Update the ticket status
    ticketEntry.status = newStatus;
    await ticketEntry.save({ session });

    logger.info("REOPEN-TICKET: Ticket status updated", {
      requestId,
      ticketCode: ticketPayload.Code,
      newStatus,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("REOPEN-TICKET: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};


exports.partialCashout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("PARTIAL-CASHOUT: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Amount: amount, Ticket: ticketPayload } = req.body;

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !amount || !ticketPayload || !ticketPayload.Code) {
      logger.error("PARTIAL-CASHOUT: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          amountExists: !!amount,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch the user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("PARTIAL-CASHOUT: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    // Process the cashout amount
    const balanceBefore = user.balance;
    user.balance += ticketPayload.TotalCashout;
    await user.save({ session });

    // Log the transaction in the Transfer model
    const bet = new Bet({
      userId: user._id,
      type: "credit",
      transaction_id: ticketPayload.Code,
      amount: parseFloat(ticketPayload.TotalCashout?.toFixed(2)),
      note: "Partial cashout deposit",
      balanceBefore: { receiver:parseFloat( balanceBefore?.toFixed(2)) },
      balanceAfter: { receiver:parseFloat( user.balance?.toFixed(2)) },
      createdFrom: "CMSWAGER",
    });
    await bet.save({ session });

    logger.info("PARTIAL-CASHOUT: Cashout processed", {
      requestId,
      userId,
      ticketCode: ticketPayload.Code,
      totalCashout: ticketPayload.TotalCashout,
      balanceBefore,
      balanceAfter: user.balance,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("PARTIAL-CASHOUT: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};


exports.rollbackPartialCashout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("ROLLBACK-PARTIAL-CASHOUT: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Amount: amount, Ticket: ticketPayload } = req.body;

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !ticketPayload || !ticketPayload.Code) {
      logger.error("ROLLBACK-PARTIAL-CASHOUT: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch the user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("ROLLBACK-PARTIAL-CASHOUT: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    // Fetch the ticket
    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);
    if (!ticketEntry || ticketEntry.status !== "cashedout") {
      logger.info("ROLLBACK-PARTIAL-CASHOUT: No rollback needed", {
        requestId,
        ticketCode: ticketPayload.Code,
        ticketStatus: ticketEntry ? ticketEntry.status : "not found",
      });
      return res.status(200).json({
        status: "success",
        balance: user.balance,
        error_code: 0,
        error_message: "No rollback needed.",
      });
    }

    // Process the rollback
    const balanceBefore = user.balance;
    user.balance -= ticketPayload.TotalCashout;
    await user.save({ session });

    ticketEntry.status = "running";
    await ticketEntry.save({ session });

    // Log the transaction in the Transfer model
    const bet = new Bet({
      userId: user._id,
      type: "debit",
      transaction_id: ticketPayload.Code,
      amount: parseFloat(ticketPayload.TotalCashout?.toFixed(2)),
      note: "Rollback partial cashout",
      balanceBefore: { sender:parseFloat( balanceBefore?.toFixed(2)) },
      balanceAfter: { sender: parseFloat(user.balance?.toFixed(2)) },
      createdFrom: "CMSWAGER",
    });
    await bet.save({ session });

    logger.info("ROLLBACK-PARTIAL-CASHOUT: Rollback processed", {
      requestId,
      userId,
      ticketCode: ticketPayload.Code,
      totalCashout: ticketPayload.TotalCashout,
      balanceBefore,
      balanceAfter: user.balance,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("ROLLBACK-PARTIAL-CASHOUT: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};


exports.partialPlacement = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("PARTIAL-PLACEMENT: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Ticket: ticketPayload } = req.body;

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !ticketPayload || !ticketPayload.Code) {
      logger.error("PARTIAL-PLACEMENT: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("PARTIAL-PLACEMENT: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    logger.info("PARTIAL-PLACEMENT: User found", {
      requestId,
      userId,
      balance: user.balance,
    });

    // Check user balance
    if (user.balance < ticketPayload.Amount) {
      logger.warn("PARTIAL-PLACEMENT: Insufficient balance", {
        requestId,
        userId,
        balance: user.balance,
        amountRequired: ticketPayload.Amount,
      });
      return res.status(406).json({
        status: "error",
        balance: user.balance,
        error_code: 2001,
        error_message: "Not enough balance.",
      });
    }

    // Deduct balance and save ticket
    const balanceBefore = user.balance;
    user.balance -= ticketPayload.Amount;
    await user.save({ session });

    const newTicket = new Ticket({
      ticketCode: ticketPayload.Code,
      userId,
      amount: parseFloat(ticketPayload.Amount?.toFixed(2)),
      status: "running",
      transactionType: TransactionType,
    });
    await newTicket.save({ session });

    logger.info("PARTIAL-PLACEMENT: Ticket saved", {
      requestId,
      ticketCode: ticketPayload.Code,
      userId,
      amount: ticketPayload.Amount,
    });

    // Log the transaction
    const transfer = new Transfer({
      senderId: user._id,
      type: "withdraw",
      transaction_id: ticketPayload.Code,
      amount: parseFloat(ticketPayload.Amount?.toFixed(2)),
      note: "Partial placement for new bet",
      balanceBefore: { sender:parseFloat( balanceBefore?.toFixed(2)) },
      balanceAfter: { sender: parseFloat(user.balance?.toFixed(2)) },
    });
    await transfer.save({ session });

    logger.info("PARTIAL-PLACEMENT: Transaction logged", {
      requestId,
      userId,
      ticketCode: ticketPayload.Code,
      amount: ticketPayload.Amount,
      balanceBefore,
      balanceAfter: user.balance,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("PARTIAL-PLACEMENT: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};




exports.rollbackPartialPlacement = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("ROLLBACK-PARTIAL-PLACEMENT: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Ticket: ticketPayload } = req.body;

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !ticketPayload || !ticketPayload.Code) {
      logger.error("ROLLBACK-PARTIAL-PLACEMENT: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("ROLLBACK-PARTIAL-PLACEMENT: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    logger.info("ROLLBACK-PARTIAL-PLACEMENT: User found", {
      requestId,
      userId,
      balance: user.balance,
    });

    // Fetch the ticket
    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);
    if (!ticketEntry || ticketEntry.status !== "running") {
      logger.info("ROLLBACK-PARTIAL-PLACEMENT: No rollback needed", {
        requestId,
        ticketCode: ticketPayload.Code,
        ticketStatus: ticketEntry ? ticketEntry.status : "not found",
      });
      return res.status(200).json({
        status: "success",
        balance: user.balance,
        error_code: 0,
        error_message: "No rollback needed.",
      });
    }

    // Rollback the balance
    const balanceBefore = user.balance;
    user.balance += ticketEntry.amount;
    await user.save({ session });

    // Delete the ticket
    await Ticket.deleteOne({ _id: ticketEntry._id }).session(session);

    logger.info("ROLLBACK-PARTIAL-PLACEMENT: Ticket deleted", {
      requestId,
      ticketCode: ticketPayload.Code,
    });

    // Log the transaction
    const bet = new Bet({
      userId: user._id,
      type: "credit",
      transaction_id: ticketPayload.Code,
      amount: parseFloat(ticketEntry.amount?.toFixed(2)),
      note: "Rollback partial placement",
      balanceBefore: { receiver: parseFloat(balanceBefore?.toFixed(2)) },
      balanceAfter: { receiver: parseFloat(user.balance?.toFixed(2)) },
      createdFrom: "CMSWAGER",
    });
    await bet.save({ session });

    logger.info("ROLLBACK-PARTIAL-PLACEMENT: Rollback logged", {
      requestId,
      userId,
      ticketCode: ticketPayload.Code,
      amount: ticketEntry.amount,
      balanceBefore,
      balanceAfter: user.balance,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("ROLLBACK-PARTIAL-PLACEMENT: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};


exports.processInsurance = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const requestId = req.headers["x-request-id"] || "unknown";
  const clientIP = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  try {
    logger.info("PROCESS-INSURANCE: Starting request", {
      requestId,
      clientIP,
      payload: req.body,
    });

    const { ClientId: clientId, UserId: userId, TransactionType, Amount: amount, Ticket: ticketPayload } = req.body;

    // Validate inputs
    if (!clientId || !userId || TransactionType === undefined || !amount || !ticketPayload || !ticketPayload.Code || !ticketPayload.InsuranceCashback) {
      logger.error("PROCESS-INSURANCE: Missing required parameters", {
        requestId,
        validationCheck: {
          clientIdExists: !!clientId,
          userIdExists: !!userId,
          transactionTypeExists: TransactionType !== undefined,
          amountExists: !!amount,
          ticketExists: !!ticketPayload,
          ticketCodeExists: !!ticketPayload?.Code,
          insuranceCashbackExists: !!ticketPayload?.InsuranceCashback,
        },
      });
      return res.status(400).json({
        status: "error",
        balance: 0,
        error_code: 1001,
        error_message: "Missing required parameters.",
      });
    }

    // Fetch the ticket
    const ticketEntry = await Ticket.findOne({ ticketCode: ticketPayload.Code }).session(session);
    if (!ticketEntry) {
      logger.warn("PROCESS-INSURANCE: Ticket not found", {
        requestId,
        ticketCode: ticketPayload.Code,
      });
      return res.status(406).json({
        status: "error",
        balance: 0,
        error_code: 2040,
        error_message: "Ticket not found.",
      });
    }

    // Fetch the user
    const user = await User.findOne({ c_id: userId }).session(session);
    if (!user) {
      logger.error("PROCESS-INSURANCE: User not found", { requestId, userId });
      return res.status(404).json({
        status: "error",
        balance: 0,
        error_code: 1002,
        error_message: "User not found.",
      });
    }

    logger.info("PROCESS-INSURANCE: User and ticket validated", {
      requestId,
      userId,
      ticketCode: ticketPayload.Code,
      insuranceCashback: ticketPayload.InsuranceCashback,
    });

    // Add cashback to user balance
    const balanceBefore = user.balance;
    user.balance += ticketPayload.InsuranceCashback;
    await user.save({ session });

    // Log the cashback transaction
    const bet = new Bet({
      userId: user._id,
      type: "credit",
      transaction_id: ticketPayload.Code,
      amount: parseFloat(ticketPayload.InsuranceCashback?.toFixed(2)),
      note: "Insurance cashback deposit",
      balanceBefore: { receiver: parseFloat(balanceBefore?.toFixed(2)) },
      balanceAfter: { receiver: parseFloat(user.balance?.toFixed(2)) },
      createdFrom: "CMSWAGER",
    });
    await bet.save({ session });

    logger.info("PROCESS-INSURANCE: Cashback processed", {
      requestId,
      userId,
      ticketCode: ticketPayload.Code,
      insuranceCashback: ticketPayload.InsuranceCashback,
      balanceBefore,
      balanceAfter: user.balance,
    });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      balance: user.balance,
      error_code: 0,
      error_message: "",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error("PROCESS-INSURANCE: Transaction aborted", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      balance: 0,
      error_code: 5001,
      error_message: "Internal server error.",
    });
  }
};

