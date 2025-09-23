#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function fixOpenSeaIssue() {
  let db;

  try {
    // Initialize database
    db = new Database();
    await db.initialize();

    console.log('\n🔧 FIXING OPENSEA COLLECTION ISSUE\n');
    console.log('═'.repeat(60));

    const problemContract = '0x1f8731e2BFcF95c114523D74a40E7bB4E1a16282';

    // Remove all activities for the problem contract
    const deleteActivities = await db.run(
      'DELETE FROM nft_activities WHERE LOWER(contract_address) = LOWER(?)',
      [problemContract]
    );

    console.log(`✅ Deleted ${deleteActivities.changes} activities for problem contract`);

    // Remove any webhook logs for the problem contract
    const deleteWebhooks = await db.run(
      'DELETE FROM webhook_logs WHERE payload LIKE ?',
      [`%${problemContract}%`]
    );

    console.log(`✅ Deleted ${deleteWebhooks.changes} webhook logs for problem contract`);

    console.log('\n🎯 SOLUTION IMPLEMENTED:');
    console.log('═'.repeat(40));
    console.log('✅ Cleaned up all traces of problem contract from database');
    console.log('✅ The bot will now filter notifications to only show your tracked contracts');
    console.log('');
    console.log('📝 NOTE: Both contracts are in the same OpenSea collection "guardians-of-imagination"');
    console.log('📝 The bot will continue to receive OpenSea events for both contracts,');
    console.log('📝 but will only process/notify for contracts you have actually tracked.');
    console.log('');
    console.log('✨ Your real MONG contract notifications will work properly!');

  } catch (error) {
    console.error('❌ Error fixing OpenSea issue:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

fixOpenSeaIssue();