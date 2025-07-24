const User = require("../models/User");
const Transfer = require("../models/transfer");
const Bet = require("../models/bets");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid"); 
const transferBonusToMain = async (userId) => {
  // const session = await mongoose.startSession();
  // session.startTransaction();

  try {
    // Get user with active session
    const user = await User.findById(userId)
    if (!user || user.bonus_balance <= 0) {
      throw new Error('No bonus balance available');
    }

    // Find active bonus
    const activeBonus = user.bonus_history.find(b => b.status === 'active');
    if (!activeBonus) {
      throw new Error('bonus not found');
    }

    // Find bets placed after bonus
    const findBetPlacedAfterBonus = await Bet.find({
      date: { $gt: activeBonus.created_at },
      userId: userId
    })

    if (findBetPlacedAfterBonus.length === 0) {
      throw new Error('Not placed any bet after deposit');
    }

    // Calculate GGR
    const debitedBets = findBetPlacedAfterBonus.filter(b => b.type === 'debit');
    const creditedBets = findBetPlacedAfterBonus.filter(b => b.type === 'credit');
    const debitBetsTotal = debitedBets.reduce((total, bet) => total + bet.amount, 0);
    const creditBetsTotal = creditedBets.reduce((total, bet) => total + bet.amount, 0);
    const GGR = debitBetsTotal - creditBetsTotal;
console.log("the GGR is " + GGR);
    if (GGR < activeBonus.totalDeposit) {
      throw new Error('Not allow you to add your bonus into balance');
    }

    // Store initial values
    console.log(user.bonus_balance,'bonus_balance before tranfering')
    const bonusToTransfer = user.bonus_balance;
    const initialBalance = user.balance;

    // Important: Combine both operations in a single update
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      {
        
        $set: {
          balance: bonusToTransfer,
          bonus_balance: 0,
          'bonus_history.$[elem].status': 'transferred'
        }
      },
      {
        new: true,
        arrayFilters: [{ 'elem._id': activeBonus._id }]
      }
    );
    // Create transfer record
    await Transfer.create([{
      type: 'credit',
      senderId: userId,
      receiverId: userId,
      amount: bonusToTransfer,
      transaction_id: uuidv4(),
      note: 'Bonus transfer to main balance',
      balanceBefore: {
        sender: initialBalance,
        receiver: initialBalance
      },
      balanceAfter: {
        sender: updatedUser.balance,
        receiver: updatedUser.balance
      }
    }]);

    // await session.commitTransaction();
    return updatedUser;

  } catch (error) {
    console.log(error)
    throw error;
  } 
};
  module.exports ={transferBonusToMain}