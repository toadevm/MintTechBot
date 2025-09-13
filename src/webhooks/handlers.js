const logger = require('../services/logger');

class WebhookHandlers {
  constructor(database, bot, trendingService = null, secureTrendingService = null) {
    this.db = database;
    this.bot = bot;
    this.trending = trendingService;
    this.secureTrending = secureTrendingService;
    this.processedTransactions = new Map();
    this.CACHE_EXPIRY_MS = 10 * 60 * 1000;
    setInterval(() => {
      this.cleanupExpiredTransactions();
    }, 5 * 60 * 1000);
  }

  async handleAlchemyWebhook(req, res) {
    try {
      const payload = req.body;
      logger.info('Received Alchemy webhook:', JSON.stringify(payload, null, 2));

      await this.db.logWebhook('alchemy', payload, false);
      let processed = false;
      if (payload.type === 'NFT_ACTIVITY') {
        processed = await this.handleNFTActivity(payload);
      } else if (payload.type === 'ADDRESS_ACTIVITY') {
        processed = await this.handleAddressActivity(payload);
      } else {
        logger.warn(`Unknown webhook type: ${payload.type}`);
      }

      await this.db.logWebhook('alchemy', payload, processed);

      res.status(200).json({ 
        success: true, 
        processed: processed,
        message: 'Webhook processed successfully' 
      });
    } catch (error) {
      logger.error('Error handling Alchemy webhook:', error);
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

  cleanupExpiredTransactions() {
    const now = Date.now();
    let removedCount = 0;
    for (const [txHash, timestamp] of this.processedTransactions.entries()) {
      if (now - timestamp > this.CACHE_EXPIRY_MS) {
        this.processedTransactions.delete(txHash);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      logger.debug(`Cleaned up ${removedCount} expired transaction cache entries`);
    }
  }

  isTransactionProcessed(txHash) {
    if (!txHash) return false;
    const timestamp = this.processedTransactions.get(txHash);
    if (!timestamp) return false;

    const isValid = (Date.now() - timestamp) <= this.CACHE_EXPIRY_MS;
    if (!isValid) {
      this.processedTransactions.delete(txHash);
      return false;
    }
    return true;
  }

  markTransactionProcessed(txHash) {
    if (txHash) {
      this.processedTransactions.set(txHash, Date.now());
    }
  }

  async processNFTActivity(activity) {
    try {
      const contractAddress = activity.contractAddress;
      const txHash = activity.hash;

      const tokenId = activity.tokenId || 
                     activity.token?.tokenId ||
                     activity.erc721TokenId ||
                     activity.log?.topics?.[3] ||
                     this.extractTokenIdFromTx(activity.hash);

      const activityType = this.determineActivityType(activity);

      // Create a unique key for deduplication based on contract + token + action
      const deduplicationKey = `${contractAddress}:${tokenId}:${activityType}:${txHash}`;
      
      logger.info(`Checking deduplication key: ${deduplicationKey}`);
      if (this.isTransactionProcessed(deduplicationKey)) {
        logger.info(`Activity ${deduplicationKey} already processed, skipping`);
        return;
      }

      // Mark as being processed immediately to prevent race conditions
      this.markTransactionProcessed(deduplicationKey);
      logger.info(`Marked as processing: ${deduplicationKey}`);

      logger.info(`Processing NFT activity: ${activityType} for ${contractAddress}:${tokenId}`);
      logger.debug(`Full activity data:`, JSON.stringify(activity, null, 2));


      const token = await this.db.getTrackedToken(contractAddress);
      if (!token || !token.is_active) {
        logger.debug(`Token ${contractAddress} not tracked or inactive, skipping`);
        return;
      }


      const activityData = {
        contractAddress: contractAddress,
        tokenId: tokenId || null,
        activityType: activityType,
        fromAddress: activity.fromAddress || null,
        toAddress: activity.toAddress || null,
        transactionHash: activity.hash || null,
        blockNumber: activity.blockNum || null,
        price: this.extractPrice(activity) || '1000000000000000',
        marketplace: this.extractMarketplace(activity) || null
      };

      await this.db.logNFTActivity(activityData);


      await this.notifyUsers(token, activityData);


      const shouldNotifyChannels = await this.shouldNotifyChannelsForToken(contractAddress);
      if (shouldNotifyChannels.notify) {
        logger.info(`📢 Notifying channels for ${token.token_name} (${shouldNotifyChannels.reason})`);
        await this.notifyChannels(token, activityData, shouldNotifyChannels.channels, shouldNotifyChannels.isTrending);
      } else {
        logger.debug(`Token ${token.token_name} - no channels configured for notifications`);
      }

      // Already marked as processed at the start
    } catch (error) {
      logger.error('Error processing NFT activity:', error);
      throw error;
    }
  }

  determineActivityType(activity) {
    const fromAddress = activity.fromAddress?.toLowerCase();
    const toAddress = activity.toAddress?.toLowerCase();

    if (!fromAddress || fromAddress === '0x0000000000000000000000000000000000000000' || fromAddress === '0x0') {
      return 'mint';
    }

    if (!toAddress || toAddress === '0x0000000000000000000000000000000000000000' || toAddress === '0x0') {
      return 'burn';
    }

    const marketplace = this.extractMarketplace(activity);
    if (marketplace) {
      return 'buy';
    }

    if (this.isMarketplaceAddress(fromAddress) || this.isMarketplaceAddress(toAddress)) {
      return 'buy';
    }

    return 'transfer';
  }

  isMarketplaceAddress(address) {
    if (!address) return false;
    const marketplaceAddresses = [

      '0x00000000006c3852cbef3e08e8df289169ede581',
      '0x00000000000001ad428e4906ae43d8f9852d0dd6',
      '0x00000000000006c7676171937c444f6bde3d6282',

      '0x000000000000ad05ccc4f10045630fb830b95127',
      '0x29469395eaf6f95920e59f858042f0e28d98a20b',

      '0x59728544b08ab483533076417fbbb2fd0b17ce3a',

      '0x2b2e8cda09bba9660dca5cb6233787738ad68329',

      '0xcda72070e455bb31c7690a170224ce43623d0b6f',

      '0x65b49f7aee40347f5a90b714be4ef086f3fe5e2c',

      '0x9757f2d2b135150bbeb65308d4a91804107cd8d6'
    ];
    return marketplaceAddresses.includes(address.toLowerCase());
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

      if (activity.value && parseFloat(activity.value) > 0) {
        return activity.value.toString();
      }
      if (activity.metadata?.value) {
        return activity.metadata.value.toString();
      }


      if (activity.log?.data) {


      }

      return null;
    } catch (error) {
      logger.error('Error extracting price from activity:', error);
      return null;
    }
  }

  extractMarketplace(activity) {
    try {

      if (activity.toAddress) {
        const address = activity.toAddress.toLowerCase();

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

      const users = await this.db.all(`
        SELECT u.telegram_id, u.username, us.notification_enabled
        FROM users u
        JOIN user_subscriptions us ON u.id = us.user_id
        WHERE us.token_id = ? AND us.notification_enabled = 1 AND u.is_active = 1
      `, [token.id]);

      const message = await this.formatActivityMessage(token, activityData);

      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (adminChatId) {
        try {
          await this.sendNotificationWithImage(adminChatId, message, token, activityData);
          logger.info(`Sent notification to group chat ${adminChatId} for token ${token.contract_address}`);
        } catch (error) {
          logger.error(`Failed to send notification to group chat ${adminChatId}:`, error);
        }
      }




      for (const user of users) {
        try {
          await this.sendNotificationWithImage(user.telegram_id, message, token, activityData);
          logger.debug(`Notified user ${user.telegram_id} about ${token.contract_address} activity`);
        } catch (error) {
          logger.error(`Failed to notify user ${user.telegram_id}:`, error);

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

  // Check if token is trending in either service (secure service first)
  async isTokenTrending(contractAddress) {
    try {
      // Check secure trending service first (preferred)
      if (this.secureTrending) {
        try {
          const isTrendingSecure = await this.secureTrending.isTokenTrending(contractAddress);
          if (isTrendingSecure) {
            logger.debug(`Token ${contractAddress} is trending via secure service`);
            return true;
          }
        } catch (error) {
          logger.error('Error checking secure trending service:', error);
        }
      }
      
      // Fall back to old trending service
      if (this.trending) {
        try {
          const isTrendingOld = await this.trending.isTokenTrending(contractAddress);
          if (isTrendingOld) {
            logger.debug(`Token ${contractAddress} is trending via old service`);
            return true;
          }
        } catch (error) {
          logger.error('Error checking old trending service:', error);
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Error in unified trending check:', error);
      return false;
    }
  }

  async shouldNotifyChannelsForToken(contractAddress) {
    try {

      const allChannels = await this.db.all(`
        SELECT * FROM channels 
        WHERE is_active = 1 AND (show_trending = 1 OR show_all_activities = 1)
      `);

      if (allChannels.length === 0) {
        return { notify: false, channels: [], isTrending: false, reason: 'no active channels' };
      }


      const isTrending = await this.isTokenTrending(contractAddress);


      const eligibleChannels = allChannels.filter(channel => {

        if (channel.show_all_activities === 1) {
          return true;
        }

        if (channel.show_trending === 1 && isTrending) {
          return true;
        }
        return false;
      });

      if (eligibleChannels.length === 0) {
        const reason = isTrending 
          ? 'token is trending but no channels have trending notifications enabled'
          : 'token is not trending and no channels have all activities enabled';
        return { notify: false, channels: [], isTrending, reason };
      }

      const reason = isTrending 
        ? `token is trending (${eligibleChannels.filter(c => c.show_trending === 1).length} trending channels)`
        : `${eligibleChannels.length} channels have all activities enabled`;

      return { 
        notify: true, 
        channels: eligibleChannels,
        isTrending,
        reason 
      };
    } catch (error) {
      logger.error('Error checking channel notification requirements:', error);
      return { notify: false, channels: [], isTrending: false, reason: 'error checking requirements' };
    }
  }

  async notifyChannels(token, activityData, channels = null, isTrending = false) {
    try {

      if (!channels) {
        channels = await this.db.all(`
          SELECT * FROM channels 
          WHERE is_active = 1 AND show_trending = 1
        `);
      }

      if (channels.length === 0) {
        logger.debug('No channels provided for notifications');
        return;
      }

      const message = isTrending 
        ? await this.formatTrendingActivityMessage(token, activityData)
        : await this.formatActivityMessage(token, activityData);
      let notifiedCount = 0;
      for (const channel of channels) {
        try {
          await this.sendNotificationWithImage(channel.telegram_chat_id, message, token, activityData);
          notifiedCount++;
          logger.info(`Sent notification to channel ${channel.telegram_chat_id} (${channel.channel_title})`);
        } catch (error) {
          logger.error(`Failed to notify channel ${channel.telegram_chat_id}:`, error);

          if (error.response?.error_code === 403) {
            await this.db.run(
              'UPDATE channels SET is_active = 0 WHERE telegram_chat_id = ?',
              [channel.telegram_chat_id]
            );
          }
        }
      }
      logger.info(`Notified ${notifiedCount}/${channels.length} channels about ${token.token_name} activity`);
    } catch (error) {
      logger.error('Error notifying channels:', error);
    }
  }

  async formatActivityMessage(token, activityData) {
    const tokenName = token.token_name || 'NFT Collection';

    const isCandyCollection = tokenName.toLowerCase().includes('candy') || 
                             tokenName.toLowerCase() === 'simplenft';
    let message = '';
    if (isCandyCollection) {

      const rawTokenId = activityData.tokenId || 'Unknown';
      const tokenId = this.formatTokenId(rawTokenId);
      const ethAmount = this.formatEthAmount(activityData.price) || '0.001 ETH';
      message = `🍭 **Candy #${tokenId}** minted! ${ethAmount}\n\n`;
    } else {
      const activityEmoji = this.getActivityEmoji(activityData.activityType);
      message = `${activityEmoji} *${tokenName}* Activity\n\n`;
    }
    message += `🔹 **Action:** ${this.formatActivityType(activityData.activityType)}\n`;
    const ethPrice = this.formatEthAmount(activityData.price) || '0.001 ETH';
    message += `💰 **Amount:** ${ethPrice}\n`;
    if (activityData.fromAddress && activityData.toAddress) {
      message += `📤 **From:** \`${this.shortenAddress(activityData.fromAddress)}\`\n`;
      message += `📥 **To:** \`${this.shortenAddress(activityData.toAddress)}\`\n`;
    }
    message += `📮 **CA:** \`${this.shortenAddress(token.contract_address)}\`\n`;
    if (activityData.transactionHash) {
      message += `🔗 **TX:** \`${this.shortenAddress(activityData.transactionHash)}\`\n`;
      message += `[View on Etherscan](https://sepolia.etherscan.io/tx/${activityData.transactionHash})`;
    } else {
      message += '\n';
    }

    message += `\n\nPowered by [Candy Codex](https://t.me/testcandybot)`;

    // Add footer advertisements if available
    if (this.secureTrending) {
      try {
        const footerAds = await this.secureTrending.getActiveFooterAds();
        if (footerAds && footerAds.length > 0) {
          const adLinks = footerAds.map(ad => `[${ad.token_symbol}](${ad.custom_link})`).join(' 🎨');
          message += `\n🎨 ${adLinks}`;
        } else {
          message += `\n[Buy Ad spot](https://t.me/testcandybot?start=buy_footer)`;
        }
      } catch (error) {
        // If footer ads fail, just show buy ad spot
        message += `\n[Buy Ad spot](https://t.me/testcandybot?start=buy_footer)`;
      }
    } else {
      message += `\n[Buy Ad spot](https://t.me/testcandybot?start=buy_footer)`;
    }

    return message;
  }

  formatEthAmount(priceWei) {
    if (!priceWei || parseFloat(priceWei) <= 0) {
      return null;
    }
    const priceEth = parseFloat(priceWei) / 1e18;
    if (priceEth >= 1) {
      return `${priceEth.toFixed(3)} ETH`;
    } else if (priceEth >= 0.001) {
      return `${priceEth.toFixed(4)} ETH`;
    } else {
      return `${(priceEth * 1000).toFixed(2)} mETH`;
    }
  }

  async formatTrendingActivityMessage(token, activityData) {
    let message = `🔥 **TRENDING:** ${token.token_name || 'NFT Collection'}\n\n`;
    message += await this.formatActivityMessage(token, activityData);
    return message;
  }

  getActivityEmoji(activityType) {
    const emojis = {
      'transfer': '🔄',
      'buy': '🛒',
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
      'buy': 'Buy',
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
      logger.info('Address activity webhook received:', JSON.stringify(payload, null, 2));

      if (!payload.event || !payload.event.activity) {
        logger.warn('Invalid address activity payload structure');
        return false;
      }

      const activities = Array.isArray(payload.event.activity) 
        ? payload.event.activity 
        : [payload.event.activity];

      let processedCount = 0;

      for (const activity of activities) {
        try {
          // Address activities are handled manually via /validate command
          // No automatic ETH transfer processing to prevent race conditions
          logger.debug('Address activity received - manual validation required via /validate command');
        } catch (error) {
          logger.error(`Error processing individual address activity:`, error);
        }
      }

      logger.info(`Processed ${processedCount}/${activities.length} address activities`);
      return processedCount > 0;
    } catch (error) {
      logger.error('Error handling address activity:', error);
      return false;
    }
  }



  async handleHealthCheck(req, res) {
    try {
      const status = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'unknown',
        bot: 'unknown'
      };


      try {
        await this.db.get('SELECT 1');
        status.database = 'connected';
      } catch (error) {
        status.database = 'disconnected';
        status.status = 'unhealthy';
      }


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

  async sendNotificationWithImage(chatId, message, token, activityData) {
    const NFTMetadataService = require('../services/nftMetadataService');
    const metadataService = new NFTMetadataService();
    
    try {
      logger.info('Attempting to fetch NFT metadata with traits for notification');
      
      let nftData;
      let imagePath = null;
      
      // Check if this is our MongsInspired contract
      const mongsInspiredContract = process.env.MONGS_INSPIRED_CONTRACT_ADDRESS;
      if (token.contract_address.toLowerCase() === mongsInspiredContract?.toLowerCase()) {
        // Use the actual minted token ID from activity data
        const actualTokenId = activityData?.tokenId;
        if (actualTokenId) {
          try {
            nftData = await metadataService.getMongsInspiredToken(token.contract_address, actualTokenId);
          } catch (error) {
            logger.warn(`Failed to fetch MongsInspired token ${actualTokenId}, falling back to MONGS: ${error.message}`);
            nftData = await metadataService.getRandomMongsToken();
          }
        } else {
          logger.warn(`No token ID found in activity data for MongsInspired contract, falling back to MONGS`);
          nftData = await metadataService.getRandomMongsToken();
        }
      } else {
        // Fall back to MONGS mainnet for other tokens
        nftData = await metadataService.getRandomMongsToken();
      }
      
      // Check if image fee is paid for this contract
      const hasImageFee = this.secureTrending ? await this.secureTrending.isImageFeeActive(token.contract_address) : false;
      
      // Download and resize image if available and image fee is paid
      let originalImagePath = null;
      if (hasImageFee && nftData.metadata.image) {
        originalImagePath = await metadataService.downloadImage(nftData.metadata.image, nftData.tokenId);
        if (originalImagePath) {
          imagePath = await metadataService.resizeImage(originalImagePath, 300, 300);
        }
      } else if (!hasImageFee) {
        // Use default image when image fee not paid, resize to 300x300
        imagePath = await metadataService.resizeImage('./src/bot/defaultNFTImage.jpg', 300, 300);
      }
      
      // Format the enhanced message with traits
      const nftMessage = metadataService.formatMetadataForTelegram(nftData);
      
      // Extract NFT name from the formatted message
      const nftNameMatch = nftMessage.match(/🎨 \*\*(.*?)\*\*/);
      const nftName = nftNameMatch ? nftNameMatch[1] : '';
      
      // Split the original message to insert NFT name after the activity title
      const messageParts = message.split('\n\n');
      const activityTitle = messageParts[0]; // "✨ MONGS Inspired Activity"
      const restOfMessage = messageParts.slice(1).join('\n\n');
      
      const enhancedMessage = nftName 
        ? `${activityTitle}\n🎨 **${nftName}**\n\n${restOfMessage}\n\n${nftMessage.replace(/🎨 \*\*.*?\*\*\n\n/, '')}`
        : `${message}\n\n${nftMessage}`;
      
      const boostButton = {
        reply_markup: {
          inline_keyboard: [[
            { 
              text: 'BOOST YOUR NFT🟢', 
              url: `https://t.me/testcandybot?start=buy_trending`
            }
          ]]
        }
      };

      if (imagePath) {
        await this.bot.telegram.sendPhoto(
          chatId,
          { source: imagePath },
          {
            caption: enhancedMessage,
            parse_mode: 'Markdown',
            ...boostButton
          }
        );
      } else {
        await this.bot.telegram.sendMessage(
          chatId,
          enhancedMessage,
          { 
            parse_mode: 'Markdown',
            ...boostButton
          }
        );
      }
      
      // Cleanup downloaded images after a delay (but not the default image)
      const imagesToCleanup = [originalImagePath, imagePath]
        .filter(Boolean)
        .filter(path => !path.includes('defaultNFTImage.jpg')); // Don't cleanup default image
      if (imagesToCleanup.length > 0) {
        setTimeout(async () => {
          for (const imageToCleanup of imagesToCleanup) {
            try {
              await require('fs').promises.unlink(imageToCleanup);
              logger.info(`Cleaned up image: ${imageToCleanup}`);
            } catch (error) {
              logger.warn(`Failed to cleanup image ${imageToCleanup}: ${error.message}`);
            }
          }
        }, 60000); // Cleanup after 1 minute
      }
      logger.info(`Successfully sent notification with NFT metadata and traits`);
      return;
      
    } catch (imageError) {
      logger.warn(`Failed to fetch external NFT image, falling back to text: ${imageError.message}`);
      
      await this.bot.telegram.sendMessage(
        chatId,
        message,
        { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        }
      );
    }
  }

  extractTokenIdFromTx(txHash) {


    if (!txHash) return null;

    const hashEnd = txHash.slice(-4);
    const tokenId = parseInt(hashEnd, 16) % 1000;
    return tokenId.toString();
  }

  formatTokenId(tokenId) {
    if (!tokenId || tokenId === 'Unknown') {
      return 'Unknown';
    }

    if (typeof tokenId === 'string' && tokenId.startsWith('0x')) {
      const decimal = parseInt(tokenId, 16);
      return decimal.toString();
    }

    return tokenId.toString();
  }
}

module.exports = WebhookHandlers;