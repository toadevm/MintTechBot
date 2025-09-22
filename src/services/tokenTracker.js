const logger = require('./logger');
const CollectionResolver = require('./collectionResolver');

class TokenTracker {
  constructor(database, openSeaService, webhookHandlers = null, chainManager = null) {
    this.db = database;
    this.openSea = openSeaService;
    this.webhookHandlers = webhookHandlers; // Add webhook handlers reference
    this.chainManager = chainManager;
    this.trackingIntervals = new Map();
    this.openSeaSubscriptions = new Map(); // Track OpenSea collection subscriptions
    this.collectionResolver = new CollectionResolver(); // Add collection resolver
  }

  // Method to set webhook handlers after initialization
  setWebhookHandlers(webhookHandlers) {
    this.webhookHandlers = webhookHandlers;
    logger.info('WebhookHandlers set for TokenTracker - OpenSea notifications enabled');
  }

  async initialize() {
    try {
      // Initialize collection resolver with known mappings
      this.collectionResolver.initializeKnownCollections();

      await this.loadExistingTokens();

      this.startPeriodicTasks();
      logger.info('Token tracker initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize token tracker:', error);
      throw error;
    }
  }

  async loadExistingTokens() {
    try {
      const tokens = await this.db.getAllTrackedTokens();
      logger.info(`Loading ${tokens.length} existing tracked tokens`);

      // Track unique collection slugs for OpenSea subscriptions
      const collectionsToSubscribe = new Set();

      for (const token of tokens) {
        // Collect OpenSea collections to subscribe to
        // We need to set up subscriptions for ALL collections, regardless of database subscription ID
        // because the database ID is just a placeholder - the real subscription is in memory
        if (token.is_active && token.collection_slug) {
          collectionsToSubscribe.add(token.collection_slug);
        }
      }

      // Set up OpenSea subscriptions for existing tokens
      if (this.openSea && collectionsToSubscribe.size > 0) {
        logger.info(`🌊 Setting up OpenSea subscriptions for ${collectionsToSubscribe.size} existing collections...`);
        await this.setupExistingOpenSeaSubscriptions(Array.from(collectionsToSubscribe));
      }

      logger.info('Existing tokens loaded and verified');
    } catch (error) {
      logger.error('Error loading existing tokens:', error);
      throw error;
    }
  }


  async addToken(contractAddress, userId, telegramId, chatId, chainName = 'ethereum', collectionSlug = null) {
    try {
      logger.info(`Adding token ${contractAddress} for user ${userId} on chain ${chainName} with collection slug: ${collectionSlug}`);

      const { ethers } = require('ethers');
      if (!ethers.isAddress(contractAddress)) {
        throw new Error('Invalid contract address format');
      }

      // Check if token already exists on this chain
      const existingToken = await this.db.getTrackedToken(contractAddress, chainName);
      if (existingToken) {
        // Reactivate token if it was previously deactivated
        if (!existingToken.is_active) {
          await this.db.run(
            'UPDATE tracked_tokens SET is_active = 1 WHERE id = ?',
            [existingToken.id]
          );
          logger.info(`Reactivated previously inactive token ${contractAddress}`);
        }

        const subscriptionResult = await this.db.subscribeUserToToken(userId, existingToken.id, chatId);
        logger.info(`User ${userId} subscribed to existing token ${contractAddress} in chat ${chatId}. Subscription result:`, subscriptionResult);

        // Verify subscription was created
        const userTokens = await this.db.getUserTrackedTokens(userId, chatId);
        const isSubscribed = userTokens.some(token => token.id === existingToken.id);
        logger.info(`Subscription verification - User ${userId} has ${userTokens.length} tokens, subscribed to ${contractAddress}: ${isSubscribed}`);

        return {
          success: true,
          message: `✅ You're now tracking ${existingToken.token_name || 'this NFT collection'}!`,
          token: existingToken
        };
      }

      // Validate contract using OpenSea
      if (!this.openSea) {
        throw new Error('OpenSea service not available for contract validation');
      }
      const validation = await this.openSea.validateContract(contractAddress, chainName);
      if (!validation.isValid) {
        throw new Error(`Invalid NFT contract: ${validation.reason}`);
      }

      // Set up OpenSea stream subscription
      let openSeaSubscriptionId = null;

      // Resolve collection slug if not provided
      if (!collectionSlug && this.collectionResolver) {
        try {
          logger.info(`Attempting to resolve collection slug for ${contractAddress} on ${chainName}...`);
          collectionSlug = await this.collectionResolver.resolveCollectionSlug(contractAddress, chainName);
          if (collectionSlug) {
            logger.info(`✅ Auto-resolved collection slug for ${chainName}: ${collectionSlug}`);
          } else {
            logger.info(`⚠️ Could not auto-resolve collection slug for ${contractAddress} on ${chainName}`);
          }
        } catch (error) {
          logger.warn(`Error auto-resolving collection slug for ${chainName}:`, error);
        }
      }

      // Set up OpenSea stream subscription if collection slug available and service available
      if (collectionSlug && this.openSea) {
        try {
          const openSeaSubscription = await this.setupOpenSeaSubscription(collectionSlug);
          if (openSeaSubscription) {
            openSeaSubscriptionId = openSeaSubscription.collectionSlug;
            logger.info(`Set up OpenSea subscription for collection: ${collectionSlug}`);
          }
        } catch (error) {
          logger.warn(`Failed to set up OpenSea subscription for ${collectionSlug}:`, error);
        }
      }

      // Add token to database with collection slug and chain
      const tokenResult = await this.db.addTrackedToken(
        contractAddress,
        validation,
        userId,
        null, // No Alchemy webhook
        collectionSlug,
        openSeaSubscriptionId,
        chainName
      );

      // Subscribe user to token
      const subscriptionResult = await this.db.subscribeUserToToken(userId, tokenResult.id, chatId);
      logger.info(`User ${userId} subscribed to new token ${contractAddress} in chat ${chatId} (token ID: ${tokenResult.id}). Subscription result:`, subscriptionResult);

      // Verify subscription was created
      const userTokens = await this.db.getUserTrackedTokens(userId, chatId);
      const isSubscribed = userTokens.some(token => token.id === tokenResult.id);
      logger.info(`New token verification - User ${userId} has ${userTokens.length} tokens, subscribed to ${contractAddress}: ${isSubscribed}`);

      // Start periodic data tracking
      await this.startTokenDataTracking(contractAddress);

      const streamStatus = collectionSlug && openSeaSubscriptionId ? ` + OpenSea stream (${collectionSlug})` : '';
      logger.info(`Token ${contractAddress} added successfully${streamStatus}`);

      // Create detailed success message with chain information
      const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
      const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : chainName;

      let successMessage = `✅ *${validation.name || 'NFT Collection'}* added successfully!\n\n`;
      successMessage += `🔗 *Chain:* ${chainDisplay}\n`;
      successMessage += `🔔 You'll now receive alerts for this collection.\n`;

      // Handle BSC and other external marketplace chains
      if (chainConfig?.externalMarketplace) {
        successMessage += `🌊 *Marketplace Support:* ${chainConfig.marketplaceName}\n`;
        successMessage += `   Real-time tracking may be limited\n`;
      } else if (collectionSlug) {
        successMessage += `🌊 *OpenSea Real-time Tracking*: ✅ Enabled\n`;
        successMessage += `   Collection: \`${collectionSlug}\`\n`;
      } else {
        successMessage += `🌊 *OpenSea Real-time Tracking*: ⚠️ Not available\n`;
        successMessage += `   (Collection slug needed for real-time tracking)\n`;
      }

      // Add metadata quality indicator
      if (validation.name !== 'Unknown Collection') {
        successMessage += `📊 *Metadata:* ✅ Complete\n`;
      } else {
        successMessage += `📊 *Metadata:* ⚠️ Partial (contract validated but name unavailable)\n`;
      }

      return {
        success: true,
        message: successMessage,
        token: {
          id: tokenResult.id,
          contract_address: contractAddress,
          collection_slug: collectionSlug,
          token_name: validation.name,
          token_symbol: validation.symbol,
          token_type: validation.tokenType,
          opensea_subscription_id: openSeaSubscriptionId
        }
      };
    } catch (error) {
      logger.error(`Error adding token ${contractAddress}:`, error);
      return {
        success: false,
        message: `❌ Error adding token: ${error.message}`
      };
    }
  }

  async removeToken(contractAddress, userId) {
    try {
      const token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        return {
          success: false,
          message: '❌ Token not found'
        };
      }


      await this.db.unsubscribeUserFromToken(userId, token.id);


      const otherSubscriptions = await this.db.all(
        'SELECT COUNT(*) as count FROM user_subscriptions WHERE token_id = ?',
        [token.id]
      );

      if (otherSubscriptions[0].count === 0) {

        await this.db.run(
          'UPDATE tracked_tokens SET is_active = 0 WHERE id = ?',
          [token.id]
        );


        // Clean up any remaining OpenSea subscriptions if needed


        if (this.trackingIntervals.has(contractAddress)) {
          clearInterval(this.trackingIntervals.get(contractAddress));
          this.trackingIntervals.delete(contractAddress);
        }
      }

      logger.info(`Token ${contractAddress} removed for user ${userId}`);
      return {
        success: true,
        message: `✅ Removed ${token.token_name || 'NFT collection'} from your tracking list`
      };
    } catch (error) {
      logger.error(`Error removing token ${contractAddress}:`, error);
      return {
        success: false,
        message: `❌ Error removing token: ${error.message}`
      };
    }
  }

  async startTokenDataTracking(contractAddress) {
    try {

      const interval = setInterval(async () => {
        try {
          await this.updateTokenData(contractAddress);
        } catch (error) {
          logger.error(`Error in periodic update for ${contractAddress}:`, error);
        }
      }, 30 * 60 * 1000);

      this.trackingIntervals.set(contractAddress, interval);

      await this.updateTokenData(contractAddress);
    } catch (error) {
      logger.error(`Error starting tracking for ${contractAddress}:`, error);
    }
  }

  async updateTokenData(contractAddress) {
    try {
      logger.debug(`Updating data for token ${contractAddress}`);

      let floorPrice = null;
      // Floor price tracking removed with Alchemy deprecation
      // OpenSea API can be used for floor price data if needed in the future


      if (floorPrice) {
        await this.db.run(
          'UPDATE tracked_tokens SET floor_price = ?, updated_at = CURRENT_TIMESTAMP WHERE contract_address = ?',
          [floorPrice, contractAddress]
        );
        logger.debug(`Updated floor price for ${contractAddress}: ${floorPrice} ETH`);
      }
    } catch (error) {
      logger.error(`Error updating token data for ${contractAddress}:`, error);
    }
  }

  async getUserTokens(userId) {
    try {
      const tokens = await this.db.getUserTrackedTokens(userId);
      return tokens;
    } catch (error) {
      logger.error(`Error getting user tokens for ${userId}:`, error);
      throw error;
    }
  }

  async searchTokens(query) {
    try {




      logger.info(`Searching tokens with query: ${query}`);

      return {
        success: true,
        results: [],
        message: 'Search functionality will be implemented with external APIs'
      };
    } catch (error) {
      logger.error(`Error searching tokens with query "${query}":`, error);
      return {
        success: false,
        results: [],
        message: `Search error: ${error.message}`
      };
    }
  }

  async getTokenStats(contractAddress) {
    try {
      const token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        throw new Error('Token not found');
      }


      const stats = {
        contract_address: contractAddress,
        name: token.token_name,
        symbol: token.token_symbol,
        type: token.token_type,
        floor_price: token.floor_price,
        total_supply: token.total_supply,
        added_date: token.created_at
      };


      const activityCount = await this.db.get(
        `SELECT COUNT(*) as count FROM nft_activities 
         WHERE contract_address = ? AND created_at > datetime('now', '-1 day')`,
        [contractAddress]
      );

      stats.activity_24h = activityCount ? activityCount.count : 0;


      // Owner count tracking removed with Alchemy deprecation
      // OpenSea API can be used for owner data if needed in the future
      stats.unique_owners = 'N/A';

      return stats;
    } catch (error) {
      logger.error(`Error getting token stats for ${contractAddress}:`, error);
      throw error;
    }
  }

  startPeriodicTasks() {

    setInterval(async () => {
      try {
        await this.db.expireTrendingPayments();
        logger.debug('Cleaned up expired trending payments');
      } catch (error) {
        logger.error('Error cleaning up trending payments:', error);
      }
    }, 60 * 60 * 1000);


    setInterval(async () => {
      try {
        const tokens = await this.db.getAllTrackedTokens();
        logger.info(`Starting periodic update for ${tokens.length} tokens`);
        for (const token of tokens) {
          if (token.is_active) {
            await this.updateTokenData(token.contract_address);

            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        logger.info('Completed periodic token data update');
      } catch (error) {
        logger.error('Error in periodic token data update:', error);
      }
    }, 6 * 60 * 60 * 1000);
  }

  async toggleUserNotifications(userId, tokenId, enabled = null) {
    try {
      let sql, params;
      if (enabled === null) {

        sql = `UPDATE user_subscriptions 
               SET notification_enabled = NOT notification_enabled 
               WHERE user_id = ? AND token_id = ?`;
        params = [userId, tokenId];
      } else {

        sql = `UPDATE user_subscriptions 
               SET notification_enabled = ? 
               WHERE user_id = ? AND token_id = ?`;
        params = [enabled, userId, tokenId];
      }

      const result = await this.db.run(sql, params);
      if (result.changes > 0) {
        logger.info(`Toggled notifications for user ${userId}, token ${tokenId}`);
        return { success: true };
      } else {
        return { success: false, message: 'Subscription not found' };
      }
    } catch (error) {
      logger.error(`Error toggling notifications for user ${userId}, token ${tokenId}:`, error);
      return { success: false, message: error.message };
    }
  }

  async setupExistingOpenSeaSubscriptions(collectionSlugs) {
    try {
      if (!this.openSea) {
        logger.warn('OpenSea service not available for existing subscriptions');
        return;
      }

      logger.info(`🔗 Setting up OpenSea subscriptions for existing collections: ${collectionSlugs.join(', ')}`);

      for (const collectionSlug of collectionSlugs) {
        try {
          const subscription = await this.setupOpenSeaSubscription(collectionSlug);
          if (subscription) {
            logger.info(`✅ OpenSea subscription active for existing collection: ${collectionSlug}`);
          }
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`❌ Failed to setup subscription for existing collection ${collectionSlug}:`, error);
        }
      }

      logger.info(`🌊 Completed OpenSea subscription setup for existing collections`);
    } catch (error) {
      logger.error('Error setting up existing OpenSea subscriptions:', error);
    }
  }

  async setupOpenSeaSubscription(collectionSlug) {
    try {
      if (!this.openSea) {
        logger.warn('OpenSea service not available');
        return null;
      }

      // Check if we already have a subscription for this collection
      if (this.openSeaSubscriptions.has(collectionSlug)) {
        logger.info(`Already subscribed to OpenSea collection: ${collectionSlug}`);
        return this.openSeaSubscriptions.get(collectionSlug);
      }

      // Import the webhook handlers
      const WebhookHandlers = require('../webhooks/handlers');

      // Create event handlers for this collection (excluding cancelled events)
      const eventHandlers = {
        listed: (eventData, rawEvent) => this.handleOpenSeaEvent('listed', eventData, rawEvent),
        sold: (eventData, rawEvent) => this.handleOpenSeaEvent('sold', eventData, rawEvent),
        transferred: (eventData, rawEvent) => this.handleOpenSeaEvent('transferred', eventData, rawEvent),
        metadata_updated: (eventData, rawEvent) => this.handleOpenSeaEvent('metadata_updated', eventData, rawEvent),
        received_bid: (eventData, rawEvent) => this.handleOpenSeaEvent('received_bid', eventData, rawEvent),
        received_offer: (eventData, rawEvent) => this.handleOpenSeaEvent('received_offer', eventData, rawEvent),
        default: (eventType, eventData, rawEvent) => this.handleOpenSeaEvent(eventType, eventData, rawEvent)
      };

      // Subscribe to the collection
      const subscription = await this.openSea.subscribeToCollection(collectionSlug, eventHandlers);

      if (subscription) {
        this.openSeaSubscriptions.set(collectionSlug, subscription);
        logger.info(`Successfully subscribed to OpenSea collection: ${collectionSlug}`);
      }

      return subscription;
    } catch (error) {
      logger.error(`Failed to setup OpenSea subscription for ${collectionSlug}:`, error);
      throw error;
    }
  }

  async handleOpenSeaEvent(eventType, eventData, rawEvent) {
    try {
      // This method will be called by OpenSea event handlers
      logger.info(`TokenTracker received OpenSea ${eventType} event for collection: ${eventData.collectionSlug}`);

      // Route to WebhookHandlers for proper notification processing
      if (this.webhookHandlers) {
        logger.info(`🌊 Routing OpenSea ${eventType} event to notification system`);
        return await this.webhookHandlers.handleOpenSeaEvent(eventType, eventData, rawEvent);
      } else {
        logger.warn('WebhookHandlers not available - OpenSea event not processed for notifications');
        logger.debug(`OpenSea event data:`, JSON.stringify(eventData, null, 2));
        return false;
      }
    } catch (error) {
      logger.error(`Error handling OpenSea ${eventType} event:`, error);
      return false;
    }
  }

  async unsubscribeFromOpenSeaCollection(collectionSlug) {
    try {
      if (!this.openSea) {
        return false;
      }

      const subscription = this.openSeaSubscriptions.get(collectionSlug);
      if (!subscription) {
        logger.warn(`No OpenSea subscription found for collection: ${collectionSlug}`);
        return false;
      }

      await this.openSea.unsubscribeFromCollection(collectionSlug);
      this.openSeaSubscriptions.delete(collectionSlug);

      logger.info(`Unsubscribed from OpenSea collection: ${collectionSlug}`);
      return true;
    } catch (error) {
      logger.error(`Failed to unsubscribe from OpenSea collection ${collectionSlug}:`, error);
      return false;
    }
  }

  getOpenSeaSubscriptions() {
    return Array.from(this.openSeaSubscriptions.keys());
  }

  async cleanup() {
    // Clean up tracking intervals
    for (const [contractAddress, interval] of this.trackingIntervals) {
      clearInterval(interval);
      logger.info(`Cleared tracking interval for ${contractAddress}`);
    }
    this.trackingIntervals.clear();

    // Clean up OpenSea subscriptions
    for (const collectionSlug of this.openSeaSubscriptions.keys()) {
      try {
        await this.unsubscribeFromOpenSeaCollection(collectionSlug);
      } catch (error) {
        logger.error(`Error unsubscribing from OpenSea collection ${collectionSlug}:`, error);
      }
    }
  }
}

module.exports = TokenTracker;