const express = require("express");
const router = express.Router();
const gameHistoryController = require("../controllers/gameHistory");
const { verifyToken } = require("../middleware/token");
const { decryptMiddleware } = require("../middleware/decrypt");

router.post("/getGameHistory", verifyToken, decryptMiddleware, gameHistoryController.getGameHistory);
router.post("/getGameBetHistory", verifyToken,decryptMiddleware, gameHistoryController.getCasinoBetsHistory);
router.post("/getDailyReport", verifyToken,decryptMiddleware, gameHistoryController.getDailyReport);
router.get("/gaming-report", verifyToken, gameHistoryController.getGamingReport);
// router.get("/gaming-report", verifyToken, gameHistoryController.getGamingReport);

module.exports = router;
