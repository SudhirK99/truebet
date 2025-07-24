const express = require("express");
const router = express.Router();
const endpointController = require("../controllers/gameBasicflow"); // Controller containing logic
const { verifyToken, verifyRole } = require("../middleware/token");
const { decryptMiddleware } = require("../middleware/decrypt");

// 1. Route to retrieve the game list
router.post("/getlist", endpointController.getlist); // Fetch list of available games
router.get("/gamesLocal", endpointController.getGameListFromDatabase); // Fetch list of available games from local DB

router.get("/get-all-games", endpointController.getAllGames); // Fetch all games
router.get("/getgamebyname", endpointController.getAllGamesbyname); // Fetch all games
router.post("/getgamebyid", decryptMiddleware, endpointController.getGamesByGameIds); // Fetch all games

router.get("/get-all-games-search", endpointController.getAllGamesSearch); // Fetch all games name and id for search listing

// 2. Route to retrieve a specific game session
router.post("/get-game", verifyToken, verifyRole(["User"]), decryptMiddleware, endpointController.getGame); // Retrieve game launch URL and session
router.post("/new-provider-get-game", verifyToken, verifyRole(["User"]), decryptMiddleware, endpointController.launchGame);

// 3. Route to check if player exists
router.post("/player-exists", decryptMiddleware, endpointController.playerExists); // Check if player exists in provider's system

// 4. Route to create a new player
router.post("/create-player", decryptMiddleware, endpointController.createPlayer); // Create a new player account

router.get("/", (req, res, next) => {
  const action = req.query.action;

  switch (action) {
    case "balance":
      return endpointController.getBalance(req, res);
    case "debit":
      return endpointController.debit(req, res);
    case "credit":
      return endpointController.credit(req, res);
    case "rollback":
      return endpointController.rollback(req, res);
    default:
      return res.status(404).json({ success: false, message: "Invalid action." });
  }
});

// New individual routes
router.get("/balance", endpointController.getBalance);
router.get("/debit", endpointController.debit);
router.get("/credit", endpointController.credit);
router.get("/rollback", endpointController.rollback);


module.exports = router;