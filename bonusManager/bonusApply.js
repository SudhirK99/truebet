const mongoose = require('mongoose');
const Bonus = require("../models/bonuses.js");
const User = require("../models/User");
const { DUMMY_BONUS } = require('../config/constants.js');

const validateBonusRule = async (bonusId) => {
  // const bonus = await Bonus.findById(bonusId);
  const bonus = DUMMY_BONUS
  if (!bonus) {
    throw new Error("Bonus not found");
  }

  // const currentDate = new Date();
  // if (currentDate < bonus.start_date || currentDate > bonus.end_date) {
  //   throw new Error("Bonus is not valid for the current date");
  // }

  if (!bonus.is_enabled) {
    throw new Error("Bonus is not enabled");
  }

  return bonus;
};

const validateUserEligibility = async (validBonus, userId, depositAmount) =>{
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }
if (user.bonus_balance > 0) {
    return { message: "User already has a bonus balance and is not eligible for another bonus" };
  }
  let bonusAmount;
  if (validBonus.amount_type === 'Percentage') {
    bonusAmount = (depositAmount * validBonus.amount) / 100; 
  } else if (validBonus.amount_type === 'Fixed') {
    bonusAmount = validBonus.amount;
  }
   const bonusEntry = {
      amount: bonusAmount,
      source: validBonus.type,
      bonusType: validBonus.amount_type,
      amount: validBonus.amount,
      totalDeposit: depositAmount,
      status: 'active'
      };
  const session = await mongoose.startSession();
session.startTransaction();
try {
  await User.findByIdAndUpdate(
    user._id,
    {
      $inc: { bonus_balance: bonusAmount },
      $push: { bonus_history: bonusEntry },
      $set: { last_bonus_date: new Date() }
    },
    { new: true, session }
  );
  await session.commitTransaction();
} catch (error) {
  await session.abortTransaction();
  console.error("Transaction error:", error);
} finally {
  session.endSession();
}      
   
  return { message: "Bonus applied successfully", bonusAmount };
};


async function applyBonus(bonusId, userId, depositAmount) {
  try {
    const validBonus = await validateBonusRule(bonusId);
    const result = await validateUserEligibility(validBonus, userId, depositAmount);
    console.log(result.message);
  } catch (error) {
    console.error(error.message,'Logs');
  }
}

module.exports = {applyBonus};