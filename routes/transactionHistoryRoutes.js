const express = require("express");
const router = express.Router();
const transactionHistoryController = require("../controllers/transactionHistory");
const { verifyToken } = require("../middleware/token");

router.get("/getUserTransactionHistory", verifyToken, transactionHistoryController.getUserTransactionHistory);

module.exports = router;
