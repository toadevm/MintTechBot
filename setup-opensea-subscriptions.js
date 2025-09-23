require('dotenv').config();
const Database = require('./src/database/db');
const OpenSeaService = require('./src/blockchain/opensea');
const WebhookHandlers = require('./src/webhooks/handlers');
const TokenTracker = require('./src/services/tokenTracker');

async function setupOpenSeaSubscriptions() {
  console.log('🌊 Setting up OpenSea stream subscriptions for all resolved collections...\n');

  const db = new Database();
  await db.initialize();

  const openSea = new OpenSeaService();
  await openSea.initialize();

  // Create minimal webhook handlers for event routing
  const webhookHandlers = new WebhookHandlers(db, null, null, null, openSea);

  try {
    // Get all tokens with collection slugs that don't have OpenSea subscriptions
    const tokensToSubscribe = await db.all(`
      SELECT DISTINCT collection_slug, COUNT(*) as token_count
      FROM tracked_tokens
      WHERE collection_slug IS NOT NULL
      AND collection_slug != ''
      AND (opensea_subscription_id IS NULL OR opensea_subscription_id = '')
      AND is_active = 1
      GROUP BY collection_slug
      ORDER BY collection_slug
    `);

    console.log(`📊 Found ${tokensToSubscribe.length} collections to set up subscriptions for:`);
    tokensToSubscribe.forEach(item => {
      console.log(`  - ${item.collection_slug} (${item.token_count} tokens)`);
    });

    if (tokensToSubscribe.length === 0) {
      console.log('✅ All collections already have OpenSea subscriptions!');
      await openSea.disconnect();
      await db.close();
      return;
    }

    console.log('\n🔗 Setting up OpenSea stream subscriptions...\n');

    const results = {
      successful: [],
      failed: [],
      total: tokensToSubscribe.length
    };

    // Set up subscription for each unique collection
    for (const item of tokensToSubscribe) {
      const collectionSlug = item.collection_slug;

      console.log(`🔗 Setting up subscription for: ${collectionSlug}`);

      try {
        // Create event handlers for this collection
        const eventHandlers = {
          listed: (eventData, rawEvent) => {
            console.log(`📝 Listed event for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent('listed', eventData, rawEvent);
          },
          sold: (eventData, rawEvent) => {
            console.log(`💰 Sold event for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent('sold', eventData, rawEvent);
          },
          transferred: (eventData, rawEvent) => {
            console.log(`🔄 Transfer event for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent('transferred', eventData, rawEvent);
          },
          metadata_updated: (eventData, rawEvent) => {
            console.log(`📊 Metadata update for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent('metadata_updated', eventData, rawEvent);
          },
          cancelled: (eventData, rawEvent) => {
            console.log(`❌ Cancelled event for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent('cancelled', eventData, rawEvent);
          },
          received_bid: (eventData, rawEvent) => {
            console.log(`🏷️ Bid received for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent('received_bid', eventData, rawEvent);
          },
          received_offer: (eventData, rawEvent) => {
            console.log(`💱 Offer received for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent('received_offer', eventData, rawEvent);
          },
          default: (eventType, eventData, rawEvent) => {
            console.log(`📡 ${eventType} event for ${collectionSlug}`);
            return webhookHandlers.handleOpenSeaEvent(eventType, eventData, rawEvent);
          }
        };

        // Subscribe to the collection
        const subscription = await openSea.subscribeToCollection(collectionSlug, eventHandlers);

        if (subscription) {
          // Update all tokens for this collection with subscription ID
          const updateResult = await db.run(`
            UPDATE tracked_tokens
            SET opensea_subscription_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE collection_slug = ? AND is_active = 1
          `, [subscription.collectionSlug, collectionSlug]);

          console.log(`  ✅ Subscribed successfully (updated ${updateResult.changes} tokens)`);
          results.successful.push({
            collection: collectionSlug,
            subscriptionId: subscription.collectionSlug,
            tokensUpdated: updateResult.changes
          });
        } else {
          console.log(`  ❌ Failed to create subscription`);
          results.failed.push({
            collection: collectionSlug,
            error: 'Subscription creation failed'
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        results.failed.push({
          collection: collectionSlug,
          error: error.message
        });
      }
    }

    // Summary
    console.log('\n📊 Subscription Setup Summary:');
    console.log(`  Total collections processed: ${results.total}`);
    console.log(`  Successfully subscribed: ${results.successful.length}`);
    console.log(`  Failed to subscribe: ${results.failed.length}`);

    if (results.successful.length > 0) {
      console.log('\n✅ Successfully subscribed collections:');
      results.successful.forEach(item => {
        console.log(`  - ${item.collection} (${item.tokensUpdated} tokens)`);
      });
    }

    if (results.failed.length > 0) {
      console.log('\n❌ Failed subscriptions:');
      results.failed.forEach(item => {
        console.log(`  - ${item.collection}: ${item.error}`);
      });
    }

    // Get active subscriptions
    const activeSubscriptions = await openSea.getActiveSubscriptions();
    console.log(`\n📈 Total active OpenSea subscriptions: ${activeSubscriptions.length}`);

    console.log('\n🚀 Next Steps:');
    console.log('  1. Restart your bot to activate all subscriptions');
    console.log('  2. Test notifications by monitoring real NFT activity');
    console.log('  3. Check your Telegram for real-time notifications');

  } catch (error) {
    console.error('❌ Error setting up subscriptions:', error);
  } finally {
    await openSea.disconnect();
    await db.close();
  }
}

// Additional utility functions
async function listActiveSubscriptions() {
  const openSea = new OpenSeaService();
  await openSea.initialize();

  try {
    const subscriptions = await openSea.getActiveSubscriptions();
    console.log(`\n📊 Active OpenSea Subscriptions (${subscriptions.length}):`);
    subscriptions.forEach(sub => {
      console.log(`  - ${sub.collectionSlug} (${sub.eventTypes} event types)`);
    });
  } catch (error) {
    console.error('Error listing subscriptions:', error);
  } finally {
    await openSea.disconnect();
  }
}

async function testSubscription(collectionSlug) {
  console.log(`🧪 Testing subscription for: ${collectionSlug}`);

  const openSea = new OpenSeaService();
  await openSea.initialize();

  try {
    const eventHandlers = {
      default: (eventType, eventData) => {
        console.log(`📡 Test event received: ${eventType} for ${eventData.collectionSlug}`);
      }
    };

    console.log('Setting up test subscription...');
    const subscription = await openSea.subscribeToCollection(collectionSlug, eventHandlers);

    if (subscription) {
      console.log(`✅ Test subscription active for ${collectionSlug}`);
      console.log('⏳ Listening for events for 30 seconds...');

      await new Promise(resolve => setTimeout(resolve, 30000));

      console.log('🛑 Test completed');
    } else {
      console.log('❌ Test subscription failed');
    }
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await openSea.disconnect();
  }
}

// Command line interface
if (require.main === module) {
  const command = process.argv[2];
  const param = process.argv[3];

  switch (command) {
    case 'list':
      listActiveSubscriptions();
      break;
    case 'test':
      if (param) {
        testSubscription(param);
      } else {
        console.log('Usage: node setup-opensea-subscriptions.js test <collection-slug>');
      }
      break;
    case 'setup':
    default:
      setupOpenSeaSubscriptions();
      break;
  }
}

module.exports = { setupOpenSeaSubscriptions, listActiveSubscriptions, testSubscription };