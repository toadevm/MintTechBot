#!/usr/bin/env node

/**
 * Fix Private Chat IDs Migration Script
 *
 * This script updates user_subscriptions records where chat_id is "private"
 * to use the actual Telegram chat ID from the users table.
 *
 * This is necessary because:
 * 1. Telegram requires actual numeric chat IDs to send messages
 * 2. Previous implementation normalized private chats to "private" string
 * 3. This breaks notifications since "private" is not a valid Telegram chat ID
 */

require('dotenv').config();
const Database = require('./src/database/db');

async function fixPrivateChatIds() {
  console.log('🔧 Starting migration to fix private chat IDs...\n');

  const db = new Database();
  await db.initialize();

  try {
    // Find all subscriptions with 'private' chat_id
    const privateSubscriptions = await db.all(
      `SELECT us.id, us.user_id, us.chat_id, u.telegram_id
       FROM user_subscriptions us
       JOIN users u ON us.user_id = u.id
       WHERE us.chat_id = 'private'`
    );

    console.log(`📊 Found ${privateSubscriptions.length} subscriptions with 'private' chat_id\n`);

    if (privateSubscriptions.length === 0) {
      console.log('✅ No subscriptions to update - migration complete!');
      await db.close();
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const subscription of privateSubscriptions) {
      try {
        // Update chat_id from 'private' to actual telegram_id
        await db.run(
          `UPDATE user_subscriptions
           SET chat_id = $1
           WHERE id = $2`,
          [subscription.telegram_id, subscription.id]
        );

        console.log(`✅ Updated subscription ${subscription.id}: 'private' → ${subscription.telegram_id}`);
        updated++;
      } catch (error) {
        console.error(`❌ Failed to update subscription ${subscription.id}:`, error.message);
        failed++;
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📝 Total: ${privateSubscriptions.length}\n`);

    console.log('🎉 Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run the migration
fixPrivateChatIds().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
