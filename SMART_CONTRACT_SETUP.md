# Smart Contract Setup Guide

This guide covers deploying the TrendingPayment smart contract for the NFT BuyBot.

## 🏗 Project Structure

The project now includes Hardhat for smart contract development:

```
candy_rush/
├── contracts/              # Smart contracts
│   └── TrendingPayment.sol
├── scripts/               # Deployment scripts
│   └── deploy.js
├── test/                  # Contract tests
│   └── TrendingPayment.test.js
├── typechain-types/       # Generated TypeScript types
├── hardhat.config.js      # Hardhat configuration
└── src/                   # Bot application code
```

## 🔧 Prerequisites

1. **Sepolia Testnet ETH**: Get from faucets like [Sepolia Faucet](https://sepoliafaucet.com/)
2. **Private Key**: For deployment (never share this!)
3. **Etherscan API Key**: For contract verification (optional)

## ⚙️ Environment Setup

Add these variables to your `.env` file:

```bash
# Deployment Configuration
PRIVATE_KEY=your_private_key_without_0x_prefix
ETHERSCAN_API_KEY=your_etherscan_api_key

# After deployment, this will be automatically set:
TRENDING_CONTRACT_ADDRESS=
```

## 🛠 Development Commands

### Contract Development
```bash
# Compile contracts
npm run compile

# Run contract tests
npm run test-contracts

# Test coverage
npm run coverage

# Clean build artifacts
npm run clean
```

### Local Development
```bash
# Start local Hardhat node
npm run node

# Deploy to local network
npm run deploy-local
```

### Sepolia Deployment
```bash
# Deploy to Sepolia testnet
npm run deploy

# Verify contract on Etherscan
npm run verify CONTRACT_ADDRESS
```

## 🚀 Deployment Process

### Step 1: Prepare Wallet
1. Create a new wallet for deployment (recommended)
2. Add Sepolia testnet ETH (≥0.1 ETH recommended)
3. Export the private key (without 0x prefix)
4. Add to `.env` file as `PRIVATE_KEY`

### Step 2: Deploy Contract
```bash
npm run deploy
```

The deployment script will:
- Deploy the TrendingPayment contract
- Automatically update your `.env` with the contract address
- Save deployment info to `deployments.json`
- Show Etherscan link for verification

### Step 3: Verify Contract (Optional)
```bash
npm run verify YOUR_CONTRACT_ADDRESS
```

### Step 4: Restart Bot
```bash
npm run dev
```

The bot will automatically load the new contract address and trending payments will be enabled!

## 📊 Contract Features

### TrendingPayment Contract
- **Base Fee**: 0.01 ETH
- **Hourly Rate**: 0.001 ETH per hour
- **Maximum Duration**: 168 hours (1 week)
- **Minimum Duration**: 1 hour

### Pricing Examples
- 1 hour: 0.011 ETH
- 6 hours: 0.016 ETH
- 24 hours: 0.034 ETH
- 1 week: 0.178 ETH

## 🧪 Testing

### Running Tests
```bash
npm run test-contracts
```

### Test Coverage
The tests cover:
- Contract deployment
- Fee calculations
- Payment validation
- Payment lifecycle
- Owner functions
- Access controls

## 🔍 Verification

After deployment on Sepolia, view your contract at:
`https://sepolia.etherscan.io/address/YOUR_CONTRACT_ADDRESS`

## 🔧 Troubleshooting

### Common Issues

**"Insufficient funds" error:**
- Ensure your wallet has enough Sepolia ETH
- Gas costs are typically 0.001-0.005 ETH

**"Nonce too high" error:**
- Reset your MetaMask nonce or wait
- Try again with `--reset` flag

**Contract verification fails:**
- Ensure you have ETHERSCAN_API_KEY set
- Contract must be deployed and confirmed

### Getting Help

1. Check the deployment logs in console
2. View transaction on Sepolia Etherscan
3. Ensure all environment variables are set
4. Try deploying to local network first with `npm run deploy-local`

## 📱 Bot Integration

Once deployed, the bot automatically:
1. Loads the contract address from `.env`
2. Enables trending payment features
3. Validates payments on-chain
4. Processes trending requests
5. Updates trending status in database

Users can then:
- Pay ETH to promote their NFT collections
- Choose promotion duration (1 hour to 1 week)
- Have their collections featured in trending feeds
- Get promoted in all connected Telegram channels

## 🔄 Updates and Maintenance

### Updating Contract
1. Modify `contracts/TrendingPayment.sol`
2. Update tests if needed
3. Run `npm run test-contracts`
4. Deploy new version with `npm run deploy`
5. Update bot and restart

### Monitoring
- Check contract balance with `trendingPayment.getContractBalance()`
- Monitor payments in database
- View transactions on Etherscan
- Check bot logs for payment processing

---

Your NFT BuyBot now has a complete trending payment system ready for production use! 🎉