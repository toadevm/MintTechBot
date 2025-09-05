# NFT BuyBot for Telegram

A comprehensive NFT tracking and trending bot for Telegram that allows users to monitor NFT collections, receive real-time activity alerts, and promote their collections through a paid trending system.

## 🚀 Features

### Core Features
- **NFT Collection Tracking**: Add any NFT contract address to receive activity alerts
- **Real-time Notifications**: Get instant alerts for transfers, sales, and other activities
- **Trending System**: Pay ETH to promote your NFT collection in trending feeds
- **Channel Integration**: Deploy bot to channels for community NFT alerts
- **Multi-chain Support**: Built for Ethereum (currently Sepolia testnet for testing)

### Advanced Features
- **Smart Contract Validation**: Automatically validates NFT contracts
- **Floor Price Tracking**: Monitor floor prices and market data
- **Activity Analytics**: Track NFT activity patterns and statistics
- **Webhook System**: Real-time updates via Alchemy webhooks
- **User Management**: Persistent user profiles and preferences

## 🛠 Tech Stack

- **Node.js** - Runtime environment
- **Telegraf.js** - Telegram Bot Framework
- **Alchemy SDK v3** - Blockchain data and webhooks
- **Ethers.js v6** - Ethereum interactions and wallet management
- **SQLite** - Database for user data and tracking
- **Express.js** - Webhook server
- **Solidity** - Smart contract for trending payments

## 📋 Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** installed
- **Telegram Bot Token** from [@BotFather](https://t.me/botfather)
- **Alchemy API Key** from [Alchemy Dashboard](https://dashboard.alchemy.com/)
- **Alchemy Auth Token** for webhooks from [Alchemy Notify](https://dashboard.alchemy.com/notify)
- A public URL for webhooks (ngrok, Railway, Heroku, etc.)

## 🔧 Installation

### 1. Clone and Install
```bash
git clone <your-repo>
cd candy_rush
npm install
```

### 2. Environment Setup
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Alchemy Configuration
ALCHEMY_API_KEY=VmvZCtX4lWs4C7E8_FaPDKgMxiqqzXoN
ALCHEMY_AUTH_TOKEN=your_alchemy_auth_token_for_webhooks
ALCHEMY_NETWORK=eth-sepolia

# Webhook Configuration  
WEBHOOK_URL=https://your-domain.com
PORT=3000

# Database
DATABASE_PATH=./database.sqlite

# Smart Contract (deploy first)
TRENDING_CONTRACT_ADDRESS=

# Admin Configuration
ADMIN_CHAT_ID=your_admin_telegram_chat_id

# Fee Configuration (in Wei - 0.01 ETH = 10^16)
TRENDING_FEE_WEI=10000000000000000
```

### 3. Deploy Smart Contract (Optional)

The trending system requires a smart contract deployment:

```bash
# Install Hardhat for contract deployment
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox

# Deploy to Sepolia testnet
npx hardhat run scripts/deploy.js --network sepolia
```

Add the deployed contract address to your `.env` file.

### 4. Set up Webhook URL

You need a public URL for Alchemy webhooks. Options:

**Development (ngrok):**
```bash
npm install -g ngrok
ngrok http 3000
# Use the HTTPS URL in your .env
```

**Production:** Deploy to Railway, Heroku, or your preferred hosting service.

### 5. Start the Bot
```bash
# Development
npm run dev

# Production
npm start
```

## 📱 Bot Commands

### User Commands
- `/start` - Initialize bot and show welcome message
- `/help` - Display help and command list
- `/add_token` - Add NFT contract to track
- `/my_tokens` - View your tracked tokens
- `/trending` - See trending NFT collections
- `/wallet` - Connect/manage your wallet
- `/status` - Check your account status

### Token Management
- `/remove_token` - Remove tracked token
- `/search` - Search for NFT collections
- `/stats <address>` - View collection statistics
- `/floor_price <address>` - Check floor price

### Trending System
- `/pay_trending` - Promote your token
- `/trending_options` - View promotion pricing

### Channel Commands
- `/add_channel` - Add bot to channel
- `/channel_settings` - Configure channel alerts
- `/trending_now` - Manual trending update

## 🏗 Architecture

### Core Components

```
src/
├── bot/               # Telegram bot logic
│   └── commands.js    # Bot commands and handlers
├── blockchain/        # Blockchain integrations
│   ├── alchemy.js     # Alchemy SDK wrapper
│   └── wallet.js      # Ethers.js wallet management
├── database/          # Data layer
│   └── db.js          # SQLite database operations
├── services/          # Business logic
│   ├── logger.js      # Winston logging
│   ├── tokenTracker.js # NFT tracking service
│   ├── trendingService.js # Paid promotion system
│   └── channelService.js  # Channel management
├── webhooks/          # Webhook handlers
│   └── handlers.js    # Alchemy webhook processing
└── contracts/         # Smart contracts
    └── TrendingPayment.sol # Trending payment contract
```

### Database Schema

The bot uses SQLite with the following main tables:
- `users` - User profiles and wallet addresses
- `tracked_tokens` - NFT contracts being monitored
- `user_subscriptions` - User-token relationships
- `trending_payments` - Paid trending promotions
- `nft_activities` - Activity logs
- `channels` - Telegram channels using the bot

### Webhook Flow

1. User adds NFT contract → Creates Alchemy webhook
2. NFT activity occurs → Alchemy sends webhook
3. Bot processes webhook → Notifies subscribed users
4. If trending → Also notifies channels

## 🚀 Deployment

### Railway Deployment
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Heroku Deployment
```bash
# Create Heroku app
heroku create your-bot-name

# Set environment variables
heroku config:set TELEGRAM_BOT_TOKEN=your_token
heroku config:set ALCHEMY_API_KEY=your_key

# Deploy
git push heroku main
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🧪 Testing

### Test on Sepolia

1. Get Sepolia ETH from [faucets](https://sepoliafaucet.com/)
2. Use Sepolia NFT contracts for testing
3. Test contract: `0x...` (add example Sepolia NFT)

### Manual Testing Checklist
- [ ] Bot responds to `/start`
- [ ] Can add valid NFT contract
- [ ] Receives webhook notifications
- [ ] Trending system accepts payments
- [ ] Channel integration works

### API Endpoints

Health check and monitoring endpoints:
- `GET /health` - System health status
- `GET /status` - Detailed system status
- `GET /metrics` - Performance metrics
- `POST /webhook/alchemy` - Alchemy webhook endpoint

## 🔧 Configuration

### Alchemy Setup
1. Create account at [Alchemy](https://www.alchemy.com/)
2. Create app for Ethereum Sepolia
3. Get API key from dashboard
4. Enable webhooks in Notify section
5. Get auth token for webhook operations

### Telegram Setup
1. Message [@BotFather](https://t.me/botfather)
2. Create new bot with `/newbot`
3. Get bot token
4. Configure bot commands with `/setcommands`

### Smart Contract Setup
The `TrendingPayment.sol` contract handles paid promotions:
- Base fee: 0.01 ETH + 0.001 ETH per hour
- Maximum duration: 168 hours (1 week)
- Owner can withdraw collected fees

## 📊 Monitoring

### Logs
The bot uses Winston logging with multiple levels:
- `error.log` - Error events only
- `combined.log` - All log levels
- Console output in development

### Metrics
Built-in metrics available at `/metrics`:
- System uptime
- Memory usage
- Active users/tokens/channels
- Database connection status

## 🔒 Security

### Best Practices
- Never log private keys or sensitive data
- Validate all user inputs
- Rate limit webhook endpoints
- Use HTTPS in production
- Regularly update dependencies

### Environment Variables
Keep sensitive data in environment variables:
- Bot tokens
- API keys
- Database credentials
- Admin chat IDs

## 🐛 Troubleshooting

### Common Issues

**Bot not responding:**
- Check `TELEGRAM_BOT_TOKEN` is correct
- Verify bot is not blocked by user
- Check internet connectivity

**Webhooks not working:**
- Verify `WEBHOOK_URL` is publicly accessible
- Check Alchemy webhook is created
- Ensure HTTPS is used

**Database errors:**
- Check file permissions for SQLite
- Verify disk space available
- Check database path in `.env`

**Contract interaction failing:**
- Verify contract address is correct
- Check network (Sepolia vs Mainnet)
- Ensure sufficient gas funds

### Debug Mode
Enable debug logging:
```env
LOG_LEVEL=debug
NODE_ENV=development
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Join our [Telegram group](https://t.me/your_support_group)
- Email: support@yourbot.com

## 🙏 Acknowledgments

- [Alchemy](https://www.alchemy.com/) for blockchain infrastructure
- [Telegraf.js](https://telegraf.js.org/) for Telegram bot framework
- [Ethers.js](https://docs.ethers.org/) for Ethereum integration
- Community contributors and testers

---

Built with ❤️ for the NFT community