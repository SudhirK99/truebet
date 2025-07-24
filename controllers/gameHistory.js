const jwt = require("jsonwebtoken");
const moment = require("moment");
const GameSession = require("../models/gamesession");
const axios = require("axios");
const User = require("../models/User");
const GameImage = require("../models/GameImage");
const Bet = require("../models/bets");
const Cpypragmatic = require("../models/cpypragmatic");
const fs = require("fs");
const path = require("path");
// const Bet = require("../models/Bet"); // Uncomment this line when using MongoDB

const PROVIDER_API_URL = process.env.PROVIDER_API_URL;
const API_PASSWORD = process.env.API_PASSWORD;
const API_USERNAME = process.env.API_USERNAME;

// Helper function to call Provider API
async function callProviderAPI(payload) {
  const url = PROVIDER_API_URL;
  try {
    const response = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
    });
    return response.data;
  } catch (error) {
    console.error(
      "[ERROR] Provider API Error:",
      error.response?.data || error.message
    );
    throw new Error(
      error.response?.data?.message || "Error communicating with provider"
    );
  }
}

// Helper function to fetch all pages from the provider API
async function fetchAllPages(payload) {
  let results = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const paginatedPayload = { ...payload, page_number: page };
    const response = await callProviderAPI(paginatedPayload);

    if (response.error === 0) {
      results.push(...response.response);
      page += 1;
      hasMorePages = page <= response.pages_total;
    } else {
      hasMorePages = false; // Stop on error
    }
  }

  return results;
}

exports.getGameHistory = async (req, res) => {
  try {
    const username = req.user.username;

    if (!username) {
      console.error("[ERROR] Decoded token missing 'username':", req.user);
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Token is invalid.",
      });
    }

    const {
      date_start,
      date_end,
      return_format = "data",
      items_per_page = 10,
    } = req.body;

    //const { currency } = req.user;
    const currency = req.user.currency;
    if (!date_start || !moment(date_start).isValid()) {
      return res.status(400).json({
        success: false,
        message: "date_start is required and must be a valid UTC date.",
      });
    }
    if (!date_end || !moment(date_end).isValid()) {
      return res.status(400).json({
        success: false,
        message: "date_end is required and must be a valid UTC date.",
      });
    }

    const dateStartFormatted = moment
      .utc(date_start)
      .format("YYYY-MM-DD HH:mm:ss");
    const dateEndFormatted = moment.utc(date_end).format("YYYY-MM-DD HH:mm:ss");

    const sessions = await GameSession.find({ username }).sort({
      launch_time: -1,
    });

    if (!sessions.length) {
      console.warn("[WARN] No game sessions found for user:", username);
      return res.status(404).json({
        success: false,
        message: "No game sessions found for this user",
      });
    }

    let allHistory = [];

    for (const session of sessions) {
      const payload = {
        api_login: API_USERNAME,
        api_password: API_PASSWORD,
        method: "getGameHistory",
        game_id: session.gameId,
        gamesession_id: session.gamesession_id,
        user_username: username,
        render: "json",
        date_start: dateStartFormatted,
        date_end: dateEndFormatted,
        return_format,
        currency,
        items_per_page: Math.min(parseInt(items_per_page, 10), 100),
      };

      const sessionHistory = await fetchAllPages(payload);
      allHistory.push(...sessionHistory);
    }

    return res.status(200).json({
      success: true,
      data: allHistory,
    });
  } catch (error) {
    console.error("[ERROR] getGameHistory failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "An internal server error occurred while fetching game history.",
    });
  }
};

exports.getCasinoBetsHistory = async (req, res) => {
  let allLastDebitTransactionsOfCreditTransactions = [];
  try {
    const {
      date_start,
      date_end,
      return_format = "data",
      items_per_page = 10,
    } = req.body;
    // const { startDate, endDate, partnerId, superAgentId, agentId, playerId, gameId,betId } = req.query;
    //  const targetUserId = playerId || agentId || superAgentId || partnerId
    const userId = req.user.id;
    let query = {};
    if (userId) query.userId = userId;

    if (date_start && date_end) {
      const start = new Date(date_start);
      const end = new Date(date_end);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid date range" });
      }
      // Ensure correct UTC start and end times
      start.setUTCHours(0, 0, 0, 0); // Set to start of the day in UTC
      end.setUTCHours(23, 59, 59, 999); // Set to end of the day in UTC
      query.date = { $gte: start, $lte: end };
      query.createdFrom = "CASINO";
    }
    const dateStartFormatted = moment
      .utc(date_start)
      .format("YYYY-MM-DD HH:mm:ss");
    const dateEndFormatted = moment.utc(date_end).format("YYYY-MM-DD HH:mm:ss");

    const transfers = await Bet.find(query).sort({ date: 1 }).lean();
    const username = req.user.username;
    const sessions = await GameSession.find({ username }).sort({
      launch_time: -1,
    });

    const gameIds = transfers.map((t) => t.gameId).filter(Boolean);
    const gameImages = await GameImage.find({ gameId: { $in: gameIds } })
      .select("gameId name")
      .lean();

    const cpypragmaticGames = await Cpypragmatic.find({
      gameId: { $in: gameIds },
    })
      .select("gameId name")
      .lean();

    // Merge results based on gameId
    const combinedGames = [...gameImages, ...cpypragmaticGames];
    const gameMap = Object.fromEntries(
      combinedGames.map((game) => [game.gameId, game.name])
    );

    const response = transfers.map((transfer) => {
      // const sender = senderMap[transfer.userId?.toString()] || null;
      const gameName = gameMap[transfer.gameId] || "";

      let stake = transfer.amount; // Default stake value
      let payout = "-"; // Default payout value
      if (transfer.type === "credit") {
        // Find the last debit transaction for the same sender & game before this credit
        const lastDebit = transfers
          .filter(
            (t) =>
              t.userId?.toString() === transfer.userId?.toString() &&
              t.gameId === transfer.gameId &&
              t.type === "debit" &&
              new Date(t.date) < new Date(transfer.date) // Ensure it's before the credit
          )
          .sort((a, b) => new Date(b.date) - new Date(a.date))[0]; // Sort descending to get latest debit // Get the first (latest) debit transaction

        if (lastDebit) {
          stake = parseFloat(
            (
              lastDebit?.balanceBefore?.sender - transfer?.balanceBefore?.sender
            )?.toFixed(2)
          );
          allLastDebitTransactionsOfCreditTransactions.push(lastDebit._id);
        }
        payout = parseFloat(
          (
            transfer?.balanceAfter?.sender - transfer?.balanceBefore?.sender
          )?.toFixed(2)
        );
      }
      return {
        ...transfer,
        // sender,
        gameName,
        stake,
        payout,
      };
    });
    let refacterResponse = response.length
      ? response
          .filter(
            (item) =>
              !allLastDebitTransactionsOfCreditTransactions.includes(item._id)
          )
          .map((item) => {
            return {
              date: item.date,
              gameName: item.gameName,
              gameId: item.gameId,
              balanceBefore: item.balanceBefore,
              balanceAfter: item.balanceAfter,
              transaction_id: item.transaction_id,
              amount: item.amount,
              status: item.type,
            };
          })
      : [];
    res.json(refacterResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getDailyReport = async (req, res) => {
  const { date, associateid = 0 } = req.body;
  const { currency } = req.user;
  if (!date) {
    return res.status(400).json({
      success: false,
      message: "The date field is required.",
    });
  }

  try {
    const payload = {
      api_password: API_PASSWORD,
      api_login: API_USERNAME,
      method: "getDailyReport",
      date,
      associateid,
      currency,
    };

    const response = await callProviderAPI(payload);

    if (response.error === 0) {
      return res.status(200).json({
        success: true,
        data: response.response,
        allowed_systems: response.allowed_systems,
        currency: response.currency,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.message || "Failed to fetch daily report.",
      });
    }
  } catch (error) {
    console.error("[ERROR] getDailyReport:", error.message);
    return res.status(500).json({
      success: false,
      message:
        "An internal server error occurred while fetching the daily report.",
    });
  }
};

// Helper function to check if requester has sufficient permissions
async function hasPermission(requesterId, targetUsername) {
  if (!targetUsername) return true;

  const requester = await User.findById(requesterId);
  const targetUser = await User.findOne({ _id: targetUsername });

  if (!targetUser) return false;

  const roleHierarchy = {
    Owner: 5,
    Partner: 4,
    SuperAgent: 3,
    Agent: 2,
    User: 1,
  };

  return roleHierarchy[requester.role] > roleHierarchy[targetUser.role];
}

// Helper function to get all users under a specific user in hierarchy
async function getDownlineUsers(userId) {
  const users = await User.find({ createrid: userId });
  let allUsers = [...users];

  for (const user of users) {
    const downlineUsers = await getDownlineUsers(user._id);
    allUsers = allUsers.concat(downlineUsers);
  }

  return allUsers;
}

const oldGameReport = async (queryData, loginUser) => {
  const {
    startDate,
    endDate,
    partnerId,
    superAgentId,
    agentId,
    playerId,
    gameId,
    groupedBy,
  } = queryData;
  const query = {};
  const userId = playerId || agentId || superAgentId || partnerId;
  const loggedInUserId = loginUser;
  let loggedInUserTree = await getDownlineUsers(loggedInUserId);
  if (
    userId &&
    !loggedInUserTree.find(
      (item) => item?._id?.toString() === userId?.toString()
    )
  ) {
    throw new Error({ status: false, error: "User not in loggedin user tree" });
  }

  const users = await getDownlineUsers(userId || loginUser);
  if (users.length === 0) {
    throw new Error({ success: true, data: [] });
  }

  const usernames = users.map((user) => user.username);
  // query.dbname = "gameImages"
  if (usernames.length) {
    query.username = { $in: usernames };
  }
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error({ error: "Invalid date range" });
    }
    // Ensure correct UTC start and end times
    start.setUTCHours(0, 0, 0, 0); // Set to start of the day in UTC
    end.setUTCHours(23, 59, 59, 999); // Set to end of the day in UTC
    query.createdAt = { $gte: start, $lte: end };
  }
  if (gameId) {
    query.gameId = gameId;
  }

  const gameSessions = await GameSession.find(query);
  if (gameSessions.length === 0) {
    throw new Error({ success: true, data: [] });
  }

  const gameIds = [...new Set(gameSessions.map((session) => session.gameId))];
  const gameDetails = await GameImage.find({ gameId: { $in: gameIds } });

  const gameMap = {};
  await Promise.all(
    gameSessions.map(async (game) => {
      const bets = await Bet.findOne({ gamesession_id: game.gamesession_id });
      let gameInfo = await GameImage.findOne({ gameId: bets?.gameId });

      if (!gameInfo) {
        const session = await GameSession.findOne({
          gamesession_id: bets?.gamesession_id,
        });
        if (session?.gameId) {
          gameInfo = await GameImage.findOne({ gameId: session.gameId });
        }
      }

      gameMap[game.gamesession_id] = {
        gamesession_id: game.gamesession_id,
        gameName: gameInfo?.name || "Unknown Game",
        providerName:
          gameInfo?.provider_name ||
          (gameInfo?.provider === "null"
            ? "Pragmatic Play"
            : game.gamesession_id.split("_")[0] || "Unknown Provider"),
      };

      return gameMap;
    })
  );
  const creatorIds = [...new Set(users.map((user) => user.createrid))];
  const creators = await User.find({ _id: { $in: creatorIds } });

  const creatorMap = {};
  creators.forEach((creator) => {
    creatorMap[creator._id] = { id: creator._id, name: creator.username };
  });

  const reportData = {};

  for (const session of gameSessions) {
    const user = users.find((u) => u.username === session.username);
    if (!user) continue;

    const gameInfo = gameMap[session.gamesession_id];
    if (!gameInfo) continue;

    const creatorData = creatorMap[user.createrid] || {
      id: "Unknown",
      name: "Unknown Agent",
    };
    const transfers = await Bet.find({
      userId: user._id,
      gamesession_id: gameInfo.gamesession_id,
      date: query.createdAt,
    })
      .sort({ date: 1 })
      .lean();
    if (transfers.length === 0) continue;

    if (groupedBy === "provider") {
      if (!reportData[gameInfo.providerName]) {
        reportData[gameInfo.providerName] = {
          providerName: gameInfo.providerName || "Plagmatic play",
          games: {},
          totalStake: 0, // Ensure totalStake exists at provider level
          totalPayout: 0, // Ensure totalPayout exists at provider level
        };
      }

      if (!reportData[gameInfo.providerName].games[gameInfo.gamesession_id]) {
        reportData[gameInfo.providerName].games[gameInfo.gamesession_id] = {
          gamesession_id: gameInfo.gamesession_id,
          gameName: gameInfo.gameName,
          users: [],
          totalStake: 0, // Ensure totalStake exists at game level
          totalPayout: 0, // Ensure totalPayout exists at game level
        };
      }

      const existingUserIndex = reportData[gameInfo.providerName].games[
        gameInfo.gamesession_id
      ].users.findIndex((userItem) => userItem.userId === user._id);

      if (existingUserIndex === -1) {
        // Calculate total stake and payout for the user

        const userTransfers = transfers.map((transfer) => {
          const gameName = gameMap[transfer.gamesession_id] || "";
          let stake = transfer.amount; // Default stake value
          let payout = 0; // Default payout value

          if (transfer.type === "credit") {
            const lastDebit = transfers
              .filter(
                (t) =>
                  t.senderId?.toString() === transfer.senderId?.toString() &&
                  t.gamesession_id === transfer.gamesession_id &&
                  t.type === "debit" &&
                  new Date(t.date) < new Date(transfer.date)
              )
              .sort((a, b) => new Date(b.date) - new Date(a.date))[0]; // Sort descending to get latest debit // Get the first (latest) debit transaction

            if (lastDebit) {
              stake =
                lastDebit.balanceBefore.sender - transfer.balanceBefore.sender;
            }
            payout =
              transfer.balanceAfter.sender - transfer.balanceBefore.sender;
          }

          return {
            ...transfer,
            gameName,
            stake,
            payout,
          };
        });

        let userTotalStake = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let userTotalPayout = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);

        // Add user to the report data
        reportData[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ].users.push({
          userId: user._id,
          userName: user.username,
          transfers: userTransfers,
          totalStake: userTotalStake, // Add totalStake for the user
          totalPayout: userTotalPayout, // Add totalPayout for the user
        });

        // Update game total stake and payout
        reportData[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ].totalStake += userTotalStake;
        reportData[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ].totalPayout += userTotalPayout;

        // Update provider total stake and payout
        reportData[gameInfo.providerName].totalStake += userTotalStake;
        reportData[gameInfo.providerName].totalPayout += userTotalPayout;
      }
    } else if (groupedBy === "date") {
      const dateKey = new Date(session.createdAt).toISOString().split("T")[0];

      if (!reportData[dateKey]) {
        reportData[dateKey] = {
          date: dateKey,
          providers: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (!reportData[dateKey].providers[gameInfo.providerName]) {
        reportData[dateKey].providers[gameInfo.providerName] = {
          providerName: gameInfo.providerName || "Plagmatic play",
          games: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (
        !reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ]
      ) {
        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ] = {
          gamesession_id: gameInfo.gamesession_id,
          gameName: gameInfo.gameName,
          users: [],
          totalStake: 0,
          totalPayout: 0,
        };
      }

      const existingUserIndex = reportData[dateKey].providers[
        gameInfo.providerName
      ].games[gameInfo.gamesession_id].users.findIndex(
        (userItem) => userItem.userId === user._id
      );

      if (existingUserIndex === -1) {
        const userTransfers = transfers.map((transfer) => {
          const gameName = gameMap[transfer.gamesession_id] || "";
          let stake = transfer.amount; // Default stake value
          let payout = 0; // Default payout value

          if (transfer.type === "credit") {
            const lastDebit = transfers
              .filter(
                (t) =>
                  t.senderId?.toString() === transfer.senderId?.toString() &&
                  t.gamesession_id === transfer.gamesession_id &&
                  t.type === "debit" &&
                  new Date(t.date) < new Date(transfer.date)
              )
              .sort((a, b) => new Date(b.date) - new Date(a.date))[0]; // Sort descending to get latest debit // Get the first (latest) debit transaction

            if (lastDebit) {
              stake =
                lastDebit.balanceBefore.sender - transfer.balanceBefore.sender;
            }
            payout =
              transfer.balanceAfter.sender - transfer.balanceBefore.sender;
          }

          return {
            ...transfer,
            gameName,
            stake,
            payout,
          };
        });

        let gameTotalStake = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let gameTotalPayout = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let userTotalStake = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let userTotalPayout = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);

        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ].users.push({
          userId: user._id,
          userName: user.username,
          transfers: userTransfers,
          totalStake: userTotalStake,
          totalPayout: userTotalPayout,
        });

        // Update game total stake and payout
        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ].totalStake += gameTotalStake;
        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gamesession_id
        ].totalPayout += gameTotalPayout;

        // Update provider total stake and payout
        reportData[dateKey].providers[gameInfo.providerName].totalStake +=
          gameTotalStake;
        reportData[dateKey].providers[gameInfo.providerName].totalPayout +=
          gameTotalPayout;

        // Update date total stake and payout
        reportData[dateKey].totalStake += gameTotalStake;
        reportData[dateKey].totalPayout += gameTotalPayout;
      }
    } else {
      if (!reportData[user.createrid]) {
        reportData[user.createrid] = {
          agentId: creatorData.id,
          agentName: creatorData.name,
          users: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (!reportData[user.createrid].users[user._id]) {
        reportData[user.createrid].users[user._id] = {
          userId: user._id,
          userName: user.username,
          providers: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (
        !reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ]
      ) {
        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ] = {
          providerName: gameInfo.providerName || "Plagmatic play",
          games: [],
          totalStake: 0,
          totalPayout: 0,
        };
      }

      const existingGameIndex = reportData[user.createrid].users[
        user._id
      ].providers[gameInfo.providerName].games.findIndex(
        (game) => game.gamesession_id === gameInfo.gamesession_id
      );

      if (existingGameIndex === -1) {
        const gameTransfers = transfers.map((transfer) => {
          const gameName = gameMap[transfer.gamesession_id] || "";
          let stake = transfer.amount; // Default stake value
          let payout = 0; // Default payout value

          if (transfer.type === "credit") {
            const lastDebit = transfers
              .filter(
                (t) =>
                  t.senderId?.toString() === transfer.senderId?.toString() &&
                  t.gamesession_id === transfer.gamesession_id &&
                  t.type === "debit" &&
                  new Date(t.date) < new Date(transfer.date)
              )
              .sort((a, b) => new Date(b.date) - new Date(a.date))[0]; // Sort descending to get latest debit // Get the first (latest) debit transaction

            if (lastDebit) {
              stake =
                lastDebit.balanceBefore.sender - transfer.balanceBefore.sender;
            }
            payout =
              transfer.balanceAfter.sender - transfer.balanceBefore.sender;
          }

          return {
            ...transfer,
            gameName,
            stake,
            payout,
          };
        });

        let gameTotalStake = gameTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let gameTotalPayout = gameTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ].games.push({
          gamesession_id: gameInfo.gamesession_id,
          gameName: gameInfo.gameName,
          transfers: gameTransfers,
          totalStake: gameTotalStake,
          totalPayout: gameTotalPayout,
        });

        // Update provider total stake and payout
        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ].totalStake += gameTotalStake;
        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ].totalPayout += gameTotalPayout;

        // Update user total stake and payout
        reportData[user.createrid].users[user._id].totalStake += gameTotalStake;
        reportData[user.createrid].users[user._id].totalPayout +=
          gameTotalPayout;

        // Update agent total stake and payout
        reportData[user.createrid].totalStake += gameTotalStake;
        reportData[user.createrid].totalPayout += gameTotalPayout;
      }
    }
  }

  let responseData;
  if (groupedBy === "provider") {
    responseData = Object.values(reportData).map((provider) => ({
      providerName: provider.providerName,
      totalStake: parseFloat(provider.totalStake?.toFixed(2)),
      totalPayout: parseFloat(provider.totalPayout?.toFixed(2)),
      games: Object.values(
        Object.values(provider.games).reduce((acc, game) => {
          const { gameName, totalStake, totalPayout, users, gamesession_id } =
            game;
          if (!acc[gameName]) {
            acc[gameName] = { gameName, totalStake: 0, totalPayout: 0 };
          }
          acc[gameName].totalStake += totalStake;
          acc[gameName].totalPayout += totalPayout;
          acc[gameName].users = users;
          acc[gameName].gamesession_id = gamesession_id;
          return acc;
        }, {})
      ),
    }));
  } else if (groupedBy === "date") {
    responseData = Object.values(reportData).map((dateGroup) => ({
      date: dateGroup.date,
      totalStake: parseFloat(dateGroup.totalStake?.toFixed(2)),
      totalPayout: parseFloat(dateGroup.totalPayout?.toFixed(2)),
      providers: Object.values(dateGroup.providers).map((provider) => ({
        providerName: provider.providerName,
        totalStake: parseFloat(provider.totalStake?.toFixed(2)),
        totalPayout: parseFloat(provider.totalPayout?.toFixed(2)),
        games: Object.values(
          Object.values(provider.games).reduce((acc, game) => {
            const { gameName, totalStake, totalPayout, users, gamesession_id } =
              game;
            if (!acc[gameName]) {
              acc[gameName] = { gameName, totalStake: 0, totalPayout: 0 };
            }
            acc[gameName].totalStake += totalStake;
            acc[gameName].totalPayout += totalPayout;
            acc[gameName].users = users;
            acc[gameName].gamesession_id = gamesession_id;
            return acc;
          }, {})
        ),
      })),
    }));
  } else {
    responseData = Object.values(reportData).map((agent) => ({
      agentId: agent.agentId,
      agentName: agent.agentName,
      totalStake: parseFloat(agent.totalStake?.toFixed(2)),
      totalPayout: parseFloat(agent.totalPayout?.toFixed(2)),
      users: Object.values(agent.users).map((user) => ({
        userId: user.userId,
        userName: user.userName,
        totalStake: parseFloat(user.totalStake?.toFixed(2)),
        totalPayout: parseFloat(user.totalPayout?.toFixed(2)),
        providers: Object.values(user.providers).map((provider) => ({
          providerName: provider.providerName,
          totalStake: parseFloat(provider.totalStake?.toFixed(2)),
          totalPayout: parseFloat(provider.totalPayout?.toFixed(2)),
          games: Object.values(
            Object.values(provider.games).reduce((acc, game) => {
              const {
                gameName,
                totalStake,
                totalPayout,
                transfers,
                gamesession_id,
              } = game;
              if (!acc[gameName]) {
                acc[gameName] = { gameName, totalStake: 0, totalPayout: 0 };
              }
              acc[gameName].totalStake += totalStake;
              acc[gameName].totalPayout += totalPayout;
              acc[gameName].transfers = transfers;
              acc[gameName].gamesession_id = gamesession_id;
              return acc;
            }, {})
          ),
        })),
      })),
    }));
  }
  return responseData;
};

const newGameReport = async (queryData, loginUser) => {
  const {
    startDate,
    endDate,
    partnerId,
    superAgentId,
    agentId,
    playerId,
    gameId,
    groupedBy,
  } = queryData;
  const query = {};
  const userId = playerId || agentId || superAgentId || partnerId;
  const loggedInUserId = loginUser;
  let loggedInUserTree = await getDownlineUsers(loggedInUserId);
  if (
    userId &&
    !loggedInUserTree.find(
      (item) => item?._id?.toString() === userId?.toString()
    )
  ) {
    throw new Error({ error: "User not in loggedin user tree" });
  }

  const users = await getDownlineUsers(userId || loginUser);
  if (users.length === 0) {
    // return res.status(200).json({ success: true, data: [] });
    throw new Error({ success: true, data: [] });
  }

  const usernames = users.map((user) => user.username);
  // query.dbname = "cpypragmatics"
  if (usernames.length) {
    query.username = { $in: usernames };
  }

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error({ error: "Invalid date range" });
    }
    // Ensure correct UTC start and end times
    start.setUTCHours(0, 0, 0, 0); // Set to start of the day in UTC
    end.setUTCHours(23, 59, 59, 999); // Set to end of the day in UTC
    query.createdAt = { $gte: start, $lte: end };
  }
  if (gameId) {
    query.gameId = gameId;
  }

  const gameSessions = await GameSession.find(query);
  if (gameSessions.length === 0) {
    throw new Error({ success: true, data: [] });
  }
  const gameIds = [
    ...new Set(gameSessions.map((session) => String(session.gameId))),
  ];
  const gameDetails = await Cpypragmatic.find({ gameId: { $in: gameIds } });

  const gameMap = {};
  gameDetails.forEach((game) => {
    gameMap[game.gameId] = {
      gameId: String(game._doc?.gameId) || String(game.gameId),
      gameName: game._doc?.name || game.name,
      providerName:
        game._doc?.provider_name ||
        game.provider_name ||
        game._doc?.vendorid ||
        game.vendorid ||
        "Unknown provider",
    };
  });
  const creatorIds = [...new Set(users.map((user) => user.createrid))];
  const creators = await User.find({ _id: { $in: creatorIds } });

  const creatorMap = {};
  creators.forEach((creator) => {
    creatorMap[creator._id] = { id: creator._id, name: creator.username };
  });

  const reportData = {};

  for (const session of gameSessions) {
    const user = users.find((u) => u.username === session.username);
    if (!user) continue;

    const gameInfo = gameMap[session.gameId];

    if (!gameInfo) continue;

    const creatorData = creatorMap[user.createrid] || {
      id: "Unknown",
      name: "Unknown Agent",
    };

    const transfers = await Bet.find({
      userId: user._id,
      gameId: gameInfo.gameId,
      date: query.createdAt,
    })
      .sort({ date: 1 })
      .lean();
    if (transfers.length === 0) continue;

    if (groupedBy === "provider") {
      if (!reportData[gameInfo.providerName]) {
        reportData[gameInfo.providerName] = {
          providerName: gameInfo.providerName || "CPY-Plagmatic",
          games: {},
          totalStake: 0, // Ensure totalStake exists at provider level
          totalPayout: 0, // Ensure totalPayout exists at provider level
        };
      }

      if (!reportData[gameInfo.providerName].games[gameInfo.gameId]) {
        reportData[gameInfo.providerName].games[gameInfo.gameId] = {
          gameId: gameInfo.gameId,
          gameName: gameInfo.gameName,
          users: [],
          totalStake: 0, // Ensure totalStake exists at game level
          totalPayout: 0, // Ensure totalPayout exists at game level
        };
      }

      const existingUserIndex = reportData[gameInfo.providerName].games[
        gameInfo.gameId
      ].users.findIndex((userItem) => userItem.userId === user._id);

      if (existingUserIndex === -1) {
        // Calculate total stake and payout for the user

        const userTransfers = transfers.map((transfer) => {
          const gameName = gameMap[transfer.gameId] || "";
          let stake = transfer.amount; // Default stake value
          let payout = 0; // Default payout value

          if (transfer.type === "credit") {
            const lastDebit = transfers
              .filter(
                (t) =>
                  t.senderId?.toString() === transfer.senderId?.toString() &&
                  t.gameId === transfer.gameId &&
                  t.type === "debit" &&
                  new Date(t.date) < new Date(transfer.date)
              )
              .sort((a, b) => new Date(b.date) - new Date(a.date))[0]; // Sort descending to get latest debit // Get the first (latest) debit transaction

            if (lastDebit) {
              stake =
                lastDebit.balanceBefore.sender - transfer.balanceBefore.sender;
            }
            payout =
              transfer.balanceAfter.sender - transfer.balanceBefore.sender;
          }

          // Accumulate total stake and payout for this user

          return {
            ...transfer,
            gameName,
            stake,
            payout,
          };
        });
        let userTotalStake = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let userTotalPayout = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);

        // Add user to the report data
        reportData[gameInfo.providerName].games[gameInfo.gameId].users.push({
          userId: user._id,
          userName: user.username,
          transfers: userTransfers,
          totalStake: userTotalStake, // Add totalStake for the user
          totalPayout: userTotalPayout, // Add totalPayout for the user
        });

        // Update game total stake and payout
        reportData[gameInfo.providerName].games[gameInfo.gameId].totalStake +=
          userTotalStake;
        reportData[gameInfo.providerName].games[gameInfo.gameId].totalPayout +=
          userTotalPayout;

        // Update provider total stake and payout
        reportData[gameInfo.providerName].totalStake += userTotalStake;
        reportData[gameInfo.providerName].totalPayout += userTotalPayout;
      }
    } else if (groupedBy === "date") {
      const dateKey = new Date(session.createdAt).toISOString().split("T")[0];

      if (!reportData[dateKey]) {
        reportData[dateKey] = {
          date: dateKey,
          providers: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (!reportData[dateKey].providers[gameInfo.providerName]) {
        reportData[dateKey].providers[gameInfo.providerName] = {
          providerName: gameInfo.providerName || "CPY-Plagmatic",
          games: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (
        !reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gameId
        ]
      ) {
        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gameId
        ] = {
          gameId: gameInfo.gameId,
          gameName: gameInfo.gameName,
          users: [],
          totalStake: 0,
          totalPayout: 0,
        };
      }

      const existingUserIndex = reportData[dateKey].providers[
        gameInfo.providerName
      ].games[gameInfo.gameId].users.findIndex(
        (userItem) => userItem.userId === user._id
      );

      if (existingUserIndex === -1) {
        const userTransfers = transfers.map((transfer) => {
          const gameName = gameMap[transfer.gameId] || "";
          let stake = transfer.amount; // Default stake value
          let payout = 0; // Default payout value

          if (transfer.type === "credit") {
            const lastDebit = transfers
              .filter(
                (t) =>
                  t.senderId?.toString() === transfer.senderId?.toString() &&
                  t.gameId === transfer.gameId &&
                  t.type === "debit" &&
                  new Date(t.date) < new Date(transfer.date)
              )
              .sort((a, b) => new Date(b.date) - new Date(a.date))[0]; // Sort descending to get latest debit // Get the first (latest) debit transaction

            if (lastDebit) {
              stake =
                lastDebit.balanceBefore.sender - transfer.balanceBefore.sender;
            }
            payout =
              transfer.balanceAfter.sender - transfer.balanceBefore.sender;
          }
          return {
            ...transfer,
            gameName,
            stake,
            payout,
          };
        });

        let gameTotalStake = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let gameTotalPayout = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let userTotalStake = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let userTotalPayout = userTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);

        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gameId
        ].users.push({
          userId: user._id,
          userName: user.username,
          transfers: userTransfers,
          totalStake: userTotalStake,
          totalPayout: userTotalPayout,
        });

        // Update game total stake and payout
        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gameId
        ].totalStake += gameTotalStake;
        reportData[dateKey].providers[gameInfo.providerName].games[
          gameInfo.gameId
        ].totalPayout += gameTotalPayout;

        // Update provider total stake and payout
        reportData[dateKey].providers[gameInfo.providerName].totalStake +=
          gameTotalStake;
        reportData[dateKey].providers[gameInfo.providerName].totalPayout +=
          gameTotalPayout;

        // Update date total stake and payout
        reportData[dateKey].totalStake += gameTotalStake;
        reportData[dateKey].totalPayout += gameTotalPayout;
      }
    } else {
      if (!reportData[user.createrid]) {
        reportData[user.createrid] = {
          agentId: creatorData.id,
          agentName: creatorData.name,
          users: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (!reportData[user.createrid].users[user._id]) {
        reportData[user.createrid].users[user._id] = {
          userId: user._id,
          userName: user.username,
          providers: {},
          totalStake: 0,
          totalPayout: 0,
        };
      }

      if (
        !reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ]
      ) {
        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ] = {
          providerName: gameInfo.providerName || "CPY-Plagmatic",
          games: [],
          totalStake: 0,
          totalPayout: 0,
        };
      }

      const existingGameIndex = reportData[user.createrid].users[
        user._id
      ].providers[gameInfo.providerName].games.findIndex(
        (game) => game.gameId === gameInfo.gameId
      );

      if (existingGameIndex === -1) {
        const gameTransfers = transfers.map((transfer) => {
          const gameName = gameMap[transfer.gameId] || "";
          let stake = transfer.amount; // Default stake value
          let payout = 0; // Default payout value

          if (transfer.type === "credit") {
            const lastDebit = transfers
              .filter(
                (t) =>
                  t.senderId?.toString() === transfer.senderId?.toString() &&
                  t.gameId === transfer.gameId &&
                  t.type === "debit" &&
                  new Date(t.date) < new Date(transfer.date)
              )
              .sort((a, b) => new Date(b.date) - new Date(a.date))[0]; // Sort descending to get latest debit // Get the first (latest) debit transaction

            if (lastDebit) {
              stake =
                lastDebit.balanceBefore.sender - transfer.balanceBefore.sender;
            }
            payout =
              transfer.balanceAfter.sender - transfer.balanceBefore.sender;
          }
          return {
            ...transfer,
            gameName,
            stake,
            payout,
          };
        });
        let gameTotalStake = gameTransfers.reduce((sum, transfer) => {
          if (transfer.type === "debit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);
        let gameTotalPayout = gameTransfers.reduce((sum, transfer) => {
          if (transfer.type === "credit") {
            return sum + transfer.amount;
          }
          return sum;
        }, 0);

        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ].games.push({
          gameId: gameInfo.gameId,
          gameName: gameInfo.gameName,
          transfers: gameTransfers,
          totalStake: gameTotalStake,
          totalPayout: gameTotalPayout,
        });

        // Update provider total stake and payout
        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ].totalStake += gameTotalStake;
        reportData[user.createrid].users[user._id].providers[
          gameInfo.providerName
        ].totalPayout += gameTotalPayout;

        // Update user total stake and payout
        reportData[user.createrid].users[user._id].totalStake += gameTotalStake;
        reportData[user.createrid].users[user._id].totalPayout +=
          gameTotalPayout;

        // Update agent total stake and payout
        reportData[user.createrid].totalStake += gameTotalStake;
        reportData[user.createrid].totalPayout += gameTotalPayout;
      }
    }
  }

  let responseData;
  if (groupedBy === "provider") {
    responseData = Object.values(reportData).map((provider) => ({
      providerName: provider.providerName,
      totalStake: parseFloat(provider.totalStake?.toFixed(2)),
      totalPayout: parseFloat(provider.totalPayout?.toFixed(2)),
      games: Object.values(provider.games),
    }));
  } else if (groupedBy === "date") {
    responseData = Object.values(reportData).map((dateGroup) => ({
      date: dateGroup.date,
      totalStake: dateGroup.totalStake,
      totalPayout: dateGroup.totalPayout,
      providers: Object.values(dateGroup.providers).map((provider) => ({
        providerName: provider.providerName,
        totalStake: parseFloat(provider.totalStake?.toFixed(2)),
        totalPayout: parseFloat(provider.totalPayout?.toFixed(2)),
        games: Object.values(provider.games),
      })),
    }));
  } else {
    responseData = Object.values(reportData).map((agent) => ({
      agentId: agent.agentId,
      agentName: agent.agentName,
      totalStake: parseFloat(agent.totalStake?.toFixed(2)),
      totalPayout: parseFloat(agent.totalPayout?.toFixed(2)),
      users: Object.values(agent.users).map((user) => ({
        userId: user.userId,
        userName: user.userName,
        totalStake: parseFloat(user.totalStake?.toFixed(2)),
        totalPayout: parseFloat(user.totalPayout?.toFixed(2)),
        providers: Object.values(user.providers),
      })),
    }));
  }

  return responseData;
};

// exports.getGamingReport = async (req, res) => {
//   try {
//     const oldGameReports = await oldGameReport(req.query, req.user.id);
//     const newGameReports = await newGameReport(req.query, req.user.id);
//     let allGameReports = [...oldGameReports, ...newGameReports];

//     if (req.query && req.query.groupedBy === "agent") {
//       const mergedReports = allGameReports.reduce((acc, item) => {
//         const existingAgent = acc.find(agent => agent.agentId?.toString() === item.agentId?.toString() && agent.agentName === item.agentName);

//         if (existingAgent) {
//           existingAgent.totalStake += item.totalStake;
//           existingAgent.totalPayout += item.totalPayout;

//           const userIds = new Set(existingAgent.users.map(user => user.userId));
//           item.users.forEach(user => {
//             if (!userIds.has(user.userId)) {
//               existingAgent.users.push(user);
//               userIds.add(user.userId);
//             }
//           });
//         } else {
//           acc.push({ ...item, users: [...item.users] });
//         }

//         return acc;
//       }, []);

//       res.status(200).json({ success: true, data: mergedReports });
//     } else {
//       res.status(200).json({ success: true, data: allGameReports });
//     }

//   }
//   catch (error) {
//     console.error("Error fetching gaming reports:", error);
//     res.status(500).json({ success: false, message: "Internal server error." });
//   }
// };

// exports.getGamingReport = async (req, res) => {
//   try {
//     const { startDate, endDate, groupedBy = "provider" } = req.query;
//     const userId = req.user.id;

//     const start = new Date(startDate);
//     const end = new Date(endDate);

//     const matchStage = {
//       createdAt: { $gte: start, $lte: end }
//     };

//     let groupStage = {};

//     switch (groupedBy) {
//       case "provider":
//         groupStage = {
//           _id: "$providerId",
//           providerName: { $first: "$providerName" },
//           totalStake: { $sum: "$stake" },
//           totalPayout: { $sum: "$payout" },
//           games: {
//             $addToSet: {
//               gameId: "$gameId",
//               gameName: "$gameName",
//               totalStake: "$stake",
//               totalPayout: "$payout"
//             }
//           }
//         };
//         break;

//       case "user":
//         groupStage = {
//           _id: "$userId",
//           userName: { $first: "$userName" },
//           totalStake: { $sum: "$stake" },
//           totalPayout: { $sum: "$payout" },
//           providers: {
//             $addToSet: {
//               providerId: "$providerId",
//               providerName: "$providerName",
//               totalStake: "$stake",
//               totalPayout: "$payout"
//             }
//           }
//         };
//         break;

//       default:
//         return res.status(400).json({ success: false, message: "Invalid groupBy type" });
//     }

//     const pipeline = [
//       { $match: matchStage },
//       { $group: groupStage }
//     ];

//     const results = await Bet.aggregate(pipeline);

//     return res.status(200).json({ success: true, data: results });

//   } catch (error) {
//     console.error("Error fetching gaming report:", error);
//     return res.status(500).json({ success: false, message: "Internal server error." });
//   }
// };

exports.getGamingReport = async (req, res) => {
  try {
    const { startDate, endDate, filteredBy = "provider" } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // --------------------------------------------
    // Future MongoDB logic (commented out for now)
    //const matchStage = {
    //   createdAt: { $gte: start, $lte: end }
    // };

    // let groupStage = {};

    // switch (filteredBy) {
    //   case "provider":
    //     groupStage = {
    //       _id: "$providerId",
    //       providerName: { $first: "$providerName" },
    //       totalStake: { $sum: "$stake" },
    //       totalPayout: { $sum: "$payout" },
    //       games: {
    //         $push: {
    //           gameId: "$gameId",
    //           gameName: "$gameName",
    //           totalStake: "$stake",
    //           totalPayout: "$payout"
    //         }
    //       }
    //     };
    //     break;

    //   case "user":
    //     groupStage = {
    //       _id: "$userId",
    //       userName: { $first: "$userName" },
    //       totalStake: { $sum: "$stake" },
    //       totalPayout: { $sum: "$payout" },
    //       providers: {
    //         $push: {
    //           providerId: "$providerId",
    //           providerName: "$providerName",
    //           totalStake: "$stake",
    //           totalPayout: "$payout"
    //         }
    //       }
    //     };
    //     break;

    //   default:
    //     return res.status(400).json({ success: false, message: "Invalid groupBy type" });
    // }

    // const pipeline = [
    //   { $match: matchStage },
    //   { $group: groupStage }
    // ];

    // const results = await Bet.aggregate(pipeline);

    // return res.status(200).json({ success: true, data: results });

    // --------------------------------------------
    // Load data from users.json (temporary mock)
    // --------------------------------------------
    const usersDataPath = path.join(__dirname, "..", "users.json");
    const users = JSON.parse(fs.readFileSync(usersDataPath, "utf8"));

    const filteredBets = users.filter((bet) => {
      const betDate = new Date(bet.createdAt);
      return betDate >= start && betDate <= end;
    });

    // Grouping logic
    const result = {};

    for (const bet of filteredBets) {
      let key;
      switch (filteredBy) {
        case "provider":
          key = bet.providerId;
          if (!result[key]) {
            result[key] = {
              _id: bet.providerId,
              providerName: bet.providerName,
              totalStake: 0,
              totalPayout: 0,
              games: [],
            };
          }
          result[key].totalStake += bet.stake;
          result[key].totalPayout += bet.payout;
          result[key].games.push({
            gameId: bet.gameId,
            gameName: bet.gameName,
            totalStake: bet.stake,
            totalPayout: bet.payout,
          });
          break;

        case "user":
          key = bet.userId;
          if (!result[key]) {
            result[key] = {
              _id: bet.userId,
              userName: bet.userName,
              totalStake: 0,
              totalPayout: 0,
              providers: [],
            };
          }
          result[key].totalStake += bet.stake;
          result[key].totalPayout += bet.payout;
          result[key].providers.push({
            providerId: bet.providerId,
            providerName: bet.providerName,
            totalStake: bet.stake,
            totalPayout: bet.payout,
          });
          break;

        default:
          return res
            .status(400)
            .json({ success: false, message: "Invalid groupBy type" });
      }
    }

    return res.status(200).json({ success: true, data: Object.values(result) });
  } catch (error) {
    console.error("Error fetching gaming report from JSON:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};
