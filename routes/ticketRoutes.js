const express = require("express");
const ticketsController = require("../controllers/tickets");
const router = express.Router();
const { verifyToken } = require("../middleware/token");


router.get("/getTickets", verifyToken, ticketsController.getTickets);

module.exports = router;
