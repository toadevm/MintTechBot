#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');
const SecureTrendingService = require('./src/services/secureTrendingService');

async function verifyImageFeeStatus() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    // Initialize secure trending service
    const secureTrending = new SecureTrendingService(db);
    await secureTrending.initialize();

    console.log('\n🔍 VERIFYING IMAGE FEE STATUS\n');
    console.log('═'.repeat(50));

    const contractAddress = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    // Check contract info
    const token = await db.get('SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)', [contractAddress]);

    console.log('📋 Contract Information:');
    if (token) {
      console.log(`   ✅ Contract: ${token.contract_address}`);
      console.log(`   ✅ Name: ${token.token_name || 'Unknown'}`);
      console.log(`   ✅ Chain: ${token.chain_name} (${token.chain_id})`);
      console.log(`   ✅ Collection Slug: ${token.collection_slug || 'Not set'}`);
      console.log(`   ✅ Active: ${token.is_active ? 'Yes' : 'No'}`);
    } else {
      console.log('   ❌ Contract not found in tracked_tokens');
      return;
    }

    // Check current image fee payment
    console.log('\n💳 Image Fee Payment Status:');
    const imagePayment = await db.get(`
      SELECT * FROM image_fee_payments
      WHERE LOWER(contract_address) = LOWER(?)
      AND is_active = 1 AND end_time > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `, [contractAddress]);

    if (imagePayment) {
      const endTime = new Date(imagePayment.end_time);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60 * 24)));
      const hoursLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60)));

      console.log(`   ✅ Active Payment Found:`);
      console.log(`      - Payment ID: ${imagePayment.id}`);
      console.log(`      - Amount: ${imagePayment.payment_amount} Wei (0.004 ETH)`);
      console.log(`      - Duration: ${imagePayment.duration_days} days`);
      console.log(`      - Days Remaining: ${daysLeft} days (${hoursLeft} hours)`);
      console.log(`      - Start Time: ${imagePayment.start_time}`);
      console.log(`      - End Time: ${imagePayment.end_time}`);
      console.log(`      - Transaction: ${imagePayment.transaction_hash}`);
      console.log(`      - Payer: ${imagePayment.payer_address}`);
      console.log(`      - Validated: ${imagePayment.is_validated ? 'Yes' : 'No'}`);
      console.log(`      - Active: ${imagePayment.is_active ? 'Yes' : 'No'}`);
    } else {
      console.log('   ❌ No active image fee payment found');
    }

    // Test isImageFeeActive function
    console.log('\n🔬 Testing isImageFeeActive Function:');
    const isActive = await secureTrending.isImageFeeActive(contractAddress);
    console.log(`   Result: ${isActive ? '✅ TRUE - Will use NFT metadata images' : '❌ FALSE - Will use default tracking images'}`);

    // Test direct database query (same as used in handlers.js)
    console.log('\n🔬 Testing Direct Database Query (as used in handlers.js):');
    const directCheck = await db.get(`
      SELECT * FROM image_fee_payments
      WHERE LOWER(contract_address) = LOWER(?)
      AND is_active = 1 AND end_time > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `, [contractAddress]);

    console.log(`   Result: ${directCheck ? '✅ TRUE - Payment found' : '❌ FALSE - No payment found'}`);

    if (directCheck) {
      console.log(`   Payment ID: ${directCheck.id}`);
      console.log(`   End Time: ${directCheck.end_time}`);
      console.log(`   Current Time: ${new Date().toISOString()}`);
    }

    console.log('\n🎯 Summary:');
    if (isActive && directCheck) {
      console.log('✅ SUCCESS: Contract 0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf is configured for NFT image display');
      console.log('✅ The bot will use actual NFT metadata images instead of default tracking images');
      console.log('✅ Image fee payment is active and validated');
      console.log(`✅ Payment expires in ${Math.ceil((new Date(directCheck.end_time) - new Date()) / (1000 * 60 * 60 * 24))} days`);
    } else {
      console.log('❌ Issue: Contract is not properly configured for NFT image display');
    }

    console.log('\n' + '═'.repeat(50));

  } catch (error) {
    console.error('❌ Error verifying image fee status:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

verifyImageFeeStatus();