const crypto = require('crypto');


const CONFIG = {
    PUBLIC_KEY: process.env.CMS_WAGGER_PUBLIC_KEY,
    PRIVATE_KEY: process.env.CMS_WAGGER_PRIVATE_KEY,
    //ALLOWED_IP: '185.27.57.141'  // Replace with the IP you want to allow

};


const verifyCmsWagerRequest = async (req, res, next) => {
    try {
        // 1. Check if required headers are present
        const publicKey = req.header('Public-Key');
        const incomingHash = req.header('Hash');
        // const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
        // if (!publicKey || !incomingHash) {
        //     return res.status(401).json({
        //         error: 'Missing required authentication headers'
        //     });
        // }

        //2. Verify Public Key
        // if (publicKey !== CONFIG.PUBLIC_KEY) {
        //     return res.status(401).json({
        //         error: 'Invalid Public Key'
        //     });
        // }

        // 3. Get request body as string
       // const bodyStr = JSON.stringify(req.body);
       //  const bodyStr = req.body;

        // 4. Calculate HMAC
        // const calculatedHash = crypto
        //     .createHmac('sha256', CONFIG.PRIVATE_KEY)
        //     .update(bodyStr)
        //     .digest('hex');

        // 5. Compare hashes
        // if (calculatedHash.toLowerCase() !== incomingHash.toLowerCase()) {
        //     console.log(bodyStr +"jere")
        //     return res.status(401).json({
        //         error: 'Invalid Hash'
        //     });
        // }


        // if (!clientIp) {
        //     return res.status(400).json({
        //         error: 'Client IP is missing in the request'
        //     });
        // }
        //
        // // 4. Validate IP address
        // if (clientIp !== CONFIG.ALLOWED_IP) {
        //     return res.status(403).json({
        //         error: 'Unauthorized IP address'
        //     });
        // }

        // 6. Validate basic request structure
        // const { ClientId, UserId, TransactionType, Amount, Ticket } = req.body;
        //
        // if (!ClientId || !UserId || !TransactionType||
        //     !Amount|| !Ticket) {
        //     return res.status(400).json({
        //         error: 'Missing required fields in request body'
        //     });
        // }

        // If everything is valid, proceed to the next middleware/route handler
        next();
    } catch (error) {
        console.error('Error in CmsWager verification:', error);
        return res.status(500).json({
            error: 'Internal server error during request verification'
        });
    }
};


module.exports = {
    verifyCmsWagerRequest
};