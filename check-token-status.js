#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function checkTokenStatus() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n📊 FINAL TOKEN STATUS AFTER CLEANUP\n');
    console.log('═'.repeat(70));

    // Check all tracked tokens with detailed info
    const tokens = await db.all(`
      SELECT
        id,
        contract_address,
        token_name,
        token_symbol,
        is_active,
        added_by_user_id,
        collection_slug,
        chain_name
      FROM tracked_tokens
      ORDER BY is_active DESC, id ASC
    `);

    console.log(`📋 ALL TRACKED TOKENS (${tokens.length} total):\n`);

    const activeTokens = tokens.filter(t => t.is_active === 1);
    const inactiveTokens = tokens.filter(t => t.is_active !== 1);

    if (activeTokens.length > 0) {
      console.log(`✅ ACTIVE TOKENS (${activeTokens.length} available for new users):`);
      activeTokens.forEach((token, i) => {
        console.log(`   ${i + 1}. ${token.token_name || 'Unknown Collection'}`);
        console.log(`      📮 Contract: ${token.contract_address}`);
        console.log(`      🔗 Collection: ${token.collection_slug || 'N/A'}`);
        console.log(`      ⛓️  Chain: ${token.chain_name || 'ethereum'}`);
        console.log(`      👤 Owner: ${token.added_by_user_id ? `User ${token.added_by_user_id}` : 'Available for claiming'}`);
        console.log('');
      });
    }

    if (inactiveTokens.length > 0) {
      console.log(`❌ INACTIVE TOKENS (${inactiveTokens.length}):`);
      inactiveTokens.forEach((token, i) => {
        console.log(`   ${i + 1}. ${token.token_name || 'Unknown Collection'} - ${token.contract_address}`);
      });
      console.log('');
    }

    // Check payment records
    const imagePayments = await db.all('SELECT COUNT(*) as count FROM image_fee_payments');
    const footerAds = await db.all('SELECT COUNT(*) as count FROM footer_ads');
    const trendingPayments = await db.all('SELECT COUNT(*) as count FROM trending_payments');

    console.log('💰 PAYMENT RECORDS STATUS:');
    console.log(`   - Image Fee Payments: ${imagePayments[0].count}`);
    console.log(`   - Footer Ads: ${footerAds[0].count}`);
    console.log(`   - Trending Payments: ${trendingPayments[0].count}`);

    console.log('\n🎯 NEXT STEPS FOR NEW USERS:');
    console.log('1. Use /startcandy to register fresh');
    console.log('2. Use /add_token to subscribe to existing collections');
    console.log('3. Pay for premium features (image display, trending, etc.)');
    console.log('4. Enjoy clean, fresh NFT tracking experience!');

  } catch (error) {
    console.error('❌ Error checking token status:', error.message);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

checkTokenStatus();