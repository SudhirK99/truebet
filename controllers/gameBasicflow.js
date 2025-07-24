const axios = require("axios");
const crypto = require("crypto");
const User = require("../models/User");
const Bet = require("../models/bets");
const GameImage = require("../models/GameImage"); // Import the GameImage model
const CpyPragmatics = require("../models/cpypragmatic");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const GameSession = require("../models/gamesession");
const cron = require("node-cron");
const Provider = require("../models/Provider"); // Adjust the path to your model
const { transferBonusToMain } = require("../bonusManager/bonusTransferToMainBalance");
const { v4: uuidv4 } = require("uuid");
const { enqueueRequest, TransactionError } = require("./lockManager");
const { CASHBACK } = require("../config/constants");

const API_PASSWORD = process.env.API_PASSWORD;
const API_USERNAME = process.env.API_USERNAME;
const API_SALT = process.env.API_SALT;
const BASE_URL = process.env.BASE_URL;
const PROVIDER_API_URL =
  process.env.PROVIDER_API_URL || "https://catch-me.bet/api";

const MAX_RETRIES = 5; // Increase max retries

let cachedGameList = null;
let cacheExpiry = 0;

// Helper function to generate SHA1 key
async function callProviderAPI(payload) {
  const url = PROVIDER_API_URL;
  try {
    // console.log("[DEBUG] Calling Provider API:", payload);
    const response = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
    });
    // console.log("[DEBUG] Provider API Response:", response.data);
    return response.data;
  } catch (error) {
    console.error("[ERROR] Provider API Error:", error.response?.data || error.message);
    throw new Error(
      error.response?.data?.message || "Error communicating with provider"
    );
  }
}

//geanration ssh
// Utility function to generate SHA1 key
function generateKey(params, providedKey) {
  // Step 1: Sort parameters alphabetically
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
        acc[key] = params[key];
      }
      return acc;
    }, {});

  console.log("[DEBUG] Sorted Params for Key Generation:");

  // Step 2: Create query string
  const queryString = Object.entries(sortedParams)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  // console.log("[DEBUG] Query String:", queryString);

  // Step 3: Concatenate salt and generate hash
  const hashInput = `${process.env.API_SALT}${queryString}`;
  const key = crypto.createHash("sha1").update(hashInput).digest("hex");

  console.log("[DEBUG] Generated Key:");

  // Step 4: Validate the provided key (if applicable)
  if (providedKey && providedKey !== key) {
    console.error("[ERROR] Hash Code Invalid. Provided key does not match.");
    const error = new Error("Hash Code Invalid");
    error.statusCode = 403; // Set HTTP status code to 403 (Forbidden)
    error.message = "Wrong key";
    throw error; // Throw error for handling in the calling function
  }

  return key;
}


// Error handler function
function handleError(res, message, statusCode = 500) {
  res.status(statusCode).json({ status: statusCode, message });
}

// 1. Check if player exists
exports.playerExists = async (req, res) => {
  const { username,
    currency = req.user.currency
  } = req.body; // Default currency to EUR if not provided
  //  const { currency } = req.user;
  if (!username) return handleError(res, "Username is required", 400);

  try {
    const payload = {
      api_password: API_PASSWORD,
      api_login: API_USERNAME,
      method: "playerExists",
      user_username: username,
      currency, // Include currency in the request
    };

    const response = await callProviderAPI(payload);

    if (response.error === 0 && response.response) {
      res.status(200).json({ success: true, data: response.response });
    } else {
      res
        .status(404)
        .json({ success: false, message: "Player does not exist" });
    }
  } catch (error) {
    handleError(res, error.message);
  }
};

// 2. Create player
exports.createPlayer = async (req, res) => {
  const { username, password,
    currency = req.user.currency
  } = req.body;
  //const { currency } = req.user;
  if (!username || !password) {
    return handleError(res, "Username and password are required", 400);
  }

  try {
    // Prepare payload for API request
    const payload = {
      api_password: API_PASSWORD,
      api_login: API_USERNAME,
      method: "createPlayer",
      user_username: username,
      user_password: password,
      currency,
    };

    // Call the provider API
    const response = await callProviderAPI(payload);

    if (response.error === 0) {
      // Extract the remote_id from the API response
      const { id: remote_id } = response.response; // Use `response.response` instead of `response.data`

      // Update local database with remote_id
      let user = await User.findOneAndUpdate(
        { username }, // Search by username
        { $set: { remote_id } }, // Update the `remote_id` field
        { new: true } // Return the updated document
      );

      if (!user) {
        // If user doesn't exist locally, create one
        user = new User({
          username,
          password, // In production, ensure the password is hashed
          remote_id,
          balance: 0, // Default balance
        });
        await user.save();
      }

      // console.log(`[DEBUG] Updated user with remote_id: ${remote_id}`);

      // Respond with success
      res.status(200).json({
        success: true,
        data: {
          username: user.username,
          remote_id: user.remote_id,
          balance: user.balance,
        },
      });
    } else {
      console.error(`[ERROR] Failed to create player: ${response.message}`);
      res.status(400).json({ success: false, message: response.message });
    }
  } catch (error) {
    console.error("[ERROR] createPlayer:", error.message);
    handleError(res, "Internal server error.", 500);
  }
};

async function fetchAndSaveGames() {
  const CACHE_DURATION_MS = 10 * 60 * 1000; // Cache for 10 minutes
  const show_systems = 1;
  const show_additional = true;
  const currency = "TND";

  if (cachedGameList && Date.now() < cacheExpiry) {
    console.log("[DEBUG] Serving cached game list from cache.");
    return cachedGameList;
  }

  try {
    const payload = {
      api_password: process.env.API_PASSWORD,
      api_login: process.env.API_USERNAME,
      method: "getGameList",
      show_systems: parseInt(show_systems, 10),
      show_additional: show_additional === "true" || show_additional === true,
      currency,
    };

    // console.log("[DEBUG] Fetching game list with payload:", payload);

    const response = await callProviderAPI(payload);

    // console.log("[DEBUG] Fetching game list provider's :", response.response_provider_logos);

    if (response.error !== 0) {
      console.error("[ERROR] Failed to fetch game list:", response.message);
      throw new Error(response.message || "Failed to fetch game list");
    }

    const mobileGames = response.response.filter(
      (game) => game.mobile === true
    );
    const providerLogos = response.response_provider_logos || {};
    const enrichedGames = enrichGamesWithProviderData(
      mobileGames,
      providerLogos
    );

    // Cache enriched games
    cachedGameList = enrichedGames;
    cacheExpiry = Date.now() + CACHE_DURATION_MS;

    console.log(
      "[DEBUG] Successfully fetched, filtered, and enriched game list."
    );

    // Save enriched games to the database
    await saveGamesToDatabase(enrichedGames);

    // Save provider data to the Provider entity
    const uniqueProviders = extractUniqueProviders(enrichedGames);
    // console.log("[DEBUG] Unique providers extracted:", uniqueProviders);

    await saveProvidersToDatabase(uniqueProviders);

    return enrichedGames;
  } catch (error) {
    console.error(
      "[ERROR] Unexpected error fetching game list:",
      error.message
    );
    throw error;
  }
}

async function givingCashBackToUsers() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const findBetPlacedAfterBonus = await Bet.find(
      { date: { $gte: twentyFourHoursAgo } },
    );
    const uniqueUserIds = [...new Set(findBetPlacedAfterBonus.map(bet => bet.userId.toString()))];
    for (const userId of uniqueUserIds) {
      //Debit section
      const debitedBets = findBetPlacedAfterBonus.filter(b => (b.type === 'debit' && b.userId.toString() === userId.toString()));
      const debitedBetsWithProvider = debitedBets.filter(b => (b.provider === 'PragmaticCopy' || b.provider !== ""));
      const debitedBetsWithNoProvider = debitedBets.filter(b => (b.provider === '' || b.provider === undefined));
      const findBetsOfVideoSlot = await GameImage.find({ gameId: { $in: debitedBetsWithNoProvider.map(b => b.gameId) }, type: "video-slots" })
      const gameIdsOfVideoSlots = new Set(findBetsOfVideoSlot.map(game => game.gameId));
      const debitedBetsMatchingVideoSlot = debitedBetsWithNoProvider.filter(bet =>
        gameIdsOfVideoSlots.has(bet.gameId)
      );
      const debitBetsTotalOfNoProviders = debitedBetsMatchingVideoSlot.reduce((total, bet) => total + bet.amount, 0);
      const debitBetsTotalOfProvider = debitedBetsWithProvider.reduce((total, bet) => total + bet.amount, 0);
      const debitBetsTotal = debitBetsTotalOfNoProviders + debitBetsTotalOfProvider

      // Credit section

      const creditedBets = findBetPlacedAfterBonus.filter(b => (b.type === 'credit' && b.userId.toString() === userId.toString()));
      const creditedBetsWithProvider = creditedBets.filter(b => (b.provider === 'PragmaticCopy' || b.provider !== ""));
      const creditedBetsWithNoProvider = creditedBets.filter(b => (b.provider === '' || b.provider === undefined));
      const findCreditBetsOfVideoSlot = await GameImage.find({ gameId: { $in: creditedBetsWithNoProvider.map(b => b.gameId) }, type: "video-slots" })
      const gameCreditIdsOfVideoSlots = new Set(findCreditBetsOfVideoSlot.map(game => game.gameId));
      const creditedBetsMatchingVideoSlot = creditedBetsWithNoProvider.filter(bet =>
        gameCreditIdsOfVideoSlots.has(bet.gameId)
      );
      const creditBetsTotalOfNoProviders = creditedBetsMatchingVideoSlot.reduce((total, bet) => total + bet.amount, 0);
      const creditBetsTotalOfProvider = creditedBetsWithProvider.reduce((total, bet) => total + bet.amount, 0);
      const creditBetsTotal = creditBetsTotalOfNoProviders + creditBetsTotalOfProvider

      const GGR = debitBetsTotal - creditBetsTotal;
      let calculatePercentage = 0;
      if (GGR > 10) {
        if (CASHBACK.amount_type === "Percentage") {
          calculatePercentage = GGR * CASHBACK.amount / 100
        } else {
          calculatePercentage = CASHBACK.amount
        }
      }
      const findUserToUpdate = await User.findOne({ _id: userId })
      await User.findOneAndUpdate(
        { _id: findUserToUpdate._id }, // Search by username
        { $set: { balance: findUserToUpdate.balance > 0 ? findUserToUpdate.balance + calculatePercentage : calculatePercentage } },
      );
    }

    // console.log(findBetPlacedAfterBonus.length,"findBetPlacedAfterBonus")
  } catch (error) {
    console.error(
      "[ERROR] Unexpected error fetching users:",
      error.message
    );
    throw error;
  }
}

// cron.schedule("0 17 * * *", async () => {
//   console.log("[DEBUG] Starting scheduled task to give cashback.");
//   try {
//     await givingCashBackToUsers();
//     console.log("[DEBUG] Scheduled task completed successfully.");
//   } catch (error) {
//     console.error("[ERROR] Scheduled task failed:", error.message);
//   }
// });

// Schedule the task to run every 24 hours
cron.schedule("0 0 * * *", async () => {
  console.log("[DEBUG] Starting scheduled task to fetch games.");
  try {
    await fetchAndSaveGames();
    console.log("[DEBUG] Scheduled task completed successfully.");
  } catch (error) {
    console.error("[ERROR] Scheduled task failed:", error.message);
  }
});

// Optional: Add manual API route
exports.getlist = async (req, res) => {
  try {
    const games = await fetchAndSaveGames();
    res.status(200).json({ success: true, data: games });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "An error occurred while fetching the game list.",
    });
  }
};

function extractUniqueProviders(games) {
  const providerSet = new Map();

  games.forEach((game) => {
    if (game.provider || game.provider_name || game.providerLogos) {
      const key = game.provider || "null"; // Use "null" for missing providers
      if (!providerSet.has(key)) {
        providerSet.set(key, {
          provider: game.provider || null,
          provider_name: game.provider_name || null,
          providerLogos: game.providerLogos || {
            image_black: null,
            image_white: null,
            image_colored: null,
          },
        });
      }
    }
  });

  return Array.from(providerSet.values());
}
async function saveProvidersToDatabase(providers) {
  try {
    for (const provider of providers) {
      console.log("[DEBUG] Saving provider:");

      const savedProvider = await Provider.findOneAndUpdate(
        { provider: provider.provider }, // Match by provider field
        provider,
        { upsert: true, new: true } // Insert if not exists, update otherwise
      );

      console.log("[DEBUG] Saved provider:");
    }
  } catch (error) {
    console.error("[ERROR] Failed to save providers to database:", error.message);
  }
}





// Helper function to enrich games with provider details
function enrichGamesWithProviderData(games, providerLogos) {
  console.log("Enriching games with provider details ");
  const providerMap = {};

  // Build a map of provider systems to provider details
  for (const category in providerLogos) {
    const providers = providerLogos[category];
    for (const provider of providers) {
      providerMap[provider.system] = {
        provider: provider.system,
        provider_name: provider.name,
        providerLogos: {
          image_black: provider.image_black,
          image_white: provider.image_white,
          image_colored: provider.image_colored,
        },
      };
    }
  }

  // Add provider details to games
  return games.map((game) => {
    const providerData = providerMap[game.system] || {}; // Use `game.system` for mapping
    return {
      ...game,
      provider: providerData.provider || null,
      provider_name: providerData.provider_name || null,
      providerLogos: providerData.providerLogos || null,
    };
  });
}



// Helper function to save game metadata to the database
async function saveGamesToDatabase(gameList) {
  try {
    for (const game of gameList) {
      if (!game.name || !game.id_hash || !game.image) {
        console.warn(`[WARN] Skipping invalid game: ${JSON.stringify(game)}`);
        continue;
      }

      // Extract all details, including additional ones
      const gameData = {
        gameId: game.id,
        id_hash: game.id_hash,
        name: game.name,
        category: game.category,
        type: game.type,
        subcategory: game.subcategory || null,
        details: game.details || null,
        new: game.new || false,
        system: game.system || null,
        position: game.position || null,
        mobile: game.mobile || false,
        id_parent: game.id_parent || null,
        id_hash_parent: game.id_hash_parent || null,
        freerounds_supported: game.freerounds_supported || false,
        featurebuy_supported: game.featurebuy_supported || false,
        has_jackpot: game.has_jackpot || false,
        play_for_fun_supported: game.play_for_fun_supported || false,
        image: game.image,
        image_preview: game.image_preview || null,
        image_filled: game.image_filled || null,
        image_portrait: game.image_portrait || null,
        image_square: game.image_square || null,
        image_background: game.image_background || null,
        image_bw: game.image_bw || null,
        currency: game.currency || null,

        // Additional game details
        aspect_ratio: game.aspect_ratio || null,
        width: game.width || null,
        height: game.height || null,
        scale_up: game.scale_up || false,
        scale_down: game.scale_down || false,
        stretching: game.stretching || false,
        html5: game.html5 || false,
        volatility: game.volatility || null,
        max_exposure: game.max_exposure || null,
        megaways: game.megaways || false,
        bonusbuy: game.bonusbuy || false,
        jackpot_type: game.jackpot_type || null,

        // Provider details
        provider: game.provider || null,
        provider_name: game.provider_name || null,
        providerLogos: game.providerLogos || null,
      };

      // Save or update the game in the database
      await GameImage.findOneAndUpdate(
        { id_hash: game.id_hash }, // Ensure no duplicate `id_hash`
        gameData,
        { upsert: true, new: true }
      );

      // console.log(`[DEBUG] Saved game: ${game.id_hash} - ${game.name}`);
    }
  } catch (error) {
    console.error("[ERROR] Failed to save games to database:", error.message);
  }
}


exports.getGameListFromDatabase = async (req, res) => {
  const { limit = 30, offset = 0, sortBy = 'name', sortOrder = 'asc', ...filters } = req.query;

  try {
    // Parse pagination and sorting parameters
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);

    // Build dynamic query object
    const query = { provider_name: { $ne: "Pragmatic Play" } }; // Exclude Playtech games

    // Add filters to the query dynamically
    Object.keys(filters).forEach((key) => {
      if (filters[key].includes(',')) {
        query[key] = { $in: filters[key].split(',') };
      } else {
        query[key] = filters[key];
      }
    });

    // Fetch games from the database with filters, pagination, and sorting by position first
    const games = await GameImage.find(query)
      .sort({ position: 1 }) // Ensure sorting by position first
      .skip(parsedOffset)
      .limit(parsedLimit);

    // Get the total count for the query
    const totalCount = await GameImage.countDocuments(query);

    res.status(200).json({
      success: true,
      data: games,
      pagination: {
        total: totalCount,
        limit: parsedLimit,
        offset: parsedOffset,
      },
    });
  } catch (error) {
    console.error("[ERROR] Fetching games from database:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch games from the database." });
  }
};



exports.getAllGames = async (req, res) => {
  try {
    // Fetch all games from the database, including all fields
    const games = await GameImage.find();

    // Respond with the entire dataset
    res.status(200).json({ success: true, data: games });
  } catch (error) {
    console.error("[ERROR] Fetching all games from database:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch all games from the database." });
  }
};

exports.getGamesByGameIds = async (req, res) => {
  try {
    const { gameIds } = req.body; // Expecting an array of gameIds from the request body

    if (!Array.isArray(gameIds) || gameIds.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid game IDs format. Must be a non-empty array." });
    }

    // Fetch games that match any of the provided gameIds
    const games = await GameImage.find({ gameId: { $in: gameIds } });

    res.status(200).json({
      success: true,
      data: games,
      count: games.length,
    });
  } catch (error) {
    console.error("[ERROR] Fetching games by gameIds:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch games." });
  }
};

exports.getAllGamesbyname = async (req, res) => {
  try {
    let { search = "", page = 1, limit = 20 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { provider_name: { $regex: search, $options: "i" } }
        ]
      };
    }

    // Exclude Pragmatic Play games from GameImage
    const gameImageQuery = { ...query, provider_name: { $ne: "Pragmatic Play" } };
    const pragmaticsQuery = { name: { $regex: search, $options: "i" } };

    // Fetch games from both collections
    const [gameImages, pragmaticsGames, totalGameImages, totalPragmaticGames] = await Promise.all([
      GameImage.find(gameImageQuery).skip((page - 1) * limit).limit(limit),
      CpyPragmatics.find(pragmaticsQuery).skip((page - 1) * limit).limit(limit),
      GameImage.countDocuments(gameImageQuery),
      CpyPragmatics.countDocuments(pragmaticsQuery)
    ]);

    // Add Provider_Name to Pragmatic Play games
    const pragmaticsGamesWithProvider = pragmaticsGames.map(game => ({
      ...game.toObject(),
      provider_name: "Pragmatic Play"
    }));

    const allGames = [...gameImages, ...pragmaticsGamesWithProvider];
    const totalGames = totalGameImages + totalPragmaticGames;

    res.status(200).json({
      success: true,
      data: allGames,
      total: totalGames,
      page,
      totalPages: Math.ceil(totalGames / limit),
    });
  } catch (error) {
    console.error("[ERROR] Fetching games:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch games." });
  }
};




exports.getAllGamesSearch = async (req, res) => {
  try {
    const { gameName } = req.query;
    if (!gameName) {
      return res.status(400).json({ success: false, message: "gameName query parameter is required" });
    }
    // Search games by gameName (case-insensitive)
    const games = await GameImage.find({ name: { $regex: gameName, $options: "i" } });
    res.status(200).json({ success: true, data: games.map(gam => { return { name: gam.name, _id: gam._id, gameId: gam.gameId } }) });
  } catch (error) {
    console.error("[ERROR] Fetching games from database:", error.message);
    res.status(500).json({ success: false, message: "Failed to fetch games from the database." });
  }
};


// 3. Get Game
exports.getGame = async (req, res) => {
  try {
    const {
      gameid,
      // username,
      play_for_fun = false,
      lang = "en",
      currency = req.user.currency,
      homeurl = "https://truebet365.net",
      cashierurl = "https://truebet365.net",
    } = req.body;

    const { username } = req.user;

    // Validate input
    if (!gameid || !username) {
      return res.status(400).json({
        status: 400,
        message: "Game ID and username are required",
      });
    }

    // Find the user in the database
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        status: 404,
        message: "User not found",
      });
    }

    // Use the provider-specific password
    const providerPassword = user.provider_password;
    if (!providerPassword) {
      return res.status(500).json({
        status: 500,
        message: "Provider password not found for this user",
      });
    }

    // Ensure the player exists in the provider system
    let remote_id = user.remote_id;
    if (!remote_id) {
      const playerExistsPayload = {
        api_password: API_PASSWORD,
        api_login: API_USERNAME,
        method: "playerExists",
        user_username: username,
        currency,
      };

      console.log("Checking if player exists with Payload:");
      const playerExistsResponse = await callProviderAPI(playerExistsPayload);
      console.log("playerExists Response:");

      if (playerExistsResponse.error === 0 && playerExistsResponse.response) {
        remote_id = playerExistsResponse.response.id;
        user.remote_id = remote_id;
        await user.save();
      } else {
        // If player does not exist, create the player
        const createPlayerPayload = {
          api_password: API_PASSWORD,
          api_login: API_USERNAME,
          method: "createPlayer",
          user_username: username,
          user_password: providerPassword, // Use provider password
          currency,
        };

        console.log("Creating player with Payload:");
        const createPlayerResponse = await callProviderAPI(createPlayerPayload);
        console.log("createPlayer Response:");

        if (createPlayerResponse.error === 0) {
          remote_id = createPlayerResponse.response.id;
          user.remote_id = remote_id;
          await user.save();
        } else {
          return res.status(400).json({
            status: 400,
            message: createPlayerResponse.message || "Failed to create player",
          });
        }
      }
    }

    // Prepare getGame payload
    const payload = {
      api_password: API_PASSWORD,
      api_login: API_USERNAME,
      method: "getGame",
      gameid,
      user_username: username,
      user_password: providerPassword, // Use provider password
      play_for_fun: !!play_for_fun,
      lang,
      currency,
      homeurl,
      cashierurl,
    };

    console.log("Calling getGame with Payload:");
    const response = await callProviderAPI(payload);
    console.log("getGame Response:");

    if (response.error === 0) {
      const gameUrl = `${response.response}`;
      const gamesession_id = response.gamesession_id;
      const sessionid = response.sessionid;

      // Save session to the database
      const gameSession = new GameSession({
        username,
        gameId: gameid,
        gamesession_id,
        launch_time: new Date(),
        dbname: "cpypragmatics",
        currency,
        play_for_fun,
        lang,
        sessionid,
        status: "active",
      });

      // const savedSession = await gameSession.save();
      await gameSession.save();
      // Return full session details
      return res.status(200).json({
        success: true,
        data: {
          gameUrl,
          gamesession_id,
          sessionid,
          // savedSession, // Include full saved session details
        },
      });
    } else {
      return res.status(400).json({
        status: 400,
        message: response.message || "Failed to launch the game",
      });
    }
  } catch (error) {
    console.error("[ERROR] getGame:", error.message);
    return res.status(500).json({
      status: 500,
      message: "Internal server error",
    });
  }
};


// 4. Get Balance
exports.getBalance = async (req, res) => {
  const { remote_id, session_id,
    currency,
    username, key } = req.query;
  //const { currency } = req.user;
  // Validate required parameters
  if (!remote_id || !username || !currency || !key) {
    console.error("[ERROR] Missing required parameters for getBalance.");
    return res.status(400).json({ status: "400", message: "Missing required parameters." });
  }

  // Generate the expected key
  const queryString = Object.keys(req.query)
    .filter((param) => param !== "key")
    .map((param) => `${param}=${req.query[param]}`)
    .join("&");

  const expectedKey = crypto.createHash("sha1").update(API_SALT + queryString).digest("hex");

  // Check if the provided key matches the expected key
  if (key !== expectedKey) {
    console.error("[ERROR] Hash Code Invalid for getBalance.");
    return res.status(403).json({ status: "403", message: "Hash Code Invalid" });
  }

  try {
    // Enqueue the balance check operation for the specific user
    const result = await enqueueRequest(remote_id, async () => {
      console.log("[INFO] Fetching balance for remote_id:");

      // Fetch user balance from the database
      const user = await User.findOne({ remote_id });
      if (!user) {
        console.error("[ERROR] Player not found for remote_id:", remote_id);
        throw new Error("Player not found.");
      }

      return {
        status: "200",
        balance: parseFloat(user.balance.toFixed(2)),
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("[ERROR] getBalance:", error.message);
    return res.status(500).json({
      status: "500",
      message: "Internal server error.",
    });
  }
};


const handleBetTransaction = async (type, params) => {
  const {
    username,
    remote_id,
    amount,
    game_id,
    transaction_id,
    session_id,
    provider,
    key, jackpot_contribution_per_id,
    jackpot_contribution_ids,
    jackpot_contribution_in_amount,
    odd_factor,
    freeround_id,
    freeround_spins_remaining,
    is_freeround_bet,
    tip_in_amount,
    fee,
    game_id_hash,
    gamesession_id,
    round_id,
    gameplay_final,
    currency,
    is_freeround_win,
    freeround_completed,
    is_promo_win,
    is_jackpot_win,
    jackpot_win_ids,
    jackpot_win_in_amount,
    is_featurebuy_win
  } = params;

  let session = null;


  try {
    // Check for existing transaction first (idempotency)
    const existingTransaction = await Bet.findOne({ transaction_id });
    const gamePayload = await GameImage.find({ gameId: game_id });
    let updatedUser;

    if (existingTransaction) {
      return {
        status: "200",
        balance: parseFloat(existingTransaction.balanceAfter.sender.toFixed(2)),
        transaction_id
      };
    }
    session = await mongoose.startSession();

    // Find user with session
    const user = await User.findOne({ username, remote_id }).session(session);
    if (!user) {
      throw new TransactionError('User not found', 404);
    }

    const transactionAmount = parseFloat(amount);

    // Validate amount
    if (transactionAmount < 0) {
      throw new TransactionError(`Negative ${type} amount is not allowed`, 400);
    }

    // Handle zero amount
    if (transactionAmount === 0) {
      return {
        status: "200",
        balance: parseFloat(user.balance.toFixed(2)),
        transaction_id
      };
    }

    // Calculate new balance
    const oldBalance = user.balance;
    const newBalance = type === 'debit'
      ? oldBalance - transactionAmount
      : oldBalance + transactionAmount;

    if (type === 'debit' && newBalance < 0 && user.bonus_balance === 0) {
      throw new TransactionError('Insufficient funds', 403);
    } else if (type === 'debit' && newBalance <= 0 && user.bonus_balance > 0) {
      console.log("Trying to shift bonus into balance")
      const bet = new Bet({
        userId: user._id,
        type,
        session_id,
        provider,
        key,
        transaction_id,
        amount: parseFloat(transactionAmount?.toFixed(2)),
        gameId: game_id,
        gameName: gamePayload.name || `Game_${game_id}`,
        balanceBefore: { sender: parseFloat(oldBalance?.toFixed(2)), receiver: null },
        balanceAfter: { sender: parseFloat(newBalance?.toFixed(2)), receiver: null },
        createdFrom: "CASINO",
        jackpot_contribution_per_id: jackpot_contribution_per_id || "",
        jackpot_contribution_ids: jackpot_contribution_ids || "",
        jackpot_contribution_in_amount: jackpot_contribution_in_amount || "",
        odd_factor: odd_factor || "",
        freeround_id: freeround_id || "",
        freeround_spins_remaining: freeround_spins_remaining || "",
        is_freeround_bet: is_freeround_bet || "",
        tip_in_amount: tip_in_amount || "",
        fee: fee || "",
        game_id_hash: game_id_hash || "",
        gamesession_id: gamesession_id || "",
        round_id: round_id || "",
        gameplay_final: gameplay_final || "",
        currency: currency || "TND",
        is_freeround_win: is_freeround_win || "",
        freeround_completed: freeround_completed || "",
        is_promo_win: is_promo_win || "",
        is_jackpot_win: is_jackpot_win || "",
        jackpot_win_ids: jackpot_win_ids || "",
        jackpot_win_in_amount: jackpot_win_in_amount || "",
        is_featurebuy_win: is_featurebuy_win || ""
      });

      await bet.save({ session });
      updatedUser = await transferBonusToMain(user._id)
    } else {
      const bet = new Bet({
        userId: user._id,
        type,
        session_id,
        provider,
        key,
        transaction_id,
        amount: parseFloat(transactionAmount?.toFixed(2)),
        gameId: game_id,
        gameName: gamePayload.name || `Game_${game_id}`,
        balanceBefore: { sender: parseFloat(oldBalance?.toFixed(2)), receiver: null },
        balanceAfter: { sender: parseFloat(newBalance?.toFixed(2)), receiver: null },
        createdFrom: "CASINO",
        jackpot_contribution_per_id: jackpot_contribution_per_id || "",
        jackpot_contribution_ids: jackpot_contribution_ids || "",
        jackpot_contribution_in_amount: jackpot_contribution_in_amount || "",
        odd_factor: odd_factor || "",
        freeround_id: freeround_id || "",
        freeround_spins_remaining: freeround_spins_remaining || "",
        is_freeround_bet: is_freeround_bet || "",
        tip_in_amount: tip_in_amount || "",
        fee: fee || "",
        game_id_hash: game_id_hash || "",
        gamesession_id: gamesession_id || "",
        round_id: round_id || "",
        gameplay_final: gameplay_final || "",
        currency: currency || "TND",
        is_freeround_win: is_freeround_win || "",
        freeround_completed: freeround_completed || "",
        is_promo_win: is_promo_win || "",
        is_jackpot_win: is_jackpot_win || "",
        jackpot_win_ids: jackpot_win_ids || "",
        jackpot_win_in_amount: jackpot_win_in_amount || "",
        is_featurebuy_win: is_featurebuy_win || ""
      });

      await bet.save({ session });
      updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { balance: newBalance },
        { new: true, session }
      );
    }
    return {
      status: "200",
      balance: parseFloat(updatedUser.balance.toFixed(2)),
      transaction_id
    };

  } catch (error) {
    console.error("Error during transfer creation:", error);
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
};


exports.debit = async (req, res) => {
  const {
    username,
    remote_id,
    session_id,
    amount,
    provider,
    game_id,
    transaction_id,
    currency = req.user.currency,
    key,
    jackpot_contribution_per_id,
    jackpot_contribution_ids,
    jackpot_contribution_in_amount,
    odd_factor,
    freeround_id,
    freeround_spins_remaining,
    is_freeround_bet,
    tip_in_amount,
    fee,
    game_id_hash,
    gamesession_id,
    round_id,
    gameplay_final
  } = req.query;
  //const { currency } = req.user;

  try {
    // Validate parameters and key
    if (!username || !remote_id || !session_id || !amount ||
      !provider || !game_id || !transaction_id || !key) {
      throw new TransactionError('Missing required parameters', 400);
    }

    // Verify key
    const queryString = Object.keys(req.query)
      .filter(param => param !== 'key')
      .map(param => `${param}=${req.query[param]}`)
      .join('&');
    const expectedKey = crypto
      .createHash('sha1')
      .update(API_SALT + queryString)
      .digest('hex');

    if (key !== expectedKey) {
      throw new TransactionError('Hash Code Invalid', 403);
    }

    // Process the debit request
    const result = await enqueueRequest(
      remote_id,
      async () => handleBetTransaction('debit', {
        username,
        remote_id,
        amount,
        game_id,
        transaction_id,
        session_id,
        provider,
        key, jackpot_contribution_per_id,
        jackpot_contribution_ids,
        jackpot_contribution_in_amount,
        odd_factor,
        freeround_id,
        freeround_spins_remaining,
        is_freeround_bet,
        tip_in_amount,
        fee,
        game_id_hash,
        gamesession_id,
        round_id,
        gameplay_final, currency
      }),
      { maxRetries: MAX_RETRIES }
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[ERROR] Debit failed:', error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      status: statusCode.toString(),
      message: error.message || 'Internal server error'
    });
  }
};




exports.credit = async (req, res) => {
  const {
    username,
    remote_id,
    session_id,
    amount,
    provider,
    game_id,
    transaction_id,
    currency = req.user.currency,
    key,
    gameplay_final,
    jackpot_contribution_per_id,
    jackpot_contribution_ids,
    jackpot_contribution_in_amount,
    odd_factor,
    freeround_id,
    freeround_spins_remaining,
    is_freeround_bet,
    tip_in_amount,
    fee,
    game_id_hash,
    gamesession_id,
    round_id,
    is_freeround_win,
    freeround_completed,
    is_promo_win,
    is_jackpot_win,
    jackpot_win_ids,
    jackpot_win_in_amount,
    is_featurebuy_win,
  } = req.query;
  // const { currency } = req.user;
  try {
    // Validate parameters
    if (!username || !remote_id || !session_id || !amount ||
      !provider || !game_id || !transaction_id || !key) {
      throw new TransactionError('Missing required parameters', 400);
    }

    // Verify hash key
    const queryString = Object.keys(req.query)
      .filter(param => param !== 'key')
      .map(param => `${param}=${req.query[param]}`)
      .join('&');

    const expectedKey = crypto
      .createHash('sha1')
      .update(API_SALT + queryString)
      .digest('hex');

    if (key !== expectedKey) {
      throw new TransactionError('Hash Code Invalid', 403);
    }

    // Find active game session
    const gameSession = await GameSession.findOne({
      username,
      gameId: game_id,
      status: 'active'
    });

    if (!gameSession && gameplay_final === '1') {
      console.warn(`[WARN] No active game session found for final gameplay: ${username}, game: ${game_id}`);
    }

    // Process the credit request
    const result = await enqueueRequest(
      remote_id,
      async () => handleBetTransaction('credit', {
        username,
        remote_id,
        amount,
        game_id,
        transaction_id,
        username,
        remote_id,
        amount,
        game_id,
        transaction_id,
        jackpot_contribution_per_id,
        jackpot_contribution_ids,
        jackpot_contribution_in_amount,
        odd_factor,
        freeround_id,
        freeround_spins_remaining,
        is_freeround_bet,
        tip_in_amount,
        fee,
        game_id_hash,
        gamesession_id,
        round_id,
        is_freeround_win,
        freeround_completed,
        is_promo_win,
        is_jackpot_win,
        jackpot_win_ids,
        jackpot_win_in_amount,
        is_featurebuy_win
      }),
      { maxRetries: MAX_RETRIES }
    );

    // Update game session if this is final gameplay
    if (gameplay_final === '1' && gameSession) {
      await GameSession.findByIdAndUpdate(
        gameSession._id,
        {
          $set: {
            status: 'completed',
            end_time: new Date()
          }
        }
      );
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('[ERROR] Credit operation failed:', error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      status: statusCode.toString(),
      message: error.message || 'Internal server error'
    });
  }
};




// Rollback Endpoint
exports.rollback = async (req, res) => {
  const { transaction_id, key, remote_id } = req.query;

  try {
    // Validate parameters
    if (!transaction_id || !key || !remote_id) {
      throw new TransactionError('Missing required parameters', 400);
    }

    // Verify key
    const queryString = Object.keys(req.query)
      .filter(param => param !== 'key')
      .map(param => `${param}=${req.query[param]}`)
      .join('&');
    const expectedKey = crypto
      .createHash('sha1')
      .update(API_SALT + queryString)
      .digest('hex');

    if (key !== expectedKey) {
      throw new TransactionError('Hash Code Invalid', 403);
    }

    // Process rollback using the queue system
    const result = await enqueueRequest(
      remote_id,
      async () => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          const originalTransaction = await Bet.findOne({ transaction_id }).session(session);
          if (!originalTransaction) {
            throw new TransactionError('Transaction not found', 404);
          }

          if (originalTransaction.rolledBack) {
            const user = await User.findById(originalTransaction.senderId).session(session);
            return {
              status: "200",
              balance: parseFloat(user.balance.toFixed(2))
            };
          }

          const user = await User.findById(originalTransaction.senderId).session(session);
          if (!user) {
            throw new TransactionError('User not found', 404);
          }

          const updatedBalance = originalTransaction.type === "debit"
            ? user.balance + parseFloat(originalTransaction.amount)
            : user.balance - parseFloat(originalTransaction.amount);

          await User.findByIdAndUpdate(
            user._id,
            { balance: parseFloat(updatedBalance?.toFixed(2)) },
            { session }
          );

          originalTransaction.rolledBack = true;
          await originalTransaction.save({ session });

          const rollbackTransaction = new Bet({
            userId: originalTransaction.senderId,
            type: "rollback",
            transaction_id: `${transaction_id}_rollback`,
            amount: parseFloat(originalTransaction.amount?.toFixed(2)),
            gameId: originalTransaction.gameId,
            gameName: originalTransaction.gameName,
            balanceBefore: { sender: parseFloat(parseFloat(user.balance?.toFixed(2))), receiver: null },
            balanceAfter: { sender: parseFloat(parseFloat(updatedBalance?.toFixed(2))), receiver: null },
            createdFrom: "CASINO",
          });

          await rollbackTransaction.save({ session });
          await session.commitTransaction();

          return {
            status: "200",
            balance: parseFloat(updatedBalance.toFixed(2))
          };

        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      },
      { maxRetries: 3 }
    );

    return res.status(200).json(result);

  } catch (error) {
    console.error('[ERROR] Rollback failed:', error);
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      status: statusCode.toString(),
      message: error.message || 'Internal server error'
    });
  }
};

// NEW PROVIDER implementation

const API_ENDPOINT = "https://apipg.slotgamesapi.com";
const STAGING_AGENT_ID = "truebet216TND";
const API_TOKEN = "a2d5a360f5664265bd378d7ee22a5783";
const SECRET_KEY = "3a042420d8de47d48b83a3c098ceee7e";
const CALLBACK_URL = "https://catch-me.bet/prg";

async function newCallProviderAPI(payload) {
  try {
    console.log(`[DEBUG] Calling Provider API: ${API_ENDPOINT}`);
    console.log(`[DEBUG] Payload:`, JSON.stringify(payload, null, 2));

    // Using the exact format specified in the documentation
    const response = await axios.post(`${API_ENDPOINT}/userAuth`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`
      },
    });
    console.log('[DEBUG] Provider API Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('[ERROR] Provider API Error:', error.response?.status, error.response?.data || error.message);

    // More detailed error logging
    if (error.response) {
      console.error('[ERROR] Response data:', error.response.data);
      console.error('[ERROR] Response status:', error.response.status);
      console.error('[ERROR] Response headers:', error.response.headers);
    } else if (error.request) {
      console.error('[ERROR] No response received:', error.request);
    }

    throw new Error(
      error.response?.data?.message || "Error communicating with provider"
    );
  }
}


exports.launchGame = async (req, res) => {
  try {
    const {
      gameid,
      lang = "en",
      isaffiliate = false,
      homeurl = "https://catch-me.bet"
    } = req.body;
    console.log(req.body
    )
    const { username } = req.user; // Assuming you have user authentication middleware

    // Validate input
    if (!gameid || !username) {
      return res.status(400).json({
        success: false,
        message: "Game ID and username are required",
      });
    }

    // Find the user in the database
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Prepare the payload for getting game URL - EXACT FORMAT FROM DOCUMENTATION
    const payload = {
      agentID: STAGING_AGENT_ID,
      userID: username,
      lang: lang,
      gameid: parseInt(gameid), // Ensure gameid is an integer
      isaffiliate: isaffiliate,
      lobbyUrl: homeurl
    };

    // Call the provider API to get the game URL
    const response = await newCallProviderAPI(payload);
    console.log('[DEBUG]: FETCH GAME URL', response)

    if (response.code === 0 && response.url) {
      // Save session to the database
      const gameSession = new GameSession({
        username,
        gameId: gameid,
        launchTime: new Date(),
        dbname: "cpypragmatics",
        language: lang,
        gameUrl: response.url,
        gamesession_id: uuidv4(),
        status: "active",
      });

      await gameSession.save();
      console.log('[DEBUG]: SESSISON SAVE OF NEW PROVIDER GAME')

      // Return the game URL and session details to the client
      return res.status(200).json({
        success: true,
        data: {
          gameUrl: response.url
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.message || "Failed to get game URL",
        code: response.code
      });
    }
  } catch (error) {
    console.error("[ERROR] launchGame:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
