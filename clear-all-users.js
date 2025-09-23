#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function clearAllUsersAndSubscriptions() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n🧹 CLEARING ALL USERS AND SUBSCRIPTIONS FROM DATABASE\n');
    console.log('═'.repeat(70));

    // First, get current statistics
    const users = await db.all('SELECT * FROM users');
    const subscriptions = await db.all('SELECT * FROM user_subscriptions');
    const tokens = await db.all('SELECT * FROM tracked_tokens WHERE is_active = 1');

    console.log('📊 CURRENT DATABASE STATUS:');
    console.log(`   - Users: ${users.length}`);
    console.log(`   - Subscriptions: ${subscriptions.length}`);
    console.log(`   - Active Tokens: ${tokens.length}`);

    if (users.length > 0) {
      console.log('\n👥 USERS TO BE REMOVED:');
      users.forEach(user => {
        console.log(`   - ID: ${user.id}, Telegram ID: ${user.telegram_id}, Username: ${user.username || 'N/A'}`);
      });
    }

    if (subscriptions.length > 0) {
      console.log('\n📋 SUBSCRIPTIONS TO BE REMOVED:');
      subscriptions.forEach(sub => {
        console.log(`   - Sub ID: ${sub.id}, User: ${sub.user_id}, Token: ${sub.token_id}, Chat: ${sub.chat_id}`);
      });
    }

    console.log('\n⚠️  WARNING: This will completely reset the user database!');
    console.log('All users will need to re-register and re-subscribe to tokens.');
    console.log('\n🔥 STARTING CLEANUP...\n');

    // Step 1: Remove all user subscriptions
    console.log('🗑️  Step 1: Removing all user subscriptions...');
    const subscriptionsDeleted = await db.run('DELETE FROM user_subscriptions');
    console.log(`✅ Deleted ${subscriptionsDeleted.changes || subscriptions.length} subscriptions`);

    // Step 2: Remove all users
    console.log('\n🗑️  Step 2: Removing all users...');
    const usersDeleted = await db.run('DELETE FROM users');
    console.log(`✅ Deleted ${usersDeleted.changes || users.length} users`);

    // Step 3: Keep tracked tokens but they'll have no subscriptions
    console.log('\n📝 Step 3: Keeping tracked tokens for future use...');
    console.log(`✅ ${tokens.length} tokens remain available for new users to subscribe to`);

    // Step 4: Clean up any orphaned data
    console.log('\n🧹 Step 4: Cleaning up any orphaned payment records...');

    // Remove image fee payments (since users are gone)
    const imagePayments = await db.all('SELECT * FROM image_fee_payments');
    if (imagePayments.length > 0) {
      await db.run('DELETE FROM image_fee_payments');
      console.log(`✅ Removed ${imagePayments.length} image fee payment records`);
    }

    // Remove footer ads (since users are gone)
    const footerAds = await db.all('SELECT * FROM footer_ads');
    if (footerAds.length > 0) {
      await db.run('DELETE FROM footer_ads');
      console.log(`✅ Removed ${footerAds.length} footer ad records`);
    }

    // Remove trending payments (since users are gone)
    const trendingPayments = await db.all('SELECT * FROM trending_payments');
    if (trendingPayments.length > 0) {
      await db.run('DELETE FROM trending_payments');
      console.log(`✅ Removed ${trendingPayments.length} trending payment records`);
    }

    // Step 5: Reset token ownership (set added_by_user_id to NULL)
    console.log('\n🔄 Step 5: Resetting token ownership...');
    await db.run('UPDATE tracked_tokens SET added_by_user_id = NULL WHERE added_by_user_id IS NOT NULL');
    console.log(`✅ Reset ownership for all tokens - they can now be claimed by new users`);

    // Final verification
    console.log('\n🔍 VERIFICATION - Final database state:');
    const finalUsers = await db.all('SELECT COUNT(*) as count FROM users');
    const finalSubscriptions = await db.all('SELECT COUNT(*) as count FROM user_subscriptions');
    const finalTokens = await db.all('SELECT COUNT(*) as count FROM tracked_tokens WHERE is_active = 1');
    const finalImagePayments = await db.all('SELECT COUNT(*) as count FROM image_fee_payments');
    const finalFooterAds = await db.all('SELECT COUNT(*) as count FROM footer_ads');

    console.log(`   ✅ Users: ${finalUsers[0].count} (should be 0)`);
    console.log(`   ✅ Subscriptions: ${finalSubscriptions[0].count} (should be 0)`);
    console.log(`   ✅ Active Tokens: ${finalTokens[0].count} (preserved)`);
    console.log(`   ✅ Image Payments: ${finalImagePayments[0].count} (should be 0)`);
    console.log(`   ✅ Footer Ads: ${finalFooterAds[0].count} (should be 0)`);

    console.log('\n🎉 DATABASE CLEANUP COMPLETED SUCCESSFULLY!');
    console.log('═'.repeat(50));
    console.log('✅ All users, subscriptions, and payment records cleared');
    console.log('✅ Tracked tokens preserved and available');
    console.log('✅ Database ready for fresh user registrations');
    console.log('✅ Users can now start from scratch with /startminty');

    console.log('\n💡 WHAT HAPPENS NEXT:');
    console.log('• New users will register fresh when they use /startminty');
    console.log('• Existing tokens remain available for new subscriptions');
    console.log('• All payment records are reset - users need to pay again for features');
    console.log('• OpenSea subscriptions remain active for continued tracking');

  } catch (error) {
    console.error('❌ Error clearing database:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

clearAllUsersAndSubscriptions();