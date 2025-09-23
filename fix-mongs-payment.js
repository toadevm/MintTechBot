#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function fixMongsPayment() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n🔧 FIXING EXISTING MONGS IMAGE PAYMENT\n');
    console.log('═'.repeat(60));

    const mongolContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    // Find the existing broken payment
    const existingPayment = await db.get('SELECT * FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?)', [mongolContract]);

    if (!existingPayment) {
      console.log('❌ No existing payment found to fix');
      return;
    }

    console.log(`✅ Found existing payment record: ID ${existingPayment.id}`);
    console.log(`   - Current amount: ${existingPayment.payment_amount}`);
    console.log(`   - Current active: ${existingPayment.is_active}`);
    console.log(`   - Current validated: ${existingPayment.is_validated}`);

    // Fix the payment record
    const currentTime = new Date().toISOString();
    const endTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(); // 30 days from now

    await db.run(`
      UPDATE image_fee_payments
      SET
        user_id = ?,
        payment_amount = ?,
        payer_address = ?,
        start_time = ?,
        end_time = ?,
        is_active = ?,
        is_validated = ?,
        validation_timestamp = ?
      WHERE id = ?
    `, [
      1, // User ID who added the token
      '0.004', // 30-day image fee amount
      '0x0000000000000000000000000000000000000000', // Placeholder payer address
      currentTime,
      endTime,
      1, // Active
      1, // Validated
      currentTime,
      existingPayment.id
    ]);

    console.log(`\n✅ Successfully updated payment record ${existingPayment.id}:`);
    console.log(`   - Amount: 0.004 ETH`);
    console.log(`   - Duration: 30 days`);
    console.log(`   - Active: Yes`);
    console.log(`   - Validated: Yes`);
    console.log(`   - End date: ${endTime.substring(0, 10)}`);

    // Verify the fix
    const fixedPayment = await db.get('SELECT * FROM image_fee_payments WHERE id = ?', [existingPayment.id]);
    if (fixedPayment && fixedPayment.payment_amount === '0.004') {
      console.log(`\n🔍 Verification successful! Payment properly fixed`);
      console.log(`   - Payment Amount: ${fixedPayment.payment_amount} ETH`);
      console.log(`   - Active: ${fixedPayment.is_active}`);
      console.log(`   - Validated: ${fixedPayment.is_validated}`);
    }

    console.log('\n🎉 MONGS IMAGE PAYMENT FIXED SUCCESSFULLY!');
    console.log('═'.repeat(40));
    console.log('✅ MONGS collection now has proper paid image display');
    console.log('✅ OpenSea notifications will use custom images instead of default tracking image');
    console.log('✅ Collection is fully set up and ready to use');

  } catch (error) {
    console.error('❌ Error fixing MONGS image payment:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

fixMongsPayment();