const logger = require('../services/logger');

class WebhookHandlers {
  constructor(database, bot, trendingService = null) {
    this.db = database;
    this.bot = bot;
    this.trending = trendingService;
  }

  async handleAlchemyWebhook(req, res) {
    try {
      const payload = req.body;
      logger.info('Received Alchemy webhook:', JSON.stringify(payload, null, 2));

      // Log webhook for debugging
      await this.db.logWebhook('alchemy', payload, false);

      // Process the webhook based on type
      let processed = false;
      
      if (payload.type === 'NFT_ACTIVITY') {
        processed = await this.handleNFTActivity(payload);
      } else if (payload.type === 'ADDRESS_ACTIVITY') {
        processed = await this.handleAddressActivity(payload);
      } else {
        logger.warn(`Unknown webhook type: ${payload.type}`);
      }

      // Update webhook log
      await this.db.logWebhook('alchemy', payload, processed);

      res.status(200).json({ 
        success: true, 
        processed: processed,
        message: 'Webhook processed successfully' 
      });
      
    } catch (error) {
      logger.error('Error handling Alchemy webhook:', error);
      
      // Log error
      if (req.body) {
        await this.db.logWebhook('alchemy', req.body, false, error.message);
      }
      
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    }
  }

  async handleNFTActivity(payload) {
    try {
      if (!payload.event || !payload.event.activity) {
        logger.warn('Invalid NFT activity payload structure');
        return false;
      }

      const activities = Array.isArray(payload.event.activity) 
        ? payload.event.activity 
        : [payload.event.activity];

      let processedCount = 0;

      for (const activity of activities) {
        try {
          await this.processNFTActivity(activity);
          processedCount++;
        } catch (error) {
          logger.error(`Error processing individual NFT activity:`, error);
        }
      }

      logger.info(`Processed ${processedCount}/${activities.length} NFT activities`);
      return processedCount > 0;
      
    } catch (error) {
      logger.error('Error handling NFT activity:', error);
      return false;
    }
  }

  async processNFTActivity(activity) {
    try {
      const contractAddress = activity.contractAddress;
      const tokenId = activity.tokenId;
      const activityType = this.normalizeActivityType(activity.category);
      
      logger.info(`Processing NFT activity: ${activityType} for ${contractAddress}:${tokenId}`);

      // Check if we're tracking this token
      const token = await this.db.getTrackedToken(contractAddress);
      if (!token || !token.is_active) {
        logger.debug(`Token ${contractAddress} not tracked or inactive, skipping`);
        return;
      }

      // Log the activity
      const activityData = {
        contractAddress: contractAddress,
        tokenId: tokenId || null,
        activityType: activityType,
        fromAddress: activity.fromAddress || null,
        toAddress: activity.toAddress || null,
        transactionHash: activity.hash || null,
        blockNumber: activity.blockNum || null,
        price: this.extractPrice(activity) || null,
        marketplace: this.extractMarketplace(activity) || null
      };

      await this.db.logNFTActivity(activityData);

      // Notify subscribed users
      await this.notifyUsers(token, activityData);

      // Send to channels if token is trending
      if (this.trending) {
        const isTrending = await this.trending.isTokenTrending(contractAddress);
        if (isTrending) {
          await this.notifyChannels(token, activityData);
        }
      }
      
    } catch (error) {
      logger.error('Error processing NFT activity:', error);
      throw error;
    }
  }

  normalizeActivityType(category) {
    const typeMap = {
      'erc721': 'transfer',
      'erc1155': 'transfer',
      'external': 'external_transfer',
      'internal': 'internal_transfer',
      'token': 'transfer',
      'sale': 'sale',
      'mint': 'mint',
      'burn': 'burn'
    };

    return typeMap[category?.toLowerCase()] || 'unknown';
  }

  extractPrice(activity) {
    try {
      // Try to extract price from various possible fields
      if (activity.value && parseFloat(activity.value) > 0) {
        return activity.value.toString();
      }
      
      if (activity.metadata?.value) {
        return activity.metadata.value.toString();
      }

      // Check for marketplace-specific price fields
      if (activity.log?.data) {
        // This would require more sophisticated parsing of transaction logs
        // For now, return null
      }

      return null;
    } catch (error) {
      logger.error('Error extracting price from activity:', error);
      return null;
    }
  }

  extractMarketplace(activity) {
    try {
      // Try to identify marketplace from transaction data
      if (activity.toAddress) {
        const address = activity.toAddress.toLowerCase();
        
        // Common marketplace addresses (Sepolia testnet equivalents)
        const marketplaces = {
          '0x00000000006c3852cbef3e08e8df289169ede581': 'OpenSea',
          '0x59728544b08ab483533076417fbbb2fd0b17ce3a': 'LooksRare',
          '0x2b2e8cda09bba9660dca5cb6233787738ad68329': 'X2Y2'
        };

        return marketplaces[address] || null;
      }

      return null;
    } catch (error) {
      logger.error('Error extracting marketplace from activity:', error);
      return null;
    }
  }

  async notifyUsers(token, activityData) {
    try {
      // Get all users subscribed to this token with notifications enabled
      const users = await this.db.all(`
        SELECT u.telegram_id, u.username, us.notification_enabled
        FROM users u
        JOIN user_subscriptions us ON u.id = us.user_id
        WHERE us.token_id = ? AND us.notification_enabled = 1 AND u.is_active = 1
      `, [token.id]);

      const message = this.formatActivityMessage(token, activityData);
      
      // Send to group chat first
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        try {
          await this.bot.telegram.sendMessage(
            adminChatId,
            message,
            { 
              parse_mode: 'Markdown',
              disable_web_page_preview: true 
            }
          );
          logger.info(`Sent notification to group chat ${adminChatId} for token ${token.contract_address}`);
        } catch (error) {
          logger.error(`Failed to send notification to group chat ${adminChatId}:`, error);
        }
      }

      // Also send to individual users if any are subscribed
      for (const user of users) {
        try {
          await this.bot.telegram.sendMessage(
            user.telegram_id, 
            message, 
            { 
              parse_mode: 'Markdown',
              disable_web_page_preview: true 
            }
          );
          
          logger.debug(`Notified user ${user.telegram_id} about ${token.contract_address} activity`);
        } catch (error) {
          logger.error(`Failed to notify user ${user.telegram_id}:`, error);
          
          // If user blocked the bot or chat doesn't exist, deactivate them
          if (error.response?.error_code === 403 || error.response?.error_code === 400) {
            await this.db.run(
              'UPDATE users SET is_active = 0 WHERE telegram_id = ?',
              [user.telegram_id]
            );
            logger.info(`Deactivated user ${user.telegram_id} due to delivery failure`);
          }
        }
      }

      logger.info(`Notified group chat and ${users.length} users about ${token.contract_address} activity`);
      
    } catch (error) {
      logger.error('Error notifying users:', error);
    }
  }

  async notifyChannels(token, activityData) {
    try {
      // Get active channels that want trending alerts
      const channels = await this.db.all(`
        SELECT * FROM channels 
        WHERE is_active = 1 AND show_trending = 1
      `);

      if (channels.length === 0) {
        return;
      }

      const message = this.formatTrendingActivityMessage(token, activityData);
      
      for (const channel of channels) {
        try {
          await this.bot.telegram.sendMessage(
            channel.telegram_chat_id,
            message,
            { 
              parse_mode: 'Markdown',
              disable_web_page_preview: true 
            }
          );
          
          logger.debug(`Notified channel ${channel.telegram_chat_id} about trending activity`);
        } catch (error) {
          logger.error(`Failed to notify channel ${channel.telegram_chat_id}:`, error);
          
          // If bot was removed from channel, deactivate it
          if (error.response?.error_code === 403) {
            await this.db.run(
              'UPDATE channels SET is_active = 0 WHERE telegram_chat_id = ?',
              [channel.telegram_chat_id]
            );
          }
        }
      }
      
    } catch (error) {
      logger.error('Error notifying channels:', error);
    }
  }

  formatActivityMessage(token, activityData) {
    const activityEmoji = this.getActivityEmoji(activityData.activityType);
    let message = `${activityEmoji} *${token.token_name || 'NFT Collection'}* Activity\n\n`;
    
    message += `🔹 **Action:** ${this.formatActivityType(activityData.activityType)}\n`;
    
    if (activityData.tokenId) {
      message += `🎯 **Token ID:** ${activityData.tokenId}\n`;
    }
    
    if (activityData.price && parseFloat(activityData.price) > 0) {
      const priceEth = parseFloat(activityData.price) / 1e18; // Convert Wei to ETH
      message += `💰 **Price:** ${priceEth.toFixed(4)} ETH\n`;
    }
    
    if (activityData.marketplace) {
      message += `🏪 **Marketplace:** ${activityData.marketplace}\n`;
    }
    
    if (activityData.fromAddress && activityData.toAddress) {
      message += `📤 **From:** \`${this.shortenAddress(activityData.fromAddress)}\`\n`;
      message += `📥 **To:** \`${this.shortenAddress(activityData.toAddress)}\`\n`;
    }
    
    message += `📮 **Contract:** \`${token.contract_address}\`\n`;
    
    if (activityData.transactionHash) {
      message += `🔗 **TX:** \`${this.shortenAddress(activityData.transactionHash)}\`\n`;
      message += `[View on Etherscan](https://sepolia.etherscan.io/tx/${activityData.transactionHash})`;
    }

    return message;
  }

  formatTrendingActivityMessage(token, activityData) {
    let message = `🔥 **TRENDING:** ${token.token_name || 'NFT Collection'}\n\n`;
    message += this.formatActivityMessage(token, activityData);
    return message;
  }

  getActivityEmoji(activityType) {
    const emojis = {
      'transfer': '🔄',
      'sale': '💸',
      'mint': '✨',
      'burn': '🔥',
      'external_transfer': '📤',
      'internal_transfer': '📥',
      'unknown': '❓'
    };
    
    return emojis[activityType] || '❓';
  }

  formatActivityType(activityType) {
    const types = {
      'transfer': 'Transfer',
      'sale': 'Sale',
      'mint': 'Mint',
      'burn': 'Burn',
      'external_transfer': 'External Transfer',
      'internal_transfer': 'Internal Transfer',
      'unknown': 'Unknown Activity'
    };
    
    return types[activityType] || 'Unknown Activity';
  }

  shortenAddress(address) {
    if (!address) return 'N/A';
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  async handleAddressActivity(payload) {
    try {
      // Handle address-specific activity if needed
      // For now, we mainly focus on NFT activity
      logger.info('Address activity webhook received (not implemented)');
      return false;
      
    } catch (error) {
      logger.error('Error handling address activity:', error);
      return false;
    }
  }

  // Health check endpoint
  async handleHealthCheck(req, res) {
    try {
      const status = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'unknown',
        bot: 'unknown'
      };

      // Check database
      try {
        await this.db.get('SELECT 1');
        status.database = 'connected';
      } catch (error) {
        status.database = 'disconnected';
        status.status = 'unhealthy';
      }

      // Check bot
      try {
        await this.bot.telegram.getMe();
        status.bot = 'connected';
      } catch (error) {
        status.bot = 'disconnected';
        status.status = 'unhealthy';
      }

      res.status(status.status === 'healthy' ? 200 : 503).json(status);
      
    } catch (error) {
      logger.error('Error in health check:', error);
      res.status(500).json({ 
        status: 'error', 
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = WebhookHandlers;