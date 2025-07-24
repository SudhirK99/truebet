const Transfer = require("../models/transfer");
const moment = require("moment");
const { ObjectId } = require('mongodb')


exports.getUserTransactionHistory = async (req, res) => {
  try {
    const username = req.user.username;
    const userId = req.user.id;

    if (!username) {
      console.error("[ERROR] Decoded token missing 'username':", req.user);
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Token is invalid.",
      });
    }

    const {
      date_start,
      date_end,
      type,
      return_format = "data",
      items_per_page = 10,
    } = req.query;

    const query = { receiverId: new ObjectId(userId) }

    if (type && type !== "Any") {
      query.type = type;
    }

    if (!date_start || !moment(date_start).isValid()) {
      return res.status(400).json({
        success: false,
        message: "date_start is required and must be a valid UTC date.",
      });
    }
    if (!date_end || !moment(date_end).isValid()) {
      return res.status(400).json({
        success: false,
        message: "date_end is required and must be a valid UTC date.",
      });
    }

    const dateStartFormatted = moment
      .utc(date_start)
      .format("YYYY-MM-DD HH:mm:ss");
    const dateEndFormatted = moment.utc(date_end).format("YYYY-MM-DD HH:mm:ss");

    if (dateStartFormatted && dateEndFormatted) {
      query.date = { $gte: dateStartFormatted, $lte: dateEndFormatted }
    }

    console.log("[DEBUG] Date Range:", dateStartFormatted, "to", dateEndFormatted);

    const userTransaction = await Transfer.find(query).sort({
      date: -1,
    });

    if (!userTransaction.length) {
      console.warn("[WARN] No game userTransaction found for user:", username);
      return res.status(400).json({
        success: false,
        message: "No game userTransaction found for this user",
      });
    }

    return res.status(200).json({
      success: true,
      data: userTransaction,
    });
  } catch (error) {
    console.error("[ERROR] getGameHistory failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "An internal server error occurred while fetching game history.",
    });
  }
};
