require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Simple metadata for MongsInspired NFTs
app.get('/metadata/:tokenId', (req, res) => {
    const tokenId = req.params.tokenId;
    
    // Generate some basic metadata for testing
    const metadata = {
        name: `MONGS Inspired #${tokenId}`,
        description: `A MONGS-inspired NFT with PROJECT_SCALE architecture. Token ID: ${tokenId}`,
        image: `https://ipfs.io/ipfs/QmYjXWeCjqYbhwLhKPJBE9TJpRjMeYxRgKZW4kTzYPKPvN/${tokenId}.png`,
        attributes: [
            {
                trait_type: "Type",
                value: "MONGS Inspired"
            },
            {
                trait_type: "Generation", 
                value: "Genesis"
            },
            {
                trait_type: "Token ID",
                value: tokenId
            },
            {
                trait_type: "Project ID",
                value: Math.floor(tokenId / 1000000).toString()
            },
            {
                trait_type: "Mint Number",
                value: (tokenId % 1000000).toString()
            },
            {
                trait_type: "Rarity",
                value: Math.floor(Math.random() * 100) < 10 ? "Rare" : "Common"
            }
        ],
        external_url: `https://etherscan.io/token/${process.env.MONGS_INSPIRED_CONTRACT_ADDRESS}?a=${tokenId}`,
        background_color: "000000"
    };
    
    console.log(`📡 Serving metadata for token ${tokenId}`);
    res.json(metadata);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'MongsInspired metadata server is running' });
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🚀 MongsInspired metadata server running on port ${PORT}`);
    console.log(`📝 Metadata endpoint: http://localhost:${PORT}/metadata/{tokenId}`);
    console.log(`💚 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;