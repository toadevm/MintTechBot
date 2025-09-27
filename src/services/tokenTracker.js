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

      // Track tokens that need cleanup
      const tokensToCleanup = [];

      for (const token of tokens) {
        // Validate if active tokens should actually be active
        if (token.is_active) {
          // Check if token has active subscriptions
          const hasActiveSubscriptions = await this.db.hasAnyActiveSubscriptions(token.id);

          // Check if token has premium features
          const hasPremiumFeatures = await this.db.hasActivePremiumFeatures(token.contract_address);

          if (!hasActiveSubscriptions && !hasPremiumFeatures) {
            // This token should not be active - mark for cleanup
            logger.warn(`🧹 STARTUP CLEANUP: Found orphaned active token ${token.contract_address} (${token.token_name}) with no subscriptions or premium features`);
            tokensToCleanup.push(token);
          } else if (token.collection_slug) {
            // Token is legitimately active - set up OpenSea subscription
            collectionsToSubscribe.add(token.collection_slug);
            logger.info(`✅ STARTUP VALIDATION: Token ${token.contract_address} (${token.token_name}) is legitimately active - subs: ${hasActiveSubscriptions}, premium: ${hasPremiumFeatures}`);
          }
        } else if (token.collection_slug) {
          // Inactive token with collection slug - check if it should be deleted
          const hasPremiumFeatures = await this.db.hasActivePremiumFeatures(token.contract_address);
          if (!hasPremiumFeatures) {
            logger.info(`🧹 STARTUP CLEANUP: Found inactive token ${token.contract_address} without premium features - will be deleted`);
            tokensToCleanup.push(token);
          }
        }
      }

      // Clean up orphaned tokens
      if (tokensToCleanup.length > 0) {
        logger.info(`🗑️ STARTUP CLEANUP: Processing ${tokensToCleanup.length} orphaned tokens...`);
        for (const token of tokensToCleanup) {
          try {
            // Delete all subscriptions for this token
            await this.db.run('DELETE FROM user_subscriptions WHERE token_id = $1', [token.id]);

            // Delete the token completely
            await this.db.run('DELETE FROM tracked_tokens WHERE id = $1', [token.id]);

            logger.info(`   ✅ Deleted orphaned token: ${token.contract_address} (${token.token_name})`);
          } catch (error) {
            logger.error(`   ❌ Failed to delete orphaned token ${token.contract_address}:`, error);
          }
        }
      }

      // Set up OpenSea subscriptions for existing tokens
      if (this.openSea && collectionsToSubscribe.size > 0) {
        logger.info(`🌊 Setting up OpenSea subscriptions for ${collectionsToSubscribe.size} existing collections...`);
        await this.setupExistingOpenSeaSubscriptions(Array.from(collectionsToSubscribe));
      }

      // Clean up orphaned OpenSea subscriptions
      logger.info('🧹 Checking for orphaned OpenSea subscriptions...');
      await this.cleanupOrphanedOpenSeaSubscriptions();

      // Run database consistency check after token loading
      logger.info('🔍 Running database consistency check...');
      const consistencyResult = await this.db.checkDatabaseConsistency();

      if (consistencyResult.isConsistent) {
        logger.info('✅ Database consistency check passed - no issues found');
      } else {
        logger.warn(`⚠️ Database consistency check found ${consistencyResult.totalIssues} types of issues`);

        // Auto-fix critical issues that could cause event processing problems
        for (const issue of consistencyResult.issues) {
          if (issue.type === 'orphaned_subscriptions') {
            logger.info(`🔧 Auto-fixing ${issue.count} orphaned subscriptions...`);
            await this.db.fixOrphanedSubscriptions();
          } else if (issue.type === 'orphaned_tokens') {
            logger.info(`🔧 Auto-fixing ${issue.count} orphaned tokens...`);
            await this.db.fixOrphanedTokens();
          } else if (issue.type === 'inconsistent_active_tokens') {
            logger.warn(`⚠️ Found ${issue.count} inconsistent active tokens - these were cleaned up during startup validation`);
          }
        }

        logger.info('✅ Database consistency issues auto-fixed during startup');
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
        let responseMessage = '';

        // Check if inactive token should be reactivated or deleted
        if (!existingToken.is_active) {
          // Check if token has active premium features
          const hasPremiumFeatures = await this.db.hasActivePremiumFeatures(contractAddress);

          if (hasPremiumFeatures) {
            // Reactivate token (preserve premium features)
            await this.db.run(
              'UPDATE tracked_tokens SET is_active = true WHERE id = $1',
              [existingToken.id]
            );
            logger.info(`🔄 REACTIVATED INACTIVE TOKEN - ${contractAddress} (preserved due to premium features)`);
            responseMessage = `✅ Resumed tracking ${existingToken.token_name || 'this NFT collection'} with preserved premium features!`;
          } else {
            // Delete inactive token without premium features and create fresh record
            logger.info(`🗑️ DELETING INACTIVE TOKEN WITHOUT PREMIUM FEATURES - ${contractAddress}`);
            await this.db.run('DELETE FROM user_subscriptions WHERE token_id = $1', [existingToken.id]);
            await this.db.run('DELETE FROM tracked_tokens WHERE id = $1', [existingToken.id]);
            logger.info(`   ✅ Deleted inactive token ${contractAddress}, will create fresh record`);

            // Jump to fresh token creation logic
            return await this.createFreshToken(contractAddress, chainName, userId, chatId);
          }
        } else {
          logger.info(`🔗 SUBSCRIBING TO ACTIVE TOKEN - ${contractAddress} (already being tracked)`);
          responseMessage = `✅ You're now tracking ${existingToken.token_name || 'this NFT collection'}!`;
        }

        const subscriptionResult = await this.db.subscribeUserToToken(userId, existingToken.id, chatId);
        logger.info(`User ${userId} subscribed to existing token ${contractAddress} in chat ${chatId}. Subscription result:`, subscriptionResult);

        // Verify subscription was created
        const userTokens = await this.db.getUserTrackedTokens(userId, chatId);
        const isSubscribed = userTokens.some(token => token.id === existingToken.id);
        logger.info(`Subscription verification - User ${userId} has ${userTokens.length} tokens, subscribed to ${contractAddress}: ${isSubscribed}`);

        return {
          success: true,
          message: responseMessage,
          token: existingToken
        };
      }

      // If we reach here, token was completely deleted or never existed - create fresh record
      return await this.createFreshToken(contractAddress, chainName, userId, chatId, collectionSlug);
    } catch (error) {
      logger.error(`Error adding token ${contractAddress}:`, error);
      return {
        success: false,
        message: `⚠️ Error adding token: ${error.message}\n\nExample: 0x1234567890abcdef1234567890abcdef12345678`
      };
    }
  }

  async removeToken(contractAddress, userId) {
    let wasMarkedInactive = false;
    let originalToken = null;

    try {
      // Input validation
      if (!contractAddress || !userId) {
        logger.error(`Invalid parameters for removeToken: contractAddress=${contractAddress}, userId=${userId}`);
        return {
          success: false,
          message: '❌ Invalid parameters provided'
        };
      }

      const token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        return {
          success: false,
          message: '❌ Token not found'
        };
      }

      // Store original token state for potential rollback
      originalToken = { ...token };

      // Unsubscribe user with error handling
      try {
        const unsubscribeResult = await this.db.unsubscribeUserFromAllChats(userId, token.id);
        logger.info(`   📊 Unsubscribed user ${userId} from token ${token.id}, removed ${unsubscribeResult.changes} subscriptions`);
      } catch (unsubscribeError) {
        logger.error(`❌ Failed to unsubscribe user ${userId} from token ${contractAddress}:`, unsubscribeError);
        return {
          success: false,
          message: `❌ Error removing subscription: ${unsubscribeError.message}`
        };
      }

      // Use comprehensive verification to check for any active subscriptions
      const hasActiveSubscriptions = await this.db.hasAnyActiveSubscriptions(token.id);
      logger.info(`🔍 COLLECTION UNSUBSCRIPTION DEBUG - Token ${contractAddress}:`);
      logger.info(`   - Token ID: ${token.id}`);
      logger.info(`   - Collection Slug: ${token.collection_slug}`);
      logger.info(`   - Has Active Subscriptions: ${hasActiveSubscriptions}`);

      if (!hasActiveSubscriptions) {
        logger.info(`✅ No active subscriptions remaining for token ${contractAddress}, proceeding with cleanup...`);

        // Check if token has active premium features (trending, image fees, footer ads)
        const hasActivePremiumFeatures = await this.db.hasActivePremiumFeatures(contractAddress);
        logger.info(`   - Has Premium Features: ${hasActivePremiumFeatures}`);

        // CRITICAL: Check if ANY OTHER tokens in the same collection are still active BEFORE making changes
        let shouldUnsubscribeFromCollection = false;
        try {
          if (token.collection_slug) {
            // First mark this token as inactive to check other tokens
            const updateResult = await this.db.run(
              'UPDATE tracked_tokens SET is_active = false WHERE id = $1',
              [token.id]
            );
            if (updateResult.changes === 0) {
              logger.warn(`⚠️ Warning: Token ${contractAddress} was not updated (may have been already inactive)`);
            }
            wasMarkedInactive = true;
            logger.info(`   ✅ Token ${contractAddress} temporarily marked as inactive for collection check`);

            const allCollectionTokens = await this.db.getTokensForCollectionSlug(token.collection_slug);
            logger.info(`   - Other tokens in collection ${token.collection_slug}: ${allCollectionTokens.length}`);

            // Additional safety check: verify no active subscriptions remain across ALL users for this collection
            const hasActiveSubscriptionsInCollection = await this.db.all(
              `SELECT COUNT(*) as count FROM user_subscriptions us
               JOIN tracked_tokens tt ON us.token_id = tt.id
               WHERE tt.collection_slug = $1`,
              [token.collection_slug]
            );

            // CRITICAL FIX: Convert count to number to handle string vs number comparison
            const totalSubscriptionsInCollection = parseInt(hasActiveSubscriptionsInCollection[0]?.count) || 0;
            logger.info(`   - Total active subscriptions across ALL users in collection ${token.collection_slug}: ${totalSubscriptionsInCollection}`);
            logger.info(`   - Count type check: ${hasActiveSubscriptionsInCollection[0]?.count} (type: ${typeof hasActiveSubscriptionsInCollection[0]?.count}) -> parsed: ${totalSubscriptionsInCollection}`);

            if (allCollectionTokens.length === 0 && totalSubscriptionsInCollection === 0) {
              shouldUnsubscribeFromCollection = true;
              logger.info(`   ✅ No other active tokens AND no subscriptions in collection - safe to unsubscribe from OpenSea`);
            } else {
              if (allCollectionTokens.length > 0) {
                logger.info(`   ⚠️ Other tokens still active in collection:`, allCollectionTokens.map(t => t.contract_address));
              }
              if (totalSubscriptionsInCollection > 0) {
                logger.info(`   ⚠️ Collection still has ${totalSubscriptionsInCollection} active subscriptions from other users - keeping OpenSea subscription`);
              }
            }
          } else {
            // No collection, just mark as inactive for now
            const updateResult = await this.db.run(
              'UPDATE tracked_tokens SET is_active = false WHERE id = $1',
              [token.id]
            );
            if (updateResult.changes === 0) {
              logger.warn(`⚠️ Warning: Token ${contractAddress} was not updated (may have been already inactive)`);
            }
            wasMarkedInactive = true;
            logger.info(`   ✅ Token ${contractAddress} marked as inactive (no collection)`);
          }
        } catch (markInactiveError) {
          logger.error(`❌ Failed to mark token ${contractAddress} as inactive:`, markInactiveError);
          // Don't continue with deletion if we can't mark inactive
          return {
            success: false,
            message: `❌ Error updating token state: ${markInactiveError.message}`
          };
        }

        // Decide whether to DELETE completely or keep as inactive
        if (!hasActivePremiumFeatures) {
          // No premium features - DELETE completely from database
          logger.info(`🗑️ DELETING TOKEN - No premium features to preserve for ${contractAddress}`);

          try {
            // First delete any remaining subscriptions (should be none, but cleanup)
            const subscriptionDeleteResult = await this.db.run('DELETE FROM user_subscriptions WHERE token_id = $1', [token.id]);
            logger.info(`   📊 Cleaned up ${subscriptionDeleteResult.changes || 0} remaining subscriptions`);

            // Delete the token record completely
            const tokenDeleteResult = await this.db.run('DELETE FROM tracked_tokens WHERE id = $1', [token.id]);
            if (tokenDeleteResult.changes === 0) {
              logger.error(`❌ CRITICAL: Token ${contractAddress} was not deleted from database (may have been deleted already)`);
              return {
                success: false,
                message: '❌ Error: Token could not be deleted from database'
              };
            }
            logger.info(`   ✅ Token ${contractAddress} completely deleted from database`);
          } catch (deleteError) {
            logger.error(`❌ Failed to delete token ${contractAddress} from database:`, deleteError);
            // Attempt rollback - restore token to active state
            if (originalToken && wasMarkedInactive) {
              try {
                await this.db.run(
                  'UPDATE tracked_tokens SET is_active = true WHERE id = $1',
                  [token.id]
                );
                logger.info(`   🔄 Rolled back token ${contractAddress} to active state after deletion failure`);
              } catch (rollbackError) {
                logger.error(`❌ CRITICAL: Failed to rollback token ${contractAddress}:`, rollbackError);
              }
            }
            return {
              success: false,
              message: `❌ Error deleting token: ${deleteError.message}`
            };
          }
        } else {
          // Has premium features - keep as inactive for potential reactivation
          logger.info(`💎 PRESERVING TOKEN - Has premium features, keeping as inactive for ${contractAddress}`);
          // Token already marked as inactive above
        }

        // Handle OpenSea collection unsubscription
        if (shouldUnsubscribeFromCollection) {
          logger.info(`🔥 UNSUBSCRIBING FROM OPENSEA - Collection ${token.collection_slug} (Contract: ${contractAddress})`);

          if (token.collection_slug) {
            try {
              const unsubscribeResult = await this.unsubscribeFromOpenSeaCollection(token.collection_slug);
              logger.info(`   ✅ OpenSea unsubscription result: ${unsubscribeResult}`);
            } catch (error) {
              logger.error(`   ❌ Failed to unsubscribe from OpenSea for collection ${token.collection_slug}:`, error);
            }
          }
        } else {
          if (hasActivePremiumFeatures) {
            logger.info(`   ⚠️ Token ${contractAddress} has active premium features, keeping OpenSea subscription active`);
          }
          if (!shouldUnsubscribeFromCollection) {
            logger.info(`   ⚠️ Collection ${token.collection_slug} has other active tokens, keeping OpenSea subscription active`);
          }
        }

        // Clean up tracking intervals regardless of premium features
        if (this.trackingIntervals.has(contractAddress)) {
          clearInterval(this.trackingIntervals.get(contractAddress));
          this.trackingIntervals.delete(contractAddress);
          logger.info(`   ✅ Cleared tracking interval for ${contractAddress}`);
        }
      } else {
        logger.info(`   ⚠️ Token ${contractAddress} still has active subscriptions, keeping all services active`);
      }

      logger.info(`Token ${contractAddress} removed for user ${userId}`);
      return {
        success: true,
        message: `✅ Removed ${token.token_name || 'NFT collection'} from your tracking list`
      };
    } catch (error) {
      logger.error(`❌ CRITICAL ERROR removing token ${contractAddress}:`, error);

      // Attempt emergency rollback if token was marked inactive
      if (originalToken && wasMarkedInactive && originalToken.is_active) {
        try {
          const rollbackResult = await this.db.run(
            'UPDATE tracked_tokens SET is_active = true WHERE id = $1',
            [originalToken.id]
          );
          if (rollbackResult.changes > 0) {
            logger.info(`🔄 EMERGENCY ROLLBACK: Restored token ${contractAddress} to active state`);
          } else {
            logger.warn(`⚠️ Emergency rollback attempted but token ${contractAddress} may have already been deleted`);
          }
        } catch (rollbackError) {
          logger.error(`❌ EMERGENCY ROLLBACK FAILED for token ${contractAddress}:`, rollbackError);
        }
      }

      // Provide detailed error message based on error type
      let errorMessage = '❌ Unexpected error occurred while removing token';
      if (error.message.includes('database') || error.message.includes('query')) {
        errorMessage = '❌ Database error occurred while removing token. Please try again.';
      } else if (error.message.includes('network') || error.message.includes('timeout')) {
        errorMessage = '❌ Network error occurred. Please check your connection and try again.';
      }

      return {
        success: false,
        message: `${errorMessage}: ${error.message}`
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
          'UPDATE tracked_tokens SET floor_price = $1, updated_at = NOW() WHERE contract_address = $2',
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
         WHERE contract_address = $1 AND created_at > NOW() - INTERVAL '1 day'`,
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
               WHERE user_id = $1 AND token_id = $2`;
        params = [userId, tokenId];
      } else {

        sql = `UPDATE user_subscriptions 
               SET notification_enabled = ? 
               WHERE user_id = $1 AND token_id = $2`;
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

      // Create event handlers for this collection (trading-focused events only)
      const eventHandlers = {
        listed: (eventData, rawEvent) => this.handleOpenSeaEvent('listed', eventData, rawEvent),
        sold: (eventData, rawEvent) => this.handleOpenSeaEvent('sold', eventData, rawEvent),
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
    logger.info(`🚨 ATTEMPTING OPENSEA UNSUBSCRIPTION - Collection: ${collectionSlug}`);

    try {
      if (!this.openSea) {
        logger.error(`   ❌ OpenSea service not available`);
        return false;
      }

      // Check current subscription state
      const subscription = this.openSeaSubscriptions.get(collectionSlug);
      const activeSubscriptions = this.getOpenSeaSubscriptions();
      logger.info(`   - Current active subscriptions: [${activeSubscriptions.join(', ')}]`);
      logger.info(`   - Subscription found for ${collectionSlug}: ${!!subscription}`);

      if (!subscription) {
        logger.warn(`   ⚠️ No OpenSea subscription found for collection: ${collectionSlug}`);
        logger.info(`   - Subscription may have been already removed or never existed`);
        return false;
      }

      // Attempt unsubscription with retry logic
      let retryCount = 0;
      const maxRetries = 3;
      let unsubscribeSuccess = false;

      while (retryCount < maxRetries && !unsubscribeSuccess) {
        try {
          logger.info(`   🔄 Unsubscription attempt ${retryCount + 1}/${maxRetries}`);
          await this.openSea.unsubscribeFromCollection(collectionSlug);
          unsubscribeSuccess = true;
          logger.info(`   ✅ OpenSea API unsubscription call succeeded`);
        } catch (apiError) {
          retryCount++;
          logger.error(`   ❌ OpenSea API unsubscription attempt ${retryCount} failed:`, apiError);

          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff: 2s, 4s, 8s
            logger.info(`   ⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // Force remove from local subscription map regardless of API success
      this.openSeaSubscriptions.delete(collectionSlug);
      logger.info(`   ✅ Removed collection ${collectionSlug} from local subscription map`);

      const remainingSubscriptions = this.getOpenSeaSubscriptions();
      logger.info(`   - Remaining active subscriptions: [${remainingSubscriptions.join(', ')}]`);

      if (unsubscribeSuccess) {
        logger.info(`✅ OPENSEA UNSUBSCRIPTION COMPLETE - Collection: ${collectionSlug}`);
        return true;
      } else {
        logger.error(`❌ OPENSEA UNSUBSCRIPTION FAILED - Collection: ${collectionSlug} (after ${maxRetries} attempts)`);
        logger.info(`   - Removed from local map anyway to prevent further issues`);
        return false;
      }
    } catch (error) {
      logger.error(`💥 CRITICAL ERROR in unsubscribeFromOpenSeaCollection for ${collectionSlug}:`, error);

      // Force cleanup even on critical error
      this.openSeaSubscriptions.delete(collectionSlug);
      logger.info(`   - Force-removed collection from local map due to critical error`);

      return false;
    }
  }

  getOpenSeaSubscriptions() {
    return Array.from(this.openSeaSubscriptions.keys());
  }

  async cleanupOrphanedOpenSeaSubscriptions() {
    try {
      logger.info('🔍 Checking OpenSea subscriptions for orphaned collections...');

      const activeSubscriptions = this.getOpenSeaSubscriptions();
      logger.info(`   - Current OpenSea subscriptions: [${activeSubscriptions.join(', ')}]`);

      if (activeSubscriptions.length === 0) {
        logger.info('   ✅ No OpenSea subscriptions to check');
        return;
      }

      let orphanedCount = 0;

      for (const collectionSlug of activeSubscriptions) {
        try {
          // Check if this collection has any active tokens with subscriptions
          const activeTokensInCollection = await this.db.getTokensForCollectionSlug(collectionSlug);

          // Also check for active subscriptions across all users for this collection
          const activeSubscriptionsInCollection = await this.db.all(
            `SELECT COUNT(*) as count FROM user_subscriptions us
             JOIN tracked_tokens tt ON us.token_id = tt.id
             WHERE tt.collection_slug = $1`,
            [collectionSlug]
          );

          const subscriptionCount = activeSubscriptionsInCollection[0]?.count || 0;

          logger.info(`   - Collection ${collectionSlug}: ${activeTokensInCollection.length} active tokens, ${subscriptionCount} subscriptions`);

          if (activeTokensInCollection.length === 0 && subscriptionCount === 0) {
            logger.warn(`🚨 ORPHANED OPENSEA SUBSCRIPTION DETECTED: ${collectionSlug}`);
            logger.info(`   - No active tokens or subscriptions remain for this collection`);
            logger.info(`   - Unsubscribing from OpenSea collection: ${collectionSlug}`);

            try {
              await this.unsubscribeFromOpenSeaCollection(collectionSlug);
              orphanedCount++;
              logger.info(`   ✅ Successfully cleaned up orphaned subscription: ${collectionSlug}`);
            } catch (unsubError) {
              logger.error(`   ❌ Failed to unsubscribe from orphaned collection ${collectionSlug}:`, unsubError);
            }
          }
        } catch (checkError) {
          logger.error(`   ❌ Error checking collection ${collectionSlug}:`, checkError);
        }
      }

      if (orphanedCount > 0) {
        logger.info(`🧹 Cleaned up ${orphanedCount} orphaned OpenSea subscriptions`);
      } else {
        logger.info(`✅ All OpenSea subscriptions are valid - no orphaned subscriptions found`);
      }
    } catch (error) {
      logger.error('❌ Error during OpenSea subscription cleanup:', error);
    }
  }

  // Manual cleanup method for emergency situations
  async forceCleanupCollection(collectionSlug) {
    logger.info(`🚨 EMERGENCY CLEANUP - Force cleaning collection: ${collectionSlug}`);

    try {
      // 1. Force remove from OpenSea subscriptions map
      const hadSubscription = this.openSeaSubscriptions.has(collectionSlug);
      this.openSeaSubscriptions.delete(collectionSlug);
      logger.info(`   ✅ Removed from local subscription map (had subscription: ${hadSubscription})`);

      // 2. Try to unsubscribe from OpenSea API anyway
      if (this.openSea) {
        try {
          await this.openSea.unsubscribeFromCollection(collectionSlug);
          logger.info(`   ✅ Force-unsubscribed from OpenSea API`);
        } catch (error) {
          logger.warn(`   ⚠️ OpenSea API unsubscribe failed (expected in emergency cleanup):`, error.message);
        }
      }

      // 3. Mark all tokens in collection as inactive
      const tokens = await this.db.all(
        'SELECT * FROM tracked_tokens WHERE collection_slug = $1',
        [collectionSlug]
      );

      for (const token of tokens) {
        await this.db.run(
          'UPDATE tracked_tokens SET is_active = false WHERE id = $1',
          [token.id]
        );
        logger.info(`   ✅ Marked token ${token.contract_address} as inactive`);

        // Clean up tracking intervals
        if (this.trackingIntervals.has(token.contract_address)) {
          clearInterval(this.trackingIntervals.get(token.contract_address));
          this.trackingIntervals.delete(token.contract_address);
          logger.info(`   ✅ Cleared tracking interval for ${token.contract_address}`);
        }
      }

      const remainingSubscriptions = this.getOpenSeaSubscriptions();
      logger.info(`✅ EMERGENCY CLEANUP COMPLETE - Collection: ${collectionSlug}`);
      logger.info(`   - Tokens processed: ${tokens.length}`);
      logger.info(`   - Remaining active subscriptions: [${remainingSubscriptions.join(', ')}]`);

      return {
        success: true,
        tokensProcessed: tokens.length,
        hadSubscription: hadSubscription,
        remainingSubscriptions: remainingSubscriptions
      };

    } catch (error) {
      logger.error(`💥 EMERGENCY CLEANUP FAILED for ${collectionSlug}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get diagnostic info about collection state
  async getDiagnosticInfo(collectionSlug) {
    logger.info(`🔍 DIAGNOSTIC INFO - Collection: ${collectionSlug}`);

    try {
      // Check subscription map
      const hasLocalSubscription = this.openSeaSubscriptions.has(collectionSlug);
      const allSubscriptions = this.getOpenSeaSubscriptions();

      // Check database tokens
      const allTokens = await this.db.all(
        'SELECT * FROM tracked_tokens WHERE collection_slug = $1',
        [collectionSlug]
      );

      const activeTokens = await this.db.getTokensForCollectionSlug(collectionSlug);

      // Check subscriptions for each token
      const tokenDetails = [];
      for (const token of allTokens) {
        const hasSubscriptions = await this.db.hasAnyActiveSubscriptions(token.id);
        const hasPremiumFeatures = await this.db.hasActivePremiumFeatures(token.contract_address);

        tokenDetails.push({
          contract_address: token.contract_address,
          is_active: token.is_active,
          has_subscriptions: hasSubscriptions,
          has_premium_features: hasPremiumFeatures
        });
      }

      const diagnosticInfo = {
        collection_slug: collectionSlug,
        has_local_subscription: hasLocalSubscription,
        all_subscriptions: allSubscriptions,
        total_tokens: allTokens.length,
        active_tokens: activeTokens.length,
        token_details: tokenDetails
      };

      logger.info(`   Diagnostic Results:`, diagnosticInfo);
      return diagnosticInfo;

    } catch (error) {
      logger.error(`💥 DIAGNOSTIC FAILED for ${collectionSlug}:`, error);
      return { error: error.message };
    }
  }

  async cleanupOrphanedTokens() {
    try {
      logger.info('🧹 TokenTracker initiating orphaned token cleanup...');
      const result = await this.db.cleanupOrphanedTokens();

      if (result.cleaned > 0) {
        logger.info(`✅ TokenTracker cleaned up ${result.cleaned} orphaned tokens:`);
        for (const token of result.tokens) {
          logger.info(`   - ${token.contract_address} (${token.token_name})`);
        }
      } else {
        logger.info('✅ TokenTracker found no orphaned tokens - database is clean');
      }

      return result;
    } catch (error) {
      logger.error('❌ TokenTracker orphaned token cleanup failed:', error);
      throw error;
    }
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

  async createFreshToken(contractAddress, chainName, userId, chatId, collectionSlug = null) {
    // If we reach here, token was completely deleted or never existed - create fresh record
    logger.info(`🆕 CREATING FRESH TOKEN RECORD - ${contractAddress} (completely new or previously deleted)`);

    // Validate contract using OpenSea
    if (!this.openSea) {
      throw new Error('OpenSea service not available for contract validation');
    }
    const validation = await this.openSea.validateContract(contractAddress, chainName);
    if (!validation.isValid) {
      throw new Error(`Invalid NFT contract: ${validation.reason}`);
    }

    logger.info(`🔍 RECEIVED VALIDATION RESULT: collectionSlug="${validation.collectionSlug}" for ${contractAddress} on ${chainName}`);

    // Check if validation contains collection slug
    if (validation.collectionSlug) {
      collectionSlug = validation.collectionSlug;
      logger.info(`✅ USING COLLECTION SLUG FROM VALIDATION: "${collectionSlug}" for ${contractAddress} on ${chainName}`);
    } else {
      logger.warn(`⚠️ NO COLLECTION SLUG IN VALIDATION RESULT for ${contractAddress} on ${chainName}`);
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
  }
}

module.exports = TokenTracker;