# MintTechBot for Telegram

MintTechBot - NFT tracking and trending bot for Telegram with real-time notifications and paid promotion system.

## Features

- NFT collection tracking with activity alerts
- Real-time notifications for transfers, sales, mints
- Trending system with ETH payments
- Channel integration
- Ethereum (Sepolia testnet) support

## Tech Stack

- Node.js + Telegraf.js
- Alchemy SDK v3 + webhooks
- Ethers.js v6 + SQLite
- Express.js webhook server

## Prerequisites

- Node.js 18+
- Telegram Bot Token from @BotFather
- Alchemy API Key + Auth Token
- Public URL for webhooks

## Installation

```bash
git clone <repo>
cd candy_rush
npm install
cp .env.example .env
```

Edit `.env`:
```env
TELEGRAM_BOT_TOKEN=your_token
ALCHEMY_API_KEY=your_key
ALCHEMY_AUTH_TOKEN=your_auth_token
ALCHEMY_NETWORK=eth-sepolia
WEBHOOK_URL=https://your-domain.com
PORT=3000
DATABASE_PATH=./database.sqlite
TRENDING_CONTRACT_ADDRESS=
ADMIN_CHAT_ID=your_chat_id
TRENDING_FEE_WEI=10000000000000000
```

Start bot:
```bash
npm start
```

## Commands

- `/start` - Initialize bot
- `/add_token` - Add NFT contract
- `/my_tokens` - View tracked tokens
- `/trending` - View trending collections
- `/pay_trending` - Promote token
- `/add_channel` - Add to channel
- `/channel_settings` - Configure alerts

## API Endpoints

- `GET /health` - Health check
- `GET /status` - System status
- `POST /webhook/alchemy` - Alchemy webhook

## License

ISC License