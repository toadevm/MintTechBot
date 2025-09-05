require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');

async function testConnections() {
  console.log('🧪 Testing NFT BuyBot Connections...\n');

  // Test 1: Environment Variables
  console.log('1. Testing Environment Variables:');
  const requiredVars = ['ALCHEMY_API_KEY'];
  let missingVars = [];

  requiredVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`   ✅ ${varName}: Present`);
    } else {
      console.log(`   ❌ ${varName}: Missing`);
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.log(`\n❌ Missing environment variables: ${missingVars.join(', ')}`);
    console.log('Please check your .env file');
    return;
  }

  // Test 2: Alchemy Connection
  console.log('\n2. Testing Alchemy Connection:');
  try {
    const settings = {
      apiKey: process.env.ALCHEMY_API_KEY,
      network: Network.ETH_SEPOLIA,
    };
    
    const alchemy = new Alchemy(settings);
    
    // Test basic connection
    const blockNumber = await alchemy.core.getBlockNumber();
    console.log(`   ✅ Connected to Sepolia testnet`);
    console.log(`   📊 Current block number: ${blockNumber}`);

    // Test NFT API
    try {
      // Test with a known Sepolia NFT contract (using a sample address)
      const testContract = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'; // UNI token as test
      const contractMetadata = await alchemy.nft.getContractMetadata(testContract);
      console.log(`   ✅ NFT API working`);
    } catch (error) {
      console.log(`   ℹ️  NFT API test skipped (no test contract): ${error.message.slice(0, 50)}...`);
    }

  } catch (error) {
    console.log(`   ❌ Alchemy connection failed: ${error.message}`);
    return;
  }

  // Test 3: Ethers.js Provider
  console.log('\n3. Testing Ethers.js Provider:');
  try {
    const provider = new ethers.JsonRpcProvider(
      `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    );

    const network = await provider.getNetwork();
    console.log(`   ✅ Provider connected to: ${network.name} (Chain ID: ${network.chainId})`);

    // Test balance query
    const balance = await provider.getBalance('0x0000000000000000000000000000000000000000');
    console.log(`   ✅ Balance query successful: ${ethers.formatEther(balance)} ETH`);

  } catch (error) {
    console.log(`   ❌ Ethers.js provider failed: ${error.message}`);
    return;
  }

  // Test 4: Telegram Bot Token (if provided)
  console.log('\n4. Testing Telegram Bot Token:');
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const { Telegraf } = require('telegraf');
      const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      
      const botInfo = await bot.telegram.getMe();
      console.log(`   ✅ Bot connected: @${botInfo.username} (${botInfo.first_name})`);
      console.log(`   🤖 Bot ID: ${botInfo.id}`);
      
    } catch (error) {
      console.log(`   ❌ Telegram bot connection failed: ${error.message}`);
    }
  } else {
    console.log(`   ⚠️  TELEGRAM_BOT_TOKEN not set - bot will not work`);
  }

  // Test 5: Database
  console.log('\n5. Testing Database:');
  try {
    const Database = require('./src/database/db');
    const db = new Database();
    await db.initialize();
    
    // Test a simple query
    const result = await db.get('SELECT 1 as test');
    if (result && result.test === 1) {
      console.log(`   ✅ Database connection successful`);
      console.log(`   📁 Database path: ${db.dbPath}`);
    }
    
    await db.close();
    
  } catch (error) {
    console.log(`   ❌ Database test failed: ${error.message}`);
  }

  // Test 6: Webhook URL (if provided)
  console.log('\n6. Testing Webhook URL:');
  if (process.env.WEBHOOK_URL) {
    try {
      const url = new URL(process.env.WEBHOOK_URL);
      if (url.protocol === 'https:') {
        console.log(`   ✅ Webhook URL format valid: ${process.env.WEBHOOK_URL}`);
        console.log(`   🔒 HTTPS enabled (required for Alchemy webhooks)`);
      } else {
        console.log(`   ⚠️  Webhook URL should use HTTPS: ${process.env.WEBHOOK_URL}`);
      }
    } catch (error) {
      console.log(`   ❌ Invalid webhook URL: ${error.message}`);
    }
  } else {
    console.log(`   ⚠️  WEBHOOK_URL not set - webhooks will not work`);
  }

  // Test 7: Smart Contract (if deployed)
  console.log('\n7. Testing Smart Contract:');
  if (process.env.TRENDING_CONTRACT_ADDRESS) {
    try {
      const provider = new ethers.JsonRpcProvider(
        `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      );
      
      const code = await provider.getCode(process.env.TRENDING_CONTRACT_ADDRESS);
      if (code !== '0x') {
        console.log(`   ✅ Smart contract deployed: ${process.env.TRENDING_CONTRACT_ADDRESS}`);
        console.log(`   📝 Contract code size: ${(code.length - 2) / 2} bytes`);
      } else {
        console.log(`   ❌ No contract code at address: ${process.env.TRENDING_CONTRACT_ADDRESS}`);
      }
    } catch (error) {
      console.log(`   ❌ Contract check failed: ${error.message}`);
    }
  } else {
    console.log(`   ⚠️  TRENDING_CONTRACT_ADDRESS not set - trending payments unavailable`);
  }

  // Summary
  console.log('\n📋 Test Summary:');
  console.log('✅ = Working correctly');
  console.log('⚠️  = Missing configuration (optional features may not work)');
  console.log('❌ = Error (requires fixing)');
  
  console.log('\n🚀 Next Steps:');
  console.log('1. Fix any ❌ errors shown above');
  console.log('2. Set missing environment variables for full functionality');
  console.log('3. Deploy smart contract if you want trending features');
  console.log('4. Set up webhook URL for production use');
  console.log('5. Run: npm start (or npm run dev for development)');
  
  console.log('\n📖 For detailed setup instructions, see README.md');
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run tests
testConnections().catch(error => {
  console.error('\n💥 Test failed:', error);
  process.exit(1);
});