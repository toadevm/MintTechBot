const logger = require('../services/logger');

class WebhookHandlers {
  constructor(database, bot, trendingService = null, secureTrendingService = null, openSeaService = null, chainManager = null, magicEdenService = null, heliusService = null) {
    this.db = database;
    this.bot = bot;
    this.trending = trendingService;
    this.secureTrending = secureTrendingService;
    this.openSea = openSeaService;
    this.chainManager = chainManager;
    this.magicEden = magicEdenService;
    this.helius = heliusService;
    this.processedTransactions = new Map();
    this.processedOpenSeaEvents = new Map(); // Track OpenSea events to prevent duplicates
    this.processedHeliusEvents = new Map(); // Track Helius events to prevent duplicates
    this.CACHE_EXPIRY_MS = 10 * 60 * 1000;
    setInterval(() => {
      this.cleanupExpiredTransactions();
      this.cleanupExpiredOpenSeaEvents();
      this.cleanupExpiredHeliusEvents();
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

  cleanupExpiredOpenSeaEvents() {
    const now = Date.now();
    let removedCount = 0;
    for (const [eventKey, timestamp] of this.processedOpenSeaEvents.entries()) {
      if (now - timestamp > this.CACHE_EXPIRY_MS) {
        this.processedOpenSeaEvents.delete(eventKey);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      logger.debug(`Cleaned up ${removedCount} expired OpenSea event cache entries`);
    }
  }

  cleanupExpiredHeliusEvents() {
    const now = Date.now();
    let removedCount = 0;
    for (const [eventKey, timestamp] of this.processedHeliusEvents.entries()) {
      if (now - timestamp > this.CACHE_EXPIRY_MS) {
        this.processedHeliusEvents.delete(eventKey);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      logger.debug(`Cleaned up ${removedCount} expired Helius event cache entries`);
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
      // Get users with their subscription context (chat_id)
      const subscriptions = await this.db.all(`
        SELECT u.telegram_id, u.username, us.notification_enabled, us.chat_id
        FROM users u
        JOIN user_subscriptions us ON u.id = us.user_id
        WHERE us.token_id = $1 AND us.notification_enabled = true AND u.is_active = true
      `, [token.id]);

      if (!subscriptions || subscriptions.length === 0) {
        logger.debug(`No users subscribed to token: ${token.contract_address}`);
        return false;
      }

      const message = await this.formatActivityMessage(token, activityData);
      logger.info(`📤 Sending notification to ${subscriptions.length} subscription(s) for ${token.token_name}`);

      // Send notifications to users in their specific subscribed contexts
      let successCount = 0;

      // Send to subscribed users in their correct context
      for (const subscription of subscriptions) {
        try {
          // Determine target chat ID based on subscription context
          let targetChatId;
          if (subscription.chat_id === 'private') {
            // For private chats, send to user's private chat
            targetChatId = subscription.telegram_id;
          } else {
            // For group chats, send to the specific group where they subscribed
            targetChatId = subscription.chat_id;
          }

          await this.sendNotificationWithImage(targetChatId, message, token, activityData);
          successCount++;
          logger.info(`✅ Notification sent to ${subscription.chat_id === 'private' ? 'private chat' : 'group'} ${targetChatId} for user ${subscription.telegram_id}`);
        } catch (error) {
          logger.error(`❌ Failed to send notification to ${subscription.chat_id} for user ${subscription.telegram_id}:`, error);

          if (error.response?.error_code === 403 || error.response?.error_code === 400) {
            await this.db.run(
              'UPDATE users SET is_active = false WHERE telegram_id = $1',
              [subscription.telegram_id]
            );
            logger.info(`Deactivated user ${subscription.telegram_id} due to delivery failure`);
          }
        }
      }

      logger.info(`📊 Notification summary: ${successCount}/${subscriptions.length} notifications sent successfully`);
      return successCount > 0;
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
            logger.info(`🔐 VERIFIED: Token ${contractAddress} has valid trending payment`);
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
            logger.info(`🔐 VERIFIED: Token ${contractAddress} is trending via legacy service`);
            return true;
          }
        } catch (error) {
          logger.error('Error checking old trending service:', error);
        }
      }

      logger.info(`🚫 NO PAYMENT: Token ${contractAddress} has no active trending payment`);
      return false;
    } catch (error) {
      logger.error('Error in unified trending check:', error);
      return false;
    }
  }

  // Secure verification for channel notifications with detailed logging
  async verifyChannelNotificationPermission(contractAddress, tokenName) {
    try {
      logger.info(`🔍 SECURITY CHECK: Verifying channel notification permission for ${tokenName} (${contractAddress})`);

      // Double-check trending payment status
      const hasTrendingPayment = await this.isTokenTrending(contractAddress);

      if (hasTrendingPayment) {
        logger.info(`✅ AUTHORIZED: ${tokenName} has valid trending payment - channel notifications allowed`);
        return { authorized: true, reason: 'valid trending payment verified' };
      } else {
        logger.warn(`⚠️ BLOCKED: ${tokenName} has no trending payment - channel notifications denied`);
        return { authorized: false, reason: 'no trending payment found' };
      }
    } catch (error) {
      logger.error(`🚨 SECURITY ERROR: Failed to verify channel permission for ${contractAddress}:`, error);
      return { authorized: false, reason: 'verification error' };
    }
  }

  async shouldNotifyChannelsForToken(contractAddress) {
    try {
      // Get all active channels
      const allChannels = await this.db.all(`
        SELECT * FROM channels
        WHERE is_active = true AND (show_trending = true OR show_all_activities = true)
      `);

      if (allChannels.length === 0) {
        return { notify: false, channels: [], isTrending: false, reason: 'no active channels' };
      }

      // Check if token has trending payment (secure verification)
      const isTrending = await this.isTokenTrending(contractAddress);

      // SECURITY ENHANCEMENT: Only tokens with trending payments get channel notifications
      if (!isTrending) {
        logger.info(`🔒 Channel notification blocked: ${contractAddress} has no active trending payment`);
        return {
          notify: false,
          channels: [],
          isTrending: false,
          reason: 'token not trending - channel notifications restricted to paid trending only'
        };
      }

      // If token is trending, find eligible channels
      const eligibleChannels = allChannels.filter(channel => {
        // For trending tokens, both show_all_activities and show_trending channels are eligible
        if (channel.show_all_activities === 1 || channel.show_trending === 1) {
          return true;
        }
        return false;
      });

      if (eligibleChannels.length === 0) {
        return {
          notify: false,
          channels: [],
          isTrending: true,
          reason: 'token is trending but no channels have notifications enabled'
        };
      }

      logger.info(`✅ Channel notification authorized: ${contractAddress} has active trending payment`);
      return {
        notify: true,
        channels: eligibleChannels,
        isTrending: true,
        reason: `token has trending payment (${eligibleChannels.length} eligible channels)`
      };
    } catch (error) {
      logger.error('Error checking channel notification requirements:', error);
      return { notify: false, channels: [], isTrending: false, reason: 'error checking requirements' };
    }
  }

  async notifyChannels(token, activityData, channels = null, isTrending = false) {
    try {
      // SECURITY: Additional verification before sending channel notifications
      const verification = await this.verifyChannelNotificationPermission(token.contract_address, token.token_name);
      if (!verification.authorized) {
        logger.warn(`🔒 BLOCKED CHANNEL NOTIFICATION: ${token.token_name} - ${verification.reason}`);
        return;
      }

      if (!channels) {
        channels = await this.db.all(`
          SELECT * FROM channels
          WHERE is_active = true AND show_trending = true
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
          logger.info(`📤 SENDING to channel ${channel.channel_title}: ${token.token_name} (verified trending payment)`);
          await this.sendNotificationWithImage(channel.telegram_chat_id, message, token, activityData);
          notifiedCount++;
          logger.info(`✅ Notification sent to channel ${channel.telegram_chat_id} (${channel.channel_title})`);
        } catch (error) {
          logger.error(`Failed to notify channel ${channel.telegram_chat_id}:`, error);

          if (error.response?.error_code === 403) {
            await this.db.run(
              'UPDATE channels SET is_active = false WHERE telegram_chat_id = $1',
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

    // Add chain information
    if (this.chainManager && token.chain_name) {
      const chainConfig = this.chainManager.getChain(token.chain_name);
      if (chainConfig) {
        message += `🔗 **Chain:** ${chainConfig.emoji} ${chainConfig.displayName}\n`;
      } else {
        message += `🔗 **Chain:** ${token.chain_name}\n`;
      }
    }

    if (activityData.transactionHash) {
      message += `🔗 **TX:** \`${this.shortenAddress(activityData.transactionHash)}\`\n`;
      message += `[View on Etherscan](https://etherscan.io/tx/${activityData.transactionHash})`;
    } else {
      message += '\n';
    }

    message += ` \nPowered by [Candy Codex](https://buy.candycodex.com/)`;

    // Add footer advertisements if available
    if (this.secureTrending) {
      try {
        const footerAds = await this.secureTrending.getActiveFooterAds();
        if (footerAds && footerAds.length > 0) {
          const adLinks = footerAds.map(ad => {
            const ticker = ad.ticker_symbol || ad.token_symbol || 'TOKEN';
            return `[⭐️${ticker}](${ad.custom_link})`;
          });

          // Add "BuyAdspot" if less than 3 slots are filled
          if (adLinks.length < 3) {
            adLinks.push('[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)');
          }

          message += `\n${adLinks.join(' ')}`;
        } else {
          message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
        }
      } catch (error) {
        // If footer ads fail, just show buy ad spot
        message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
      }
    } else {
      message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
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

    // Check if image fee is paid for this contract FIRST
    const hasImageFee = this.secureTrending ? await this.secureTrending.isImageFeeActive(token.contract_address) : false;
    logger.info(`🖼️ IMAGE FEE CHECK: ${token.contract_address} (${token.token_name}) - hasImageFee: ${hasImageFee}`);

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

      // Handle image processing based on payment status
      let originalImagePath = null;
      if (hasImageFee && nftData.metadata.image) {
        // For PAID tokens: Retry until successful, never fallback
        logger.info(`✅ IMAGE FEE PAID: Processing actual NFT image for ${token.token_name} - WILL RETRY UNTIL SUCCESS`);
        const result = await this.retryImageProcessingForPaidToken(metadataService, nftData.metadata.image, nftData.tokenId, token.token_name);
        originalImagePath = result.originalPath;
        imagePath = result.resizedPath;
      } else {
        // For UNPAID tokens: Use default tracking image immediately
        logger.info(`🚫 IMAGE FEE NOT PAID: Using default tracking image for ${token.token_name}`);
        // Use pre-sized default tracking image for better performance
        const path = require('path');
        imagePath = path.join(__dirname, '../../src/bot/defaultTracking_300x300.jpg');
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
        inline_keyboard: [[
          {
            text: 'BOOST YOUR NFT🟢',
            callback_data: '/buy_trending'
          }
        ]]
      };

      // ALWAYS send as photo - image processing is guaranteed to succeed
      await this.bot.telegram.sendPhoto(
        chatId,
        { source: imagePath },
        {
          caption: enhancedMessage,
          parse_mode: 'Markdown',
          reply_markup: boostButton
        }
      );

      // Cleanup downloaded images after a delay (only for paid tokens with NFT metadata images)
      const imagesToCleanup = hasImageFee ? [originalImagePath, imagePath].filter(Boolean) : []; // Only cleanup NFT metadata images for paid tokens
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
      // For PAID tokens: This should never happen due to retry logic
      if (hasImageFee) {
        logger.error(`🚨 CRITICAL: Paid token ${token.token_name} failed image processing after retries: ${imageError.message}`);
        throw new Error(`Paid token image processing failed: ${imageError.message}`);
      }

      // For UNPAID tokens: Fallback to default image with retry
      logger.warn(`Unpaid token ${token.token_name} failed, retrying with default image: ${imageError.message}`);

      try {
        // Use pre-sized default tracking image for better performance
        const path = require('path');
        const defaultImagePath = path.join(__dirname, '../../src/bot/defaultTracking_300x300.jpg');
        const boostButton = {
          inline_keyboard: [[
            {
              text: 'BOOST YOUR NFT🟢',
              callback_data: '/buy_trending'
            }
          ]]
        };

        await this.bot.telegram.sendPhoto(
          chatId,
          { source: defaultImagePath },
          {
            caption: message,
            parse_mode: 'Markdown',
            reply_markup: boostButton
          }
        );
        logger.info(`Sent notification with default image for unpaid token ${token.token_name}`);
      } catch (fallbackError) {
        logger.error(`🚨 CRITICAL: Even default image failed for ${token.token_name}: ${fallbackError.message}`);
        throw new Error(`Complete image processing failure: ${fallbackError.message}`);
      }
    }
  }

  // Retry image processing for paid tokens - keeps trying until success
  async retryImageProcessingForPaidToken(metadataService, imageUrl, tokenId, tokenName, maxRetries = 10) {
    let attempt = 1;

    // Add a unique processing key to prevent duplicate retries for the same notification
    const processingKey = `${tokenName}:${tokenId}:${Date.now()}`;
    logger.info(`🔒 STARTING PAID TOKEN PROCESSING: ${processingKey}`);

    while (attempt <= maxRetries) {
      try {
        logger.info(`🔄 PAID TOKEN RETRY ${attempt}/${maxRetries}: Processing image for ${tokenName} (${processingKey})`);

        const originalImagePath = await metadataService.downloadImage(imageUrl, tokenId);
        if (originalImagePath) {
          const resizedImagePath = await metadataService.resizeImage(originalImagePath, 300, 300);
          if (resizedImagePath) {
            logger.info(`✅ PAID TOKEN SUCCESS: Image processed on attempt ${attempt} for ${tokenName} (${processingKey})`);
            return {
              originalPath: originalImagePath,
              resizedPath: resizedImagePath
            };
          }
        }

        logger.warn(`⚠️ PAID TOKEN ATTEMPT ${attempt} FAILED: Retrying in ${attempt * 2} seconds for ${tokenName} (${processingKey})`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // Exponential backoff
        attempt++;

      } catch (error) {
        logger.error(`❌ PAID TOKEN ATTEMPT ${attempt} ERROR for ${tokenName} (${processingKey}): ${error.message}`);

        if (attempt === maxRetries) {
          logger.error(`🚨 PAID TOKEN FINAL FAILURE: All ${maxRetries} attempts failed for ${tokenName} (${processingKey})`);
          throw new Error(`Paid token image processing failed after ${maxRetries} attempts: ${error.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        attempt++;
      }
    }

    throw new Error(`Paid token image processing exhausted all ${maxRetries} attempts`);
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

  // OpenSea Event Handling Methods
  async handleOpenSeaEvent(eventType, eventData, rawEvent) {
    try {
      logger.info(`🌊 OPENSEA EVENT PROCESSING - ${eventType} for collection: ${eventData.collectionSlug}`);

      // Create unique key for deduplication
      const eventKey = this.createOpenSeaEventKey(eventType, eventData);

      if (this.isOpenSeaEventProcessed(eventKey)) {
        logger.info(`   ⏭️ Event ${eventKey} already processed, skipping`);
        return false;
      }

      // Mark as being processed
      this.markOpenSeaEventProcessed(eventKey);

      // CRITICAL: Check if we have tracked tokens for this collection
      const tokens = await this.db.getTokensForCollectionSlug(eventData.collectionSlug);
      logger.info(`   📊 Collection ${eventData.collectionSlug} analysis:`);
      logger.info(`      - Tokens returned by query: ${tokens?.length || 0}`);

      if (!tokens || tokens.length === 0) {
        logger.info(`   🛑 STOPPING EVENT PROCESSING - No tracked tokens found for collection: ${eventData.collectionSlug}`);
        logger.info(`      - This collection should not receive events anymore`);
        return false;
      }

      // Log details about returned tokens
      logger.info(`      - Active tokens in collection:`, tokens.map(t => ({
        contract: t.contract_address,
        name: t.token_name,
        is_active: t.is_active,
        has_subscriptions: 'checking...'
      })));

      // Additional safety check: verify at least one token has active subscriptions
      let hasAnyActiveSubscriptions = false;
      for (const token of tokens) {
        if (typeof this.db.hasAnyActiveSubscriptions === 'function') {
          const tokenHasSubscriptions = await this.db.hasAnyActiveSubscriptions(token.id);
          if (tokenHasSubscriptions) {
            hasAnyActiveSubscriptions = true;
            logger.info(`      - Token ${token.contract_address} has active subscriptions: YES`);
          } else {
            logger.info(`      - Token ${token.contract_address} has active subscriptions: NO`);
          }
        } else {
          logger.info(`      - Token ${token.contract_address} subscription check skipped (method not available)`);
        }
      }

      if (!hasAnyActiveSubscriptions) {
        logger.info(`   🛑 STOPPING EVENT PROCESSING - Collection ${eventData.collectionSlug} has no tokens with active subscriptions`);
        logger.info(`      - This indicates a database inconsistency or recent unsubscription`);
        return false;
      }

      logger.info(`   ✅ Proceeding with event processing for ${tokens.length} tokens`);

      // Process each tracked token in this collection
      let processedCount = 0;
      for (const token of tokens) {
        try {
          await this.processOpenSeaEventForToken(eventType, eventData, token, rawEvent);
          processedCount++;
        } catch (error) {
          logger.error(`Error processing OpenSea event for token ${token.contract_address}:`, error);
        }
      }

      logger.info(`Processed OpenSea ${eventType} event for ${processedCount} tokens`);
      return processedCount > 0;
    } catch (error) {
      logger.error(`Error handling OpenSea ${eventType} event:`, error);
      return false;
    }
  }

  async processOpenSeaEventForToken(eventType, eventData, token, rawEvent) {
    try {
      // SAFEGUARD: Verify token still exists in database before processing
      const tokenExists = await this.db.get('SELECT id FROM tracked_tokens WHERE id = $1 AND is_active = true', [token.id]);
      if (!tokenExists) {
        logger.warn(`🚫 Skipping OpenSea event processing - token ${token.contract_address} no longer exists in database`);
        return;
      }

      // SAFEGUARD: Check if any users exist in database at all
      const userCount = await this.db.get('SELECT COUNT(*) as count FROM users WHERE is_active = true');
      if (!userCount || userCount.count === 0) {
        logger.warn(`🚫 Skipping OpenSea event processing - no active users in database`);
        return;
      }

      // OPTIMIZATION: Skip processing if token has no active subscriptions and no premium features
      const hasActiveSubscriptions = typeof this.db.hasAnyActiveSubscriptions === 'function'
        ? await this.db.hasAnyActiveSubscriptions(token.id)
        : false;
      const hasActivePremiumFeatures = await this.db.hasActivePremiumFeatures(token.contract_address);

      if (!hasActiveSubscriptions && !hasActivePremiumFeatures) {
        logger.debug(`⏭️ Skipping OpenSea event processing - token ${token.contract_address} has no active subscriptions or premium features`);
        return;
      }

      // Convert OpenSea event to our internal activity format
      const activityData = this.convertOpenSeaEventToActivity(eventType, eventData, token);

      // Log the activity
      await this.db.logNFTActivity(activityData);

      // Notify users subscribed to this specific token with rich OpenSea data
      await this.notifyUsersOpenSea(token, eventType, eventData, activityData);

      // Check if token should notify channels
      const shouldNotifyChannels = await this.shouldNotifyChannelsForToken(token.contract_address);
      if (shouldNotifyChannels.notify) {
        logger.info(`📢 Notifying channels for ${token.token_name} via OpenSea event (${shouldNotifyChannels.reason})`);
        await this.notifyChannelsOpenSea(token, eventType, eventData, activityData, shouldNotifyChannels.channels, shouldNotifyChannels.isTrending);
      }

      logger.info(`Successfully processed OpenSea ${eventType} event for token ${token.contract_address}`);
    } catch (error) {
      logger.error(`Error processing OpenSea event for token ${token.contract_address}:`, error);
      throw error;
    }
  }

  convertOpenSeaEventToActivity(eventType, eventData, token) {
    // Map OpenSea event types to our activity types (excluding cancelled events)
    const activityTypeMap = {
      'listed': 'sale',
      'sold': 'buy',
      'transferred': 'transfer',
      'metadata_updated': 'transfer',
      'received_bid': 'sale',
      'received_offer': 'sale'
    };

    return {
      contractAddress: eventData.contractAddress || token.contract_address,
      tokenId: eventData.tokenId || null,
      activityType: activityTypeMap[eventType] || 'transfer',
      fromAddress: eventData.fromAddress || eventData.makerAddress,
      toAddress: eventData.toAddress || eventData.takerAddress,
      transactionHash: eventData.transactionHash || null,
      blockNumber: eventData.blockNumber || null,
      price: eventData.price || '1000000000000000', // Default to 0.001 ETH in wei
      marketplace: 'OpenSea'
    };
  }

  createOpenSeaEventKey(eventType, eventData) {
    // Create unique key for deduplication
    const contractAddress = eventData.contractAddress || 'unknown';
    const tokenId = eventData.tokenId || 'unknown';
    const txHash = eventData.transactionHash || eventData.orderHash || 'unknown';
    const timestamp = eventData.sentAt || new Date().toISOString();

    return `opensea:${eventType}:${contractAddress}:${tokenId}:${txHash}:${timestamp}`;
  }

  isOpenSeaEventProcessed(eventKey) {
    const timestamp = this.processedOpenSeaEvents.get(eventKey);
    if (!timestamp) return false;

    const isValid = (Date.now() - timestamp) <= this.CACHE_EXPIRY_MS;
    if (!isValid) {
      this.processedOpenSeaEvents.delete(eventKey);
      return false;
    }
    return true;
  }

  markOpenSeaEventProcessed(eventKey) {
    this.processedOpenSeaEvents.set(eventKey, Date.now());
  }

  // Setup OpenSea event handlers for a collection
  async setupOpenSeaHandlers(collectionSlug) {
    try {
      if (!this.openSea) {
        logger.warn('OpenSea service not available');
        return null;
      }

      const eventHandlers = {
        listed: (eventData, rawEvent) => this.handleOpenSeaEvent('listed', eventData, rawEvent),
        sold: (eventData, rawEvent) => this.handleOpenSeaEvent('sold', eventData, rawEvent),
        cancelled: (eventData, rawEvent) => this.handleOpenSeaEvent('cancelled', eventData, rawEvent),
        received_bid: (eventData, rawEvent) => this.handleOpenSeaEvent('received_bid', eventData, rawEvent),
        received_offer: (eventData, rawEvent) => this.handleOpenSeaEvent('received_offer', eventData, rawEvent),
        default: (eventType, eventData, rawEvent) => this.handleOpenSeaEvent(eventType, eventData, rawEvent)
      };

      const subscription = await this.openSea.subscribeToCollection(collectionSlug, eventHandlers);
      logger.info(`Set up OpenSea event handlers for collection: ${collectionSlug}`);
      return subscription;
    } catch (error) {
      logger.error(`Failed to setup OpenSea handlers for collection ${collectionSlug}:`, error);
      throw error;
    }
  }

  // OpenSea-specific notification methods with rich data formatting
  async notifyUsersOpenSea(token, eventType, eventData, activityData) {
    try {
      // SAFEGUARD: Verify token still exists in database
      const tokenExists = await this.db.get('SELECT id FROM tracked_tokens WHERE id = $1 AND is_active = true', [token.id]);
      if (!tokenExists) {
        logger.warn(`🚫 Skipping notification - token ${token.contract_address} no longer exists in database`);
        return false;
      }

      // SAFEGUARD: Check if any users exist in database at all
      const userCount = await this.db.get('SELECT COUNT(*) as count FROM users WHERE is_active = true');
      if (!userCount || userCount.count === 0) {
        logger.warn(`🚫 Skipping notification - no active users in database`);
        return false;
      }

      // OPTIMIZATION: Skip if no active subscriptions (avoids unnecessary query)
      const hasActiveSubscriptions = typeof this.db.hasAnyActiveSubscriptions === 'function'
        ? await this.db.hasAnyActiveSubscriptions(token.id)
        : false;
      if (!hasActiveSubscriptions) {
        logger.debug(`⏭️ Skipping OpenSea notification - token ${token.contract_address} has no active subscriptions`);
        return false;
      }

      // Get users with their subscription context (chat_id)
      const subscriptions = await this.db.all(`
        SELECT u.telegram_id, u.username, us.notification_enabled, us.chat_id
        FROM users u
        JOIN user_subscriptions us ON u.id = us.user_id
        WHERE us.token_id = $1 AND us.notification_enabled = true AND u.is_active = true
      `, [token.id]);

      if (!subscriptions || subscriptions.length === 0) {
        logger.debug(`No users subscribed to token: ${token.contract_address}`);
        return false;
      }

      const message = await this.formatOpenSeaActivityMessage(eventType, eventData, token);
      logger.info(`📤 Sending OpenSea ${eventType} notification to ${subscriptions.length} subscription(s) for ${token.token_name}`);

      // Send notifications to users in their specific subscribed contexts
      let successCount = 0;

      // Send to subscribed users in their correct context
      for (const subscription of subscriptions) {
        try {
          // Determine target chat ID based on subscription context
          let targetChatId;
          if (subscription.chat_id === 'private') {
            // For private chats, send to user's private chat
            targetChatId = subscription.telegram_id;
          } else {
            // For group chats, send to the specific group where they subscribed
            targetChatId = subscription.chat_id;
          }

          await this.sendOpenSeaNotificationWithImage(targetChatId, message, eventData);
          successCount++;
          logger.info(`✅ OpenSea notification sent to ${subscription.chat_id === 'private' ? 'private chat' : 'group'} ${targetChatId} for user ${subscription.telegram_id}`);
        } catch (error) {
          logger.error(`❌ Failed to send OpenSea notification to ${subscription.chat_id} for user ${subscription.telegram_id}:`, error);
        }
      }

      logger.info(`📊 OpenSea notification summary: ${successCount}/${subscriptions.length} notifications sent successfully`);
      return successCount > 0;
    } catch (error) {
      logger.error('Error notifying users for OpenSea event:', error);
      return false;
    }
  }

  async notifyChannelsOpenSea(token, eventType, eventData, activityData, channels, isTrending = false) {
    try {
      // SECURITY: Additional verification before sending OpenSea channel notifications
      const verification = await this.verifyChannelNotificationPermission(token.contract_address, token.token_name);
      if (!verification.authorized) {
        logger.warn(`🔒 BLOCKED OPENSEA CHANNEL NOTIFICATION: ${token.token_name} - ${verification.reason}`);
        return false;
      }

      if (!channels || channels.length === 0) {
        return false;
      }

      const message = isTrending
        ? await this.formatTrendingOpenSeaMessage(eventType, eventData, token)
        : await this.formatOpenSeaActivityMessage(eventType, eventData, token);

      let notifiedCount = 0;
      for (const channel of channels) {
        try {
          logger.info(`📤 SENDING OpenSea to channel ${channel.channel_title}: ${token.token_name} (verified trending payment)`);
          // Use same field name as original: telegram_chat_id
          await this.sendOpenSeaNotificationWithImage(channel.telegram_chat_id, message, eventData);
          notifiedCount++;
          logger.info(`✅ OpenSea notification sent to channel: ${channel.channel_title || channel.channel_name}`);
        } catch (error) {
          logger.error(`❌ Failed to send OpenSea notification to channel ${channel.channel_title || channel.channel_name}:`, error);

          // Handle bot removal from channel (same as original)
          if (error.response?.error_code === 403) {
            await this.db.run(
              'UPDATE channels SET is_active = false WHERE telegram_chat_id = $1',
              [channel.telegram_chat_id]
            );
            logger.info(`Deactivated channel ${channel.telegram_chat_id} due to bot removal`);
          }
        }
      }

      logger.info(`📢 Notified ${notifiedCount}/${channels.length} channels for OpenSea ${eventType} event`);
      return notifiedCount > 0;
    } catch (error) {
      logger.error('Error notifying channels for OpenSea event:', error);
      return false;
    }
  }

  async formatOpenSeaActivityMessage(eventType, eventData, token) {
    const collectionName = eventData.collectionName || token.token_name || 'NFT Collection';
    const nftName = eventData.nftName || `#${eventData.tokenId || 'Unknown'}`;

    // Get event-specific emoji and action
    const eventInfo = this.getOpenSeaEventInfo(eventType);

    let message = `${eventInfo.emoji} **${collectionName}** ${eventInfo.action}\n\n`;

    // NFT details
    message += `🖼️ **NFT:** ${nftName}\n`;
    if (eventData.tokenId) {
      message += `🔢 **Token ID:** ${eventData.tokenId}\n`;
    }

    // Price information (for relevant events)
    if (eventData.price && eventType !== 'transferred') {
      const priceFormatted = this.formatOpenSeaPrice(eventData.price, eventData.paymentTokenSymbol, eventData.paymentTokenDecimals);
      message += `💰 **${eventInfo.priceLabel}:** ${priceFormatted}`;

      // Add USD value if available
      if (eventData.priceUsd) {
        message += ` ($${this.formatUsdAmount(eventData.priceUsd)})`;
      } else {
        // Debug info when USD is missing
        logger.warn(`💰 USD price missing for ${eventType} event:`, {
          event_type: eventType,
          has_price: !!eventData.price,
          price_value: eventData.price,
          payment_token_symbol: eventData.paymentTokenSymbol,
          payment_token_usd_price: eventData.paymentTokenUsdPrice,
          contract: eventData.contractAddress,
          token_id: eventData.tokenId
        });
      }
      message += '\n';
    }

    // User addresses - removed to keep notifications short
    // Keeping only transfer addresses as they are essential
    if (eventType === 'transferred') {
      if (eventData.fromAddress) {
        message += `📤 **From:** \`${this.shortenAddress(eventData.fromAddress)}\`\n`;
      }
      if (eventData.toAddress) {
        message += `📥 **To:** \`${this.shortenAddress(eventData.toAddress)}\`\n`;
      }
    }

    // Collection and marketplace info
    message += `🏪 **Marketplace:** OpenSea\n`;
    message += `📮 **Collection:** \`${eventData.collectionSlug || 'Unknown'}\`\n`;

    // Add chain information for OpenSea events
    if (this.chainManager && token.chain_name) {
      const chainConfig = this.chainManager.getChain(token.chain_name);
      if (chainConfig) {
        message += `🔗 **Chain:** ${chainConfig.emoji} ${chainConfig.displayName}\n`;
      } else {
        message += `🔗 **Chain:** ${token.chain_name}\n`;
      }
    }

    // Transaction link - removed from sale and transfer events to keep notifications short
    if (eventData.transactionHash && eventType !== 'sold' && eventType !== 'transferred') {
      message += `🔗 **TX:** \`${this.shortenAddress(eventData.transactionHash)}\`\n`;
      message += `[View on Etherscan](https://etherscan.io/tx/${eventData.transactionHash})\n`;
    }

    // OpenSea link (using the exact format from OpenSea's item.permalink or manual construction)
    if (eventData.contractAddress && eventData.tokenId) {
      // Get chain name for OpenSea URL - map our chain names to OpenSea's format
      const openSeaChainMap = {
        'ethereum': 'ethereum',
        'arbitrum': 'arbitrum',
        'optimism': 'optimism',
        'bsc': 'bsc',
        'hyperblast': 'ethereum' // Fallback to ethereum since HyperEVM not supported on OpenSea
      };
      const chainForUrl = openSeaChainMap[token.chain_name] || 'ethereum';

      // OpenSea URLs are: https://opensea.io/assets/{chain}/{contract}/{tokenId}
      message += `[View on OpenSea](https://opensea.io/assets/${chainForUrl}/${eventData.contractAddress}/${eventData.tokenId})\n`;
    } else if (eventData.collectionSlug) {
      message += `[View Collection](https://opensea.io/collection/${eventData.collectionSlug})\n`;
    }

    message += ` \nPowered by [Candy Codex](https://buy.candycodex.com/)`;

    // Add footer advertisements if available
    if (this.secureTrending) {
      try {
        const footerAds = await this.secureTrending.getActiveFooterAds();
        if (footerAds && footerAds.length > 0) {
          const adLinks = footerAds.map(ad => {
            const ticker = ad.ticker_symbol || ad.token_symbol || 'TOKEN';
            return `[⭐️${ticker}](${ad.custom_link})`;
          });

          // Add "BuyAdspot" if less than 3 slots are filled
          if (adLinks.length < 3) {
            adLinks.push('[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)');
          }

          message += `\n${adLinks.join(' ')}`;
        } else {
          message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
        }
      } catch (error) {
        message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
      }
    } else {
      message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
    }

    return message;
  }

  async formatTrendingOpenSeaMessage(eventType, eventData, token) {
    const collectionName = eventData.collectionName || token.token_name || 'NFT Collection';
    const eventInfo = this.getOpenSeaEventInfo(eventType);

    let message = `🔥 **TRENDING:** ${collectionName} ${eventInfo.action}\n\n`;

    // Add rest of the message using the regular formatter
    const regularMessage = await this.formatOpenSeaActivityMessage(eventType, eventData, token);
    // Remove the first line and add to trending message
    const lines = regularMessage.split('\n');
    message += lines.slice(1).join('\n');

    return message;
  }

  getOpenSeaEventInfo(eventType) {
    const eventMap = {
      'sold': {
        emoji: '💰🟢',
        action: '**Buy**',
        priceLabel: 'Buy Price'
      },
      'listed': {
        emoji: '📝',
        action: 'Listed',
        priceLabel: 'List Price'
      },
      'transferred': {
        emoji: '🔄',
        action: 'Transfer',
        priceLabel: 'Value'
      },
      'received_bid': {
        emoji: '🏷️',
        action: 'Bid Received',
        priceLabel: 'Bid Amount'
      },
      'received_offer': {
        emoji: '💱',
        action: 'Offer Received',
        priceLabel: 'Offer Amount'
      },
      'metadata_updated': {
        emoji: '📊',
        action: 'Updated',
        priceLabel: 'Value'
      }
    };

    return eventMap[eventType] || {
      emoji: '🎯',
      action: 'Activity',
      priceLabel: 'Price'
    };
  }

  formatOpenSeaPrice(priceWei, tokenSymbol = 'ETH', decimals = 18) {
    if (!priceWei || parseFloat(priceWei) <= 0) {
      return '0 ETH';
    }

    const priceInToken = parseFloat(priceWei) / Math.pow(10, decimals);

    if (priceInToken >= 1) {
      return `${priceInToken.toFixed(3)} ${tokenSymbol}`;
    } else if (priceInToken >= 0.001) {
      return `${priceInToken.toFixed(4)} ${tokenSymbol}`;
    } else {
      return `${(priceInToken * 1000).toFixed(2)} m${tokenSymbol}`;
    }
  }

  formatUsdAmount(usdValue) {
    const value = parseFloat(usdValue);
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    } else if (value >= 1) {
      return value.toFixed(2);
    } else {
      return value.toFixed(4);
    }
  }

  async sendOpenSeaNotificationWithImage(chatId, message, eventData) {
    // SECURITY: Check if image fee is paid for this contract before showing actual NFT image
    const hasImageFee = this.secureTrending ? await this.secureTrending.isImageFeeActive(eventData.contractAddress) : false;
    logger.info(`🖼️ OPENSEA IMAGE FEE CHECK: ${eventData.contractAddress} - hasImageFee: ${hasImageFee}`);

    try {
      let processedImagePath = null;

      // Handle image processing based on payment status
      if (hasImageFee && eventData.nftImageUrl && eventData.nftImageUrl.startsWith('http')) {
        // For PAID tokens: Retry until successful, never fallback to default
        logger.info(`✅ IMAGE FEE PAID: Processing OpenSea image for ${eventData.contractAddress} - WILL RETRY UNTIL SUCCESS`);
        processedImagePath = await this.retryOpenSeaImageProcessingForPaidToken(eventData.nftImageUrl, eventData.tokenId || 'unknown', eventData.contractAddress);
      } else {
        // For UNPAID tokens: Use default tracking image immediately
        logger.info(`🚫 IMAGE FEE NOT PAID: Using default tracking image for OpenSea notification`);
        processedImagePath = await this.resizeDefaultTrackingImage();
      }

      const boostButton = {
        inline_keyboard: [[
          {
            text: 'BOOST YOUR NFT🟢',
            callback_data: '/buy_trending'
          }
        ]]
      };

      // ALWAYS send as photo - image processing is guaranteed to succeed
      await this.bot.telegram.sendPhoto(chatId, { source: processedImagePath }, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: boostButton
      });
      logger.info(`✅ OpenSea notification with image sent successfully to ${chatId}`);

      // Clean up the temporary file after sending (only for paid tokens with NFT metadata images)
      if (hasImageFee && processedImagePath) {
        this.cleanupTempImage(processedImagePath);
      }

    } catch (error) {
      // For PAID tokens: This should never happen due to retry logic
      if (hasImageFee) {
        logger.error(`🚨 CRITICAL: Paid OpenSea token ${eventData.contractAddress} failed image processing after retries: ${error.message}`);
        throw new Error(`Paid OpenSea token image processing failed: ${error.message}`);
      }

      // For UNPAID tokens: Emergency fallback to default image
      logger.warn(`Unpaid OpenSea token ${eventData.contractAddress} failed, emergency fallback to default image: ${error.message}`);

      try {
        const emergencyImagePath = await this.resizeDefaultTrackingImage();
        const boostButton = {
          inline_keyboard: [[
            {
              text: 'BOOST YOUR NFT🟢',
              callback_data: '/buy_trending'
            }
          ]]
        };

        await this.bot.telegram.sendPhoto(chatId, { source: emergencyImagePath }, {
          caption: message,
          parse_mode: 'Markdown',
          reply_markup: boostButton
        });
        logger.info(`Sent OpenSea notification with emergency default image for unpaid token ${eventData.contractAddress}`);
      } catch (emergencyError) {
        logger.error(`🚨 CRITICAL: Even emergency default image failed for OpenSea ${eventData.contractAddress}: ${emergencyError.message}`);
        throw new Error(`Complete OpenSea image processing failure: ${emergencyError.message}`);
      }
    }
  }

  // Retry OpenSea image processing for paid tokens - keeps trying until success
  async retryOpenSeaImageProcessingForPaidToken(imageUrl, tokenId, contractAddress, maxRetries = 10) {
    let attempt = 1;

    // Add a unique processing key to prevent duplicate retries for the same notification
    const processingKey = `opensea:${contractAddress}:${tokenId}:${Date.now()}`;
    logger.info(`🔒 STARTING PAID OPENSEA PROCESSING: ${processingKey}`);

    while (attempt <= maxRetries) {
      try {
        logger.info(`🔄 PAID OPENSEA RETRY ${attempt}/${maxRetries}: Processing image for ${contractAddress} (${processingKey})`);

        const processedImagePath = await this.downloadAndResizeOpenSeaImage(imageUrl, tokenId);
        if (processedImagePath) {
          logger.info(`✅ PAID OPENSEA SUCCESS: Image processed on attempt ${attempt} for ${contractAddress} (${processingKey})`);
          return processedImagePath;
        }

        logger.warn(`⚠️ PAID OPENSEA ATTEMPT ${attempt} FAILED: Retrying in ${attempt * 2} seconds for ${contractAddress} (${processingKey})`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000)); // Exponential backoff
        attempt++;

      } catch (error) {
        logger.error(`❌ PAID OPENSEA ATTEMPT ${attempt} ERROR for ${contractAddress} (${processingKey}): ${error.message}`);

        if (attempt === maxRetries) {
          logger.error(`🚨 PAID OPENSEA FINAL FAILURE: All ${maxRetries} attempts failed for ${contractAddress} (${processingKey})`);
          throw new Error(`Paid OpenSea token image processing failed after ${maxRetries} attempts: ${error.message}`);
        }

        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        attempt++;
      }
    }

    throw new Error(`Paid OpenSea token image processing exhausted all ${maxRetries} attempts`);
  }

  /**
   * Download and resize an OpenSea image to 300x300
   * @param {string} imageUrl - The OpenSea image URL
   * @param {string} tokenId - Token ID for filename uniqueness
   * @returns {string|null} Path to resized image file or null if failed
   */
  async downloadAndResizeOpenSeaImage(imageUrl, tokenId) {
    const axios = require('axios');
    const sharp = require('sharp');
    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Create temp directory if it doesn't exist
      const tempDir = path.join(__dirname, '../../temp_opensea_images');
      await fs.mkdir(tempDir, { recursive: true });

      // Generate unique filename
      const fileName = `opensea_${tokenId}_${Date.now()}.jpg`;
      const tempPath = path.join(tempDir, fileName);
      const resizedPath = path.join(tempDir, `resized_${fileName}`);

      // Download the image
      logger.info(`📥 Downloading OpenSea image: ${imageUrl}`);
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Save downloaded image
      await fs.writeFile(tempPath, response.data);
      logger.info(`💾 Downloaded image saved: ${tempPath}`);

      // Resize to exactly 300x300 with proper aspect ratio handling
      await sharp(tempPath)
        .resize(300, 300, {
          fit: 'cover',           // Ensures exactly 300x300 by cropping if needed
          position: 'center'      // Center crop
        })
        .jpeg({
          quality: 85,
          progressive: true
        })
        .toFile(resizedPath);

      // Clean up original downloaded file
      await fs.unlink(tempPath).catch(() => {}); // Ignore errors

      logger.info(`🖼️ Image resized to 300x300: ${resizedPath}`);
      return resizedPath;

    } catch (error) {
      logger.error(`❌ Failed to download/resize OpenSea image: ${error.message}`);
      return null;
    }
  }

  /**
   * Get path to pre-sized default tracking image (300x300)
   * No resizing needed - uses pre-optimized image for better performance
   * @returns {string} Path to pre-sized default image
   */
  async resizeDefaultTrackingImage() {
    try {
      const fs = require('fs').promises;

      // Use pre-sized 300x300 default tracking image (no resizing needed)
      const path = require('path');
      const presizedImagePath = path.join(__dirname, '../images/candyImage.jpg');

      // Verify the pre-sized image exists
      try {
        await fs.access(presizedImagePath);
        logger.debug(`📸 Using pre-sized default tracking image: ${presizedImagePath}`);
        return presizedImagePath;
      } catch (error) {
        // If pre-sized image doesn't exist, fall back to original with dynamic resizing
        logger.warn('⚠️  Pre-sized default image not found, falling back to dynamic resizing');

        const sharp = require('sharp');
        const path = require('path');
        const timestamp = Date.now();
        const tempDir = './temp_opensea_images';

        // Ensure temp directory exists
        try {
          await fs.mkdir(tempDir, { recursive: true });
        } catch (err) {
          // Directory might already exist, ignore
        }

        const resizedPath = path.join(tempDir, `default_tracking_${timestamp}.jpg`);

        // Resize default tracking image to 300x300 (fallback)
        await sharp('./src/images/candyImage.jpg')
          .resize(300, 300, {
            fit: 'cover',
            position: 'center'
          })
          .jpeg({
            quality: 85,
            progressive: true
          })
          .toFile(resizedPath);

        logger.debug(`📸 Default tracking image resized to 300x300: ${resizedPath}`);
        return resizedPath;
      }
    } catch (error) {
      logger.error(`❌ Failed to get default tracking image: ${error.message}`);
      return null;
    }
  }

  /**
   * Clean up temporary image file
   * @param {string} imagePath - Path to image file to delete
   */
  async cleanupTempImage(imagePath) {
    try {
      const fs = require('fs').promises;
      await fs.unlink(imagePath);
      logger.debug(`🗑️ Cleaned up temp image: ${imagePath}`);
    } catch (error) {
      logger.debug(`⚠️ Failed to cleanup temp image: ${error.message}`);
    }
  }

  // ==================== HELIUS WEBHOOK HANDLERS (SOLANA / MAGIC EDEN) ====================

  /**
   * Handle Helius webhook for Solana NFT sales on Magic Eden
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async handleHeliusWebhook(req, res) {
    try {
      // Verify auth header
      const authHeader = req.headers.authorization;
      if (!this.helius || !this.helius.verifyWebhookAuth(authHeader)) {
        logger.warn('⚠️ Unauthorized Helius webhook request');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const transactions = req.body;
      logger.info(`🌟 Received Helius webhook with ${transactions.length} transactions`);

      await this.db.logWebhook('helius', transactions, false);
      let processedCount = 0;

      for (const transaction of transactions) {
        try {
          if (transaction.type === 'NFT_SALE') {
            logger.info(`💰 Processing Helius NFT_SALE event: ${transaction.signature}`);
            const processed = await this.handleHeliusNFTSale(transaction);
            if (processed) processedCount++;
          }
        } catch (error) {
          logger.error(`Error processing Helius transaction ${transaction.signature}:`, error);
        }
      }

      await this.db.logWebhook('helius', transactions, processedCount > 0);
      logger.info(`✅ Helius webhook processed: ${processedCount}/${transactions.length} events`);

      res.status(200).json({
        success: true,
        processed: processedCount,
        message: 'Webhook processed successfully'
      });
    } catch (error) {
      logger.error('Error handling Helius webhook:', error);
      if (req.body) {
        await this.db.logWebhook('helius', req.body, false, error.message);
      }
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Handle a single NFT sale event from Helius
   * @param {Object} transaction - The transaction object from Helius
   * @returns {Promise<boolean>} True if processed successfully
   */
  async handleHeliusNFTSale(transaction) {
    try {
      if (!this.helius) {
        logger.warn('Helius service not available');
        return false;
      }

      // Parse the NFT sale event
      const saleData = this.helius.parseNFTSaleEvent(transaction);
      if (!saleData) {
        logger.warn('Failed to parse Helius NFT sale event');
        return false;
      }

      // Create deduplication key
      const eventKey = `helius:${saleData.signature}:${saleData.mintAddress}`;
      if (this.isHeliusEventProcessed(eventKey)) {
        logger.info(`⏭️ Helius event ${eventKey} already processed, skipping`);
        return false;
      }

      // Mark as being processed
      this.markHeliusEventProcessed(eventKey);

      logger.info(`🌟 HELIUS NFT SALE - Mint: ${saleData.mintAddress}, Price: ${saleData.amountSol} SOL`);

      // For Solana NFTs, we need to find the collection symbol from the mint
      // First, try to get collection info from Magic Eden
      let collectionSymbol = null;
      if (this.magicEden) {
        try {
          const nftInfo = await this.magicEden.getNFTMetadata(saleData.mintAddress);
          collectionSymbol = nftInfo?.collection || nftInfo?.collectionSymbol;
          if (collectionSymbol) {
            logger.info(`📦 Found collection: ${collectionSymbol} for mint ${saleData.mintAddress}`);
          }
        } catch (error) {
          logger.debug(`Could not fetch collection for mint ${saleData.mintAddress}: ${error.message}`);
        }
      }

      // Find tracked tokens by collection symbol for Solana
      let token = null;
      if (collectionSymbol) {
        // Query by collection_slug for Solana tokens
        const tokens = await this.db.all(
          'SELECT * FROM tracked_tokens WHERE chain_name = $1 AND collection_slug = $2 AND is_active = true',
          ['solana', collectionSymbol]
        );
        if (tokens && tokens.length > 0) {
          token = tokens[0];
          logger.info(`📊 Found tracked Solana collection: ${token.token_name} (${collectionSymbol})`);
        }
      }

      if (!token) {
        logger.debug(`Collection ${collectionSymbol || 'unknown'} for mint ${saleData.mintAddress} not tracked, skipping`);
        return false;
      }

      // Log activity to database
      const activityData = {
        contractAddress: saleData.mintAddress,
        tokenId: null, // Solana uses mint addresses
        activityType: 'buy',
        fromAddress: saleData.seller,
        toAddress: saleData.buyer,
        transactionHash: saleData.signature,
        blockNumber: saleData.slot,
        price: saleData.amount.toString(), // Store lamports
        marketplace: 'Magic Eden'
      };

      await this.db.logNFTActivity(activityData);

      // Notify subscribed users
      await this.notifyUsersMagicEden(token, saleData, activityData);

      // Check if token should notify channels
      const shouldNotifyChannels = await this.shouldNotifyChannelsForToken(token.contract_address);
      if (shouldNotifyChannels.notify) {
        logger.info(`📢 Notifying channels for ${token.token_name} via Magic Eden sale (${shouldNotifyChannels.reason})`);
        await this.notifyChannelsMagicEden(token, saleData, activityData, shouldNotifyChannels.channels, shouldNotifyChannels.isTrending);
      }

      logger.info(`✅ Successfully processed Helius NFT sale for ${token.token_name}`);
      return true;

    } catch (error) {
      logger.error('Error handling Helius NFT sale:', error);
      return false;
    }
  }

  /**
   * Check if Helius event has been processed
   * @param {string} eventKey - Unique event key
   * @returns {boolean} True if already processed
   */
  isHeliusEventProcessed(eventKey) {
    const timestamp = this.processedHeliusEvents.get(eventKey);
    if (!timestamp) return false;

    const isValid = (Date.now() - timestamp) <= this.CACHE_EXPIRY_MS;
    if (!isValid) {
      this.processedHeliusEvents.delete(eventKey);
      return false;
    }
    return true;
  }

  /**
   * Mark Helius event as processed
   * @param {string} eventKey - Unique event key
   */
  markHeliusEventProcessed(eventKey) {
    this.processedHeliusEvents.set(eventKey, Date.now());
  }

  /**
   * Notify users about Magic Eden sale
   * @param {Object} token - Token data from database
   * @param {Object} saleData - Parsed sale data from Helius
   * @param {Object} activityData - Activity data for database
   * @returns {Promise<boolean>} True if notifications sent successfully
   */
  async notifyUsersMagicEden(token, saleData, activityData) {
    try {
      // Get users with their subscription context (chat_id)
      const subscriptions = await this.db.all(`
        SELECT u.telegram_id, u.username, us.notification_enabled, us.chat_id
        FROM users u
        JOIN user_subscriptions us ON u.id = us.user_id
        WHERE us.token_id = $1 AND us.notification_enabled = true AND u.is_active = true
      `, [token.id]);

      if (!subscriptions || subscriptions.length === 0) {
        logger.debug(`No users subscribed to Solana token: ${token.contract_address}`);
        return false;
      }

      const message = await this.formatMagicEdenSaleMessage(token, saleData);
      logger.info(`📤 Sending Magic Eden sale notification to ${subscriptions.length} subscription(s) for ${token.token_name}`);

      let successCount = 0;

      for (const subscription of subscriptions) {
        try {
          let targetChatId;
          if (subscription.chat_id === 'private') {
            targetChatId = subscription.telegram_id;
          } else {
            targetChatId = subscription.chat_id;
          }

          await this.sendMagicEdenNotificationWithImage(targetChatId, message, saleData, token);
          successCount++;
          logger.info(`✅ Magic Eden notification sent to ${subscription.chat_id === 'private' ? 'private chat' : 'group'} ${targetChatId}`);
        } catch (error) {
          logger.error(`❌ Failed to send Magic Eden notification to ${subscription.chat_id}:`, error);

          if (error.response?.error_code === 403 || error.response?.error_code === 400) {
            await this.db.run(
              'UPDATE users SET is_active = false WHERE telegram_id = $1',
              [subscription.telegram_id]
            );
            logger.info(`Deactivated user ${subscription.telegram_id} due to delivery failure`);
          }
        }
      }

      logger.info(`📊 Magic Eden notification summary: ${successCount}/${subscriptions.length} notifications sent`);
      return successCount > 0;
    } catch (error) {
      logger.error('Error notifying users for Magic Eden sale:', error);
      return false;
    }
  }

  /**
   * Notify channels about Magic Eden sale
   * @param {Object} token - Token data
   * @param {Object} saleData - Sale data
   * @param {Object} activityData - Activity data
   * @param {Array} channels - Channels to notify
   * @param {boolean} isTrending - Whether token is trending
   * @returns {Promise<boolean>} True if notifications sent
   */
  async notifyChannelsMagicEden(token, saleData, activityData, channels, isTrending = false) {
    try {
      // Security check
      const verification = await this.verifyChannelNotificationPermission(token.contract_address, token.token_name);
      if (!verification.authorized) {
        logger.warn(`🔒 BLOCKED MAGIC EDEN CHANNEL NOTIFICATION: ${token.token_name} - ${verification.reason}`);
        return false;
      }

      if (!channels || channels.length === 0) {
        return false;
      }

      const message = isTrending
        ? await this.formatTrendingMagicEdenMessage(token, saleData)
        : await this.formatMagicEdenSaleMessage(token, saleData);

      let notifiedCount = 0;
      for (const channel of channels) {
        try {
          logger.info(`📤 SENDING Magic Eden to channel ${channel.channel_title}: ${token.token_name}`);
          await this.sendMagicEdenNotificationWithImage(channel.telegram_chat_id, message, saleData, token);
          notifiedCount++;
          logger.info(`✅ Magic Eden notification sent to channel: ${channel.channel_title}`);
        } catch (error) {
          logger.error(`❌ Failed to send Magic Eden notification to channel ${channel.channel_title}:`, error);

          if (error.response?.error_code === 403) {
            await this.db.run(
              'UPDATE channels SET is_active = false WHERE telegram_chat_id = $1',
              [channel.telegram_chat_id]
            );
          }
        }
      }

      logger.info(`📢 Notified ${notifiedCount}/${channels.length} channels for Magic Eden sale`);
      return notifiedCount > 0;
    } catch (error) {
      logger.error('Error notifying channels for Magic Eden sale:', error);
      return false;
    }
  }

  /**
   * Format Magic Eden sale message for Telegram
   * @param {Object} token - Token data
   * @param {Object} saleData - Sale data from Helius
   * @returns {Promise<string>} Formatted message
   */
  async formatMagicEdenSaleMessage(token, saleData) {
    const nftName = token.token_name || 'Solana NFT';

    let message = `💰🟢 **${nftName}** **BUY!** on Magic Eden\n\n`;
    message += `💰 **Price:** ${saleData.amountSol} SOL`;

    // Add USD value if PriceService is available
    if (this.secureTrending && this.secureTrending.priceService) {
      try {
        const solPrice = await this.secureTrending.priceService.getTokenPrice('SOL');
        if (solPrice) {
          const usdValue = parseFloat(saleData.amountSol) * solPrice;
          message += ` ($${usdValue.toFixed(2)})`;
        }
      } catch (error) {
        logger.warn('Failed to get SOL price for USD conversion:', error);
      }
    }

    message += '\n';
    message += `👤 **Buyer:** \`${this.shortenAddress(saleData.buyer)}\`\n`;
    message += `📤 **Seller:** \`${this.shortenAddress(saleData.seller)}\`\n`;
    message += `🏪 **Marketplace:** Magic Eden\n`;
    message += `🔗 **Chain:** ◎ Solana\n`;
    message += `[View on Solana Explorer](https://explorer.solana.com/tx/${saleData.signature})\n`;

    message += ` \nPowered by [Candy Codex](https://buy.candycodex.com/)`;

    // Add footer advertisements
    if (this.secureTrending) {
      try {
        const footerAds = await this.secureTrending.getActiveFooterAds();
        if (footerAds && footerAds.length > 0) {
          const adLinks = footerAds.map(ad => {
            const ticker = ad.ticker_symbol || ad.token_symbol || 'TOKEN';
            return `[⭐️${ticker}](${ad.custom_link})`;
          });

          if (adLinks.length < 3) {
            adLinks.push('[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)');
          }

          message += `\n${adLinks.join(' ')}`;
        } else {
          message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
        }
      } catch (error) {
        message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
      }
    } else {
      message += `\n[BuyAdspot](https://t.me/MintTechBot?start=buy_footer)`;
    }

    return message;
  }

  /**
   * Format trending Magic Eden sale message
   * @param {Object} token - Token data
   * @param {Object} saleData - Sale data
   * @returns {Promise<string>} Formatted message
   */
  async formatTrendingMagicEdenMessage(token, saleData) {
    let message = `🔥 **TRENDING:** ${token.token_name || 'Solana NFT'}\n\n`;
    const regularMessage = await this.formatMagicEdenSaleMessage(token, saleData);
    const lines = regularMessage.split('\n');
    message += lines.slice(1).join('\n');
    return message;
  }

  /**
   * Send Magic Eden notification with image
   * @param {string} chatId - Telegram chat ID
   * @param {string} message - Message text
   * @param {Object} saleData - Sale data
   * @param {Object} token - Token data
   */
  async sendMagicEdenNotificationWithImage(chatId, message, saleData, token) {
    // Check if image fee is paid for this contract
    const hasImageFee = this.secureTrending ? await this.secureTrending.isImageFeeActive(token.contract_address) : false;
    logger.info(`🖼️ MAGIC EDEN IMAGE FEE CHECK: ${token.contract_address} - hasImageFee: ${hasImageFee}`);

    try {
      let imagePath = null;

      if (hasImageFee && saleData.nfts && saleData.nfts[0]?.imageUri) {
        // For PAID tokens: Try to fetch actual NFT image
        logger.info(`✅ IMAGE FEE PAID: Processing Magic Eden NFT image`);
        try {
          imagePath = await this.downloadAndResizeSolanaImage(saleData.nfts[0].imageUri, saleData.mintAddress);
        } catch (error) {
          logger.warn(`Failed to process Solana NFT image: ${error.message}`);
          imagePath = null;
        }
      }

      // Fallback to default image if no paid image or download failed
      if (!imagePath) {
        logger.info(`🚫 Using default tracking image for Magic Eden notification`);
        const path = require('path');
        imagePath = path.join(__dirname, '../images/candyImage.jpg');
      }

      const boostButton = {
        inline_keyboard: [[
          {
            text: 'BOOST YOUR NFT🟢',
            callback_data: '/buy_trending'
          }
        ]]
      };

      await this.bot.telegram.sendPhoto(chatId, { source: imagePath }, {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: boostButton
      });

      logger.info(`✅ Magic Eden notification with image sent successfully to ${chatId}`);

    } catch (error) {
      logger.error(`Error sending Magic Eden notification with image:`, error);
      throw error;
    }
  }

  /**
   * Download and resize Solana NFT image
   * @param {string} imageUrl - NFT image URL
   * @param {string} mintAddress - Solana mint address
   * @returns {Promise<string>} Path to resized image
   */
  async downloadAndResizeSolanaImage(imageUrl, mintAddress) {
    const axios = require('axios');
    const sharp = require('sharp');
    const fs = require('fs').promises;
    const path = require('path');

    try {
      const tempDir = path.join(__dirname, '../../temp_solana_images');
      await fs.mkdir(tempDir, { recursive: true });

      const fileName = `solana_${mintAddress.slice(0, 8)}_${Date.now()}.jpg`;
      const tempPath = path.join(tempDir, fileName);
      const resizedPath = path.join(tempDir, `resized_${fileName}`);

      // Download the image
      logger.info(`📥 Downloading Solana NFT image: ${imageUrl}`);
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      await fs.writeFile(tempPath, response.data);
      logger.info(`💾 Downloaded Solana image saved: ${tempPath}`);

      // Resize to 300x300
      await sharp(tempPath)
        .resize(300, 300, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({
          quality: 85,
          progressive: true
        })
        .toFile(resizedPath);

      // Clean up original
      await fs.unlink(tempPath).catch(() => {});

      logger.info(`🖼️ Solana image resized to 300x300: ${resizedPath}`);
      return resizedPath;

    } catch (error) {
      logger.error(`❌ Failed to download/resize Solana image: ${error.message}`);
      throw error;
    }
  }
}

module.exports = WebhookHandlers;