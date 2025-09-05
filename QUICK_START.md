# Quick Start Guide

Get your NFT BuyBot running in 5 minutes!

## ✅ Test Results

Your setup is working! The test shows:
- ✅ Alchemy API connected to Sepolia testnet
- ✅ Database initialized successfully
- ✅ Ethers.js provider working
- ⚠️ Need Telegram bot token for full functionality

## 🚀 Quick Setup

### 1. Get Telegram Bot Token
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`
3. Choose a name and username for your bot
4. Copy the token you receive

### 2. Update Environment
Edit your `.env` file:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
WEBHOOK_URL=https://your-domain.com (for production)
```

### 3. Start the Bot
```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

### 4. Test Your Bot
1. Find your bot on Telegram using the username you chose
2. Send `/start` to your bot
3. Try adding an NFT contract address (Sepolia testnet)

## 📱 Example NFT Contracts for Testing (Sepolia)

Use these contract addresses to test your bot:
- `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` (UNI Token - for basic testing)
- Find more Sepolia NFT contracts on [Sepolia Etherscan](https://sepolia.etherscan.io/)

## 🎯 Core Features Working

With the current setup, you can:
- ✅ Add NFT contracts to track
- ✅ Store user data in database
- ✅ Validate Ethereum addresses
- ✅ Connect to Sepolia blockchain
- ✅ Process user commands

## 🔧 Optional Setup (for full features)

### For Webhooks (Real-time notifications):
1. Deploy to a hosting service (Railway, Heroku, etc.)
2. Get public HTTPS URL
3. Set `WEBHOOK_URL` in environment
4. Get Alchemy Auth Token from [dashboard](https://dashboard.alchemy.com/notify)

### For Trending Payments:
1. Deploy the smart contract to Sepolia
2. Set `TRENDING_CONTRACT_ADDRESS` in environment
3. Users can pay ETH to promote their NFTs

### For Channel Integration:
- Add bot to Telegram channels
- Configure trending broadcasts
- Multi-channel NFT alerts

## 📖 Commands Your Bot Supports

### User Commands
- `/start` - Initialize and welcome message
- `/help` - Show all commands
- `/add_token` - Add NFT contract to track
- `/my_tokens` - View tracked collections
- `/trending` - See promoted collections
- `/wallet` - Connect wallet address

### Advanced Features (when fully configured)
- Real-time NFT transfer notifications
- Sale and price alerts
- Community trending system
- Multi-channel deployment
- Analytics and statistics

## 🚨 Troubleshooting

**Bot not responding?**
- Check your `TELEGRAM_BOT_TOKEN` is correct
- Make sure the bot is started with `npm start`
- Look at the console logs for errors

**Can't add tokens?**
- Verify you're using valid Ethereum addresses
- Check that Alchemy API is working (run `npm test`)
- Use Sepolia testnet contracts for testing

**Need help?**
- Check the full `README.md` for detailed instructions
- Review `DEPLOYMENT.md` for production setup
- Run `npm test` to diagnose connection issues

## 🎉 You're Ready!

Your NFT BuyBot is ready to track NFT collections on Sepolia testnet. 

**Next steps:**
1. Add your Telegram bot token
2. Start the bot with `npm run dev`  
3. Test with some Sepolia NFT contracts
4. Deploy to production when ready!

---

**Happy NFT tracking!** 🚀