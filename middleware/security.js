const revokedTokens = new Set(); // In-memory store for revoked tokens (use Redis or a database for production)

// Middleware to check if a token has been revoked
const isTokenRevoked = (req, res, next) => {
    const token = req.headers["authorization"]?.split(" ")[1]; // Extract Bearer token

    if (!token) {
        return res.status(401).json({ message: "No token provided." });
    }

    if (revokedTokens.has(token)) {
        return res.status(403).json({ message: "Token has been revoked." });
    }

    next();
};

// Middleware to set Content Security Policy (CSP) headers
const setCSP = (req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none';"
    );
    next();
};

// Function to revoke a token
const revokeToken = (token) => {
    revokedTokens.add(token);
    // Optionally, set a timeout to remove the token after its expiration time
    setTimeout(() => revokedTokens.delete(token), 60 * 60 * 1000); // Remove after 1 hour
};

module.exports = { isTokenRevoked, setCSP, revokeToken };
