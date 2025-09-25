#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function clearDatabasePreserveMongOnly() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n🧹 CLEARING DATABASE - PRESERVE ONLY MONG NFT\n');
    console.log('═'.repeat(60));

    const mongContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    // Start transaction for safety
    await db.run('BEGIN TRANSACTION');

    try {
      // Phase 1: Check what we're preserving
      console.log('\n📋 CHECKING DATA TO PRESERVE:');

      const mongToken = await db.get('SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)', [mongContract]);
      if (mongToken) {
        console.log(`✅ Found MONG token: ID ${mongToken.id}, Name: ${mongToken.token_name}`);
        console.log(`   Contract: ${mongToken.contract_address}`);
        console.log(`   Chain: ${mongToken.chain_name}, Active: ${mongToken.is_active}`);
      } else {
        console.log('❌ MONG token not found in tracked_tokens');
      }

      const mongImagePayments = await db.all('SELECT * FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?)', [mongContract]);
      console.log(`💰 MONG image fee payments to preserve: ${mongImagePayments.length}`);
      mongImagePayments.forEach((payment, index) => {
        console.log(`   Payment ${index + 1}: ID ${payment.id}, Active: ${payment.is_active}, Amount: ${payment.payment_amount} ETH`);
        console.log(`     TX Hash: ${payment.transaction_hash}`);
      });

      // Phase 2: Count what we're deleting
      console.log('\n🗑️  COUNTING DATA TO DELETE:');

      const userCount = await db.get('SELECT COUNT(*) as count FROM users');
      console.log(`   Users to delete: ${userCount.count}`);

      const subscriptionCount = await db.get('SELECT COUNT(*) as count FROM user_subscriptions');
      console.log(`   User subscriptions to delete: ${subscriptionCount.count}`);

      const channelCount = await db.get('SELECT COUNT(*) as count FROM channels');
      console.log(`   Channels to delete: ${channelCount.count}`);

      const tokenCount = await db.get('SELECT COUNT(*) as count FROM tracked_tokens WHERE LOWER(contract_address) != LOWER(?)', [mongContract]);
      console.log(`   Non-MONG tokens to delete: ${tokenCount.count}`);

      const trendingCount = await db.get('SELECT COUNT(*) as count FROM trending_payments');
      console.log(`   Trending payments to delete: ${trendingCount.count}`);

      const footerCount = await db.get('SELECT COUNT(*) as count FROM footer_ads');
      console.log(`   Footer ads to delete: ${footerCount.count}`);

      const pendingCount = await db.get('SELECT COUNT(*) as count FROM pending_payments');
      console.log(`   Pending payments to delete: ${pendingCount.count}`);

      const transactionCount = await db.get('SELECT COUNT(*) as count FROM processed_transactions');
      console.log(`   Processed transactions to delete: ${transactionCount.count}`);

      const activityCount = await db.get('SELECT COUNT(*) as count FROM nft_activities');
      console.log(`   NFT activities to delete: ${activityCount.count}`);

      const webhookCount = await db.get('SELECT COUNT(*) as count FROM webhook_logs');
      console.log(`   Webhook logs to delete: ${webhookCount.count}`);

      const nonMongImageCount = await db.get('SELECT COUNT(*) as count FROM image_fee_payments WHERE LOWER(contract_address) != LOWER(?)', [mongContract]);
      console.log(`   Non-MONG image payments to delete: ${nonMongImageCount.count}`);

      // Phase 3: Perform the cleanup
      console.log('\n🔄 STARTING CLEANUP OPERATIONS:');

      // Delete all user subscriptions first (foreign key dependency)
      const subsDeleted = await db.run('DELETE FROM user_subscriptions');
      console.log(`✅ Deleted ${subsDeleted.changes} user subscriptions`);

      // Delete all users
      const usersDeleted = await db.run('DELETE FROM users');
      console.log(`✅ Deleted ${usersDeleted.changes} users`);

      // Delete all channels
      const channelsDeleted = await db.run('DELETE FROM channels');
      console.log(`✅ Deleted ${channelsDeleted.changes} channels`);

      // Delete non-MONG tracked tokens
      const tokensDeleted = await db.run('DELETE FROM tracked_tokens WHERE LOWER(contract_address) != LOWER(?)', [mongContract]);
      console.log(`✅ Deleted ${tokensDeleted.changes} non-MONG tokens`);

      // Delete all trending payments
      const trendingDeleted = await db.run('DELETE FROM trending_payments');
      console.log(`✅ Deleted ${trendingDeleted.changes} trending payments`);

      // Delete all footer ads
      const footerDeleted = await db.run('DELETE FROM footer_ads');
      console.log(`✅ Deleted ${footerDeleted.changes} footer ads`);

      // Delete all pending payments
      const pendingDeleted = await db.run('DELETE FROM pending_payments');
      console.log(`✅ Deleted ${pendingDeleted.changes} pending payments`);

      // Delete all processed transactions
      const transactionsDeleted = await db.run('DELETE FROM processed_transactions');
      console.log(`✅ Deleted ${transactionsDeleted.changes} processed transactions`);

      // Delete all NFT activities
      const activitiesDeleted = await db.run('DELETE FROM nft_activities');
      console.log(`✅ Deleted ${activitiesDeleted.changes} NFT activities`);

      // Delete all webhook logs
      const webhooksDeleted = await db.run('DELETE FROM webhook_logs');
      console.log(`✅ Deleted ${webhooksDeleted.changes} webhook logs`);

      // Delete non-MONG image fee payments
      const imageDeleted = await db.run('DELETE FROM image_fee_payments WHERE LOWER(contract_address) != LOWER(?)', [mongContract]);
      console.log(`✅ Deleted ${imageDeleted.changes} non-MONG image payments`);

      // Phase 4: Verify what remains
      console.log('\n✨ VERIFICATION - FINAL DATABASE STATE:');

      const finalUsers = await db.get('SELECT COUNT(*) as count FROM users');
      console.log(`👥 Remaining users: ${finalUsers.count}`);

      const finalSubscriptions = await db.get('SELECT COUNT(*) as count FROM user_subscriptions');
      console.log(`🔗 Remaining subscriptions: ${finalSubscriptions.count}`);

      const finalChannels = await db.get('SELECT COUNT(*) as count FROM channels');
      console.log(`📺 Remaining channels: ${finalChannels.count}`);

      const finalTokens = await db.all('SELECT * FROM tracked_tokens');
      console.log(`🎯 Remaining tokens: ${finalTokens.length}`);
      finalTokens.forEach(token => {
        console.log(`   - ${token.token_name || 'Unknown'} (${token.contract_address})`);
      });

      const finalImagePayments = await db.all('SELECT * FROM image_fee_payments');
      console.log(`💰 Remaining image payments: ${finalImagePayments.length}`);
      finalImagePayments.forEach(payment => {
        console.log(`   - Contract: ${payment.contract_address}, Active: ${payment.is_active}, Amount: ${payment.payment_amount} ETH`);
      });

      const finalTrending = await db.get('SELECT COUNT(*) as count FROM trending_payments');
      console.log(`📈 Remaining trending payments: ${finalTrending.count}`);

      const finalFooter = await db.get('SELECT COUNT(*) as count FROM footer_ads');
      console.log(`🔗 Remaining footer ads: ${finalFooter.count}`);

      // Commit the transaction
      await db.run('COMMIT');
      console.log('\n🎉 DATABASE CLEANUP COMPLETED SUCCESSFULLY!');
      console.log('\n📝 SUMMARY:');
      console.log('   ✅ All users removed (they will need to re-register)');
      console.log('   ✅ All groups/channels removed');
      console.log('   ✅ All non-MONG tokens removed');
      console.log('   ✅ All payment history cleared (except MONG image fees)');
      console.log(`   ✅ MONG NFT preserved: ${mongContract}`);
      console.log('   ✅ MONG image fee payments preserved');
      console.log('\n🔄 Users can now re-add MONG collection and it will use existing image fee payment');

    } catch (error) {
      // Rollback on error
      await db.run('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Error during database cleanup:', error.message);
    console.error('🔄 Database has been rolled back to original state');
  } finally {
    if (db) {
      await db.close();
    }
  }
}

clearDatabasePreserveMongOnly();