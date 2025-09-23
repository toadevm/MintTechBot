#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function debugOpenSeaMapping() {
  let db;

  try {
    // Initialize database
    db = new Database();
    await db.initialize();

    console.log('\n🔍 OPENSEA MAPPING DEBUG\n');
    console.log('═'.repeat(60));

    const realMongContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';
    const problemContract = '0x1f8731e2BFcF95c114523D74a40E7bB4E1a16282';

    // Check the real MONG contract details
    const mongToken = await db.get('SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)', [realMongContract]);

    if (mongToken) {
      console.log(`✅ REAL MONG CONTRACT DETAILS:`);
      console.log(`   📍 Address: ${mongToken.contract_address}`);
      console.log(`   🏷️  Name: ${mongToken.token_name}`);
      console.log(`   💰 Symbol: ${mongToken.token_symbol}`);
      console.log(`   🌊 Collection Slug: ${mongToken.collection_slug || 'NOT SET'}`);
      console.log(`   🔗 OpenSea Sub ID: ${mongToken.opensea_subscription_id || 'NOT SET'}`);
      console.log(`   ⛓️  Chain: ${mongToken.chain_name}`);
      console.log(`   🆔 Chain ID: ${mongToken.chain_id}`);
      console.log('');

      // If there's a collection slug, let's see what other contracts might use it
      if (mongToken.collection_slug) {
        console.log(`🔍 CHECKING FOR OTHER CONTRACTS WITH SAME COLLECTION SLUG: ${mongToken.collection_slug}`);
        console.log('═'.repeat(50));

        // This is the issue - we need to check if this slug maps to multiple contracts
        console.log(`⚠️  The collection slug "${mongToken.collection_slug}" might be shared between multiple contracts.`);
        console.log(`⚠️  This could explain why you're getting notifications for ${problemContract}`);
        console.log(`⚠️  Both contracts might be part of the same OpenSea collection.`);
        console.log('');

        console.log(`🔧 SOLUTION: We need to check OpenSea API to see what contracts are in this collection.`);
        console.log(`🔧 Or we might need to unsubscribe from this collection and create a contract-specific subscription.`);
      }
    } else {
      console.log('❌ Real MONG contract not found in database!');
    }

    // Check if there are any webhook logs or activities related to the problem contract
    const activities = await db.all('SELECT * FROM nft_activities WHERE LOWER(contract_address) = LOWER(?) LIMIT 5', [problemContract]);
    if (activities.length > 0) {
      console.log(`\n⚠️  FOUND ${activities.length} ACTIVITIES FOR PROBLEM CONTRACT:`);
      console.log('═'.repeat(50));
      activities.forEach((activity, index) => {
        console.log(`${index + 1}. Type: ${activity.activity_type}`);
        console.log(`   Contract: ${activity.contract_address}`);
        console.log(`   Token ID: ${activity.token_id}`);
        console.log(`   Created: ${activity.created_at}`);
        console.log('');
      });
    }

    // Check webhook logs for the problem contract
    const webhookLogs = await db.all('SELECT * FROM webhook_logs WHERE payload LIKE ? LIMIT 3', [`%${problemContract}%`]);
    if (webhookLogs.length > 0) {
      console.log(`\n📡 FOUND ${webhookLogs.length} WEBHOOK LOGS FOR PROBLEM CONTRACT:`);
      console.log('═'.repeat(50));
      webhookLogs.forEach((log, index) => {
        console.log(`${index + 1}. Type: ${log.webhook_type}`);
        console.log(`   Processed: ${log.processed}`);
        console.log(`   Created: ${log.created_at}`);
        console.log(`   Error: ${log.error_message || 'None'}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error debugging OpenSea mapping:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

debugOpenSeaMapping();