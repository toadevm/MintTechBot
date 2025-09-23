#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function fixTokenSubscriptions() {
  let db;

  try {
    // Initialize database
    db = new Database();
    await db.initialize();

    console.log('\n🔧 FIXING TOKEN SUBSCRIPTION INCONSISTENCIES\n');
    console.log('═'.repeat(60));

    // Step 1: Find tokens without any subscriptions
    const orphanedTokens = await db.all(`
      SELECT tt.*
      FROM tracked_tokens tt
      LEFT JOIN user_subscriptions us ON tt.id = us.token_id
      WHERE tt.is_active = 1 AND us.token_id IS NULL
    `);

    console.log(`\n🔍 ORPHANED TOKENS (active tokens with no subscriptions): ${orphanedTokens.length}`);
    if (orphanedTokens.length > 0) {
      orphanedTokens.forEach(token => {
        console.log(`   - ID ${token.id}: ${token.contract_address} (${token.token_name || 'Unknown'})`);
      });

      // Deactivate orphaned tokens
      for (const token of orphanedTokens) {
        await db.run('UPDATE tracked_tokens SET is_active = 0 WHERE id = ?', [token.id]);
        console.log(`   ✅ Deactivated token ${token.contract_address}`);
      }
    }

    // Step 2: Find subscriptions pointing to non-existent tokens
    const orphanedSubscriptions = await db.all(`
      SELECT us.*
      FROM user_subscriptions us
      LEFT JOIN tracked_tokens tt ON us.token_id = tt.id
      WHERE tt.id IS NULL
    `);

    console.log(`\n🔍 ORPHANED SUBSCRIPTIONS (subscriptions to deleted tokens): ${orphanedSubscriptions.length}`);
    if (orphanedSubscriptions.length > 0) {
      orphanedSubscriptions.forEach(sub => {
        console.log(`   - Sub ID ${sub.id}: User ${sub.user_id} -> Token ${sub.token_id} (missing)`);
      });

      // Remove orphaned subscriptions
      for (const sub of orphanedSubscriptions) {
        await db.run('DELETE FROM user_subscriptions WHERE id = ?', [sub.id]);
        console.log(`   ✅ Removed orphaned subscription ${sub.id}`);
      }
    }

    // Step 3: Find tokens that should have subscriptions but don't (like MONGS case)
    const tokensWithoutUserSubscriptions = await db.all(`
      SELECT tt.*, COUNT(us.id) as subscription_count
      FROM tracked_tokens tt
      LEFT JOIN user_subscriptions us ON tt.id = us.token_id
      WHERE tt.is_active = 1
      GROUP BY tt.id
      HAVING subscription_count = 0
    `);

    console.log(`\n🔍 ACTIVE TOKENS WITHOUT SUBSCRIPTIONS: ${tokensWithoutUserSubscriptions.length}`);
    if (tokensWithoutUserSubscriptions.length > 0) {
      tokensWithoutUserSubscriptions.forEach(token => {
        console.log(`   - ID ${token.id}: ${token.contract_address} (${token.token_name || 'Unknown'})`);
        console.log(`     This might be the source of "NFT not found" errors in removal`);
      });
    }

    // Step 4: Summary and recommendations
    console.log('\n🎯 CLEANUP SUMMARY:');
    console.log('═'.repeat(40));
    console.log(`✅ Deactivated orphaned tokens: ${orphanedTokens.length}`);
    console.log(`✅ Removed orphaned subscriptions: ${orphanedSubscriptions.length}`);

    if (tokensWithoutUserSubscriptions.length > 0) {
      console.log(`\n⚠️  WARNING: ${tokensWithoutUserSubscriptions.length} active tokens have no subscriptions`);
      console.log('   These tokens may cause "NFT not found" errors when users try to remove them.');
      console.log('   The updated handleRemoveToken() function should now handle these gracefully.');
    } else {
      console.log('✅ All active tokens have proper subscriptions');
    }

    console.log('\n🎉 DATA CONSISTENCY CHECK COMPLETED!');

  } catch (error) {
    console.error('❌ Error fixing token subscriptions:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

fixTokenSubscriptions();