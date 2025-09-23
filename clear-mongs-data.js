#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function clearMongsData() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n🧹 CLEARING ALL MONGS COLLECTION DATA\n');
    console.log('═'.repeat(60));

    const mongolContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    // First, find the MONGS token
    const mongToken = await db.get('SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)', [mongolContract]);

    if (mongToken) {
      console.log(`✅ Found MONGS token: ID ${mongToken.id}, Name: ${mongToken.token_name}`);

      // Remove all subscriptions for this token
      const subscriptions = await db.all('SELECT * FROM user_subscriptions WHERE token_id = ?', [mongToken.id]);
      console.log(`\n🗑️  Removing ${subscriptions.length} subscriptions...`);

      for (const sub of subscriptions) {
        await db.run('DELETE FROM user_subscriptions WHERE id = ?', [sub.id]);
        console.log(`   ✅ Removed subscription ${sub.id} (User: ${sub.user_id}, Chat: ${sub.chat_id})`);
      }

      // Remove the token itself
      await db.run('DELETE FROM tracked_tokens WHERE id = ?', [mongToken.id]);
      console.log(`\n✅ Removed MONGS token (ID: ${mongToken.id})`);
    } else {
      console.log('❌ MONGS token not found in database');
    }

    // Remove any image fee payments for this contract (both case variations)
    const imagePayments = await db.all('SELECT * FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?)', [mongolContract]);
    console.log(`\n🗑️  Removing ${imagePayments.length} image fee payments...`);

    for (const payment of imagePayments) {
      await db.run('DELETE FROM image_fee_payments WHERE id = ?', [payment.id]);
      console.log(`   ✅ Removed image payment ${payment.id} (${payment.contract_address})`);
    }

    // Remove any footer ads for this contract
    const footerAds = await db.all('SELECT * FROM footer_ads WHERE LOWER(contract_address) = LOWER(?)', [mongolContract]);
    console.log(`\n🗑️  Removing ${footerAds.length} footer ads...`);

    for (const ad of footerAds) {
      await db.run('DELETE FROM footer_ads WHERE id = ?', [ad.id]);
      console.log(`   ✅ Removed footer ad ${ad.id}`);
    }

    // Show final status
    console.log('\n🎉 CLEANUP COMPLETED!');
    console.log('═'.repeat(40));
    console.log('✅ All MONGS collection data has been removed');
    console.log('✅ Ready for fresh re-addition through bot interface');
    console.log('\nNext steps:');
    console.log('1. Start the bot');
    console.log('2. Use /add_token to add MONGS collection properly');
    console.log('3. Bot will fetch correct OpenSea metadata');
    console.log('4. Then add image payment record');

  } catch (error) {
    console.error('❌ Error clearing MONGS data:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

clearMongsData();