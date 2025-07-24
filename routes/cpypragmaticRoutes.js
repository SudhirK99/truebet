// routes/walletRoutes.js

const express = require('express');
const router = express.Router();
const cpypragmaticController = require('../controllers/cpypragmaticController');


router.get('/cpypragmatic-get-games', cpypragmaticController.fetchGamesAndSave);

// router.get("/prg", (req, res, next) => {
//     const action = req.query.action;

//     switch (action) {
//       case "GetBalance":
//         return cpypragmaticController.getBalance(req, res);
//       case "Deposit":
//         return cpypragmaticController.debit(req, res);
//       case "Withdraw":
//         return cpypragmaticController.credit(req, res);
//       case "RollbackTransaction":
//         return cpypragmaticController.rollback(req, res);
//       case "BetWin":
//         return cpypragmaticController.betWin(req, res);
//       default:
//         return res.status(404).json({ success: false, message: "Invalid action." });
//     }
//   });

// New individual routes
router.post("/GetBalance", cpypragmaticController.getBalance);
router.post("/Withdraw", cpypragmaticController.debit);
router.post("/Deposit", cpypragmaticController.credit);
router.post("/BetWin", cpypragmaticController.betWin);
router.post("/RollbackTransaction", cpypragmaticController.rollback);

module.exports = router;