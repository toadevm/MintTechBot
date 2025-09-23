require('dotenv').config();
const Database = require('./src/database/db');

async function verifyOpenSeaSetup() {
  console.log('🔍 Verifying OpenSea notification setup...\n');

  const db = new Database();
  await db.initialize();

  try {
    // Check all tracked tokens
    const allTokens = await db.all(`
      SELECT id, token_name, contract_address, collection_slug, opensea_subscription_id, is_active
      FROM tracked_tokens
      WHERE is_active = 1
      ORDER BY id
    `);

    console.log(`📊 Current Token Status (${allTokens.length} active tokens):\n`);

    let fullyConfigured = 0;
    let partiallyConfigured = 0;
    let notConfigured = 0;

    allTokens.forEach(token => {
      const hasSlug = token.collection_slug && token.collection_slug !== '';
      const hasSubscription = token.opensea_subscription_id && token.opensea_subscription_id !== '';

      let status = '';
      if (hasSlug && hasSubscription) {
        status = '✅ Fully configured for OpenSea notifications';
        fullyConfigured++;
      } else if (hasSlug) {
        status = '⚠️ Has collection slug, needs subscription setup';
        partiallyConfigured++;
      } else {
        status = '❌ No OpenSea configuration';
        notConfigured++;
      }

      console.log(`${token.id}. ${token.token_name || 'Unknown'}`);
      console.log(`   Contract: ${token.contract_address}`);
      console.log(`   Collection: ${token.collection_slug || 'Not resolved'}`);
      console.log(`   Status: ${status}\n`);
    });

    // Summary
    console.log('📈 Summary:');
    console.log(`  ✅ Fully configured: ${fullyConfigured}/${allTokens.length} (${Math.round((fullyConfigured/allTokens.length)*100)}%)`);
    console.log(`  ⚠️ Partially configured: ${partiallyConfigured}/${allTokens.length}`);
    console.log(`  ❌ Not configured: ${notConfigured}/${allTokens.length}`);

    // Check user subscriptions for Gemesis specifically
    console.log('\n🎯 Gemesis User Subscription Check:');
    const gemesisUsers = await db.all(`
      SELECT u.telegram_id, u.username, us.notification_enabled
      FROM users u
      JOIN user_subscriptions us ON u.id = us.user_id
      JOIN tracked_tokens t ON us.token_id = t.id
      WHERE t.contract_address = '0xbe9371326f91345777b04394448c23e2bfeaa826'
      AND t.is_active = 1
    `);

    if (gemesisUsers.length > 0) {
      console.log(`  Found ${gemesisUsers.length} users subscribed to Gemesis:`);
      gemesisUsers.forEach(user => {
        console.log(`  - Telegram ID: ${user.telegram_id}, Notifications: ${user.notification_enabled ? '✅' : '❌'}`);
      });
    } else {
      console.log('  ❌ No users subscribed to Gemesis');
    }

    // Recommendations
    console.log('\n🚀 Next Steps:');
    if (fullyConfigured === allTokens.length) {
      console.log('  ✅ All tokens are fully configured!');
      console.log('  1. Restart your bot to activate all OpenSea subscriptions');
      console.log('  2. Test with real NFT activity');
      console.log('  3. Monitor Telegram for notifications');
    } else {
      if (partiallyConfigured > 0) {
        console.log(`  1. Run: node setup-opensea-subscriptions.js setup`);
      }
      if (notConfigured > 0) {
        console.log(`  2. Run: node fix-all-collections.js fix`);
      }
      console.log('  3. Then restart your bot');
    }

    // Check recent events
    console.log('\n📡 Recent Activity Check:');
    const recentActivity = await db.all(`
      SELECT contract_address, activity_type, created_at, marketplace
      FROM nft_activities
      WHERE created_at > datetime('now', '-24 hours')
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (recentActivity.length > 0) {
      console.log(`  Recent activities (${recentActivity.length} in last 24h):`);
      recentActivity.forEach(activity => {
        console.log(`  - ${activity.activity_type} on ${activity.marketplace} (${activity.created_at})`);
      });
    } else {
      console.log('  No recent activities logged');
    }

  } catch (error) {
    console.error('❌ Error during verification:', error);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  verifyOpenSeaSetup();
}

module.exports = { verifyOpenSeaSetup };