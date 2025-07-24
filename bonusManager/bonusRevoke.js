const User = require("../models/User");

async function revokeBonus(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("user not found");
    }
     
    if (user.role === 'User' && user.bonus_balance > 0) {
      
      user.bonus_balance = 0;
      user.bonus_history.forEach(b => {
        if (b.status === 'active') {
          b.status = 'revoked';
        }
      });
      await user.save();

      return { message: "Bonus revoked successfully" };
    } else {
      throw new Error("No bonus balance to revoke or sender is not a user");
    }
  } catch (error) {
    console.log(error.message)
    // throw new Error(`Error revoking bonus: ${error.message}`);
  }
}

module.exports ={revokeBonus}