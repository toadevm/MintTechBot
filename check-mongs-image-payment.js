#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function checkMongsImagePayment() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n🔍 CHECKING MONGS IMAGE PAYMENT STATUS\n');
    console.log('═'.repeat(60));

    const mongolContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    // Check image fee payments
    const imagePayments = await db.all('SELECT * FROM image_fee_payments WHERE contract_address = ?', [mongolContract]);
    console.log(`\n💰 IMAGE FEE PAYMENTS for ${mongolContract}:`);
    if (imagePayments.length > 0) {
      imagePayments.forEach(payment => {
        console.log(`   - ID: ${payment.id}, Amount: ${payment.payment_amount} ETH, Duration: ${payment.duration_days} days`);
        console.log(`     Active: ${payment.is_active}, Validated: ${payment.is_validated}`);
        console.log(`     Start: ${payment.start_time}, End: ${payment.end_time}`);
        console.log(`     TX Hash: ${payment.transaction_hash}`);
      });
    } else {
      console.log('   ❌ No image fee payments found');
    }

    // Check all payments for debugging
    const allImagePayments = await db.all('SELECT * FROM image_fee_payments');
    console.log(`\n📋 ALL IMAGE FEE PAYMENTS (${allImagePayments.length} total):`);
    allImagePayments.forEach(payment => {
      console.log(`   - Contract: ${payment.contract_address}, Amount: ${payment.payment_amount} ETH, Duration: ${payment.duration_days} days, Active: ${payment.is_active}`);
    });

    // Check MONGS token details
    const mongToken = await db.get('SELECT * FROM tracked_tokens WHERE contract_address = ?', [mongolContract]);
    if (mongToken) {
      console.log(`\n🎯 MONGS TOKEN DETAILS:`);
      console.log(`   - ID: ${mongToken.id}, Name: ${mongToken.token_name}`);
      console.log(`   - Contract: ${mongToken.contract_address}`);
      console.log(`   - Active: ${mongToken.is_active}`);
      console.log(`   - Chain: ${mongToken.chain_name}`);
      console.log(`   - Collection Slug: ${mongToken.collection_slug}`);
    }

  } catch (error) {
    console.error('❌ Error checking MONGS image payment:', error.message);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

checkMongsImagePayment();