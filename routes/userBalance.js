const express = require('express');
const router = express.Router();
const { getUserBalance, getUserHierarchy } = require('../controllers/userBalance');
const { verifyToken } = require('../middleware/token');

// Define the route
router.get('/user-balance', verifyToken, getUserBalance);
router.get('/user-hierarchy', verifyToken, getUserHierarchy);
// router.post('/user-hierarchy/expand', verifyToken, expandHierarchyNode);
// router.post('/user-hierarchy/collapse', verifyToken, collapseHierarchyNode);
module.exports = router;