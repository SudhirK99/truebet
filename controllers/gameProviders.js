const Provider = require("../models/Provider");

exports.getProviders = async (req, res) => {
    try {
        const providers = await Provider.find()
        // Return response
        return res.status(200).json({
            success: true,
            data: providers
        });

    } catch (error) {
        console.error("[ERROR] Error occurred during providers retrieval:", error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while retrieving providers",
            error: error.message
        });
    }
};