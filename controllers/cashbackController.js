// controllers/cashback.controller.js

const cron = require('node-cron');
const moment = require('moment-timezone');
const Users = require('../models/User');
const Tickets = require('../models/Ticket');
const Bets = require('../models/bets');
const GameImage = require('../models/GameImage');
const { CASHBACK_CONFIG } = require('../config/constants');
const Transfer = require('../models/transfer');
const { v4: uuidv4 } = require("uuid");

const getPreviousDayTimeRangeUTC = () => {
   // Define timezone as GMT+1
   const timezone = 'Europe/Paris';

   // Start and end time in GMT+1
   const start = moment.tz(timezone).subtract(1, 'day').startOf('day').utc().toDate();
   const end = moment.tz(timezone).subtract(1, 'day').endOf('day').utc().toDate();

   return { start, end };
};

async function processCashback() {
   try {
      console.log('Starting cashback processing...');

      const { start, end } = getPreviousDayTimeRangeUTC();
      console.log(`Processing cashback for bets from ${start} to ${end}`);

      await calculateCashbackSlots(start, end);
      await calculateCashbackSportsbook(start, end);

      console.log('Cashback processing completed.');
   } catch (error) {
      console.error('[ERROR] Cashback processing failed:', error.message);
   }
}

async function calculateCashbackSlots(start, end) {
   try {
      const { SLOTS } = CASHBACK_CONFIG;

      if (!SLOTS.is_enabled) {
         console.log('Slots cashback is disabled, skipping.');
         return;
      }

      const bets = await Bets.find({
         createdAt: { $gte: start, $lte: end },
         createdFrom: "CASINO"
      });

      if (!bets.length) {
         console.log('No bets found for slots cashback.');
         return;
      }

      const gameIds = [...new Set(bets.map(bet => bet.gameId))];
      const videoSlotGames = await GameImage.find({
         gameId: { $in: gameIds },
         type: 'video-slots'
      });

      const videoSlotGameIds = new Set(videoSlotGames.map(g => g.gameId));
      const slotsBets = bets.filter(bet => videoSlotGameIds.has(bet.gameId));

      if (!slotsBets.length) {
         console.log('No video slots bets found.');
         return;
      }

      const betsByUser = slotsBets.reduce((acc, bet) => {
         const userId = bet.userId.toString();
         if (!acc[userId]) acc[userId] = [];
         acc[userId].push(bet);
         return acc;
      }, {});

      for (const [userId, userBets] of Object.entries(betsByUser)) {
         await processUserCashback(userId, userBets, SLOTS);
      }

      console.log('Slots cashback processing completed.');
   } catch (error) {
      console.error('[ERROR] Slots cashback processing failed:', error.message);
   }
}

async function calculateCashbackSportsbook(start, end) {
   try {
      const { SPORTSBOOK } = CASHBACK_CONFIG;

      if (!SPORTSBOOK.is_enabled) {
         console.log('Sportsbook cashback is disabled, skipping.');
         return;
      }

      const tickets = await Tickets.find({
         date: { $gte: start, $lte: end },
         status: 'concluded',
      });

      if (!tickets.length) {
         console.log('No concluded tickets found.');
         return;
      }

      const ticketsByUser = tickets.reduce((acc, ticket) => {
         const userId = ticket.userId.toString();
         if (!acc[userId]) acc[userId] = [];
         acc[userId].push(ticket);
         return acc;
      }, {});

      for (const [userId, userTickets] of Object.entries(ticketsByUser)) {
         const ticketIds = userTickets.map(ticket => ticket._id);

         const bets = await Bets.find({
            ticketId: { $in: ticketIds },
            createdFrom: "CMSWAGER"
         });

         await processUserCashback(userId, bets, SPORTSBOOK);
      }

      console.log('Sportsbook cashback processing completed.');
   } catch (error) {
      console.error('[ERROR] Sportsbook cashback processing failed:', error.message);
   }
}

async function processUserCashback(userId, bets, cashbackConfig) {
   try {
      if (!cashbackConfig.is_for_all_users && !cashbackConfig.selected_users.includes(userId)) {
         return;
      }

      const debits = bets.filter(b => b.type === 'debit');
      const credits = bets.filter(b => b.type === 'credit');

      const totalDebit = debits.reduce((sum, bet) => sum + bet.amount, 0);
      const totalCredit = credits.reduce((sum, bet) => sum + bet.amount, 0);

      const GGR = totalDebit - totalCredit;
      let cashbackAmount = 0;

      if (GGR > cashbackConfig.minimum_ggr) {
         cashbackAmount = cashbackConfig.amount_type === 'Percentage'
            ? (GGR * cashbackConfig.amount) / 100
            : cashbackConfig.amount;

         if (cashbackConfig.maximum_amount && cashbackAmount > cashbackConfig.maximum_amount) {
            cashbackAmount = cashbackConfig.maximum_amount;
         }
      }

      if (cashbackAmount > 0) {
         // Get user before update to capture balanceBefore
         const user = await Users.findById(userId);
         const balanceBefore = user.balance;

         // Update user balance
         const updatedUser = await Users.findByIdAndUpdate(userId, {
            $inc: { balance: cashbackAmount },
         }, { new: true });

         // Create transaction record in Transfer collection
         await Transfer.create({
            receiverId: userId,
            senderId: userId,
            type: 'deposit',
            transaction_id: uuidv4(),
            amount: cashbackAmount,
            note: `${cashbackConfig.name} cashback for ${new Date(bets[0].createdAt).toLocaleDateString()}`,
            date: new Date(),
            balanceBefore: {
               receiver: balanceBefore
            },
            balanceAfter: {
               receiver: updatedUser.balance
            }
         });

         console.log(`Cashback of ${cashbackAmount} applied to user ${userId} for ${cashbackConfig.name}`);
      }
   } catch (error) {
      console.error(`[ERROR] Processing cashback for user ${userId} failed:`, error.message);
   }
}

const scheduleCron = () => {
   cron.schedule('0 10 * * *', () => {
      processCashback();
   }, {
      timezone: "Europe/Paris" // Adjust timezone if necessary
   });
};

module.exports = {
   scheduleCron,
   processCashback,
   calculateCashbackSlots,
   calculateCashbackSportsbook
};
