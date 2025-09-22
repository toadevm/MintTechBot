#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function cleanupDatabase() {
  let db;

  try {
    // Initialize database
    db = new Database();
    await db.initialize();

    console.log('\n🧹 STARTING DATABASE CLEANUP\n');
    console.log('═'.repeat(60));

    const realMongContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';
    const realMongTokenId = 6; // ID of the real MONG contract that paid for image fee

    console.log(`✅ Preserving Real MONG Contract: ${realMongContract}`);
    console.log(`✅ Preserving Token ID: ${realMongTokenId}`);
    console.log('');

    // Step 1: Identify what to keep vs clean up
    console.log('🔍 IDENTIFYING CLEANUP TARGETS...\n');

    // Get all tokens except the real MONG
    const tokensToDelete = await db.all(
      'SELECT * FROM tracked_tokens WHERE id != ? ORDER BY id',
      [realMongTokenId]
    );

    console.log(`📋 Tokens to delete: ${tokensToDelete.length}`);
    tokensToDelete.forEach(token => {
      console.log(`   - ID ${token.id}: ${token.contract_address} (${token.token_name || 'Unknown'})`);
    });

    // Get subscriptions for tokens to be deleted
    const subscriptionsToDelete = await db.all(
      'SELECT * FROM user_subscriptions WHERE token_id != ?',
      [realMongTokenId]
    );

    console.log(`\n📬 Subscriptions to delete: ${subscriptionsToDelete.length}`);
    subscriptionsToDelete.forEach(sub => {
      console.log(`   - Sub ID ${sub.id}: User ${sub.user_id} -> Token ${sub.token_id}`);
    });

    // Get image fee payments for other contracts
    const imageFeesToDelete = await db.all(
      'SELECT * FROM image_fee_payments WHERE LOWER(contract_address) != LOWER(?)',
      [realMongContract]
    );

    console.log(`\n🖼️  Image fee payments to delete: ${imageFeesToDelete.length}`);
    imageFeesToDelete.forEach(payment => {
      console.log(`   - Payment ID ${payment.id}: ${payment.contract_address}`);
    });

    // Get processed transactions for other contracts
    const processedTxToDelete = await db.all(
      'SELECT * FROM processed_transactions WHERE LOWER(contract_address) != LOWER(?)',
      [realMongContract]
    );

    console.log(`\n🔗 Processed transactions to delete: ${processedTxToDelete.length}`);
    processedTxToDelete.forEach(tx => {
      console.log(`   - TX ID ${tx.id}: ${tx.contract_address} (${tx.transaction_hash})`);
    });

    // Get all other tables to clean
    const trendingPayments = await db.all('SELECT * FROM trending_payments');
    const pendingPayments = await db.all('SELECT * FROM pending_payments');
    const footerAds = await db.all('SELECT * FROM footer_ads');
    const nftActivities = await db.all('SELECT * FROM nft_activities');
    const webhookLogs = await db.all('SELECT * FROM webhook_logs');

    console.log(`\n📊 OTHER DATA TO CLEAN:`);
    console.log(`   - Trending payments: ${trendingPayments.length}`);
    console.log(`   - Pending payments: ${pendingPayments.length}`);
    console.log(`   - Footer ads: ${footerAds.length}`);
    console.log(`   - NFT activities: ${nftActivities.length}`);
    console.log(`   - Webhook logs: ${webhookLogs.length}`);

    console.log('\n🗑️  PERFORMING CLEANUP...\n');

    // Step 2: Delete user subscriptions for tokens to be deleted
    if (subscriptionsToDelete.length > 0) {
      const deleteSubscriptionsResult = await db.run(
        'DELETE FROM user_subscriptions WHERE token_id != ?',
        [realMongTokenId]
      );
      console.log(`✅ Deleted ${deleteSubscriptionsResult.changes} user subscriptions`);
    }

    // Step 3: Delete image fee payments for other contracts
    if (imageFeesToDelete.length > 0) {
      const deleteImageFeesResult = await db.run(
        'DELETE FROM image_fee_payments WHERE LOWER(contract_address) != LOWER(?)',
        [realMongContract]
      );
      console.log(`✅ Deleted ${deleteImageFeesResult.changes} image fee payments`);
    }

    // Step 4: Delete processed transactions for other contracts
    if (processedTxToDelete.length > 0) {
      const deleteTxResult = await db.run(
        'DELETE FROM processed_transactions WHERE LOWER(contract_address) != LOWER(?)',
        [realMongContract]
      );
      console.log(`✅ Deleted ${deleteTxResult.changes} processed transactions`);
    }

    // Step 5: Clean other tables
    if (trendingPayments.length > 0) {
      const deleteTrendingResult = await db.run('DELETE FROM trending_payments');
      console.log(`✅ Deleted ${deleteTrendingResult.changes} trending payments`);
    }

    if (pendingPayments.length > 0) {
      const deletePendingResult = await db.run('DELETE FROM pending_payments');
      console.log(`✅ Deleted ${deletePendingResult.changes} pending payments`);
    }

    if (footerAds.length > 0) {
      const deleteFooterResult = await db.run('DELETE FROM footer_ads');
      console.log(`✅ Deleted ${deleteFooterResult.changes} footer ads`);
    }

    if (nftActivities.length > 0) {
      const deleteActivitiesResult = await db.run('DELETE FROM nft_activities');
      console.log(`✅ Deleted ${deleteActivitiesResult.changes} NFT activities`);
    }

    if (webhookLogs.length > 0) {
      const deleteWebhookResult = await db.run('DELETE FROM webhook_logs');
      console.log(`✅ Deleted ${deleteWebhookResult.changes} webhook logs`);
    }

    // Step 6: Delete tracked tokens (must be done last due to foreign key constraints)
    if (tokensToDelete.length > 0) {
      const deleteTokensResult = await db.run(
        'DELETE FROM tracked_tokens WHERE id != ?',
        [realMongTokenId]
      );
      console.log(`✅ Deleted ${deleteTokensResult.changes} tracked tokens`);
    }

    console.log('\n🎉 DATABASE CLEANUP COMPLETED!\n');

    // Step 7: Verify what remains
    console.log('✅ VERIFICATION - REMAINING DATA:\n');

    const remainingTokens = await db.all('SELECT * FROM tracked_tokens');
    console.log(`📋 Remaining tokens: ${remainingTokens.length}`);
    remainingTokens.forEach(token => {
      console.log(`   ✅ ${token.contract_address} (${token.token_name})`);
    });

    const remainingSubscriptions = await db.all('SELECT * FROM user_subscriptions');
    console.log(`\n📬 Remaining subscriptions: ${remainingSubscriptions.length}`);
    remainingSubscriptions.forEach(sub => {
      console.log(`   ✅ Sub ${sub.id}: User ${sub.user_id} -> Token ${sub.token_id}`);
    });

    const remainingImageFees = await db.all('SELECT * FROM image_fee_payments');
    console.log(`\n🖼️  Remaining image fees: ${remainingImageFees.length}`);
    remainingImageFees.forEach(payment => {
      console.log(`   ✅ ${payment.contract_address} - ${require('ethers').formatEther(payment.payment_amount)} ETH`);
    });

    console.log('\n🎯 CLEANUP SUMMARY:');
    console.log('═'.repeat(40));
    console.log('✅ Real MONG contract preserved');
    console.log('✅ Image fee payment preserved');
    console.log('✅ User subscription preserved');
    console.log('✅ All test/duplicate data removed');
    console.log('✅ Database is now clean and ready for production');

  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

cleanupDatabase();