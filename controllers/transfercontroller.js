const Transfer = require("../models/transfer");
const Bet = require("../models/bets");
const User = require("../models/User");
const GameImage = require("../models/GameImage");
const moment = require('moment');
const mongoose = require('mongoose'); // Import mongoose to use ObjectId
const { applyBonus } = require("../bonusManager/bonusApply");
const Cpypragmatic = require("../models/cpypragmatic");
const { revokeBonus } = require("../bonusManager/bonusRevoke");


// Remove fee calculation as fee is no longer required
exports.makeTransfer = async (req, res) => {
    const { senderId, receiverId, type, amount, note, transaction_id } = req.body;
    const ipAddress = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const transferAmount = Number(amount);

        if (isNaN(transferAmount) || transferAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid amount specified"
            });
        }
        if (transferAmount < 1) {
            return res.status(400).json({
                success: false,
                message: "Minimum transaction is 1TND"
            });
        }
        const senderObjectId = new mongoose.Types.ObjectId(senderId);
        const receiverObjectId = new mongoose.Types.ObjectId(receiverId);

        const sender = await User.findById(senderObjectId).session(session);
        const receiver = await User.findById(receiverObjectId).session(session);

        if (!sender || !receiver) {
            return res.status(404).json({
                success: false,
                message: "Sender or receiver not found"
            });
        }

        // Store initial balances for transaction record
        const senderInitialBalance = sender.balance;
        const receiverInitialBalance = receiver.balance;

        // Handle deposit logic
        if (type === 'deposit') {
            if (req.user.role !== "Owner") {
                if (!new mongoose.Types.ObjectId(sender.id).equals(receiver.createrid)) {
                    return res.status(400).json({
                        success: false,
                        message: "Transfer not permitted. Please check your eligibility and try again."
                    });
                }
            }

            if (sender.balance < transferAmount) {
                return res.status(400).json({
                    success: false,
                    message: "Insufficient balance for deposit"
                });
            }

            // Process regular transfer
            receiver.balance = parseFloat((receiver.balance + transferAmount).toFixed(2));
            sender.balance = parseFloat((sender.balance - transferAmount).toFixed(2));
            // Handle bonus logic for deposits
            if (receiver.role === 'User') {
                try {
                    await applyBonus("dummyBonus", receiver.id, transferAmount)

                } catch (bonusError) {
                    console.error("Bonus processing error:", bonusError);
                    // Continue with regular deposit even if bonus fails
                }
            }

        }
        // Handle withdraw logic
        else if (type === 'withdraw') {
            if (req.user.role !== "Owner") {
                if (new mongoose.Types.ObjectId(receiver.id).equals(sender.createrid)) {
                    if (sender.balance < transferAmount) {
                        return res.status(400).json({
                            success: false,
                            message: "Insufficient balance for withdrawal"
                        });
                    }
                    receiver.balance = parseFloat((receiver.balance + transferAmount).toFixed(2));
                    sender.balance = parseFloat((sender.balance - transferAmount).toFixed(2));
                } else {
                    return res.status(400).json({
                        success: false,
                        message: "Transfer not permitted. Please check your eligibility and try again."
                    });
                }
            } else {
                if (sender.balance < transferAmount) {
                    return res.status(400).json({
                        success: false,
                        message: "Insufficient balance for deposit"
                    });
                }
                if (sender.role === 'User' && sender.bonus_balance > 0) {
                    try {
                        await revokeBonus(sender.id)

                    } catch (bonusError) {
                        console.error("Bonus processing error:", bonusError);
                        // Continue with regular deposit even if bonus fails
                    }
                }
                receiver.balance = parseFloat((receiver.balance + transferAmount).toFixed(2));
                sender.balance = parseFloat((sender.balance - transferAmount).toFixed(2));
            }
        } else {
            return res.status(400).json({
                success: false,
                message: "Invalid transfer type"
            });
        }

        // Save updated balances
        await sender.save({ session });
        await receiver.save({ session });

        // Create transfer record
        const newTransfer = new Transfer({
            senderId: sender._id,
            receiverId: receiver._id,
            type,
            amount: parseFloat(transferAmount.toFixed(2)),
            transaction_id,
            note,
            balanceBefore: {
                sender: parseFloat(senderInitialBalance.toFixed(2)),
                receiver: parseFloat(receiverInitialBalance.toFixed(2))
            },
            balanceAfter: {
                sender: parseFloat(sender.balance.toFixed(2)),
                receiver: parseFloat(receiver.balance.toFixed(2))
            },
            initiatorIP: ipAddress,
            initiatorID: req.user.id,
        });

        await newTransfer.save({ session });

        // Commit transaction
        await session.commitTransaction();

        res.status(201).json({
            success: true,
            data: {
                message: "Transfer processed successfully."
            }
        });
    } catch (error) {
        await session.abortTransaction();
        console.error("Error during transfer creation:", error);
        res.status(400).json({
            success: false,
            message: error.message || "An error occurred during the transfer"
        });
    } finally {
        session.endSession();
    }
};

async function getDownlineUsers(userId) {
    const users = await User.find({ createrid: userId });
    let allUsers = [...users];

    for (const user of users) {
        const downlineUsers = await getDownlineUsers(user._id);
        allUsers = allUsers.concat(downlineUsers);
    }

    return allUsers;
}

// Helper function to generate the start and end date ranges based on input
const getDateFilter = (dateOption) => {
    let start, end;

    switch (dateOption) {
        case 'today':
            start = moment().startOf('day').toDate();
            end = moment().endOf('day').toDate();
            break;
        case 'yesterday':
            start = moment().subtract(1, 'days').startOf('day').toDate();
            end = moment().subtract(1, 'days').endOf('day').toDate();
            break;
        case '7days':
            start = moment().subtract(7, 'days').startOf('day').toDate();
            end = moment().endOf('day').toDate();
            break;
        case 'month':
            start = moment().startOf('month').toDate();
            end = moment().endOf('month').toDate();
            break;
        default:
            // Assuming the dateOption is a custom date in YYYY-MM-DD format
            start = moment(dateOption).startOf('day').toDate();
            end = moment(dateOption).endOf('day').toDate();
            break;
    }

    return { start, end };
};

// Controller function to get transfer history
exports.getTransferHistory = async (req, res, next) => {
  try {
    const {
      userName = "",
      filterUserName = "",
      transactionId = "",
      datefrom,
      dateto,
      startDate,
      endDate,
      timeFrom = "00:00",
      timeTo = "23:59",
      pageNum = 0,
      pageCount = 50,
      typeHist = -1 // -1 means all types
    } = req.body;

    console.log(req.body,{
      userName,
      filterUserName ,
      transactionId ,
      datefrom,
      dateto,
      startDate,
      endDate,
      timeFrom ,
      timeTo,
      pageNum,
      pageCount,
      typeHist // -1 means all types
    })

    const loggedInUserId = req.user.id;

    // Fetch user's downline tree
    const loggedInUserTree = await getDownlineUsers(loggedInUserId);
    loggedInUserTree.push(await User.findById(loggedInUserId));
    const allowedUserIds = loggedInUserTree.map(u => u._id);

    // Optional: filter by userName (dropdown)
    let filteredUserId = null;
    if (userName) {
      const targetUser = await User.findOne({ username: userName });
      if (!targetUser || !allowedUserIds.some(id => id.toString() === targetUser._id.toString())) {
        return res.status(403).json({ message: "You are not allowed to access this user's data." });
      }
      filteredUserId = targetUser._id;
    }

    // Optional: filter by filterUserName (manual input)
    let secondaryFilteredUserId = null;
    if (filterUserName) {
      const userToFilter = await User.findOne({ username: filterUserName });
      if (!userToFilter || !allowedUserIds.some(id => id.toString() === userToFilter._id.toString())) {
        return res.status(403).json({ message: "You are not allowed to access this user's data." });
      }
      secondaryFilteredUserId = userToFilter._id;
    }

    // Parse dates
    const start = startDate ? new Date(startDate) : new Date(`${datefrom}T${timeFrom}:00Z`);
    const end = endDate ? new Date(endDate) : new Date(`${dateto}T${timeTo}:59Z`);

    // Build MongoDB query
    const query = {
      type:
        typeHist === -1
          ? { $in: ["deposit", "withdraw"] }
          : typeHist === 1
          ? "deposit"
          : typeHist === 2
          ? { $ne: "deposit" }
          : { $in: ["deposit", "withdraw"] },
      date: { $gte: start, $lte: end }
    };

    // Filter by transaction ID if provided
    if (transactionId) {
      query._id = transactionId;
    } else {
      query.$or = [
        { senderId: secondaryFilteredUserId || filteredUserId || { $in: allowedUserIds } },
        { receiverId: secondaryFilteredUserId || filteredUserId || { $in: allowedUserIds } }
      ];
    }

    // Fetch from DB
    const transfers = await Transfer.find(query)
      .populate("senderId", "username role")
      .populate("receiverId", "username role")
      .sort({ date: -1 })
      .skip(pageNum * pageCount)
      .limit(Number(pageCount));

    res.status(200).json({ success: true, transferHistory: transfers });
  } catch (error) {
    res.status(500).json({ message: "Error fetching transfer history." });
  }
};



exports.getAllTransfers = async (req, res) => {
    try {
        // Fetch all transfers, populate senderId and receiverId details, and sort by date
        const transfers = await Transfer.find({})
            .populate('senderId', 'username role') // Populate sender's username and role
            .populate('receiverId', 'username role') // Populate receiver's username and role
            .sort({ date: -1 }); // Sort by most recent transfers

        // Return all transfer details
        res.status(200).json({
            success: true,
            transfers,
        });
    } catch (error) {
        console.error("Error fetching all transfers:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching all transfers.",
        });
    }
};



exports.getAgentTransactions = async (req, res) => {
    try {
        const roles = ["Owner", "Partner", "SuperAgent", "Agent"];

        const transfers = await Transfer.find({})
            .populate('senderId', 'username role')
            .populate('receiverId', 'username role')
            .sort({ date: -1 });

        const agentTransfers = transfers.filter(transfer => {
            // Check if senderId and receiverId are valid and have a role property
            const senderRole = transfer.senderId?.role;
            const receiverRole = transfer.receiverId?.role;

            return roles.includes(senderRole) || roles.includes(receiverRole);
        }).map(transfer => {
            return {
                senderRole: transfer.senderId?.role || null,
                date: transfer.date,
                senderUsername: transfer.senderId?.username || null,
                senderID: transfer.senderId?._id || null,
                receiverID: transfer.receiverId?._id || null,
                receiverUsername: transfer.receiverId?.username || null,
                senderBalanceBefore: transfer.balanceBefore?.sender || null,
                senderBalanceAfter: transfer.balanceAfter?.sender || null,
                receiverBalanceBefore: transfer.balanceBefore?.receiver || null,
                receiverBalanceAfter: transfer.balanceAfter?.receiver || null,
                amount: transfer.amount || null,
            };
        });

        res.status(200).json({
            success: true,
            agentTransactions: agentTransfers
        });
    } catch (error) {
        console.error("Error fetching agent transactions:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching agent transactions."
        });
    }
};

exports.getTransfer = async (req, res) => {
    const { username, date } = req.query;
    try {

        const user = await User.findOne({ username });

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Apply the date filter
        const dateFilter = getDateFilter(date);

        // Find transfers and populate senderId and receiverId with usernames and roles
        const transfers = await Transfer.find({
            $or: [
                { senderId: user._id },
                { receiverId: user._id }
            ],
            date: { $gte: dateFilter.start, $lte: dateFilter.end }
        })
            .populate('senderId', 'username role')  // Populate both username and role for senderId
            .populate('receiverId', 'username role'); // Populate both username and role for receiverId


        res.status(200).json({ success: true, transferHistory: transfers });
    } catch (error) {
        console.error("Error fetching transfer history:", error);
        return res.status(500).json({ message: "Error fetching transfer history." });
    }
};


exports.calculateMoneyDetails = async (req, res) => {
    try {
        // Fetch all transfers, populate senderId and receiverId details
        const transfers = await Transfer.find({})
            .populate('senderId', 'username role')
            .populate('receiverId', 'username role')
            .sort({ date: -1 }); // Sort by most recent transfers
        const bets = await Bet.find({})
            .populate('senderId', 'username role')
            .populate('receiverId', 'username role')
            .sort({ date: -1 }); // Sort by most recent transfers

        // Helper function to calculate moneyIn, moneyOut, and difference
        const calculateMoneyForTransfer = (transfer) => {
            const { senderId, receiverId, type, amount, rolledBack } = transfer;
            let moneyIn = 0;
            let moneyOut = 0;

            if (type === "deposit") {
                moneyIn = amount;
            } else if (type === "withdraw") {
                moneyOut = amount;
            }
            const difference = moneyIn - moneyOut;

            return { moneyIn, moneyOut, difference };
        };
        const calculateMoneyForBet = (bet) => {
            const { senderId, receiverId, type, amount, rolledBack } = bet;
            let moneyIn = 0;
            let moneyOut = 0;

            if (type === "credit") {
                moneyIn = amount;
            } else if (type === "debit") {
                moneyOut = amount;
            } else if (type === "rollback") {
                if (rolledBack) {
                    moneyOut = amount;
                } else {
                    moneyIn = amount;
                }
            }

            const difference = moneyIn - moneyOut;

            return { moneyIn, moneyOut, difference };
        };

        // Process each transfer and calculate money details
        const processedTransfers = transfers.map((transfer) => {
            const { moneyIn, moneyOut, difference } = calculateMoneyForTransfer(transfer);

            return {
                transactionId: transfer.transaction_id,
                senderUsername: transfer.senderId?.username || null,
                senderRole: transfer.senderId?.role || null,
                receiverUsername: transfer.receiverId?.username || null,
                receiverRole: transfer.receiverId?.role || null,
                date: transfer.date,
                amount: parseFloat(transfer.amount?.toFixed(2)),
                moneyIn: parseFloat(moneyIn?.toFixed(2)),
                moneyOut: parseFloat(moneyOut?.toFixed(2)),
                difference: parseFloat(difference?.toFixed(2)),
            };
        });
        const processedBets = bets.map((bet) => {
            const { moneyIn, moneyOut, difference } = calculateMoneyForBet(bet);

            return {
                transactionId: bet.transaction_id,
                senderUsername: bet.senderId?.username || null,
                senderRole: bet.senderId?.role || null,
                receiverUsername: bet.receiverId?.username || null,
                receiverRole: bet.receiverId?.role || null,
                date: bet.date,
                amount: parseFloat(bet.amount?.toFixed(2)),
                moneyIn: parseFloat(moneyIn?.toFixed(2)),
                moneyOut: parseFloat(moneyOut?.toFixed(2)),
                difference: parseFloat(difference?.toFixed(2)),
            };
        });

        // Return the processed data
        res.status(200).json({
            success: true,
            transfers: [...processedTransfers, ...processedBets],
        });
    } catch (error) {
        console.error("Error calculating money details:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while calculating money details.",
        });
    }
};

exports.getTransferReport = async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        const start = new Date(startDate);
        const end = new Date(endDate);
        start.setUTCHours(0, 0, 0, 0); // Set to start of the day in UTC
        end.setUTCHours(23, 59, 59, 999); // Set to end of the day in UTC
        const targetUserId = userId
        const loggedInUserId = req.user.id;
        let loggedInUserTree = await getDownlineUsers(loggedInUserId)
        if (loggedInUserId !== targetUserId) {
            if (targetUserId && !loggedInUserTree.find(item => item?._id?.toString() === targetUserId?.toString())) {
                return res.status(404).json({ error: "User not in loggedin user tree" });
            }
        }
        // Find the target user by username
        const targetUser = await User.findOne({ _id: targetUserId });
        if (!targetUser) {
            return res.status(404).json({ message: "User not found" });
        }

        // Find the requester
        const requester = await User.findById(loggedInUserId);
        if (!requester) {
            return res.status(404).json({ message: "Requester not found" });
        }

        // Define role hierarchy
        const roleHierarchy = {
            'Owner': 4,
            'Partner': 3,
            'SuperAgent': 2,
            'Agent': 1,
            'User': 0
        };

        // Check if requester's role is higher than or equal to target user's role
        if (roleHierarchy[requester.role] < roleHierarchy[targetUser.role]) {
            return res.status(403).json({ message: "You don't have permission to view users with higher roles" });
        }

        // Check if target user is in requester's creation tree
        if (loggedInUserId !== targetUserId) {
            const isInCreationTree = await checkCreationTree(targetUser.id, loggedInUserId);
            if (!isInCreationTree) {
                return res.status(403).json({ message: "User is not in your creation tree" });
            }
        }

        // Create date filter
        const dateFilter = {};
        if (startDate && endDate) {
            dateFilter.date = {
                $gte: start,
                $lte: end
            };
        }

        // Get transfers
        const transfers = await Transfer.find({
            $or: [
                { senderId: targetUser._id },
                { receiverId: targetUser._id }
            ],
            ...dateFilter
        });

        // Calculate totals
        let moneyIn = 0;
        let moneyOut = 0;

        transfers.forEach(transfer => {
            if (transfer.receiverId?.toString() === targetUser._id.toString()) {
                moneyIn += transfer.amount;
            }
            if (transfer.senderId?.toString() === targetUser._id.toString()) {
                moneyOut += transfer.amount;
            }
        });

        const difference = moneyIn - moneyOut;
        const childerenOfTargetedUser = await User.find({ createrid: userId })

        const refactoredChildren = childerenOfTargetedUser.map(child => {
            let childMoneyIn = 0;
            let childMoneyOut = 0;

            // Calculate moneyIn and moneyOut for each child
            transfers.forEach(transfer => {
                if (transfer.receiverId?.toString() === child._id.toString()) {
                    childMoneyIn += transfer.amount;
                }
                if (transfer.senderId?.toString() === child._id.toString()) {
                    childMoneyOut += transfer.amount;
                }
            });

            return {
                username: child.username,
                childId: child._id,
                role: child.role,
                moneyIn: childMoneyIn,
                moneyOut: childMoneyOut,
                difference: childMoneyIn - childMoneyOut,
            };
        });


        return res.status(200).json({
            username: targetUser.username,
            _id: targetUser._id,
            role: targetUser.role,
            children: [...refactoredChildren],
            moneyIn,
            moneyOut,
            difference,
            period: {
                from: startDate || 'all time',
                to: endDate || 'all time'
            }
        });

    } catch (error) {
        console.error('Error in getTransferReport:', error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

// Helper function to check the creation tree
async function checkCreationTree(targetUserId, requesterId) {
    let currentUserId = targetUserId;
    const visited = new Set(); // To prevent infinite loops

    while (currentUserId && !visited.has(currentUserId)) {
        visited.add(currentUserId);

        const user = await User.findById(currentUserId);
        if (!user) break;

        // If we find the requester in the creation chain, return true
        if (user.createrid?.toString() === requesterId.toString()) {
            return true;
        }

        // Move up the creation chain
        currentUserId = user.createrid;
    }

    return false;
}


async function getDownlineUsers(userId) {
    const users = await User.find({ createrid: userId });
    let allUsers = [...users];

    for (const user of users) {
        const downlineUsers = await getDownlineUsers(user._id);
        allUsers = allUsers.concat(downlineUsers);
    }

    return allUsers;
}

exports.getCasinoBets = async (req, res) => {
    let allLastDebitTransactionsOfCreditTransactions = []
    try {
        const { startDate, endDate, partnerId, superAgentId, agentId, playerId, gameId, betId } = req.query;
        const targetUserId = playerId || agentId || superAgentId || partnerId
        const loggedInUserId = req.user.id;
        let loggedInUserTree = await getDownlineUsers(loggedInUserId)
        if (targetUserId && !loggedInUserTree.find(item => item?._id?.toString() === targetUserId?.toString())) {
            return res.status(404).json({ error: "User not in loggedin user tree" });
        }

        let relevantUsers;
        if (targetUserId) {
            const targetUser = await User.findById(targetUserId);
            relevantUsers = await getDownlineUsers(targetUserId);
            relevantUsers.push(targetUser);
        } else {
            relevantUsers = await getDownlineUsers(req.user.id);
            relevantUsers.push(await User.findById(req.user.id));
        }
        const userIds = relevantUsers.map(user => user._id);
        const query = {
            type: { $in: ["credit", "debit"] },
            $or: [{ userId: { $in: userIds } }],
            createdFrom: "CASINO"
        };

        if (gameId) query.gameId = gameId;
        if (betId) query.transaction_id = betId;

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return res.status(400).json({ error: "Invalid date range" });
            }
            // Ensure correct UTC start and end times
            start.setUTCHours(0, 0, 0, 0); // Set to start of the day in UTC
            end.setUTCHours(23, 59, 59, 999); // Set to end of the day in UTC
            query.date = { $gte: start, $lte: end };
        }

        const transfers = await Bet.find(query).sort({ date: 1 }).lean();

        const senderIds = transfers.map(t => t.userId).filter(Boolean);

        const senders = await User.find({ _id: { $in: senderIds } }).select("_id username balance").lean();

        const senderMap = Object.fromEntries(senders.map(user => [user._id.toString(), user]));
        const gameIds = transfers.map(t => t.gameId).filter(Boolean);
        const gameImages = await GameImage.find({ gameId: { $in: gameIds } }).select("gameId name").lean();

        const cpypragmaticGames = await Cpypragmatic.find({ gameId: { $in: gameIds } })
            .select("gameId name")
            .lean();

        // Merge results based on gameId
        const combinedGames = [...gameImages, ...cpypragmaticGames];
        const gameMap = Object.fromEntries(combinedGames.map(game => [game.gameId, game.name]));

        const response = transfers.map(transfer => {
            const sender = senderMap[transfer.userId?.toString()] || null;
            const gameName = gameMap[transfer.gameId] || "";

            let stake = transfer.amount; // Default stake value
            let payout = "-"; // Default payout value
            if (transfer.type === "credit") {
                // Find the last debit transaction for the same sender & game before this credit
                const lastDebit = transfers
                    .filter(t =>
                        t.userId?.toString() === transfer.userId?.toString() &&
                        t.gameId === transfer.gameId &&
                        t.type === "debit" &&
                        new Date(t.date) < new Date(transfer.date) // Ensure it's before the credit
                    )
                    .sort((a, b) => new Date(b.date) - new Date(a.date)) // Sort descending to get latest debit
                [0]; // Get the first (latest) debit transaction
                if (lastDebit) {
                    stake = parseFloat((lastDebit.balanceBefore?.sender - transfer.balanceBefore?.sender)?.toFixed(2));
                    allLastDebitTransactionsOfCreditTransactions.push(lastDebit._id)
                }
                payout = parseFloat((transfer?.balanceAfter?.sender - transfer?.balanceBefore?.sender)?.toFixed(2))
            }
            return {
                ...transfer,
                sender,
                gameName,
                stake,
                payout
            };

        });
        let refacterResponse = response.length
            ? response.filter(item => !allLastDebitTransactionsOfCreditTransactions.includes(item._id))
            : []
        res.json(refacterResponse);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
}