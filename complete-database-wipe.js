#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function completeDatabaseWipe() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n🔥 COMPLETE DATABASE WIPE - NUCLEAR RESET\n');
    console.log('═'.repeat(80));

    console.log('⚠️  WARNING: This will COMPLETELY ERASE ALL DATA!');
    console.log('• All users, subscriptions, and tokens will be removed');
    console.log('• All payment records will be deleted');
    console.log('• All OpenSea subscriptions will be cleared');
    console.log('• Auto-increment IDs will be reset to start from 1');
    console.log('• This creates a completely fresh database state');

    console.log('\n🚀 Starting complete nuclear reset...\n');

    // Get current statistics before wiping
    const stats = await getCurrentDatabaseStats(db);
    displayCurrentStats(stats);

    console.log('\n🗑️  PHASE 1: Removing all user data...');

    // Remove all user subscriptions first (foreign key constraints)
    await db.run('DELETE FROM user_subscriptions');
    console.log('   ✅ Deleted all user subscriptions');

    // Remove all users
    await db.run('DELETE FROM users');
    console.log('   ✅ Deleted all users');

    console.log('\n🗑️  PHASE 2: Removing all tokens and collections...');

    // Remove all tracked tokens (this will also clean up OpenSea data)
    await db.run('DELETE FROM tracked_tokens');
    console.log('   ✅ Deleted all tracked tokens');

    console.log('\n🗑️  PHASE 3: Removing all payment records...');

    // Remove all payment types
    await db.run('DELETE FROM image_fee_payments');
    console.log('   ✅ Deleted all image fee payments');

    await db.run('DELETE FROM footer_ads');
    console.log('   ✅ Deleted all footer advertisements');

    await db.run('DELETE FROM trending_payments');
    console.log('   ✅ Deleted all trending payments');

    console.log('\n🗑️  PHASE 4: Cleaning up system data...');

    // Clean up any other tables that might exist
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");

    for (const table of tables) {
      const tableName = table.name;

      // Skip already cleaned tables
      if (['users', 'user_subscriptions', 'tracked_tokens', 'image_fee_payments', 'footer_ads', 'trending_payments'].includes(tableName)) {
        continue;
      }

      try {
        await db.run(`DELETE FROM ${tableName}`);
        console.log(`   ✅ Cleared table: ${tableName}`);
      } catch (error) {
        console.log(`   ⚠️  Could not clear table ${tableName}: ${error.message}`);
      }
    }

    console.log('\n🔄 PHASE 5: Resetting auto-increment sequences...');

    // Reset auto-increment for all tables
    const resetTables = [
      'users', 'user_subscriptions', 'tracked_tokens',
      'image_fee_payments', 'footer_ads', 'trending_payments'
    ];

    for (const tableName of resetTables) {
      try {
        await db.run(`DELETE FROM sqlite_sequence WHERE name='${tableName}'`);
        console.log(`   ✅ Reset auto-increment for ${tableName}`);
      } catch (error) {
        // Table might not have auto-increment, that's OK
        console.log(`   ℹ️  No auto-increment to reset for ${tableName}`);
      }
    }

    // Run VACUUM to reclaim disk space and optimize database
    console.log('\n🧹 PHASE 6: Optimizing database...');
    await db.run('VACUUM');
    console.log('   ✅ Database optimized and disk space reclaimed');

    // Verify complete reset
    console.log('\n🔍 PHASE 7: Verification - checking database state...');
    const finalStats = await getCurrentDatabaseStats(db);

    console.log('\n📊 FINAL DATABASE STATE:');
    for (const [table, count] of Object.entries(finalStats)) {
      const status = count === 0 ? '✅' : '❌';
      console.log(`   ${status} ${table}: ${count} records`);
    }

    // Check if everything is actually clean
    const totalRecords = Object.values(finalStats).reduce((sum, count) => sum + count, 0);

    if (totalRecords === 0) {
      console.log('\n🎉 COMPLETE DATABASE WIPE SUCCESSFUL!');
      console.log('═'.repeat(60));
      console.log('✅ Database is completely empty and ready for fresh start');
      console.log('✅ All auto-increment IDs reset to start from 1');
      console.log('✅ Database optimized and disk space reclaimed');
      console.log('✅ No OpenSea subscriptions or mappings remain');
      console.log('✅ All user data and payment records eliminated');

      console.log('\n💡 NEXT STEPS:');
      console.log('1. Bot will start with completely clean state');
      console.log('2. Users must use /startcandy to register fresh');
      console.log('3. All tokens must be re-added from scratch');
      console.log('4. All payments must be made fresh');
      console.log('5. OpenSea subscriptions will be created when tokens are added');

    } else {
      console.log('\n⚠️  WARNING: Database wipe incomplete!');
      console.log(`${totalRecords} records still remain in database`);
      console.log('Manual cleanup may be required');
    }

  } catch (error) {
    console.error('❌ Error during database wipe:', error.message);
    console.error('Database may be in inconsistent state');
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

async function getCurrentDatabaseStats(db) {
  const stats = {};

  const tables = [
    'users', 'user_subscriptions', 'tracked_tokens',
    'image_fee_payments', 'footer_ads', 'trending_payments'
  ];

  for (const table of tables) {
    try {
      const result = await db.get(`SELECT COUNT(*) as count FROM ${table}`);
      stats[table] = result.count;
    } catch (error) {
      stats[table] = 0; // Table might not exist
    }
  }

  return stats;
}

function displayCurrentStats(stats) {
  console.log('📊 CURRENT DATABASE STATE:');
  let totalRecords = 0;

  for (const [table, count] of Object.entries(stats)) {
    console.log(`   - ${table}: ${count} records`);
    totalRecords += count;
  }

  console.log(`\n💾 TOTAL RECORDS TO DELETE: ${totalRecords}`);

  if (totalRecords === 0) {
    console.log('ℹ️  Database is already empty');
  }
}

completeDatabaseWipe();