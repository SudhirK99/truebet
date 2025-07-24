const express = require("express");
const { reserveTicket,rollbackTicket,confirmTicket,getCMS,userLogin,cancelTicket,concludeBet,reopenTicket,partialCashout,rollbackPartialCashout,partialPlacement,rollbackPartialPlacement,processInsurance } = require("../controllers/CmsWager"); // Adjust the path as needed
const { verifyCmsWagerRequest } = require("../middleware/cmsWagger");
const { decryptMiddleware } = require("../middleware/decrypt");
const router = express.Router();

router.post("/get-cms-token", getCMS);
router.post("/login", userLogin);
router.post("/ticket/reserve",verifyCmsWagerRequest, reserveTicket);
router.post("/ticket/rollback",verifyCmsWagerRequest, rollbackTicket);
router.post("/ticket/confirm",verifyCmsWagerRequest, confirmTicket);
router.post("/ticket/cancel",verifyCmsWagerRequest, cancelTicket);
router.post("/ticket/result",verifyCmsWagerRequest, concludeBet);
router.post("/ticket/reopen",verifyCmsWagerRequest, reopenTicket);
router.post("/ticket/partial-cashout",verifyCmsWagerRequest, partialCashout);
router.post("/ticket/rollback-partial-cashout",verifyCmsWagerRequest, rollbackPartialCashout);
router.post("/ticket/partial-placement",verifyCmsWagerRequest, partialPlacement);
router.post("/ticket/rollback-partial-placement",verifyCmsWagerRequest, rollbackPartialPlacement);
router.post("/ticket/insurance",verifyCmsWagerRequest, processInsurance);




module.exports = router;
