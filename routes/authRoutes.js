const express = require("express");
const router = express.Router();
const AuthController = require("../controllers/auth");
const { verifyToken,verifyRole,verifyID } = require('../middleware/token'); // Middleware for token verification
const { isTokenRevoked, setCSP } = require("../middleware/security"); // Middleware for security
const { decryptMiddleware } = require("../middleware/decrypt");

// Apply CSP middleware globally
router.use(setCSP);

// User registration and login routes
router.post("/register",verifyToken,decryptMiddleware, AuthController.register); // Register new user
router.post("/owner-register" ,AuthController.ownerRegister); // Register new user
router.post("/login",decryptMiddleware, AuthController.login); // Login user
router.post("/refresh-token",decryptMiddleware, AuthController.refreshToken); // Refresh access token with token revocation check
router.post("/logout", verifyToken,decryptMiddleware, isTokenRevoked, AuthController.logout); // Logout user with token revocation check
router.post("/change-password", verifyToken,decryptMiddleware,verifyRole(["Partner", "SuperAgent", "Agent","User"]), isTokenRevoked, AuthController.userChangePassword); // Logout user with token revocation check
router.post("/update-user-password", verifyToken,decryptMiddleware,verifyRole(["Owner","Partner", "SuperAgent", "Agent"]), isTokenRevoked, AuthController.updateUserPassword); // Logout user with token revocation check
// User management routes
router.get("/getallusers", verifyToken,verifyRole(["Owner"]), isTokenRevoked, AuthController.getAllUsers); // Get all users (secured with token verification)
router.get("/getAllUsersByCreatorId", verifyToken, verifyRole(["Owner", "Partner", "SuperAgent", "Agent"]), isTokenRevoked, AuthController.getAllUsersByCreatorId); // Get all users via creator Id(secured with token verification)
router.get("/getAllCreatorUsers", verifyToken, verifyRole(["Owner", "Partner", "SuperAgent", "Agent"]), isTokenRevoked, AuthController.getAllCreatorUsers); // Get all users via creator Id(secured with token verification)
router.post("/usersByRole", verifyToken,decryptMiddleware, isTokenRevoked, AuthController.getUsersByRole); // Get users by role
router.get("/user/:id", verifyToken, isTokenRevoked, AuthController.getUserById); // Get user by ID
router.get('/users/role/:createrid', verifyToken,verifyID , isTokenRevoked, AuthController.fetchUsersByCreaterId); // Get users by createrId

// Profile and user update routes
router.post('/profile', verifyToken,decryptMiddleware, isTokenRevoked, AuthController.getProfile); // Get user profile (secured with token)
router.put('/update', verifyToken,decryptMiddleware, isTokenRevoked, AuthController.updateUser); // Update user details
router.get('/pages/User/:createrid', (req, res, next) => {
    req.params.id = req.params.createrid; // Map createrid to id
    next();
}, verifyToken, isTokenRevoked, AuthController.getUserById);
// User deletion routes
router.delete("/delete_user", verifyToken, isTokenRevoked, AuthController.deleteUserByUsername); // Delete user by username
router.delete("/delete_user/:id", verifyToken, isTokenRevoked, AuthController.deleteUserById); // Delete user by ID

// Balance routes
router.post('/getbalance', verifyToken,decryptMiddleware, isTokenRevoked, AuthController.getBalance); // Get user balance (secured with token)
router.get("/ubalance", verifyToken, isTokenRevoked, AuthController.updatebalance);
// Custom routes
router.get('/usersByCreater/:createrid', verifyToken, isTokenRevoked, AuthController.getUsersByCreaterId); // Get users by Creater ID

module.exports = router;
