const crypto = require("crypto");

// Generate unique transaction ID
exports.generateTransactionId = () => {
    return `txn_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
};

// Generate SHA1 hash for `key`
function generateKeys(params) {
    // Sort the parameters alphabetically by key to ensure consistency
    const sortedParams = Object.keys(params)
        .sort()
        .reduce((acc, key) => {
            if (params[key] !== undefined && params[key] !== null) {
                acc[key] = params[key]; // Include only defined values
            }
            return acc;
        }, {});

    // Convert the sorted parameters to a query string
    const queryString = new URLSearchParams(sortedParams).toString();

    // Combine the API_SALT with the query string and hash it
    const hash = crypto.createHash("sha1").update(process.env.API_SALT + queryString).digest("hex");

    return hash;
}

module.exports = { generateKeys };