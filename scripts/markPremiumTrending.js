#!/usr/bin/env node
/**
 * Dev Script: Mark Token as Premium Trending
 *
 * Usage:
 *   node scripts/markPremiumTrending.js <contract_address> [group_link]
 *
 * Examples:
 *   node scripts/markPremiumTrending.js 0x1234abcd...
 *   node scripts/markPremiumTrending.js 0x1234abcd... https://t.me/testgroup
 *   node scripts/markPremiumTrending.js 0x1234abcd... @testgroup
 */

// Load environment variables
require('dotenv').config();

const Database = require('../src/database/db');
const logger = require('../src/services/logger');

// Helper function to extract username from various link formats
function parseGroupLink(input) {
  if (!input) return { link: null, username: null };

  let link = input.trim();
  let username = null;

  // If starts with @, convert to t.me link
  if (link.startsWith('@')) {
    username = link.slice(1);
    link = `https://t.me/${username}`;
  }
  // If it's a full t.me link, extract username
  else if (link.includes('t.me/')) {
    const match = link.match(/t\.me\/([^/?]+)/);
    username = match ? match[1] : null;
  }
  // If it's just plain text (username without @)
  else if (!link.startsWith('http')) {
    username = link;
    link = `https://t.me/${username}`;
  }

  return { link, username };
}

async function main() {
  // Parse command line arguments
  const contractAddress = process.argv[2];
  const groupLinkInput = process.argv[3] || null;

  // Validate contract address
  if (!contractAddress) {
    console.error('❌ Error: Contract address is required');
    console.log('\nUsage: node scripts/markPremiumTrending.js <contract_address> [group_link]');
    console.log('\nExamples:');
    console.log('  node scripts/markPremiumTrending.js 0x1234abcd...');
    console.log('  node scripts/markPremiumTrending.js 0x1234abcd... https://t.me/testgroup');
    console.log('  node scripts/markPremiumTrending.js 0x1234abcd... @testgroup');
    process.exit(1);
  }

  // Validate contract address format
  if (!contractAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    console.error('❌ Error: Invalid Ethereum contract address format');
    console.log('Expected format: 0x followed by 40 hexadecimal characters');
    process.exit(1);
  }

  // Parse group link
  const { link: groupLink, username: groupUsername } = parseGroupLink(groupLinkInput);

  console.log('\n🚀 Dev Script: Mark Token as Premium Trending\n');
  console.log(`📝 Contract Address: ${contractAddress}`);
  if (groupLink) {
    console.log(`🔗 Group Link: ${groupLink}`);
    console.log(`👤 Username: @${groupUsername}`);
  } else {
    console.log(`🔗 Group Link: None (will not appear in notifications)`);
  }
  console.log('⏱️  Duration: 24 hours');
  console.log('⭐ Tier: PREMIUM\n');

  // Connect to database
  const db = new Database();

  try {
    await db.initialize();
    console.log('✅ Database connected\n');

    // Find the token by contract address
    console.log('🔍 Looking for tracked token...');
    const token = await db.query(
      `SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER($1) LIMIT 1`,
      [contractAddress]
    );

    if (!token.rows || token.rows.length === 0) {
      console.error('❌ Error: Token not found in database');
      console.log('\nThis token is not being tracked. Please add it to a group first using /start');
      process.exit(1);
    }

    const tokenData = token.rows[0];
    console.log(`✅ Found token: ${tokenData.token_name || 'Unknown'} (${tokenData.token_symbol || 'N/A'})`);
    console.log(`   Chain: ${tokenData.chain_name}`);
    console.log(`   Token ID: ${tokenData.id}\n`);

    // Check if token already has active trending
    const existingTrending = await db.query(
      `SELECT * FROM trending_payments
       WHERE token_id = $1 AND is_active = true AND end_time > NOW()`,
      [tokenData.id]
    );

    if (existingTrending.rows && existingTrending.rows.length > 0) {
      console.log('⚠️  Warning: Token already has an active trending payment');
      const existing = existingTrending.rows[0];
      console.log(`   Tier: ${existing.tier}`);
      console.log(`   Expires: ${new Date(existing.end_time).toLocaleString()}\n`);
      console.log('Creating new entry anyway (for testing)...\n');
    }

    // Create premium trending payment
    console.log('💎 Creating premium trending payment...');

    const userId = 1; // System user for dev scripts
    const paymentAmount = '0.01'; // Placeholder amount
    const transactionHash = `dev_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const payerAddress = '0xDEVELOPMENT';
    const durationHours = 24;
    const tier = 'premium';

    const result = await db.addTrendingPayment(
      userId,
      tokenData.id,
      paymentAmount,
      transactionHash,
      durationHours,
      payerAddress,
      tier,
      groupLink,
      groupUsername
    );

    if (result && result.id) {
      console.log(`✅ Success! Trending payment created (ID: ${result.id})\n`);
      console.log('📊 Summary:');
      console.log(`   Token: ${tokenData.token_symbol || tokenData.token_name || contractAddress}`);
      console.log(`   Tier: ⭐ PREMIUM`);
      console.log(`   Duration: 24 hours`);
      console.log(`   Expires: ${new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString()}`);
      if (groupLink) {
        console.log(`   Group Link: ${groupLink}`);
      }
      console.log(`   Status: ✅ Active & Validated\n`);
      console.log('🎯 This token will now:');
      console.log('   • Appear in premium trending channels');
      console.log('   • Show ⭐ PREMIUM badge in broadcasts');
      if (groupLink) {
        console.log(`   • Display clickable ticker link: 💬 $${tokenData.token_symbol || 'TOKEN'}`);
      }
      console.log('\n✨ Ready for testing!\n');
    } else {
      console.error('❌ Error: Failed to create trending payment');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    logger.error('Dev script error:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
