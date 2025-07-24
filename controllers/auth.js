const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const mongoose = require('mongoose');
const { v4: uuidv4 } = require("uuid"); // Use UUID for session ID generation
const Joi = require('joi');
const rateLimit = require("express-rate-limit");
const crypto = require("crypto"); // Ensure this is imported
const { getIo } = require("../socket");
const { ROLE_BASE_ACCESS_FOR_USER_REGISTERATION } = require("../config/helperFunction");


const userRegistrationSchema = Joi.object({
    username: Joi.string().trim().min(3).max(30).required(),
    password: Joi.string().min(8).required(), // Ensures a minimum password length of 8 characters
    role: Joi.string().valid("Owner", "Partner", "SuperAgent", "Agent", "User").optional(),
    id: Joi.string().optional(), // Optional creator ID (can be null for top-level admins)
});



const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: "Too many login attempts. Please try again later."
});

const generateRandomPassword = () => {
    return Math.random().toString(36).slice(2, 10); // Example: Simple alphanumeric string
};



const logActivity = async (userId, action, ip) => {
    try {
        await User.findByIdAndUpdate(
            userId,
            {
                $push: {
                    logs: {
                        action,
                        timestamp: new Date(),
                        ip: ip || "N/A",
                    },
                },
            },
            { new: true } // Return the updated document
        );
    } catch (error) {
        console.error("Error logging activity:", error);
    }
};

// Function to generate a random provider-specific password

exports.register = async (req, res, next) => {
    const { username, password, role: bodyRole } = req.body;
    const { id, role: loggedInUserRole, currency } = req.user
    const { error } = userRegistrationSchema.validate({ username, password, role: bodyRole });
    if (error) {
        return res.status(400).json({ success: false, message: error.details[0].message });
    }
    const usernameRegex = /^[a-z1-9]+$/;
    if (!username || !usernameRegex.test(username)) {
        return res.status(400).json({
            message: "Username must only contain letters and numbers"
        });
    }
    try {
        // Check if username is already taken
        const existingUser = await User.findOne({ username: username.trim() });
        if (existingUser) {
            return res.status(409).json({ success: false, message: "Username already taken." });
        }

        // Check if an Owner role exists
        const ownerExists = await User.findOne({ role: "Owner" });

        let providerPassword = null;
        const hashedPassword = await bcrypt.hash(password.trim(), 10);

        //   if (bodyRole !== "Owner") {
        //       providerPassword = generateRandomPassword();
        //     } else

        if (bodyRole === 'User') {
            providerPassword = generateRandomPassword();
        }


        if (ROLE_BASE_ACCESS_FOR_USER_REGISTERATION(loggedInUserRole, bodyRole)) {
            // Create a new user
            const newUser = new User({
                username: username.trim(),
                password: hashedPassword,
                provider_password: providerPassword,
                role: bodyRole || "User",
                createrid: id || null,
                currency
            });

            await newUser.save();

            await logActivity(newUser._id, "register", req.ip);

            res.status(201).json({
                success: true,
                message: "User created successfully.",
                data: {
                    username: newUser.username,
                    // provider_password: providerPassword,
                    c_id: newUser.c_id, // Include the generated c_id in the response
                },
            });
        } else {
            return res.status(400).json({ success: false, message: "You do not have permission to create this role." });
        }
    } catch (err) {
        console.error("Error creating user:", err);
        next(err);
    }
};


exports.ownerRegister = async (req, res, next) => {
    const { username, password, role: bodyRole, currency } = req.body;
    const { error } = userRegistrationSchema.validate({ username, password, role: bodyRole });
    if (error) {
        return res.status(400).json({ success: false, message: error.details[0].message });
    }
    try {
        // Check if username is already taken
        const existingUser = await User.findOne({ username: username.trim() });
        if (existingUser) {
            return res.status(409).json({ success: false, message: "Username already taken." });
        }

        // Check if an Owner role exists
        const ownerExists = await User.findOne({ role: "Owner" });

        const hashedPassword = await bcrypt.hash(password.trim(), 10);
        let providerPassword = null;
        // if (!ownerExists && bodyRole === 'Owner') {
        //     providerPassword = null;
        // } else if (ownerExists) {
        //     return res.status(409).json({ success: false, message: "An owner already exists. Please use a different identifier." });

        // }

        // Create a new user
        const newUser = new User({
            username: username.trim(),
            password: hashedPassword,
            provider_password: providerPassword,
            role: bodyRole || "User",
            createrid: null,
            currency: currency ? currency : "TND"
        });

        await newUser.save();

        await logActivity(newUser._id, "register", req.ip);
        res.status(201).json({
            success: true,
            message: "Owner created successfully.",
            data: {
                username: newUser.username,
                provider_password: providerPassword,
                c_id: newUser.c_id, // Include the generated c_id in the response
            },
        });
    } catch (err) {
        console.error("Error creating user:", err);
        next(err);
    }
};


exports.userChangePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Input validation
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }

        // Password strength validation
        if (newPassword.length < 8) {
            return res.status(400).json({ message: 'New password must be at least 8 characters long' });
        }

        // Get user from database
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if current password matches
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: "Incorrect password." });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);

        // Add to logs
        user.logs.push({
            action: 'password_change',
            ip: req.ip || 'unknown'
        });

        // Save user with new password
        await user.save();

        res.json({ message: 'Password updated successfully', success: true });
    } catch (err) {
        console.error('Error changing password:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
};


exports.updateUserPassword = async (req, res) => {
    try {
        const { newPassword, userId } = req.body;

        // Input validation
        if (!newPassword) {
            return res.status(400).json({ message: 'New password is required' });
        }

        // Password strength validation
        if (newPassword.length < 8) {
            return res.status(400).json({ message: 'New password must be at least 8 characters long' });
        }

        // Get user from database
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);

        // Add to logs
        user.logs.push({
            action: 'password_change',
            ip: req.ip || 'unknown'
        });

        // Save user with new password
        await user.save();

        res.json({ message: 'Password updated successfully', success: true });
    } catch (err) {
        console.error('Error changing password:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
};


// Connexion d'un utilisateur


exports.login = [loginLimiter, async (req, res, next) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username and password are required." });
    }

    try {
        // Find user by username
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        if (user && user?.role !== "Owner" && user?.status === "blocked") {
            return res.status(404).json({ success: false, message: "User is not active." });
        }


        // Validate password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: "Incorrect password." });
        }

        // Generate new session ID
        const newSessionId = uuidv4();

        // If there's an existing session, we'll emit a socket event to force logout
        const oldSessionId = user.sessionId;

        // Generate new tokens
        const token = jwt.sign(
            { username: user.username, role: user.role, id: user._id, sessionId: newSessionId, bonus_balance: user.bonus_balance, currency: user.currency },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        const refreshToken = crypto.randomBytes(64).toString("hex");

        // Update user with new session info
        user.sessionId = newSessionId;
        user.refreshToken = refreshToken;
        user.token = token;

        await user.save();

        // If there was an old session, emit logout event via Socket.IO
        if (oldSessionId && oldSessionId !== newSessionId) {
            // io.on("connection", (socket) => {
            let io = getIo();
            io.emit("forceLogout", {
                message: "New login detected from another device",
                oldSessionId: oldSessionId,
                userId: user._id
            });
            // })


            console.log('omitting the session logout')
        }

        // Set the refresh token as an HTTP-only cookie
        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "None",
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        // Log the login activity
        await logActivity(user._id, "login", req.ip);

        // Return response
        return res.status(200).json({
            success: true,
            message: "Login successful.",
            user: {
                _id: user._id,
                username: user.username,
                role: user.role,
                balance: user.balance,
                isPasswordChanged: user.isPasswordChanged,
                bonus_balance: user.bonus_balance,
                c_id: user.c_id,
                sessionId: newSessionId,
                token: token,
                currency: user.currency
            }
        });

    } catch (error) {
        console.error("Error during login:", error);
        next(error);
    }
}];





// exports.login = [loginLimiter, async (req, res, next) => {
//     const { username, password } = req.body;


//     if (!username || !password) {
//         return res.status(400).json({ success: false, message: "Username and password are required." });
//     }

//     try {
//         // Find user by username
//         const user = await User.findOne({ username });

//         if (!user) {
//             return res.status(404).json({ success: false, message: "Bad credentials." });
//         }

//         // Validate password
//         // const isPasswordValid = await bcrypt.compare(password, user.password);
//         // if (!isPasswordValid) {
//         //     return res.status(401).json({ success: false, message: "Incorrect password." });
//         // }

//         // Generate access token (short-lived)
//         const token = jwt.sign(
//             { username: user.username, role: user.role, id: user._id, c_id: user.c_id }, // Include c_id in token payload
//             process.env.JWT_SECRET,
//             { expiresIn: "24h" } // Short-lived token
//         );
//         user.token = token;

//         console.log(user.token, "user.token")


//         // Generate refresh token
//         const refreshToken = crypto.randomBytes(64).toString("hex");
//         user.refreshToken = refreshToken;

//         // Generate session ID
//         const sessionId = uuidv4();
//         user.sessionId = sessionId;

//         // Save the user with the updated tokens
//         await user.save();

//         // Log the login activity
//         await logActivity(user._id, "login", req.ip);

//         // Set the refresh token as an HTTP-only cookie
//         res.cookie("refreshToken", refreshToken, {
//             httpOnly: true,
//             secure: true, // Only transmit over HTTPS in production
//             sameSite: "None", // Required for cross-origin
//             maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days expiration
//         });

//         // Respond with essential data
//         res.status(200).json({
//             success: true,
//             message: "Login successful.",
//             user: {
//                 _id: user._id,
//                 username: user.username,
//                 role: user.role,
//                 balance: user.balance,
//                 sessionId: user.sessionId, // Include only if needed for session tracking
//                 token: user.token,
//                 c_id: user.c_id, // Include the c_id field in the response
//             }
//         });
//     } catch (error) {
//         console.error("Error during login:", error);
//         next(error); // Pass error to global error handler
//     }
// }];




exports.logout = async (req, res, next) => {
    const { refreshToken } = req.cookies;

    if (!refreshToken) {
        return res.status(400).json({ success: false, message: "No refresh token provided." });
    }

    try {
        const user = await User.findOne({ refreshToken });

        if (!user) {
            return res.status(404).json({ success: false, message: "The session has expired. Please log in again to continue." });
        }

        // Revoke tokens and clear session data
        user.refreshToken = null;
        user.sessionId = null;
        await user.save();

        res.clearCookie("refreshToken"); // Clear the cookie
        console.log("User logged out successfully.");

        res.status(200).json({ success: true, message: "Logged out successfully." });
    } catch (error) {
        console.error("Error during logout:", error);
        next(error);
    }
};

exports.refreshToken = async (req, res, next) => {
    const cookieRefreshToken = req.cookies.refreshToken;
    if (!cookieRefreshToken) {
        return res.status(400).json({ success: false, message: "Refresh token is required." });
    }

    try {
        // Find the user associated with the refresh token
        const user = await User.findOne({ refreshToken: cookieRefreshToken });

        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid refresh token" });
        }

        // Generate a new access token
        const newAccessToken = jwt.sign(
            { username: user.username, role: user.role, id: user._id, sessionId: user.sessionId },
            process.env.JWT_SECRET,
            { expiresIn: "1h" } // Short-lived access token
        );

        // Generate a new refresh token
        const newRefreshToken = crypto.randomBytes(64).toString("hex");
        user.refreshToken = newRefreshToken;

        // Save the user with the updated refresh token
        await user.save();

        // Set the new refresh token as an HTTP-only cookie
        res.cookie("refreshToken", newRefreshToken, {
            httpOnly: true,
            secure: true, // Only transmit over HTTPS in production
            sameSite: "None", // Adjust based on your frontend setup
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days expiration
        });

        // Respond with the new access token
        res.status(200).json({
            success: true,
            message: "Token refreshed successfully.",
            accessToken: newAccessToken,
        });
    } catch (error) {
        console.error("Error refreshing token:", error);
        next(error);
    }
};





// Récupérer les utilisateurs par rôle
exports.getUsersByRole = async (req, res, next) => {
    const { role } = req.body;

    try {
        const users = await User.find({ role });

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun utilisateur trouvé avec ce rôle." });
        }

        users.forEach(user => {
            user.password = undefined;
        });

        // Log the role search activity
        await logActivity(req.user._id, `searched for users with role: ${role}`, req.ip);

        res.status(200).json({ success: true, users });
    } catch (error) {
        console.error("Erreur lors de la récupération des utilisateurs :", error);
        next(error);
    }
};


// Supprimer un utilisateur par nom d'utilisateur
exports.deleteUserByUsername = async (req, res, next) => {
    const { username } = req.body;

    try {
        const user = await User.findOneAndDelete({ username });

        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }

        // Log the deletion activity
        await logActivity(req.user._id, `deleted user: ${username}`, req.ip);

        res.status(200).json({ success: true, message: "Utilisateur supprimé avec succès" });
    } catch (error) {
        console.error("Erreur lors de la suppression de l'utilisateur :", error);
        next(error);
    }
};


// Récupérer tous les utilisateurs
exports.getAllUsers = async (req, res, next) => {
    try {
        const users = await User.find({}).populate('createrid', 'username role balance userdate');

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun utilisateur trouvé." });
        }

        const formattedUsers = users.map(user => ({
            _id: user._id,
            username: user.username,
            role: user.role,
            balance: user.balance,
            remote_id: user.remote_id,
            createrid: user.createrid ? user.createrid._id : null,
            creatorInfo: user.createrid ? {
                username: user.createrid.username,
                role: user.createrid.role,
                balance: user.createrid.balance,
                userdate: user.createrid.userdate
            } : null,
            userdate: user.userdate,
            __v: user.__v
        }));

        res.status(200).json({ success: true, users: formattedUsers });
    } catch (error) {
        console.error("Erreur lors de la récupération des utilisateurs :", error);
        next(error);
    }
};



// Helper function to get all descendant user IDs
const getDescendantIds = async (userId) => {
    const directDescendants = await User.find({ createrid: userId });
    const descendantIds = directDescendants.map(user => user);

    for (const descendant of directDescendants) {
        const subDescendants = await getDescendantIds(descendant._id);
        descendantIds.push(...subDescendants);
    }

    return descendantIds;
};

exports.getAllUsersByCreatorId = async (req, res, next) => {
    const { createrid } = req.query;
    try {
        const users = await getDescendantIds(createrid)
        res.status(200).json({
            success: true, users: users.map(user => {
                return {
                    username: user.username,
                    createrid: user.createrid,
                    _id: user._id,
                    role: user.role,
                    balance: user.balance
                }
            })
        });
    } catch (err) {
        console.error("Erreur lors de la récupération des utilisateurs :", error);
        next(error);
    }

};
exports.getAllCreatorUsers = async (req, res, next) => {
    const { createrid } = req.query;
    try {
        if (!createrid) {
            return res.status(400).json({ success: false, message: "Creator Id required" });
        }
        const users = await User.find({ createrid: createrid });
        res.status(200).json({
            success: true, users: users.map(user => {
                return {
                    username: user.username,
                    createrid: user.createrid,
                    _id: user._id,
                    role: user.role,
                    balance: user.balance
                }
            })
        });
    } catch (err) {
        console.error("Erreur lors de la récupération des utilisateurs :", error);
        next(error);
    }

};

// Récupérer le solde d'un utilisateur
exports.getBalance = async (req, res, next) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ success: false, message: "Nom d'utilisateur requis" });
    }

    try {
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }

        res.status(200).json({ success: true, balance: user.balance });
    } catch (error) {
        console.error("Erreur lors de la récupération du solde :", error);
        next(error);
    }
};

// In-memory cache
const balanceCache = {};

exports.updatebalance = async (req, res) => {
    const userId = req.user.id;

    try {
        const ifModifiedSince = req.headers["if-modified-since"];

        // Check the cache first
        const cachedData = balanceCache[userId];
        if (cachedData) {
            const { balance, updatedAt } = cachedData;

            // If the cache timestamp matches If-Modified-Since, return 304
            if (ifModifiedSince && new Date(ifModifiedSince).toISOString() === updatedAt.toISOString()) {
                return res.status(304).end(); // Not Modified
            }

            // Respond with cached balance
            res.setHeader("Last-Modified", updatedAt.toISOString());
            return res.status(200).json({ success: true, balance });
        }

        // If not in cache, fetch from the database
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Ensure updatedAt is a valid Date
        const updatedAt = user.updatedAt instanceof Date ? user.updatedAt : new Date();

        // Update the cache
        balanceCache[userId] = { balance: user.balance, updatedAt };

        // Respond with the fetched balance
        res.setHeader("Last-Modified", updatedAt.toISOString());
        return res.status(200).json({ success: true, balance: user.balance });
    } catch (error) {
        console.error("Error fetching balance:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};




// Recursive function to get all users and their sub-users
const fetchUserHierarchy = async (userId) => {
    const users = await User.find({ createrid: userId });

    const userTree = await Promise.all(users.map(async (user) => {
        // Fetch children of the current user
        const children = await fetchUserHierarchy(user._id);

        // Exclude sensitive information
        user = user.toObject(); // Convert Mongoose document to plain JavaScript object
        user.password = undefined;

        return {
            ...user,
            children
        };
    }));

    return userTree;
};

// Controller function to get the full user tree from the top level
exports.getUsersByCreaterId = async (req, res, next) => {
    const { createrid } = req.params;

    try {
        // Find the root user (highest level in the hierarchy)
        const rootUser = await User.findOne({ _id: createrid });
        if (!rootUser) {
            return res.status(404).json({ success: false, message: "Créateur introuvable." });
        }

        // Fetch the full user tree from the root user
        const userHierarchy = await fetchUserHierarchy(rootUser._id);

        // Return the root user with its full hierarchy
        rootUser.password = undefined; // Exclude password for security
        res.status(200).json({ success: true, user: { ...rootUser.toObject(), children: userHierarchy } });
    } catch (error) {
        console.error("Erreur lors de la récupération des utilisateurs par ID créateur :", error);
        next(error);
    }
};


// Mettre à jour un utilisateur
exports.updateUser = async (req, res, next) => {
    const { userId, username, role, balance, password } = req.body; // Ajoutez password ici

    if (!userId) {
        return res.status(400).json({ success: false, message: "ID utilisateur requis" });
    }

    try {
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }

        let changes = []; // To track fields that were updated

        // Vérification si un nouveau nom d'utilisateur est fourni
        if (username && username !== user.username) {
            const existingUser = await User.findOne({ username });
            if (existingUser) {
                return res.status(409).json({ success: false, message: "Nom d'utilisateur déjà pris" });
            }
            user.username = username;
            changes.push('username');
        }

        if (role) {
            user.role = role;
            changes.push('role');
        }

        if (balance !== undefined) {
            user.balance = balance;
            changes.push('balance');
        }

        // Vérification si un nouveau mot de passe est fourni
        if (password) {
            user.password = await bcrypt.hash(password, 10); // Hachez le nouveau mot de passe
            changes.push('password');
        }

        await user.save();
        user.password = undefined; // Retirer le mot de passe avant d'envoyer la réponse

        // Log the update activity
        await logActivity(req.user._id, `updated user ${userId}: ${changes.join(', ')}`, req.ip);

        res.status(200).json({ success: true, message: "Utilisateur mis à jour avec succès", user });
    } catch (error) {
        console.error("Erreur lors de la mise à jour de l'utilisateur :", error);
        next(error);
    }
};



// Récupérer un utilisateur par ID
exports.getUserById = async (req, res, next) => {
    const { id } = req.params;

    try {
        let user;

        if (mongoose.Types.ObjectId.isValid(id)) {
            // Query by ObjectId
            user = await User.findById(id);
        } else {
            // Query by username if it's not a valid ObjectId
            user = await User.findOne({ username: id });
        }

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        user.password = undefined; // Exclude sensitive data
        user.logs = undefined;
        user.provider_password = undefined;
        user.refreshToken = undefined;
        user.sessionId = undefined;
        user.userdate = undefined;


        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Error fetching user:", error);
        next(error);
    }
};

// Supprimer un utilisateur par ID
exports.deleteUserById = async (req, res, next) => {
    const { id } = req.params; // Log the user ID being used

    try {
        const user = await User.findByIdAndDelete(id);

        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }

        // Log the delete activity
        await logActivity(req.user._id, `deleted user with ID: ${id}`, req.ip);

        res.status(200).json({ success: true, message: "Utilisateur supprimé avec succès" });
    } catch (error) {
        console.error("Erreur lors de la suppression de l'utilisateur :", error);
        next(error);
    }
};


exports.getProfile = async (req, res, next) => {
    const { username } = req.body; // Assume the username is passed in the request body

    if (!username) {
        return res.status(400).json({ success: false, message: "Nom d'utilisateur requis" });
    }

    try {
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }

        user.password = undefined; // Exclude the password from the response

        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Erreur lors de la récupération du profil de l'utilisateur :", error);
        res.status(500).json({ success: false, message: "Une erreur est survenue lors de la récupération du profil" });
    }
};



exports.fetchUsersByCreaterId = async (req, res, next) => {
    const { createrid } = req.params; // Extract createrid from URL parameters

    try {
        // Find users with the provided createrid
        const users = await User.find({ createrid });

        // If no users are found, return 404
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "No users found for this creater ID." });
        }

        // Hide passwords before sending the response
        const sanitizedUsers = users.map(user => {
            const userObject = user.toObject();
            delete userObject.password;
            delete userObject.logs;
            delete userObject.userdate;
            delete userObject.provider_password;
            return userObject;
        });

        // Return the list of users with the given createrid
        return res.status(200).json({ success: true, users: sanitizedUsers });
    } catch (error) {
        console.error("Error fetching users by createrid:", error);
        return res.status(500).json({ success: false, message: "Error fetching users." });
    }
};


// Fetch user by username
exports.getUserByUsername = async (req, res) => {
    const { username } = req.params;

    try {
        // Find the user by username and exclude sensitive fields (e.g., password)
        const user = await User.findOne({ username }).select("-password");

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Error fetching user by username:", error);
        res.status(500).json({ success: false, message: "Internal server error." });
    }
};
