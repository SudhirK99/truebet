const crypto = require("crypto");

function generateKey(params, salt) {
    const normalizedParams = normalizeParams(params);

    const sortedParams = Object.keys(normalizedParams)
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


module.exports = {
    generateKey,
};
