const DUMMY_BONUS = {
  type: "Deposit",
  name: "Bonus",
  amount: 15,
  amount_type: "Percentage",
  is_enabled: false,
  selected_users: [], // Example ObjectIds
  is_for_all_users: false,
};
const CASHBACK = {
  type: "Deposit",
  name: "Cashback",
  amount: 5,
  amount_type: "Percentage",
  is_enabled: false,
  selected_users: [], // Example ObjectIds
  is_for_all_users: false,
};
const CASHBACK_CONFIG = {
  SLOTS: {
    type: "Slots",
    name: "Video Slots Cashback",
    amount: 5,
    amount_type: "Percentage",
    is_enabled: true,
    minimum_ggr: 10,
    maximum_amount: 100, // Optional cap on cashback amount
    selected_users: [], // Array of user IDs
    is_for_all_users: true,
  },
  SPORTSBOOK: {
    type: "Sportsbook",
    name: "Sportsbook Cashback",
    amount: 3,
    amount_type: "Percentage",
    is_enabled: false,
    minimum_ggr: 15,
    maximum_amount: null, // No limit
    selected_users: [], // Array of user IDs 
    is_for_all_users: false,
  },
  // Can add more provider-specific or game-specific cashbacks here
};

module.exports = { CASHBACK, CASHBACK_CONFIG, DUMMY_BONUS }