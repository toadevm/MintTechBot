#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function addContractImagePayment() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n💰 ADDING CONTRACT IMAGE PAYMENT RECORD\n');
    console.log('═'.repeat(60));

    const contractAddress = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    // Step 1: Check if contract exists in tracked_tokens
    console.log('🔍 Step 1: Checking if contract exists in tracked_tokens...');
    const token = await db.get('SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)', [contractAddress]);

    if (!token) {
      console.log('❌ Contract not found in tracked_tokens table!');
      console.log(`   Contract: ${contractAddress}`);
      console.log('\n📝 Note: Contract must be added using /add_token command first');
      console.log('   Example: /add_token 0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf');
      return;
    }

    console.log(`✅ Found contract in tracked_tokens:`);
    console.log(`   - ID: ${token.id}`);
    console.log(`   - Name: ${token.token_name || 'Unknown'}`);
    console.log(`   - Contract: ${token.contract_address}`);
    console.log(`   - Chain: ${token.chain_name} (${token.chain_id})`);
    console.log(`   - Collection Slug: ${token.collection_slug || 'Not set'}`);
    console.log(`   - Active: ${token.is_active}`);

    // Step 2: Check if image payment already exists
    console.log('\n🔍 Step 2: Checking for existing image fee payment...');
    const existingPayment = await db.get('SELECT * FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?) AND is_active = 1', [contractAddress]);

    if (existingPayment) {
      const endTime = new Date(existingPayment.end_time);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60 * 24)));

      console.log(`\n⚠️  Existing active image payment found:`);
      console.log(`   - Payment ID: ${existingPayment.id}`);
      console.log(`   - Amount: ${existingPayment.payment_amount} ETH`);
      console.log(`   - Duration: ${existingPayment.duration_days} days`);
      console.log(`   - Days Left: ${daysLeft} days`);
      console.log(`   - Contract: ${existingPayment.contract_address}`);
      console.log(`   - Active: ${existingPayment.is_active}`);
      console.log(`   - Validated: ${existingPayment.is_validated}`);
      console.log('\n❌ Active image payment already exists. Skipping addition.');
      return;
    }

    console.log('✅ No existing active image payment found');

    // Step 3: Create image fee payment record
    console.log('\n💳 Step 3: Creating image fee payment record...');

    const currentTime = new Date().toISOString();
    const endTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(); // 30 days from now
    const paymentAmountWei = '4000000000000000'; // 0.004 ETH in Wei

    const imagePaymentData = {
      user_id: 1, // Default user ID
      contract_address: contractAddress,
      payment_amount: paymentAmountWei,
      transaction_hash: 'manual_payment_' + Date.now(), // Placeholder for manual addition
      payer_address: '0x0000000000000000000000000000000000000000', // Placeholder
      start_time: currentTime,
      end_time: endTime,
      is_active: 1,
      is_validated: 1,
      validation_timestamp: currentTime,
      created_at: currentTime,
      duration_days: 30
    };

    console.log(`   - Contract: ${imagePaymentData.contract_address}`);
    console.log(`   - Amount: 0.004 ETH (${paymentAmountWei} Wei)`);
    console.log(`   - Duration: ${imagePaymentData.duration_days} days`);
    console.log(`   - End Time: ${endTime}`);

    // Insert the image payment record using the database method
    const result = await db.addImageFeePayment(
      imagePaymentData.user_id,
      imagePaymentData.contract_address,
      imagePaymentData.payment_amount,
      imagePaymentData.transaction_hash,
      imagePaymentData.payer_address,
      imagePaymentData.duration_days
    );

    console.log(`\n✅ Successfully created image payment record:`);
    console.log(`   - Payment ID: ${result.lastID}`);
    console.log(`   - Contract: ${imagePaymentData.contract_address}`);
    console.log(`   - Amount: 0.004 ETH`);
    console.log(`   - Duration: ${imagePaymentData.duration_days} days`);
    console.log(`   - Active: Yes`);
    console.log(`   - Validated: Yes`);

    // Step 4: Verify the addition
    console.log('\n🔍 Step 4: Verifying the addition...');

    const verifyPayment = await db.get('SELECT * FROM image_fee_payments WHERE id = ?', [result.lastID]);
    if (verifyPayment) {
      console.log(`✅ Payment record verified - ID ${verifyPayment.id} exists`);
    } else {
      console.log(`❌ Payment record verification failed`);
      return;
    }

    // Test isImageFeeActive function
    const isActive = await db.get(`
      SELECT * FROM image_fee_payments
      WHERE LOWER(contract_address) = LOWER(?)
      AND is_active = 1 AND end_time > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `, [contractAddress]);

    if (isActive) {
      console.log(`✅ isImageFeeActive check passed - contract will use custom NFT images`);
    } else {
      console.log(`❌ isImageFeeActive check failed - contract will still use default images`);
      return;
    }

    console.log('\n🎉 CONTRACT IMAGE PAYMENT ADDED SUCCESSFULLY!');
    console.log('═'.repeat(50));
    console.log('✅ Contract 0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf now has paid image display');
    console.log('✅ Bot will use actual NFT metadata images instead of default tracking images');
    console.log('✅ Payment duration: 30 days');
    console.log('✅ Payment amount: 0.004 ETH');
    console.log('✅ Ready for use in notifications');

  } catch (error) {
    console.error('❌ Error adding contract image payment:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

addContractImagePayment();