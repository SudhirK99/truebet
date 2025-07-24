const Ticket = require("../models/Ticket");
const User = require("../models/User");

// exports.getTickets = async (req, res) => {

//     async function getDownlineUsers(userId) {
//   const users = await User.find({ createrid: userId });
//   let allUsers = [...users];

//   for (const user of users) {
//     const downlineUsers = await getDownlineUsers(user._id);
//     allUsers = allUsers.concat(downlineUsers);
//   }

//   return allUsers;
// }
//     try {
//         const { ticketCode, userId, startDate, endDate } = req.query;


//   // checking the user is in logged in user's tree
//         const targetUserId = userId
//         const loggedInUserId = req.user.id;
//         let loggedInUserTree = await getDownlineUsers(loggedInUserId)
//         if (targetUserId && !loggedInUserTree.find(item => item?._id?.toString() === targetUserId?.toString())) {
//             return res.status(404).json({ error: "User not in loggedin user tree" });
//         }

//          const targetedUser = await User.findById( userId );
        
//         if (!targetedUser) {
//             return res.status(404).json({ error: "User not found" });
//         }
//         // Build query object
//         const query = {};

//         // Add ticketCode to query if provided
//         if (ticketCode) {
//             query.ticketCode = ticketCode;
//         }

//         // Add userId to query if provided
//         if (userId) {
//             query.userId = parseInt(targetedUser.c_id);
//         }

//         // Add date range to query if both startDate and endDate are provided
//         if (startDate && endDate) {
//             // Validate date format
//             const start = new Date(startDate);
//             const end = new Date(endDate);

//             if (isNaN(start.getTime()) || isNaN(end.getTime())) {
//                 return res.status(400).json({
//                     success: false,
//                     message: "Invalid date format. Please use ISO format (YYYY-MM-DD)"
//                 });
//             }

//             // Set time to start of day for startDate and end of day for endDate
//             start.setHours(0, 0, 0, 0);
//             end.setHours(23, 59, 59, 999);

//             query.createdAt = {
//                 $gte: start,
//                 $lte: end
//             };
//         }

//         // Execute query with pagination
//         const page = parseInt(req.query.page) || 1;
//         const limit = parseInt(req.query.limit) || 10;
//         const skip = (page - 1) * limit;

//         // Get total count for pagination
//         const totalCount = await Ticket.countDocuments(query);

//         // Fetch tickets with pagination and sorting
//         const tickets = await Ticket.find(query)
//             .sort({ createdAt: -1 }) // Sort by creation date, newest first
//             .skip(skip)
//             .limit(limit);

//         // Calculate total pages
//         const totalPages = Math.ceil(totalCount / limit);

//         // Return response
//         return res.status(200).json({
//             success: true,
//             data: {
//                 tickets,
//                 pagination: {
//                     currentPage: page,
//                     totalPages,
//                     totalItems: totalCount,
//                     itemsPerPage: limit
//                 }
//             }
//         });

//     } catch (error) {
//         console.error("[ERROR] Error occurred during tickets retrieval:", error);
//         return res.status(500).json({
//             success: false,
//             message: "An error occurred while retrieving tickets",
//             error: error.message
//         });
//     }
// };


exports.getTickets = async (req, res) => {
    async function getDownlineUsers(userId) {
        const users = await User.find({ createrid: userId });
        let allUsers = [...users];

        for (const user of users) {
            const downlineUsers = await getDownlineUsers(user._id);
            allUsers = allUsers.concat(downlineUsers);
        }

        return allUsers;
    }

    try {
        const { ticketCode, userId, startDate, endDate } = req.query;
        const query = {};

        // If userId is provided, filter tickets for that specific user
        if (userId) {
            const targetUserId = userId;
            const loggedInUserId = req.user.id;
            let loggedInUserTree = await getDownlineUsers(loggedInUserId);

            // Check if the target user is in the logged-in user's downline
            if (targetUserId && !loggedInUserTree.find(item => item?._id?.toString() === targetUserId?.toString())) {
                return res.status(404).json({ error: "User not in logged-in user tree" });
            }

            const targetedUser = await User.findById(userId);
            if (!targetedUser) {
                return res.status(404).json({ error: "User not found" });
            }

            query.userId = parseInt(targetedUser.c_id);
        } else {
            // If userId is not provided, handle based on the role
            if (req.user.role === "Owner") {
                // If the user is an Owner, return all tickets
                // No additional query conditions needed
            } else {
                // If the user is not an Owner, return tickets for users under the logged-in user
                const downlineUsers = await getDownlineUsers(req.user.id);
                const downlineUserIds = downlineUsers.map(user => parseInt(user.c_id));
                query.userId = { $in: downlineUserIds };
            }
        }

        // Add ticketCode to query if provided
        if (ticketCode) {
            query.ticketCode = ticketCode;
        }

        // Add date range to query if both startDate and endDate are provided
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);

            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid date format. Please use ISO format (YYYY-MM-DD)"
                });
            }

            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            query.createdAt = {
                $gte: start,
                $lte: end
            };
        }

        // Execute query with pagination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const totalCount = await Ticket.countDocuments(query);
        const tickets = await Ticket.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalPages = Math.ceil(totalCount / limit);

        return res.status(200).json({
            success: true,
            data: {
                tickets,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit
                }
            }
        });

    } catch (error) {
        console.error("[ERROR] Error occurred during tickets retrieval:", error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while retrieving tickets",
            error: error.message
        });
    }
};