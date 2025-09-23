#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function debugMongsIssue() {
  let db;

  try {
    // Initialize database
    db = new Database();
    await db.initialize();

    console.log('\n🔍 DEBUGGING MONGS TOKEN REMOVAL ISSUE\n');
    console.log('═'.repeat(60));

    const testUserId = '7009068937'; // Based on user logs, this seems to be the user ID
    const chatId = 'private';
    const mongolContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';

    console.log(`🔍 USER INFO:`);
    console.log(`   User ID: ${testUserId}`);
    console.log(`   Chat ID: ${chatId}`);
    console.log(`   MONGS Contract: ${mongolContract}`);
    console.log('');

    // Check if user exists
    const user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [testUserId]);
    if (user) {
      console.log(`✅ USER EXISTS: ID ${user.id}, Telegram ID ${user.telegram_id}`);
    } else {
      console.log(`❌ USER NOT FOUND for Telegram ID ${testUserId}`);
    }

    // Find the MONGS token
    const mongToken = await db.get('SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)', [mongolContract]);
    if (mongToken) {
      console.log(`✅ MONGS TOKEN EXISTS: ID ${mongToken.id}, Name: ${mongToken.token_name}`);
      console.log(`   Contract: ${mongToken.contract_address}`);
      console.log(`   Active: ${mongToken.is_active}`);
      console.log(`   Chain: ${mongToken.chain_name}`);
    } else {
      console.log(`❌ MONGS TOKEN NOT FOUND`);
      return;
    }

    if (!user) {
      console.log('\n❌ Cannot check subscriptions without user');
      return;
    }

    // Check for subscription
    const subscription = await db.get(
      'SELECT * FROM user_subscriptions WHERE user_id = ? AND token_id = ? AND chat_id = ?',
      [user.id, mongToken.id, chatId]
    );

    if (subscription) {
      console.log(`✅ SUBSCRIPTION EXISTS: ID ${subscription.id}`);
      console.log(`   User ID: ${subscription.user_id}`);
      console.log(`   Token ID: ${subscription.token_id}`);
      console.log(`   Chat ID: ${subscription.chat_id}`);
      console.log(`   Notifications: ${subscription.notification_enabled}`);
    } else {
      console.log(`❌ NO SUBSCRIPTION FOUND for user ${user.id}, token ${mongToken.id}, chat ${chatId}`);
    }

    // Check for ANY subscriptions for this user and token
    const anySubscriptions = await db.all(
      'SELECT * FROM user_subscriptions WHERE user_id = ? AND token_id = ?',
      [user.id, mongToken.id]
    );

    console.log(`\n🔍 ALL SUBSCRIPTIONS for user ${user.id} and token ${mongToken.id}: ${anySubscriptions.length}`);
    anySubscriptions.forEach(sub => {
      console.log(`   - Sub ID ${sub.id}: Chat ${sub.chat_id}, Notifications: ${sub.notification_enabled}`);
    });

    // Check what getUserTrackedTokens returns
    console.log(`\n🔍 TESTING getUserTrackedTokens(${user.id}, ${chatId}):`);
    const trackedTokens = await db.getUserTrackedTokens(user.id, chatId);
    console.log(`   Returns ${trackedTokens.length} tokens:`);
    trackedTokens.forEach(token => {
      console.log(`   - ID ${token.id}: ${token.token_name} (${token.contract_address})`);
    });

    // Show what would happen with the remove logic
    console.log(`\n🔧 SIMULATING REMOVE LOGIC:`);
    if (!subscription) {
      console.log(`   ❌ No subscription in chat context ${chatId}`);
      if (anySubscriptions.length === 0) {
        console.log(`   ✅ No subscriptions anywhere - would deactivate token`);
      } else {
        console.log(`   ⚠️  Has ${anySubscriptions.length} subscriptions in other chats - would show error`);
      }
    } else {
      console.log(`   ✅ Would remove subscription normally`);
    }

  } catch (error) {
    console.error('❌ Error debugging MONGS issue:', error.message);
    console.error(error.stack);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

debugMongsIssue();