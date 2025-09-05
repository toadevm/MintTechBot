const TokenTracker = require('./src/services/tokenTracker');
const Database = require('./src/database/db');
const { Alchemy, Network } = require('alchemy-sdk');

async function testTokenAddition() {
  console.log('🔍 Testing token addition workflow...');
  
  try {
    // Initialize services
    const database = new Database();
    await database.initialize();
    
    const alchemyConfig = {
      apiKey: process.env.ALCHEMY_API_KEY,
      network: Network.ETH_SEPOLIA,
      authToken: process.env.ALCHEMY_AUTH_TOKEN
    };
    const alchemy = new Alchemy(alchemyConfig);
    
    const tokenTracker = new TokenTracker(database, alchemy);
    
    // Test contract address (our deployed NFT)
    const testContract = process.env.SAMPLE_NFT_CONTRACT_ADDRESS;
    const testUserId = 12345; // Mock user ID
    
    console.log(`📋 Testing with contract: ${testContract}`);
    console.log(`👤 Mock user ID: ${testUserId}`);
    
    // Test the token addition with our fixes
    console.log('\n🔄 Adding token...');
    const result = await tokenTracker.addToken(testContract, testUserId);
    
    if (result.success) {
      console.log('✅ Token addition successful!');
      console.log(`📄 Result: ${result.message}`);
      console.log(`🔗 Token details:`, JSON.stringify(result.token, null, 2));
    } else {
      console.log('❌ Token addition failed!');
      console.log(`📄 Error: ${result.message}`);
    }
    
    // Test notification by checking if token is properly tracked
    console.log('\n🔍 Verifying token in database...');
    const trackedToken = await database.get(
      'SELECT * FROM tracked_tokens WHERE contract_address = ?',
      [testContract.toLowerCase()]
    );
    
    if (trackedToken) {
      console.log('✅ Token found in database:');
      console.log(`   - ID: ${trackedToken.id}`);
      console.log(`   - Name: ${trackedToken.token_name}`);
      console.log(`   - Symbol: ${trackedToken.token_symbol}`);
      console.log(`   - Webhook ID: ${trackedToken.webhook_id || 'None (manual tracking)'}`);
      console.log(`   - Active: ${trackedToken.is_active ? 'Yes' : 'No'}`);
    } else {
      console.log('❌ Token not found in database');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Test failed:', error);
    process.exit(1);
  }
}

// Load environment variables
require('dotenv').config();

testTokenAddition();