const crypto = require("crypto");
const API_SALT = process.env.API_SALT;

// Normalize parameters (e.g., convert `false` to "0")
function normalizeParams(params) {
    return Object.entries(params).reduce((acc, [key, value]) => {
        acc[key] = value === false ? "0" : value;
        return acc;
    }, {});
}

// Generate the key using the provided query and salt
function generateKey(params, salt) {
    const normalizedParams = normalizeParams(params);

    const sortedParams = Object.keys(normalizedParams)
        .filter((key) => key !== "key") // Exclude 'key' itself
        .sort()
        .reduce((acc, key) => {
            acc[key] = normalizedParams[key];
            return acc;
        }, {});

    const queryString = Object.entries(sortedParams)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");

    console.log("[DEBUG] Generated Query String:", queryString);

    const hashInput = `${salt}${queryString}`;
    console.log("[DEBUG] Hash Input:", hashInput);

    return crypto.createHash("sha1").update(hashInput).digest("hex");
}

// Validate the key
function validateKey(reqQuery, salt) {
    const receivedKey = reqQuery.key;

    const calculatedKey = generateKey(reqQuery, salt);

    console.log("[DEBUG] Received Key:", receivedKey);
    console.log("[DEBUG] Calculated Key:", calculatedKey);

    return receivedKey === calculatedKey;
}

// Middleware to validate the request key
function validateRequestKey(req, res, next) {
    const { key } = req.query;

    if (!key) {
        console.warn("[WARN] Missing key in query");
        return res.status(403).json({ status: "403", msg: "Hash Code Invalid" });
    }

    const isValid = validateKey(req.query, API_SALT);
    if (!isValid) {
        console.warn("[WARN] Key validation failed");
        return res.status(403).json({ status: "403", msg: "Hash Code Invalid" });
    }

    next(); // Proceed if the key is valid
}

module.exports = {
    validateRequestKey,
};
