const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Middleware to verify JWT and attach user info to request
// const verifyToken = (req, res, next) => {
//     const authHeader = req.headers["authorization"];
//     const token = authHeader?.split(" ")[1];
//     console.log("Full auth header:", authHeader);
//     console.log("Extracted token:", token);
//     if (!token) {
//         return res.status(401).json({ success: false, message: "Access denied: No token provided." });
//     }
//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         req.user = decoded; // Attach user info to request object
//         next();
//     } catch (error) {
//         if (error.name === "TokenExpiredError") {
//             console.warn("Token expired:", error);
//             return res.status(401).json({ success: false, message: "Token expired. Please refresh your token." });
//         }
//         console.error("Invalid token:", error);
//         return res.status(401).json({ success: false, message: "Invalid token." });
//     }
// };


const verifyToken = async (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ success: false, message: "Access denied: No token provided." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Fetch the user and verify session
        const user = await User.findById(decoded.id);
        
        if (!user) {
            return res.status(401).json({ success: false, message: "User not found." });
        }
        // Check if the session ID in the token matches the user's current session ID
        if (decoded.sessionId !== user.sessionId) {
            return res.status(401).json({ 
                success: false, 
                message: "Session expired. Please login again.",
                code: "SESSION_EXPIRED"
            });
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({ success: false, message: "Token expired." });
        }
        return res.status(401).json({ success: false, message: "Invalid token." });
    }
};


// Middleware to verify user's role
const verifyRole = (allowedRoles) => (req, res, next) => {
    try {
        const { role } = req.user;

        if (!allowedRoles.includes(role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied`,
            });
        }

        next(); // Proceed to next middleware or route handler
    } catch (error) {
        console.error("Role verification error:", error);
        return res.status(500).json({ success: false, message: "Role verification failed." });
    }
};

const verifyID = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ success: false, message: "Access denied: No token provided." });
    }

    try {
        // Decode the token to extract the user's role
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const tokenRole = decoded.id; // Role from token

        // Extract role from POST request payload
        const { createrid } = req.params;
        if (!createrid) {
            return res.status(400).json({ success: false, message: "Role not provided in request payload." });
        }

        // Compare the role from the token with the role in the request payload
        if (tokenRole !== createrid) {
            return res.status(403).json({
                success: false,
                message: `Access denied: Token role (${tokenRole}) does not match the requested role (${createrid}).`,
            });
        }

        // Proceed to the next middleware or route handler if roles match
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            console.warn("Token expired:", error);
            return res.status(401).json({ success: false, message: "Token expired. Please refresh your token." });
        }

        console.error("Invalid token:", error);
        return res.status(401).json({ success: false, message: "Invalid token." });
    }
};


const verifysenderID = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ success: false, message: "Access denied: No token provided." });
    }

    try {
        // Decode the token to extract the user's role
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const tokenRole = decoded.id; // Role from token

        // Extract role from POST request payload
        const { senderId: senderId } = req.body;

        if (!senderId) {
            return res.status(400).json({ success: false, message: "Role not provided in request payload." });
        }

        // Compare the role from the token with the role in the request payload
        // if (tokenRole !== senderId) {
        //     return res.status(403).json({
        //         success: false,
        //         message: `Access denied: Token role (${tokenRole}) does not match the requested role (${senderId}).`,
        //     });
        // }

        // Proceed to the next middleware or route handler if roles match
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            console.warn("Token expired:", error);
            return res.status(401).json({ success: false, message: "Token expired. Please refresh your token." });
        }

        console.error("Invalid token:", error);
        return res.status(401).json({ success: false, message: "Invalid token." });
    }
};
module.exports = { verifyToken, verifyRole,verifysenderID,verifyID };
