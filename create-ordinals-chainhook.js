#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');

async function createOrdinalsChainHook() {
  const apiKey = process.env.HIRO_API_KEY;
  const webhookUrl = process.env.HIRO_WEBHOOK_URL;
  const webhookSecret = process.env.HIRO_WEBHOOK_SECRET;

  console.log('\n' + '━'.repeat(70));
  console.log('🔧 Creating Bitcoin Ordinals Chainhook via Hiro Platform API');
  console.log('━'.repeat(70) + '\n');

  // Validation
  if (!apiKey) {
    console.error('❌ HIRO_API_KEY not found in .env');
    console.error('   Add: HIRO_API_KEY=your_key_here');
    process.exit(1);
  }

  if (!webhookUrl) {
    console.error('❌ HIRO_WEBHOOK_URL not found in .env');
    console.error('   Add: HIRO_WEBHOOK_URL=https://your-domain.com/webhooks/hiro/ordinals');
    process.exit(1);
  }

  if (!webhookSecret) {
    console.error('❌ HIRO_WEBHOOK_SECRET not found in .env');
    console.error('   Add: HIRO_WEBHOOK_SECRET=your_random_secret_32_chars');
    process.exit(1);
  }

  console.log('📋 Configuration:');
  console.log('   API Key:', apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4));
  console.log('   Webhook URL:', webhookUrl);
  console.log('   Webhook Secret:', '***' + webhookSecret.substring(webhookSecret.length - 8));
  console.log('');

  // Get current Bitcoin block height
  let currentBlock;
  try {
    console.log('📊 Fetching current Bitcoin block height...');
    const blockResponse = await axios.get('https://blockstream.info/api/blocks/tip/height');
    currentBlock = blockResponse.data;
    console.log(`   Current block: ${currentBlock}`);
    console.log(`   Starting from: ${currentBlock - 10} (10 blocks ago for safety)\n`);
  } catch (error) {
    console.warn('⚠️  Could not fetch current block, using default 820000');
    currentBlock = 820010;
  }

  const predicate = {
    chain: 'bitcoin',
    name: 'Bitcoin Ordinals Feed - CandyRush Bot',
    version: 1,
    networks: {
      mainnet: {
        if_this: {
          scope: 'ordinals_protocol',
          operation: 'inscription_feed'
        },
        then_that: {
          http_post: {
            url: webhookUrl,
            authorization_header: `Bearer ${webhookSecret}`
          }
        },
        start_block: currentBlock - 10
      }
    }
  };

  console.log('📤 Sending request to Hiro Platform API...');
  console.log('   Endpoint: https://api.platform.hiro.so/v1/chainhooks');
  console.log('');

  try {
    const response = await axios.post(
      'https://api.platform.hiro.so/v1/chainhooks',
      predicate,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('━'.repeat(70));
    console.log('✅ SUCCESS! Chainhook Created Successfully!');
    console.log('━'.repeat(70) + '\n');

    console.log('📝 Chainhook Details:');
    console.log('   UUID:', response.data.uuid || response.data.id);
    console.log('   Name:', response.data.name);
    console.log('   Chain:', response.data.chain);
    console.log('   Network:', 'mainnet');
    console.log('   Status:', response.data.enabled !== false ? '🟢 Enabled' : '🔴 Disabled');
    console.log('   Created:', new Date().toLocaleString());

    console.log('\n📋 Configuration:');
    console.log('   Scope:', 'ordinals_protocol');
    console.log('   Operation:', 'inscription_feed');
    console.log('   Start Block:', currentBlock - 10);
    console.log('   Webhook:', webhookUrl);

    console.log('\n' + '━'.repeat(70));
    console.log('🎉 Setup Complete!');
    console.log('━'.repeat(70));

    console.log('\n📝 Next Steps:');
    console.log('   1. Add this to your .env file:');
    console.log(`      HIRO_CHAINHOOK_UUID=${response.data.uuid || response.data.id}`);
    console.log('');
    console.log('   2. Your bot will now receive Bitcoin Ordinals webhooks in real-time!');
    console.log('');
    console.log('   3. View in Hiro dashboard:');
    console.log('      https://platform.hiro.so/chainhooks');
    console.log('');
    console.log('   4. Monitor webhook calls:');
    console.log('      Check your bot console for incoming webhook logs');
    console.log('');
    console.log('✅ All done! Your Ordinals tracking is now LIVE!');
    console.log('');

  } catch (error) {
    console.log('━'.repeat(70));
    console.error('❌ ERROR: Failed to Create Chainhook');
    console.log('━'.repeat(70) + '\n');

    if (error.response) {
      console.error('📊 Response Details:');
      console.error('   Status Code:', error.response.status);
      console.error('   Status Text:', error.response.statusText);
      console.error('');
      console.error('📄 Error Response:');
      console.error(JSON.stringify(error.response.data, null, 2));
      console.error('');

      if (error.response.status === 401 || error.response.status === 403) {
        console.error('💡 Authentication Error:');
        console.error('   - Check your HIRO_API_KEY is correct');
        console.error('   - Verify the API key has Chainhook permissions');
        console.error('   - Get a new API key from: https://platform.hiro.so/settings/api-keys');
      } else if (error.response.status === 400) {
        console.error('💡 Bad Request:');
        console.error('   - Check your webhook URL is valid');
        console.error('   - Ensure webhook URL is publicly accessible');
        console.error('   - Test with: curl -I ' + webhookUrl);
      } else if (error.response.status === 409) {
        console.error('💡 Conflict Error:');
        console.error('   - A chainhook with this configuration may already exist');
        console.error('   - Check your dashboard: https://platform.hiro.so/chainhooks');
        console.error('   - Delete existing chainhook or use different name');
      } else if (error.response.status === 429) {
        console.error('💡 Rate Limit:');
        console.error('   - Too many requests, wait a minute and try again');
      } else if (error.response.status >= 500) {
        console.error('💡 Server Error:');
        console.error('   - Hiro Platform may be experiencing issues');
        console.error('   - Check status: https://status.hiro.so/');
        console.error('   - Try again in a few minutes');
      }
    } else if (error.code === 'ECONNABORTED') {
      console.error('💡 Timeout Error:');
      console.error('   - Request timed out after 30 seconds');
      console.error('   - Check your internet connection');
      console.error('   - Try again');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('💡 Connection Error:');
      console.error('   - Cannot reach Hiro Platform API');
      console.error('   - Check your internet connection');
      console.error('   - Verify DNS is working');
    } else {
      console.error('💡 Unknown Error:');
      console.error('   Message:', error.message);
      console.error('   Code:', error.code);
    }

    console.error('');
    console.error('🔍 Troubleshooting:');
    console.error('   1. Verify .env configuration');
    console.error('   2. Check Hiro Platform dashboard');
    console.error('   3. Test webhook URL accessibility');
    console.error('   4. Review Hiro docs: https://docs.hiro.so/');
    console.error('   5. Join Hiro Discord for support');
    console.error('');

    process.exit(1);
  }
}

console.log('');
createOrdinalsChainHook().catch(error => {
  console.error('\n💥 Unexpected Error:', error.message);
  process.exit(1);
});
