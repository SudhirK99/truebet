const express = require("express");
const router = express.Router();
const TransferController = require("../controllers/transfercontroller");
const { verifyToken, verifyRole,verifysenderID } = require("../middleware/token");
const { decryptMiddleware } = require("../middleware/decrypt");


router.post(
    "/transfer",
    verifyToken,
    decryptMiddleware,
    verifyRole(["Owner", "Partner", "SuperAgent", "Agent"]),
    verifysenderID,
    TransferController.makeTransfer
);

router.post(
    "/transfer-history",
    verifyToken, 
    decryptMiddleware,
    verifyRole(["Owner", "Partner", "SuperAgent", "Agent", "User"]), 
    TransferController.getTransferHistory
);

router.get(
    "/transfer-report",
    verifyToken,
    verifyRole(["Owner", "Partner", "SuperAgent", "Agent"]),
    TransferController.getTransferReport
);
router.get(
    "/all-transfers",
    verifyToken, 
    verifyRole(["Owner", "Partner"]), 
    TransferController.getAllTransfers
);

router.get(
    "/agent-transfer",
    verifyToken, 
    verifyRole(["Owner", "Partner"]), 
    TransferController.getAgentTransactions
);

router.get(
    "/transfer-h",
    verifyToken, 
    TransferController.getTransfer
);

router.get(
    "/calculate-money-details",
    verifyToken,
    verifyRole(["Owner", "Partner", "SuperAgent", "Agent"]),
    TransferController.calculateMoneyDetails // New controller method
);

router.get(
    "/casino-bets",
    verifyToken,
    verifyRole(["Owner", "Partner", "SuperAgent", "Agent"]),
    TransferController.getCasinoBets // New controller method
);

module.exports = router;
