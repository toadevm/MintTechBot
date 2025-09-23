require('dotenv').config();
const Database = require('./src/database/db.js');

async function checkImagePayment() {
  const contractAddress = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

  try {
    // Initialize database
    const db = new Database();
    await db.initialize();
    console.log('✅ Database connected');

    // Check if token exists in tracked_tokens
    console.log(`\n🔍 Checking payment status for: ${contractAddress}`);

    const token = await db.get(
      'SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)',
      [contractAddress]
    );

    if (token) {
      console.log(`📋 Token Info:`);
      console.log(`   Name: ${token.token_name || 'Unknown'}`);
      console.log(`   Symbol: ${token.token_symbol || 'Unknown'}`);
      console.log(`   Chain: ${token.chain_name || 'ethereum'}`);
      console.log(`   Collection Slug: ${token.collection_slug || 'Not set'}`);
    } else {
      console.log('❌ Contract address not found in tracked tokens');
      return;
    }

    // Check current active image fee status
    const isActive = await db.isImageFeeActive(contractAddress);
    console.log(`\n💰 Current Image Fee Status: ${isActive ? '✅ ACTIVE (PAID)' : '❌ INACTIVE (NOT PAID)'}`);

    // Get all image fee payment history
    const payments = await db.all(
      `SELECT * FROM image_fee_payments
       WHERE LOWER(contract_address) = LOWER(?)
       ORDER BY created_at DESC`,
      [contractAddress]
    );

    if (payments.length > 0) {
      console.log(`\n📊 Payment History (${payments.length} payment(s)):`);
      payments.forEach((payment, index) => {
        const endTime = new Date(payment.end_time);
        const now = new Date();
        const isExpired = endTime < now;
        const daysLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60 * 24)));

        console.log(`\n   Payment ${index + 1}:`);
        console.log(`   ├─ Amount: ${payment.payment_amount} Wei (${(payment.payment_amount / 1e18).toFixed(4)} ETH)`);
        console.log(`   ├─ Duration: ${payment.duration_days || 30} days`);
        console.log(`   ├─ Transaction: ${payment.transaction_hash}`);
        console.log(`   ├─ Payer: ${payment.payer_address}`);
        console.log(`   ├─ Status: ${payment.is_active ? '🟢 Active' : '🔴 Inactive'}`);
        console.log(`   ├─ Validated: ${payment.is_validated ? '✅ Yes' : '❌ No'}`);
        console.log(`   ├─ Start: ${payment.start_time}`);
        console.log(`   ├─ End: ${payment.end_time}`);
        console.log(`   └─ Expiry: ${isExpired ? '🔴 EXPIRED' : `🟢 ${daysLeft} days left`}`);
      });
    } else {
      console.log('\n📊 Payment History: No image fee payments found');
    }

    // Check if token is trending (related info)
    const trending = await db.all(
      `SELECT tp.*, tt.token_name FROM trending_payments tp
       JOIN tracked_tokens tt ON tp.token_id = tt.id
       WHERE LOWER(tt.contract_address) = LOWER(?)
       AND tp.is_active = 1 AND tp.end_time > datetime('now')`,
      [contractAddress]
    );

    if (trending.length > 0) {
      console.log(`\n🔥 Trending Status: ✅ ACTIVE (${trending.length} trending payment(s))`);
    } else {
      console.log(`\n🔥 Trending Status: ❌ NOT TRENDING`);
    }

    console.log('\n✅ Check completed');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkImagePayment();