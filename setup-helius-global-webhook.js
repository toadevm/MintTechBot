#!/usr/bin/env node

/**
 * Setup Global Helius Webhook
 *
 * This script creates a single global webhook that monitors ALL Magic Eden NFT sales.
 * The webhook handler will filter events by collection based on what's tracked in the database.
 *
 * Benefits:
 * - Only uses 1 webhook slot instead of 1 per collection
 * - Works for all current and future Solana collections
 * - No need to create/delete webhooks when adding/removing collections
 */

require('dotenv').config();
const HeliusService = require('./src/blockchain/helius');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

function success(message) {
  log(colors.green, '✅', message);
}

function error(message) {
  log(colors.red, '❌', message);
}

function warning(message) {
  log(colors.yellow, '⚠️ ', message);
}

function info(message) {
  log(colors.cyan, 'ℹ️ ', message);
}

function header(message) {
  console.log(`\n${colors.bold}${colors.blue}${message}${colors.reset}`);
  console.log('═'.repeat(message.length));
}

async function setupGlobalWebhook() {
  header('🌟 Setting Up Global Helius Webhook');
  console.log();

  try {
    // Initialize Helius service
    info('Initializing Helius service...');
    const helius = new HeliusService();
    await helius.initialize();
    success('Helius service initialized');
    console.log();

    // Check for existing webhooks
    header('📋 Checking Existing Webhooks');
    console.log();
    const existingWebhooks = await helius.listWebhooks();

    const currentNgrokUrl = process.env.WEBHOOK_URL || 'https://245c814b2ebb.ngrok-free.app';
    const webhookEndpoint = `${currentNgrokUrl}/webhook/helius`;

    info(`Current webhook URL: ${webhookEndpoint}`);
    console.log();

    // Check if we already have a webhook pointing to current URL
    const existingGlobalWebhook = existingWebhooks.find(wh =>
      wh.webhookURL === webhookEndpoint &&
      wh.transactionTypes?.includes('NFT_SALE')
    );

    if (existingGlobalWebhook) {
      success('Global webhook already exists!');
      console.log(`   Webhook ID: ${existingGlobalWebhook.webhookID}`);
      console.log(`   URL: ${existingGlobalWebhook.webhookURL}`);
      console.log(`   Types: ${existingGlobalWebhook.transactionTypes?.join(', ')}`);
      console.log();
      info('No action needed - using existing webhook');
      return existingGlobalWebhook.webhookID;
    }

    // Create new global webhook
    header('🚀 Creating Global Webhook');
    console.log();
    info('Creating webhook for all Magic Eden NFT sales...');

    const result = await helius.createWebhook(
      webhookEndpoint,
      null,  // No specific addresses (monitors Magic Eden program by default)
      'Global Magic Eden Tracker'
    );

    if (result.success) {
      console.log();
      success('Global webhook created successfully! 🎉');
      console.log(`   Webhook ID: ${colors.cyan}${result.webhookId}${colors.reset}`);
      console.log(`   URL: ${colors.yellow}${result.webhookURL}${colors.reset}`);
      console.log(`   Monitoring: ${colors.magenta}All Magic Eden NFT sales${colors.reset}`);
      console.log();

      header('✨ Configuration Complete');
      console.log();
      success('Your bot will now receive notifications for ALL Magic Eden sales');
      info('The webhook handler filters events based on tracked collections');
      console.log();
      info('To add new Solana collections, simply use /addtoken in Telegram');
      info('No webhook management needed - it works automatically!');
      console.log();

      return result.webhookId;
    } else {
      throw new Error(result.error || 'Failed to create webhook');
    }

  } catch (err) {
    console.log();
    header('❌ SETUP FAILED');
    console.log();
    error(`Error: ${err.message}`);
    console.log();

    if (err.message.includes('webhook limit')) {
      warning('You have reached the Helius webhook limit');
      console.log();
      info('Solution: Delete old/unused webhooks first:');
      console.log(`   ${colors.cyan}node delete-old-helius-webhooks.js${colors.reset}`);
      console.log();
    }

    process.exit(1);
  }
}

// Run the setup
setupGlobalWebhook().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
