const express = require("express");
const providersController = require("../controllers/gameProviders");
const router = express.Router();
const { verifyToken } = require("../middleware/token");


router.get("/getProviders", providersController.getProviders);

module.exports = router;
