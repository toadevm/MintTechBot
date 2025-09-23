#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function addMongsImagePayment() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n💰 ADDING MONGS IMAGE PAYMENT RECORD\n');
    console.log('═'.repeat(60));

    const mongolContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    // First verify the MONGS token exists and get its details
    const mongToken = await db.get('SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)', [mongolContract]);

    if (!mongToken) {
      console.log('❌ MONGS token not found in database. Please add it first using /add_token');
      return;
    }

    console.log(`✅ Found MONGS token:`);
    console.log(`   - ID: ${mongToken.id}`);
    console.log(`   - Name: ${mongToken.token_name}`);
    console.log(`   - Contract: ${mongToken.contract_address}`);
    console.log(`   - Collection Slug: ${mongToken.collection_slug}`);
    console.log(`   - Active: ${mongToken.is_active}`);

    // Check if image payment already exists
    const existingPayment = await db.get('SELECT * FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?)', [mongolContract]);

    if (existingPayment) {
      console.log(`\n⚠️  Existing image payment found: ID ${existingPayment.id}`);
      console.log(`   - Amount: ${existingPayment.amount_eth} ETH`);
      console.log(`   - Duration: ${existingPayment.duration_days} days`);
      console.log(`   - Contract: ${existingPayment.contract_address}`);
      console.log(`   - Processed: ${existingPayment.is_processed}`);
      console.log('\n❌ Image payment already exists. Skipping addition.');
      return;
    }

    // Add image fee payment for 30 days (0.004 ETH as per your pricing structure)
    const currentTime = new Date().toISOString();
    const endTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(); // 30 days from now

    const imagePaymentData = {
      user_id: 1, // User ID who added the token
      contract_address: mongolContract,
      payment_amount: '0.004',
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

    // Add the image payment
    const result = await db.run(`
      INSERT INTO image_fee_payments (
        user_id,
        contract_address,
        payment_amount,
        transaction_hash,
        payer_address,
        start_time,
        end_time,
        is_active,
        is_validated,
        validation_timestamp,
        created_at,
        duration_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      imagePaymentData.user_id,
      imagePaymentData.contract_address,
      imagePaymentData.payment_amount,
      imagePaymentData.transaction_hash,
      imagePaymentData.payer_address,
      imagePaymentData.start_time,
      imagePaymentData.end_time,
      imagePaymentData.is_active,
      imagePaymentData.is_validated,
      imagePaymentData.validation_timestamp,
      imagePaymentData.created_at,
      imagePaymentData.duration_days
    ]);

    console.log(`\n✅ Successfully added image payment for MONGS:`);
    console.log(`   - Payment ID: ${result.lastID}`);
    console.log(`   - Contract: ${imagePaymentData.contract_address}`);
    console.log(`   - Amount: ${imagePaymentData.payment_amount} ETH`);
    console.log(`   - Duration: ${imagePaymentData.duration_days} days`);
    console.log(`   - Active: Yes`);
    console.log(`   - Validated: Yes`);

    // Update the collection slug for the MONGS token if it's missing
    if (!mongToken.collection_slug || mongToken.collection_slug === 'undefined' || mongToken.collection_slug === null) {
      console.log(`\n🔄 Updating MONGS token with collection slug...`);
      await db.run('UPDATE tracked_tokens SET collection_slug = ? WHERE id = ?', ['mongs-nft', mongToken.id]);
      console.log(`✅ Updated MONGS token with collection slug: mongs-nft`);
    }

    // Verify the payment was added correctly
    const verifyPayment = await db.get('SELECT * FROM image_fee_payments WHERE id = ?', [result.lastID]);
    if (verifyPayment) {
      console.log(`\n🔍 Verification successful! Payment record exists with ID ${verifyPayment.id}`);
    }

    console.log('\n🎉 MONGS IMAGE PAYMENT ADDED SUCCESSFULLY!');
    console.log('═'.repeat(40));
    console.log('✅ MONGS collection now has paid image display');
    console.log('✅ OpenSea notifications will use custom images instead of default tracking image');
    console.log('✅ Collection is fully set up and ready to use');

  } catch (error) {
    console.error('❌ Error adding MONGS image payment:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

addMongsImagePayment();