#!/usr/bin/env node
require('dotenv').config();

async function cleanupOpenSeaSubscriptions() {
  console.log('\n🌊 OPENSEA SUBSCRIPTION CLEANUP\n');
  console.log('═'.repeat(60));

  try {
    // Import OpenSea streaming service
    const OpenSeaStreamService = require('./src/services/openSeaStreamService');
    const Database = require('./src/database/db');

    // Initialize database to check current state
    const db = new Database();
    await db.initialize();

    // Check if there are any tracked tokens
    const tokens = await db.all('SELECT * FROM tracked_tokens WHERE is_active = 1');
    console.log(`📊 Current tracked tokens in database: ${tokens.length}`);

    if (tokens.length > 0) {
      console.log('⚠️  WARNING: Found active tokens in database:');
      tokens.forEach(token => {
        console.log(`   - ${token.token_name || 'Unknown'} (${token.contract_address})`);
      });
      console.log('\nThese should have been removed by database wipe. Something went wrong.');
    } else {
      console.log('✅ Database is clean - no tracked tokens found');
    }

    await db.close();

    console.log('\n🔄 ATTEMPTING OPENSEA STREAM CLEANUP...');

    // Initialize OpenSea Stream service
    const openSeaService = new OpenSeaStreamService();

    // Check if there's a disconnect method or way to clean up
    if (typeof openSeaService.disconnect === 'function') {
      console.log('📡 Disconnecting from OpenSea Stream...');
      await openSeaService.disconnect();
      console.log('✅ OpenSea Stream disconnected');
    } else {
      console.log('ℹ️  No disconnect method found on OpenSea service');
    }

    // Check if there's a way to clear subscriptions
    if (typeof openSeaService.clearAllSubscriptions === 'function') {
      console.log('🗑️  Clearing all OpenSea subscriptions...');
      await openSeaService.clearAllSubscriptions();
      console.log('✅ All OpenSea subscriptions cleared');
    } else {
      console.log('ℹ️  No clearAllSubscriptions method found');
    }

    console.log('\n🧹 CLEANUP COMPLETED');
    console.log('═'.repeat(40));
    console.log('✅ OpenSea cleanup process finished');
    console.log('⚠️  Note: Some subscriptions may persist until bot restart');
    console.log('💡 Recommendation: Completely restart the bot process');

  } catch (error) {
    console.error('❌ Error during OpenSea cleanup:', error.message);
    console.log('\n🔍 TROUBLESHOOTING:');
    console.log('1. Check if OpenSea service is running');
    console.log('2. Verify environment variables are correct');
    console.log('3. Consider manual bot restart');
  }
}

cleanupOpenSeaSubscriptions();