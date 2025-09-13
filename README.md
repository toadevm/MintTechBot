# MintTechBot for Telegram

MintTechBot - NFT tracking and trending bot for Telegram with real-time notifications and paid promotion system.

## Features

- NFT collection tracking with activity alerts
- Real-time notifications for transfers, sales, mints
- Trending system with ETH payments
- Channel integration
- Ethereum mainnet support

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
ALCHEMY_NETWORK=eth-mainnet
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
- `/buy_trending` - Purchase trending promotion
- `/validate` - Validate trending payment
- `/add_channel` - Add to channel
- `/channel_settings` - Configure alerts

## Fee Configuration

### Changing Trending Fees

The bot uses a **secure trending system** where users send ETH directly to a smart contract. To modify trending fees:

**Location:** `src/services/secureTrendingService.js`

Find the `trendingFees` object around line 55:

```javascript
this.trendingFees = {
  normal: {
    6: ethers.parseEther('0.0625'),   // 6hrs: 0.0625 ETH
    12: ethers.parseEther('0.115'),   // 12hrs: 0.115 ETH
    18: ethers.parseEther('0.151'),   // 18hrs: 0.151 ETH
    24: ethers.parseEther('0.20')     // 24hrs: 0.20 ETH
  },
  premium: {
    6: ethers.parseEther('0.125'),    // 6hrs: 0.125 ETH
    12: ethers.parseEther('0.225'),   // 12hrs: 0.225 ETH
    18: ethers.parseEther('0.32'),    // 18hrs: 0.32 ETH
    24: ethers.parseEther('0.40')     // 24hrs: 0.40 ETH
  }
}
```

### Examples

**To increase all premium fees by 25%:**
```javascript
premium: {
  6: ethers.parseEther('0.15625'),   // was 0.125
  12: ethers.parseEther('0.28125'),  // was 0.225
  18: ethers.parseEther('0.40'),     // was 0.32
  24: ethers.parseEther('0.50')      // was 0.40
}
```

**To set custom normal fees:**
```javascript
normal: {
  6: ethers.parseEther('0.05'),      // 6hrs: 0.05 ETH
  12: ethers.parseEther('0.09'),     // 12hrs: 0.09 ETH
  18: ethers.parseEther('0.13'),     // 18hrs: 0.13 ETH
  24: ethers.parseEther('0.17')      // 24hrs: 0.17 ETH
}
```

### After Changing Fees

1. **Restart the bot:** `npm start`
2. **Verify changes:** Use `/buy_trending` command to see new prices
3. **Test payments:** Ensure users can pay the new amounts

### Legacy System

The legacy trending service (`src/services/trendingService.js`) is now simplified and only handles database operations. All new trending payments use the secure system above.

## API Endpoints

- `GET /health` - Health check
- `GET /status` - System status
- `POST /webhook/alchemy` - Alchemy webhook

## License

ISC License