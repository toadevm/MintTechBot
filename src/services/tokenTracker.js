const logger = require('./logger');

class TokenTracker {
  constructor(database, alchemyService, walletService) {
    this.db = database;
    this.alchemy = alchemyService;
    this.wallet = walletService;
    this.trackingIntervals = new Map(); // Store active tracking intervals
  }

  async initialize() {
    try {
      // Load existing tokens and set up tracking
      await this.loadExistingTokens();
      
      // Start periodic tasks
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
      
      for (const token of tokens) {
        if (token.is_active && token.webhook_id) {
          // Verify webhook still exists
          try {
            const webhooks = await this.alchemy.listWebhooks();
            const webhookExists = webhooks.find(w => w.id === token.webhook_id);
            
            if (!webhookExists && webhooks.length >= 0) { // Only check if we got a valid response
              logger.warn(`Webhook ${token.webhook_id} not found for token ${token.contract_address}, recreating...`);
              await this.recreateWebhookForToken(token);
            }
          } catch (error) {
            if (error.message && error.message.includes('Unauthenticated')) {
              logger.warn(`Webhook authentication failed for token ${token.contract_address} - webhooks disabled`);
            } else {
              logger.error(`Error checking webhook for token ${token.contract_address}:`, error);
            }
          }
        }
      }
      
      logger.info('Existing tokens loaded and verified');
    } catch (error) {
      logger.error('Error loading existing tokens:', error);
      throw error;
    }
  }

  async recreateWebhookForToken(token) {
    try {
      const webhook = await this.alchemy.createNFTActivityWebhook(
        [token.contract_address],
        process.env.WEBHOOK_URL + '/webhook/alchemy'
      );
      
      // Update database with new webhook ID (if webhook was created)
      if (webhook && webhook.id) {
        await this.db.run(
          'UPDATE tracked_tokens SET webhook_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [webhook.id, token.id]
        );
        logger.info(`Recreated webhook for token ${token.contract_address}: ${webhook.id}`);
      } else {
        // Clear webhook ID if creation failed or webhooks are disabled
        await this.db.run(
          'UPDATE tracked_tokens SET webhook_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [token.id]
        );
        logger.warn(`Webhook creation failed for token ${token.contract_address} - cleared webhook ID`);
      }
      
      return webhook;
    } catch (error) {
      logger.error(`Failed to recreate webhook for token ${token.contract_address}:`, error);
      throw error;
    }
  }

  async addToken(contractAddress, userId, telegramId) {
    try {
      logger.info(`Adding token ${contractAddress} for user ${userId}`);
      
      // Validate contract address
      const { ethers } = require('ethers');
      if (!ethers.isAddress(contractAddress)) {
        throw new Error('Invalid contract address format');
      }

      // Check if token already exists
      const existingToken = await this.db.getTrackedToken(contractAddress);
      if (existingToken) {
        // Just subscribe user to existing token
        await this.db.subscribeUserToToken(userId, existingToken.id);
        logger.info(`User ${userId} subscribed to existing token ${contractAddress}`);
        return {
          success: true,
          message: `✅ You're now tracking ${existingToken.token_name || 'this NFT collection'}!`,
          token: existingToken
        };
      }

      // Validate with Alchemy
      const validation = await this.alchemy.validateContract(contractAddress);
      if (!validation.isValid) {
        throw new Error(`Invalid NFT contract: ${validation.reason}`);
      }

      // Create webhook
      const webhook = await this.alchemy.createNFTActivityWebhook(
        [contractAddress],
        process.env.WEBHOOK_URL + '/webhook/alchemy'
      );

      // Add to database
      const tokenResult = await this.db.addTrackedToken(
        contractAddress,
        validation,
        userId,
        webhook ? webhook.id : null
      );

      // Subscribe user to the token
      await this.db.subscribeUserToToken(userId, tokenResult.id);

      // Start tracking token data
      await this.startTokenDataTracking(contractAddress);

      logger.info(`Token ${contractAddress} added successfully${webhook ? ` with webhook ${webhook.id}` : ' (webhook creation failed - using manual tracking)'}`);
      
      return {
        success: true,
        message: `✅ *${validation.name || 'NFT Collection'}* added successfully!\n\n🔔 You'll now receive alerts for this collection.`,
        token: {
          id: tokenResult.id,
          contract_address: contractAddress,
          token_name: validation.name,
          token_symbol: validation.symbol,
          token_type: validation.tokenType,
          webhook_id: webhook ? webhook.id : null
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

      // Remove user subscription
      await this.db.unsubscribeUserFromToken(userId, token.id);

      // Check if any other users are subscribed
      const otherSubscriptions = await this.db.all(
        'SELECT COUNT(*) as count FROM user_subscriptions WHERE token_id = ?',
        [token.id]
      );

      if (otherSubscriptions[0].count === 0) {
        // No other users, remove token completely
        await this.db.run(
          'UPDATE tracked_tokens SET is_active = 0 WHERE id = ?',
          [token.id]
        );

        // Delete webhook
        if (token.webhook_id) {
          try {
            await this.alchemy.deleteWebhook(token.webhook_id);
            logger.info(`Deleted webhook ${token.webhook_id} for token ${contractAddress}`);
          } catch (error) {
            logger.error(`Error deleting webhook ${token.webhook_id}:`, error);
          }
        }

        // Stop tracking interval if exists
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
      // Update token data every 30 minutes
      const interval = setInterval(async () => {
        try {
          await this.updateTokenData(contractAddress);
        } catch (error) {
          logger.error(`Error in periodic update for ${contractAddress}:`, error);
        }
      }, 30 * 60 * 1000); // 30 minutes

      this.trackingIntervals.set(contractAddress, interval);
      
      // Do initial update
      await this.updateTokenData(contractAddress);
      
    } catch (error) {
      logger.error(`Error starting tracking for ${contractAddress}:`, error);
    }
  }

  async updateTokenData(contractAddress) {
    try {
      logger.debug(`Updating data for token ${contractAddress}`);
      
      // Get floor price
      let floorPrice = null;
      try {
        const floorPriceData = await this.alchemy.getFloorPrice(contractAddress);
        if (floorPriceData && floorPriceData.openSea) {
          floorPrice = floorPriceData.openSea.floorPrice.toString();
        }
      } catch (error) {
        logger.debug(`No floor price data for ${contractAddress}:`, error.message);
      }

      // Update database
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
      // For now, this is a placeholder - you could implement search via:
      // 1. Alchemy's search API if available
      // 2. OpenSea API
      // 3. Your own indexed database
      
      logger.info(`Searching tokens with query: ${query}`);
      
      // Return empty results for now
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

      // Get basic stats
      const stats = {
        contract_address: contractAddress,
        name: token.token_name,
        symbol: token.token_symbol,
        type: token.token_type,
        floor_price: token.floor_price,
        total_supply: token.total_supply,
        added_date: token.created_at
      };

      // Get activity count from the last 24 hours
      const activityCount = await this.db.get(
        `SELECT COUNT(*) as count FROM nft_activities 
         WHERE contract_address = ? AND created_at > datetime('now', '-1 day')`,
        [contractAddress]
      );

      stats.activity_24h = activityCount ? activityCount.count : 0;

      // Get unique owners (if available)
      try {
        const owners = await this.alchemy.getOwnersForContract(contractAddress);
        stats.unique_owners = owners.length;
      } catch (error) {
        logger.debug(`Could not get owners for ${contractAddress}:`, error.message);
        stats.unique_owners = 'N/A';
      }

      return stats;
      
    } catch (error) {
      logger.error(`Error getting token stats for ${contractAddress}:`, error);
      throw error;
    }
  }

  startPeriodicTasks() {
    // Clean up expired trending payments every hour
    setInterval(async () => {
      try {
        await this.db.expireTrendingPayments();
        logger.debug('Cleaned up expired trending payments');
      } catch (error) {
        logger.error('Error cleaning up trending payments:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Update all token data every 6 hours
    setInterval(async () => {
      try {
        const tokens = await this.db.getAllTrackedTokens();
        logger.info(`Starting periodic update for ${tokens.length} tokens`);
        
        for (const token of tokens) {
          if (token.is_active) {
            await this.updateTokenData(token.contract_address);
            // Add small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        logger.info('Completed periodic token data update');
      } catch (error) {
        logger.error('Error in periodic token data update:', error);
      }
    }, 6 * 60 * 60 * 1000); // 6 hours
  }

  async toggleUserNotifications(userId, tokenId, enabled = null) {
    try {
      let sql, params;
      
      if (enabled === null) {
        // Toggle current state
        sql = `UPDATE user_subscriptions 
               SET notification_enabled = NOT notification_enabled 
               WHERE user_id = ? AND token_id = ?`;
        params = [userId, tokenId];
      } else {
        // Set specific state
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

  async cleanup() {
    // Clear all intervals
    for (const [contractAddress, interval] of this.trackingIntervals) {
      clearInterval(interval);
      logger.info(`Cleared tracking interval for ${contractAddress}`);
    }
    this.trackingIntervals.clear();
  }
}

module.exports = TokenTracker;