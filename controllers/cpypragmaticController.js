// controllers/walletController.js

const crypto = require('crypto');
const Cpypragmatic = require('../models/cpypragmatic');
const User = require("../models/User");
const Bet = require("../models/bets");
const GameImage = require("../models/GameImage"); // Import the GameImage model
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const GameSession = require("../models/gamesession");
const cron = require("node-cron");
const Provider = require("../models/Provider"); // Adjust the path to your model
const { default: axios } = require('axios');
const { enqueueRequest } = require('./lockManager');
const { transferBonusToMain } = require('../bonusManager/bonusTransferToMainBalance');
const { v4: uuidv4 } = require("uuid");


const fetchGamesAndSave = async (req, res) => {
  try {
    const response = await axios.get(`https://${process.env.CPYPRAGMATIC_API_ENDPONIT}/gamelist`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CPYPRAGMATIC_API_TOKEN}`,
        'Accept': 'application/json',
      }
    });

    const games = response.data.data.map(item => { return { ...item, gameId: item.gameid, provider_name: item.vendorid } });
    const existingGames = await Cpypragmatic.find({}, 'gameId');
    const existingGameIds = new Set(existingGames.map(game => game.gameId));
    const newGames = games.filter(game => !existingGameIds.has(game.gameId));
    if (newGames.length > 0) {
      await Cpypragmatic.insertMany(newGames, { ordered: false }).catch(err => console.log("Duplicate entries skipped"));

    }
    const priorityGameIds = [2023, 2039, 2027, 2077, 2261, 2207, 2397];

    const prioritizedData = response.data.data.map(item => {
      const gameId = item.gameid;
      return {
        ...item,
        gameId,
        provider_name: item.vendorid,
        priority: priorityGameIds.includes(gameId) ? 1 : 2,
      };
    });

    // Optional: Sort by priority
    const sortedData = prioritizedData.sort((a, b) => a.priority - b.priority);

    console.log("sortedData")
    res.status(200).json({
      success: true,
      data: sortedData,
      code: response.data.code,
      message: response.data.message
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: error.message });
  }
};


// Debit credit rollback getBalance

const generatingSignKeys = (dataString) => {
  const hmac = crypto.createHmac('sha256', process.env.CPYPRAGMATIC_SECRET_KEY);
  hmac.update(dataString);
  return hmac.digest('hex').toUpperCase();
}
// Enhanced debit function with detailed logging
const debit = async (req, res) => {
  console.log('\n==================== DEBIT OPERATION START ====================');
  console.log('[DEBUG] Full request body:', JSON.stringify(req.body, null, 2));

  const {
    agentID,
    userID,
    amount,
    transactionID,
    roundID,
    gameID,
    freeSpinID,
    sign,
  } = req.body;

  try {
    // Validate required parameters
    if (!agentID || !userID || !amount || !transactionID || !roundID || !gameID || !sign) {
      console.error('[ERROR] Missing required parameters:', { agentID, userID, amount, transactionID, roundID, gameID, sign });
      return res.status(400).json({
        code: 1, // Missing parameters
        message: "Missing required parameters",
      });
    }

    // Verify sign
    const formattedAmount = parseFloat(amount).toFixed(2);
    console.log('[DEBUG] Formatted amount:', formattedAmount, 'Original amount:', amount);

    const dataString = `${agentID}${userID}${formattedAmount}${transactionID}${roundID}${gameID}`;
    const expectedSign = generatingSignKeys(dataString);
    console.log('[DEBUG] Data string for sign:', dataString);
    console.log('[DEBUG] Expected sign:', expectedSign);
    console.log('[DEBUG] Received sign:', sign);

    if (sign !== expectedSign) {
      console.error('[ERROR] Sign verification failed');
      return res.status(403).json({
        code: 2, // Invalid sign
        message: "Invalid sign",
      });
    }

    // Process the deposit request
    const existingTransaction = await Bet.findOne({ transaction_id: transactionID });
    if (existingTransaction) {
      console.log('[DEBUG] Duplicate transaction detected:', transactionID);
      console.log('[DEBUG] Existing transaction details:', JSON.stringify(existingTransaction, null, 2));

      return res.status(200).json({
        code: 11,
        message: "Duplicate transaction.",
        platformTransactionID: existingTransaction.transaction_id,
        balance: existingTransaction.finalBalance.toFixed(2),
      });
    }

    const user = await User.findOne({ username: userID });
    if (!user) {
      console.error('[ERROR] User not found:', userID);
      return res.status(404).json({ code: 3, message: "User not found." });
    }

    console.log('[DEBUG] User found:', userID);
    console.log('[DEBUG] Current user balance:', user.balance);
    console.log('[DEBUG] Current user bonus balance:', user.bonus_balance);

    if (user.balance < formattedAmount) {
      console.error('[ERROR] Insufficient funds. Balance:', user.balance, 'Amount:', formattedAmount);
      return res.status(400).json({ code: 6, message: "Insufficient funds." });
    }

    const oldBalance = user.balance;
    const newBalance = Number(oldBalance) - Number(formattedAmount);
    const transaction_id = transactionID || uuidv4();
    console.log('[DEBUG] Balance calculation:');
    console.log('[DEBUG] Old balance:', oldBalance, 'Type:', typeof oldBalance);
    console.log('[DEBUG] Amount to deduct:', formattedAmount, 'Type:', typeof formattedAmount);
    console.log('[DEBUG] New balance:', newBalance, 'Type:', typeof newBalance);

    let updatedUser;

    // Handle different balance scenarios
    if (newBalance < 0 && user.bonus_balance === 0) {
      console.error('[ERROR] Negative balance without bonus funds');
      throw new TransactionError('Insufficient funds', 403);
    } else if (newBalance === 0 && user.bonus_balance > 0) {
      console.log('[DEBUG] Using bonus balance as main balance is depleted');

      const bet = new Bet({
        transaction_id: transaction_id,
        userId: user.id,
        type: "debit",
        amount: amount,
        roundId: roundID,
        gameId: gameID,
        provider: "PragmaticCopy",
        freeSpinId: freeSpinID,
        createdFrom: "CASINO",
        balanceBefore: { sender: parseFloat(oldBalance.toFixed(2)), receiver: null },
        balanceAfter: { sender: parseFloat(newBalance.toFixed(2)), receiver: null },
        finalBalance: parseFloat(newBalance.toFixed(2)) // Add this line
      });

      await bet.save();
      console.log('[DEBUG] Bet record saved:', transaction_id);

      updatedUser = await transferBonusToMain(user._id);
      console.log('[DEBUG] After bonus transfer - Updated user balance:', updatedUser.balance);
    } else {
      console.log('[DEBUG] Standard balance deduction');

      const bet = new Bet({
        transaction_id: transaction_id,
        userId: user.id,
        type: "debit",
        amount: amount,
        roundId: roundID,
        gameId: gameID,
        provider: "PragmaticCopy",
        freeSpinId: freeSpinID,
        createdFrom: "CASINO",
        balanceBefore: { sender: parseFloat(oldBalance.toFixed(2)), receiver: null },
        balanceAfter: { sender: parseFloat(newBalance.toFixed(2)), receiver: null },
        finalBalance: parseFloat(newBalance.toFixed(2)) // Add this line
      });

      await bet.save();
      console.log('[DEBUG] Bet record saved:', transaction_id);

      updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { balance: newBalance },
        { new: true } // Add this to return the updated document
      );

      console.log('[DEBUG] User balance updated to:', updatedUser.balance);
    }

    const responseObj = {
      code: 0,
      message: "Success",
      transaction_id: transaction_id,
      balance: parseFloat(updatedUser.balance.toFixed(2)),
    };

    console.log('[DEBUG] Response object:', JSON.stringify(responseObj, null, 2));
    console.log('==================== DEBIT OPERATION END ====================\n');

    return res.status(200).json(responseObj);

  } catch (error) {
    console.error('[ERROR] Debit operation failed:', error);
    console.error('[ERROR] Stack trace:', error.stack);
    console.log('==================== DEBIT OPERATION END WITH ERROR ====================\n');

    return res.status(500).json({
      code: 5, // Internal server error
      message: "Internal server error",
    });
  }
};

// Enhanced credit function with detailed logging
const credit = async (req, res) => {
  console.log('\n==================== CREDIT OPERATION START ====================');
  console.log('[DEBUG] Full request body:', JSON.stringify(req.body, null, 2));

  const {
    agentID,
    userID,
    amount,
    refTransactionID,
    transactionID,
    roundID,
    gameID,
    freeSpinID,
    isBonusBuy,
    sign,
  } = req.body;

  try {
    // Validate required parameters
    if (!agentID || !userID || !amount || !transactionID || !refTransactionID || !roundID || !gameID || !sign) {
      console.error('[ERROR] Missing required parameters:', { agentID, userID, amount, refTransactionID, transactionID, roundID, gameID, sign });
      return res.status(400).json({
        code: 1, // Missing parameters
        message: "Missing required parameters",
      });
    }

    // Verify sign
    const formattedAmount = parseFloat(amount).toFixed(2);
    console.log('[DEBUG] Formatted amount:', formattedAmount, 'Original amount:', amount);

    const dataString = `${agentID}${userID}${formattedAmount}${refTransactionID}${transactionID}${roundID}${gameID}`;
    const expectedSign = generatingSignKeys(dataString);
    console.log('[DEBUG] Data string for sign:', dataString);
    console.log('[DEBUG] Expected sign:', expectedSign);
    console.log('[DEBUG] Received sign:', sign);

    if (sign !== expectedSign) {
      console.error('[ERROR] Sign verification failed');
      return res.status(403).json({
        code: 2, // Invalid sign
        message: "Invalid sign",
      });
    }

    // Process the withdraw request
    const existingTransaction = await Bet.findOne({ transaction_id: transactionID });
    if (existingTransaction) {
      console.log('[DEBUG] Duplicate transaction detected:', transactionID);
      console.log('[DEBUG] Existing transaction details:', JSON.stringify(existingTransaction, null, 2));

      return res.status(200).json({
        code: 11,
        message: "Duplicate transaction.",
        platformTransactionID: existingTransaction.transaction_id,
        balance: existingTransaction.finalBalance.toFixed(2),
      });
    }

    const user = await User.findOne({ username: userID });
    if (!user) {
      console.error('[ERROR] User not found:', userID);
      return res.status(404).json({ code: 3, message: "User not found." });
    }

    console.log('[DEBUG] User found:', userID);
    console.log('[DEBUG] Current user balance:', user.balance);
    console.log('[DEBUG] Current user bonus balance:', user.bonus_balance);

    if (formattedAmount < 0) {
      console.error('[ERROR] Negative amount:', formattedAmount);
      return res.status(400).json({ code: 6, message: "Invalid amount." });
    }

    const oldBalance = user.balance;
    const newBalance = Number(oldBalance) + Number(formattedAmount);
    const transaction_id = transactionID || uuidv4();
    console.log('[DEBUG] Balance calculation:');
    console.log('[DEBUG] Old balance:', oldBalance, 'Type:', typeof oldBalance);
    console.log('[DEBUG] Amount to add:', formattedAmount, 'Type:', typeof formattedAmount);
    console.log('[DEBUG] New balance:', newBalance, 'Type:', typeof newBalance);

    let updatedUser;

    // Return the response
    if (newBalance < 0 && user.bonus_balance === 0) {
      console.error('[ERROR] Negative balance without bonus funds');
      throw new TransactionError('Insufficient funds', 403);
    } else if (newBalance === 0 && user.bonus_balance > 0) {
      console.log('[DEBUG] Using bonus balance as main balance is depleted');

      const bet = new Bet({
        transaction_id: transaction_id,
        userId: user.id,
        type: "credit",
        amount: formattedAmount,
        roundId: roundID,
        gameId: gameID,
        provider: "PragmaticCopy",
        freeSpinId: freeSpinID,
        createdFrom: "CASINO",
        balanceBefore: { sender: parseFloat(oldBalance.toFixed(2)), receiver: null },
        balanceAfter: { sender: parseFloat(newBalance.toFixed(2)), receiver: null },
        finalBalance: parseFloat(newBalance.toFixed(2)) // Add this line
      });

      await bet.save();
      console.log('[DEBUG] Credit record saved:', transaction_id);

      updatedUser = await transferBonusToMain(user._id);
      console.log('[DEBUG] After bonus transfer - Updated user balance:', updatedUser.balance);
    } else {
      console.log('[DEBUG] Standard balance addition');

      const bet = new Bet({
        transaction_id: transaction_id,
        userId: user.id,
        type: "credit",
        amount: formattedAmount,
        roundId: roundID,
        gameId: gameID,
        provider: "PragmaticCopy",
        freeSpinId: freeSpinID,
        createdFrom: "CASINO",
        balanceBefore: { sender: parseFloat(oldBalance.toFixed(2)), receiver: null },
        balanceAfter: { sender: parseFloat(newBalance.toFixed(2)), receiver: null },
        finalBalance: parseFloat(newBalance.toFixed(2)) // Add this line
      });

      await bet.save();
      console.log('[DEBUG] Credit record saved:', transaction_id);

      updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { balance: newBalance },
        { new: true } // Add this to return the updated document
      );

      console.log('[DEBUG] User balance updated to:', updatedUser.balance);
    }

    const responseObj = {
      code: 0,
      message: "Success",
      transaction_id: transaction_id,
      balance: parseFloat(updatedUser.balance.toFixed(2)),
    };

    console.log('[DEBUG] Response object:', JSON.stringify(responseObj, null, 2));
    console.log('==================== CREDIT OPERATION END ====================\n');

    return res.status(200).json(responseObj);
  } catch (error) {
    console.error('[ERROR] Credit operation failed:', error);
    console.error('[ERROR] Stack trace:', error.stack);
    console.log('==================== CREDIT OPERATION END WITH ERROR ====================\n');

    return res.status(500).json({
      code: 5, // Internal server error
      message: "Internal server error",
    });
  }
};

// Enhanced getBalance function with detailed logging
const getBalance = async (req, res) => {
  console.log('\n==================== GET BALANCE OPERATION START ====================');
  console.log('[DEBUG] Request body:', JSON.stringify(req.body, null, 2));
  console.log('[DEBUG] Request query:', JSON.stringify(req.query, null, 2));

  const { agentID, userID, gameID, sign } = req.body;

  // Validate required parameters
  if (!agentID || !userID || !gameID || !sign) {
    console.error("[ERROR] Missing required parameters for getBalance:", { agentID, userID, gameID, sign });
    return res.status(400).json({ code: 1, message: "Missing required parameters." });
  }

  // Generate the expected sign
  const dataString = `${agentID}${userID}${gameID}`;
  let expectedSign = generatingSignKeys(dataString);
  console.log('[DEBUG] Data string for sign:', dataString);
  console.log('[DEBUG] Expected sign:', expectedSign);
  console.log('[DEBUG] Received sign:', sign);

  //Validate signature
  if (sign !== expectedSign) {
    console.error("[ERROR] Invalid signature for getBalance.");
    return res.status(403).json({ code: 2, message: "Invalid signature." });
  }

  try {
    // Fetch user balance from the database
    const user = await User.findOne({ username: userID });

    if (!user) {
      console.error("[ERROR] User not found:", userID);
      return res.status(404).json({ code: 3, message: "Cannot find specified user ID." });
    }

    console.log('[DEBUG] User found:', userID);
    console.log('[DEBUG] Current user balance:', user.balance);

    const responseObj = {
      code: 0,
      balance: parseFloat(user.balance.toFixed(2))
    };

    console.log('[DEBUG] Response object:', JSON.stringify(responseObj, null, 2));
    console.log('==================== GET BALANCE OPERATION END ====================\n');

    return res.status(200).json(responseObj);
  } catch (error) {
    console.error("[ERROR] getBalance:", error.message);
    console.error('[ERROR] Stack trace:', error.stack);
    console.log('==================== GET BALANCE OPERATION END WITH ERROR ====================\n');

    return res.status(500).json({ code: 5, message: "Internal server error." });
  }
};

// Enhanced betWin function with detailed logging
const betWin = async (req, res) => {
  console.log('\n==================== BET-WIN OPERATION START ====================');
  console.log('[DEBUG] Full request body:', JSON.stringify(req.body, null, 2));

  try {
    const { agentID, sign, userID, betAmount, winAmount, transactionID, roundID, gameID, freeSpinID } = req.body;

    // Validate required parameters
    if (!agentID || !sign || !userID || betAmount == null || winAmount == null || !transactionID || !roundID || !gameID) {
      console.error('[ERROR] Missing required parameters:', { agentID, sign, userID, betAmount, winAmount, transactionID, roundID, gameID });
      return res.status(400).json({ code: 1, message: "Missing required parameters." });
    }

    const formattedAmount1 = parseFloat(betAmount).toFixed(2);
    const formattedAmount2 = parseFloat(winAmount).toFixed(2);

    // Verify sign
    const dataString = `${agentID}${userID}${formattedAmount1}${formattedAmount2}${transactionID}${roundID}${gameID}`;
    const expectedSign = generatingSignKeys(dataString);

    if (sign !== expectedSign) {
      console.error('[ERROR] Sign verification failed');
      return res.status(403).json({ code: 2, message: "Invalid sign." });
    }

    // Check for duplicate
    const existingTransaction = await Bet.findOne({ transaction_id: transactionID });
    if (existingTransaction) {
      return res.status(200).json({
        code: 11,
        message: "Duplicate transaction.",
        platformTransactionID: existingTransaction.transaction_id,
        balance: existingTransaction.finalBalance.toFixed(2),
      });
    }

    const user = await User.findOne({ username: userID });
    if (!user) {
      console.error('[ERROR] User not found:', userID);
      return res.status(404).json({ code: 3, message: "User not found." });
    }

    const oldBalance = user.balance;

    if (oldBalance < betAmount) {
      console.error('[ERROR] Insufficient funds. Balance:', oldBalance, 'Bet amount:', betAmount);
      return res.status(400).json({ code: 6, message: "Insufficient funds." });
    }

    // Step 1: Debit for the bet
    const balanceAfterBet = oldBalance - parseFloat(betAmount);
    const betTransaction = new Bet({
      transaction_id: transactionID, // use same transaction ID for bet
      userId: user._id,
      type: "debit",
      amount: parseFloat(betAmount).toFixed(2),
      roundId: roundID,
      gameId: gameID,
      provider: "PragmaticCopy",
      freeSpinId: freeSpinID,
      createdFrom: "CASINO",
      balanceBefore: { sender: parseFloat(oldBalance.toFixed(2)), receiver: null },
      balanceAfter: { sender: parseFloat(balanceAfterBet.toFixed(2)), receiver: null },
      finalBalance: parseFloat(balanceAfterBet.toFixed(2)),
    });
    await betTransaction.save();

    let updatedBalance = balanceAfterBet;

    // Step 2: Credit if winAmount > 0
    if (parseFloat(winAmount) > 0) {
      const balanceAfterWin = updatedBalance + parseFloat(winAmount);
      const creditTransaction = new Bet({
        transaction_id: `${transactionID}-win`, // mark win with new ID
        userId: user._id,
        type: "credit",
        amount: parseFloat(winAmount).toFixed(2),
        roundId: roundID,
        gameId: gameID,
        provider: "PragmaticCopy",
        freeSpinId: freeSpinID,
        createdFrom: "CASINO",
        balanceBefore: { sender: parseFloat(updatedBalance.toFixed(2)), receiver: null },
        balanceAfter: { sender: parseFloat(balanceAfterWin.toFixed(2)), receiver: null },
        finalBalance: parseFloat(balanceAfterWin.toFixed(2)),
      });
      await creditTransaction.save();

      updatedBalance = balanceAfterWin;
    }

    const updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { balance: updatedBalance },
        { new: true }
    );

    const responseObj = {
      code: 0,
      message: "Success",
      transaction_id: transactionID,
      balance: parseFloat(updatedUser.balance.toFixed(2)),
    };

    console.log('[DEBUG] Response object:', JSON.stringify(responseObj, null, 2));
    console.log('==================== BET-WIN OPERATION END ====================\n');
    return res.status(200).json(responseObj);
  } catch (error) {
    console.error("[ERROR] betWin:", error.message);
    console.error('[ERROR] Stack trace:', error.stack);
    console.log('==================== BET-WIN OPERATION END WITH ERROR ====================\n');
    return res.status(500).json({ code: 5, message: "Internal server error." });
  }
};

// Rollback Endpoint
const rollback = async (req, res) => {
  try {
    const { agentID, sign, userID, refTransactionID, gameID } = req.body;

    // Validate required parameters
    if (!agentID || !sign || !userID || !refTransactionID || !gameID) {
      return res.status(400).json({ code: 1, message: "Missing required parameters." });
    }

    // Verify sign
    const dataString = `${agentID}${userID}${refTransactionID}${gameID}`
    const expectedSign = generatingSignKeys(dataString)
    if (sign !== expectedSign) {
      return res.status(403).json({ code: 2, message: "Invalid sign." });
    }

    // Find original transaction
    const originalTransaction = await Bet.findOne({ transactionID: refTransactionID });
    if (!originalTransaction) {
      return res.status(404).json({ code: 3, message: "Transaction not found." });
    }

    // Check if already rolled back
    if (originalTransaction.rolledBack) {
      return res.status(200).json({
        code: 12,
        message: "Transaction is already rolled back.",
        balance: originalTransaction.finalBalance.toFixed(2),
      });
    }
    // Fetch user
    const user = await User.findOne({ username: userID });
    if (!user) {
      return res.status(404).json({ code: 4, message: "User not found." });
    }

    // Start a transaction session
    const session = await User.startSession();
    session.startTransaction();

    try {
      // Update user balance
      const updatedBalance =
        originalTransaction.type === "debit"
          ? user.balance + originalTransaction.amount
          : user.balance - originalTransaction.amount;

      user.balance = updatedBalance;
      await user.save({ session });

      // Mark transaction as rolled back
      originalTransaction.rolledBack = true;
      await originalTransaction.save({ session });

      // Create rollback transaction record
      await Bet.create(
        [
          {
            transaction_id: refTransactionID,
            userID,
            amount: originalTransaction.amount,
            gameID,
            type: "rollback",
          },
        ],
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        code: 0,
        message: "Rollback successful.",
        balance: updatedBalance.toFixed(2),
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } catch (error) {
    console.error("[ERROR] RollbackTransaction:", error.message);
    return res.status(500).json({ code: 5, message: "Internal server error." });
  }
};




module.exports = {
  fetchGamesAndSave,
  getBalance,
  debit,
  rollback,
  credit,
  betWin
};