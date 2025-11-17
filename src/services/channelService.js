const logger = require('./logger');
const crypto = require('crypto');
const CollectionStatsService = require('./collectionStatsService');

class ChannelService {
  constructor(database, bot, trendingService, secureTrendingService = null) {
    this.db = database;
    this.bot = bot;
    this.trending = trendingService;
    this.secureTrending = secureTrendingService;
    this.scheduledMessages = new Map();

    // Initialize collection stats service
    this.statsService = new CollectionStatsService(database);
  }

  async initialize() {
    try {

      this.startTrendingBroadcasts();
      logger.info('Channel service initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize channel service:', error);
      throw error;
    }
  }

  async addChannel(telegramChatId, channelTitle, addedByUserId) {
    try {

      try {
        const botInfo = await this.bot.telegram.getChatMember(telegramChatId, this.bot.botInfo.id);
        if (!botInfo || (botInfo.status !== 'administrator' && botInfo.status !== 'member')) {
          return {
            success: false,
            message: '❌ Bot needs to be added to the channel first with permission to send messages'
          };
        }
      } catch (error) {
        logger.error(`Error checking bot permissions in channel ${telegramChatId}:`, error);
        return {
          success: false,
          message: '❌ Unable to verify bot permissions. Make sure the bot is added to the channel.'
        };
      }


      const result = await this.db.addChannel(telegramChatId, channelTitle, addedByUserId);

      const welcomeMessage = `🤖 <b>MintTechBot Added Successfully!</b>

I'll now send trending NFT alerts to this channel.

<b>What I do:</b>
🔥 Show trending NFT collections (paid promotions)
📊 Real-time NFT activity alerts
💰 Price and floor updates

<b>Settings:</b>
✅ Trending alerts: <b>ON</b>
❌ All activity alerts: <b>OFF</b> (admin only)

Use /channel_settings to configure alerts.`;

      try {
        await this.bot.telegram.sendMessage(
          telegramChatId, 
          welcomeMessage, 
          { parse_mode: 'HTML' }
        );
      } catch (error) {
        logger.error(`Failed to send welcome message to channel ${telegramChatId}:`, error);
      }

      logger.info(`Channel added: ${telegramChatId} (${channelTitle}) by user ${addedByUserId}`);
      return {
        success: true,
        message: '✅ Channel added successfully! I will now send trending alerts here.',
        channelId: result.id
      };
    } catch (error) {
      logger.error(`Error adding channel ${telegramChatId}:`, error);
      return {
        success: false,
        message: `❌ Error adding channel: ${error.message}`
      };
    }
  }

  async removeChannel(telegramChatId, removedByUserId) {
    try {
      const result = await this.db.run(
        'UPDATE channels SET is_active = false WHERE telegram_chat_id = $1',
        [telegramChatId]
      );

      if (result.changes > 0) {

        try {
          await this.bot.telegram.sendMessage(
            telegramChatId,
            '👋 MintTechBot has been deactivated for this channel. Goodbye!',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {

        }

        logger.info(`Channel removed: ${telegramChatId} by user ${removedByUserId}`);
        return {
          success: true,
          message: '✅ Channel removed successfully'
        };
      } else {
        return {
          success: false,
          message: '❌ Channel not found or already inactive'
        };
      }
    } catch (error) {
      logger.error(`Error removing channel ${telegramChatId}:`, error);
      return {
        success: false,
        message: `❌ Error removing channel: ${error.message}`
      };
    }
  }

  async updateChannelSettings(telegramChatId, settings) {
    try {
      const { show_trending, show_all_activities, trending_tier } = settings;
      const result = await this.db.run(`
        UPDATE channels
        SET show_trending = COALESCE($1, show_trending),
            show_all_activities = COALESCE($2, show_all_activities),
            trending_tier = COALESCE($3, trending_tier)
        WHERE telegram_chat_id = $4 AND is_active = true
      `, [show_trending, show_all_activities, trending_tier, telegramChatId]);

      if (result.changes > 0) {
        logger.info(`Channel settings updated: ${telegramChatId}`);
        return {
          success: true,
          message: '✅ Channel settings updated successfully'
        };
      } else {
        return {
          success: false,
          message: '❌ Channel not found or inactive'
        };
      }
    } catch (error) {
      logger.error(`Error updating channel settings ${telegramChatId}:`, error);
      return {
        success: false,
        message: `❌ Error updating settings: ${error.message}`
      };
    }
  }

  async getChannelSettings(telegramChatId) {
    try {
      const channel = await this.db.get(
        'SELECT * FROM channels WHERE telegram_chat_id = $1 AND is_active = true',
        [telegramChatId]
      );

      if (!channel) {
        return {
          success: false,
          message: '❌ Channel not found or inactive'
        };
      }

      return {
        success: true,
        settings: {
          show_trending: !!channel.show_trending,
          show_all_activities: !!channel.show_all_activities,
          trending_tier: channel.trending_tier || 'normal',
          channel_title: channel.channel_title,
          added_date: channel.created_at
        }
      };
    } catch (error) {
      logger.error(`Error getting channel settings ${telegramChatId}:`, error);
      return {
        success: false,
        message: `❌ Error getting settings: ${error.message}`
      };
    }
  }

  async broadcastToChannels(message, channelFilter = null) {
    try {
      let channels;
      if (channelFilter) {
        channels = await this.db.all(`
          SELECT * FROM channels 
          WHERE is_active = 1 AND ${channelFilter}
        `);
      } else {
        channels = await this.db.getActiveChannels();
      }

      if (channels.length === 0) {
        logger.info('No active channels for broadcast');
        return { sent: 0, failed: 0 };
      }

      let sent = 0;
      let failed = 0;

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
          sent++;

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          failed++;
          logger.error(`Failed to send broadcast to channel ${channel.telegram_chat_id}:`, error);

          if (error.response?.error_code === 403) {
            await this.db.run(
              'UPDATE channels SET is_active = false WHERE telegram_chat_id = $1',
              [channel.telegram_chat_id]
            );
            logger.info(`Deactivated channel ${channel.telegram_chat_id} - bot removed`);
          }
        }
      }

      logger.info(`Broadcast complete: ${sent} sent, ${failed} failed`);
      return { sent, failed };
    } catch (error) {
      logger.error('Error in channel broadcast:', error);
      throw error;
    }
  }

  startTrendingBroadcasts() {
    // Full trending broadcast every 4 hours
    setInterval(async () => {
      try {
        await this.sendTrendingUpdate();
      } catch (error) {
        logger.error('Error in scheduled trending broadcast:', error);
      }
    }, 4 * 60 * 60 * 1000);

    // Stats update and message refresh every 10 seconds
    // This will update collection stats and edit pinned messages if stats changed
    setInterval(async () => {
      try {
        logger.info('[StatsUpdate] Running 10-second stats update cycle...');
        await this.sendTrendingUpdate();
      } catch (error) {
        logger.error('Error in 10-second stats update:', error);
      }
    }, 10 * 1000); // 10 seconds

    // Initial broadcast after 60 seconds
    setTimeout(async () => {
      try {
        await this.sendTrendingUpdate();
      } catch (error) {
        logger.error('Error in initial trending broadcast:', error);
      }
    }, 60 * 1000);

    logger.info('📅 Trending broadcast schedule started:');
    logger.info('  - Full broadcast: Every 4 hours');
    logger.info('  - Stats update: Every 10 minutes');
    logger.info('  - Initial broadcast: In 60 seconds');
  }

  async sendTrendingUpdate() {
    try {
      // Get channels grouped by tier preference (exclude 'none' tier and 'all_activities' mode)
      const channels = await this.db.all(`
        SELECT * FROM channels
        WHERE is_active = true
          AND show_all_activities = false
          AND trending_tier != 'none'
      `);

      if (channels.length === 0) {
        logger.debug('No channels configured for trending broadcasts, skipping');
        return;
      }

      // Log channel tier distribution
      const tierCounts = channels.reduce((acc, c) => {
        acc[c.trending_tier] = (acc[c.trending_tier] || 0) + 1;
        return acc;
      }, {});
      logger.info(`Channel tier distribution: ${JSON.stringify(tierCounts)}`);

      // Group channels by tier preference (strict filtering - no 'both' tier)
      const normalChannels = channels.filter(c => c.trending_tier === 'normal');
      const premiumChannels = channels.filter(c => c.trending_tier === 'premium');

      logger.info(`Filtered channels - Normal: ${normalChannels.length}, Premium: ${premiumChannels.length}`);

      // Update collection stats for all trending tokens before broadcasting
      logger.info('[TrendingBroadcast] Updating collection stats...');
      await this.statsService.updateAllTrendingStats();

      let totalSent = 0;
      let totalSkipped = 0;
      let totalFailed = 0;

      // Broadcast normal tier tokens
      if (normalChannels.length > 0) {
        let normalTokens = [];

        if (this.secureTrending) {
          try {
            const secureNormalTokens = await this.secureTrending.getTrendingTokens('normal');
            normalTokens = normalTokens.concat(secureNormalTokens);
            logger.debug(`Found ${secureNormalTokens.length} secure normal trending tokens`);
          } catch (error) {
            logger.error('Error getting secure normal trending tokens:', error);
          }
        }

        // Old trending service removed - it returned ALL tokens without tier filtering
        // This caused premium tokens to be broadcast to normal channels

        if (normalTokens.length > 0) {
          const uniqueNormalTokens = normalTokens.filter((token, index, self) =>
            index === self.findIndex(t => t.contract_address === token.contract_address)
          );

          logger.info(`Broadcasting ${uniqueNormalTokens.length} normal tier tokens to ${normalChannels.length} channels`);
          normalChannels.forEach(c => logger.debug(`  - Normal broadcast to: ${c.channel_title} (tier: ${c.trending_tier})`));

          // Format message and generate content hash
          const message = this.formatTrendingBroadcast(uniqueNormalTokens, 'normal');
          const contentHash = this.generateTrendingHash(uniqueNormalTokens, 'normal');

          // Use smart pinned message logic instead of always sending new messages
          for (const channel of normalChannels) {
            const result = await this.getOrCreatePinnedMessage(channel, message, contentHash);
            if (result.success) {
              if (result.action === 'skipped') {
                totalSkipped++;
              } else {
                totalSent++;
              }
            } else {
              totalFailed++;
            }
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          logger.info(`Normal trending: ${totalSent} created/edited, ${totalSkipped} skipped, ${totalFailed} failed`);
        }
      }

      // Broadcast premium tier tokens
      if (premiumChannels.length > 0 && this.secureTrending) {
        try {
          const premiumTokens = await this.secureTrending.getTrendingTokens('premium');

          if (premiumTokens.length > 0) {
            logger.info(`Broadcasting ${premiumTokens.length} premium tier tokens to ${premiumChannels.length} channels`);
            premiumChannels.forEach(c => logger.debug(`  - Premium broadcast to: ${c.channel_title} (tier: ${c.trending_tier})`));

            // Format message and generate content hash
            const message = this.formatTrendingBroadcast(premiumTokens, 'premium');
            const contentHash = this.generateTrendingHash(premiumTokens, 'premium');

            // Use smart pinned message logic instead of always sending new messages
            for (const channel of premiumChannels) {
              const result = await this.getOrCreatePinnedMessage(channel, message, contentHash);
              if (result.success) {
                if (result.action === 'skipped') {
                  totalSkipped++;
                } else {
                  totalSent++;
                }
              } else {
                totalFailed++;
              }
              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            logger.info(`Premium trending complete`);
          } else {
            logger.debug('No premium trending tokens found');
          }
        } catch (error) {
          logger.error('Error getting premium trending tokens:', error);
        }
      } else if (premiumChannels.length > 0) {
        logger.debug('Premium channels exist but secureTrending service not available');
      }

      logger.info(`📊 Total trending broadcast: ${totalSent} created/edited, ${totalSkipped} skipped (unchanged), ${totalFailed} failed`);
    } catch (error) {
      logger.error('Error sending trending update:', error);
    }
  }

  async broadcastToChannelList(channels, message) {
    let sent = 0;
    let failed = 0;

    for (const channel of channels) {
      try {
        await this.bot.telegram.sendMessage(
          channel.telegram_chat_id,
          message,
          {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }
        );
        sent++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failed++;
        logger.error(`Failed to send broadcast to channel ${channel.telegram_chat_id}:`, error);

        if (error.response?.error_code === 403) {
          await this.db.run(
            'UPDATE channels SET is_active = false WHERE telegram_chat_id = $1',
            [channel.telegram_chat_id]
          );
          logger.info(`Deactivated channel ${channel.telegram_chat_id} - bot removed`);
        }
      }
    }

    return { sent, failed };
  }

  formatTrendingBroadcast(trendingTokens, tier = 'normal') {
    // Two-line header with emojis (centered using spaces)
    const tierLabel = tier === 'premium' ? '⭐️ PREMIUM' : '🔵 STANDARD';
    const tierEmoji = tier === 'premium' ? '⭐️' : '🔵';

    // Add spacing for visual centering
    let message = `       🔥 ${tierLabel} TRENDING ${tierLabel.includes('PREMIUM') ? '⭐️' : '🔵'}🔥\n`;
    message += `        🔥 NFT COLLECTIONS 🔥\n\n`;

    trendingTokens.slice(0, 5).forEach((token, index) => {
      const collectionName = token.token_name || 'Unknown Collection';

      // Make collection name clickable if group_link exists
      if (token.group_link) {
        message += `${tierEmoji} <b>${index + 1}. <a href="${token.group_link}">${collectionName}</a></b>\n`;
      } else {
        message += `${tierEmoji} <b>${index + 1}. ${collectionName}</b>\n`;
      }

      // Display floor price FIRST (prefer floor_price_24h over static floor_price)
      const floorPrice = token.floor_price_24h || token.floor_price;
      if (floorPrice && parseFloat(floorPrice) > 0) {
        message += `💎 Floor: ${parseFloat(floorPrice).toFixed(4)} ETH\n`;
      }

      // Display 24h volume SECOND with change percentage
      if (token.volume_24h !== null && token.volume_24h !== undefined) {
        const volumeStr = parseFloat(token.volume_24h).toFixed(3);

        // Add volume change percentage if available AND non-zero (OpenSea often returns 0)
        if (token.volume_change_24h !== null &&
            token.volume_change_24h !== undefined &&
            parseFloat(token.volume_change_24h) !== 0) {
          const changePercent = (parseFloat(token.volume_change_24h) * 100).toFixed(1);
          const sign = changePercent >= 0 ? '+' : '';
          message += `📊 24h Vol: ${volumeStr} ETH (${sign}${changePercent}%)\n`;
        } else {
          message += `📊 24h Vol: ${volumeStr} ETH\n`;
        }
      }

      // Display market cap THIRD
      if (token.market_cap !== null && token.market_cap !== undefined && parseFloat(token.market_cap) > 0) {
        const marketCapNum = parseFloat(token.market_cap);
        const marketCapStr = marketCapNum >= 1000
          ? `${(marketCapNum / 1000).toFixed(2)}K`
          : marketCapNum.toFixed(2);
        message += `🏛️ Market Cap: ${marketCapStr} ETH\n\n`;
      } else {
        message += '\n';
      }
    });

    return message;
  }

  /**
   * Generate SHA-256 hash of trending tokens for change detection
   * @param {Array} trendingTokens - Array of trending token objects
   * @param {string} tier - Tier level ('normal' or 'premium')
   * @returns {string} SHA-256 hash as hex string
   */
  generateTrendingHash(trendingTokens, tier) {
    // Create deterministic string representation of trending data
    // Include stats data (volume, floor price, volume change, market cap) so hash changes when stats update
    const tokenData = trendingTokens.slice(0, 5).map(token => ({
      contract: token.contract_address.toLowerCase(),
      name: token.token_name || '',
      payment: token.payment_amount || '0',
      volume_24h: token.volume_24h || '0',
      volume_change_24h: token.volume_change_24h || '0',
      floor_price: token.floor_price_24h || token.floor_price || '0',
      market_cap: token.market_cap || '0'
    }));

    // Create stable JSON string (sorted keys to ensure consistency)
    const dataString = JSON.stringify({
      tier,
      tokens: tokenData
    }, Object.keys({tier: null, tokens: null}).sort());

    // Generate SHA-256 hash
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }

  /**
   * Get or create pinned trending message for a channel
   * Smart logic: checks existing pin, compares content hash, only edits/creates if changed
   * @param {Object} channel - Channel database record
   * @param {string} message - Formatted trending message
   * @param {string} contentHash - SHA-256 hash of trending content
   * @returns {Promise<Object>} Result object with success status and details
   */
  async getOrCreatePinnedMessage(channel, message, contentHash) {
    try {
      const chatId = channel.telegram_chat_id;
      let messageId = channel.pinned_trending_message_id;
      let storedHash = channel.pinned_message_content_hash;

      // Case 1: Content hasn't changed, no action needed
      if (messageId && storedHash === contentHash) {
        logger.info(`📌 [${channel.channel_title}] Pinned message exists, content unchanged - skipping update`);
        logger.debug(`   Stored hash: ${storedHash}`);
        logger.debug(`   Current hash: ${contentHash}`);
        return { success: true, action: 'skipped', reason: 'content_unchanged' };
      }

      // Log if this is first pin or an update
      if (!messageId) {
        logger.info(`📌 [${channel.channel_title}] No pinned message exists - creating new one`);
      } else {
        logger.info(`📌 [${channel.channel_title}] Content changed - updating pinned message ${messageId}`);
        logger.debug(`   Old hash: ${storedHash}`);
        logger.debug(`   New hash: ${contentHash}`);
      }

      // Case 2: Have pinned message ID, try to edit it
      if (messageId) {
        try {
          await this.bot.telegram.editMessageText(
            chatId,
            parseInt(messageId),
            null,
            message,
            {
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Candy Codex Telegram', url: 'https://t.me/CandyCodex' }]
                ]
              }
            }
          );

          // Update hash in database
          await this.db.run(
            `UPDATE channels
             SET pinned_message_content_hash = $1,
                 last_pinned_update = NOW()
             WHERE telegram_chat_id = $2`,
            [contentHash, chatId]
          );

          logger.info(`[${channel.channel_title}] Edited existing pinned message ${messageId}`);
          return { success: true, action: 'edited', messageId };

        } catch (editError) {
          // Message might have been deleted or permission issues
          if (editError.response?.error_code === 400 || editError.response?.description?.includes('message to edit not found')) {
            logger.warn(`[${channel.channel_title}] Pinned message ${messageId} not found, will create new one`);
            messageId = null; // Reset to create new message
          } else {
            throw editError; // Re-throw other errors
          }
        }
      }

      // Case 3: No pinned message or edit failed, create new one
      const sentMessage = await this.bot.telegram.sendMessage(
        chatId,
        message,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Candy Codex Telegram', url: 'https://t.me/CandyCodex' }]
            ]
          }
        }
      );

      // Try to pin the message
      try {
        await this.bot.telegram.pinChatMessage(chatId, sentMessage.message_id, {
          disable_notification: true
        });

        logger.info(`[${channel.channel_title}] Created and pinned new message ${sentMessage.message_id}`);

      } catch (pinError) {
        // Bot might not have pin permissions, log but don't fail
        if (pinError.response?.error_code === 400 && pinError.response?.description?.includes('not enough rights')) {
          logger.warn(`[${channel.channel_title}] No permission to pin message, sent without pinning`);
        } else {
          logger.error(`[${channel.channel_title}] Error pinning message:`, pinError);
        }
      }

      // Update database with new message ID and hash
      await this.db.run(
        `UPDATE channels
         SET pinned_trending_message_id = $1,
             pinned_message_content_hash = $2,
             last_pinned_update = NOW()
         WHERE telegram_chat_id = $3`,
        [sentMessage.message_id.toString(), contentHash, chatId]
      );

      return { success: true, action: 'created', messageId: sentMessage.message_id };

    } catch (error) {
      logger.error(`[${channel.channel_title}] Error managing pinned message:`, error);

      // Handle bot removal from channel
      if (error.response?.error_code === 403) {
        await this.db.run(
          'UPDATE channels SET is_active = false WHERE telegram_chat_id = $1',
          [channel.telegram_chat_id]
        );
        logger.info(`Deactivated channel ${channel.telegram_chat_id} - bot removed`);
      }

      return { success: false, error: error.message };
    }
  }

  async handleChannelCommand(ctx, command) {
    try {
      const chatId = ctx.chat.id.toString();
      const userId = ctx.from?.id;
      switch (command) {
        case 'channel_settings':
          return await this.handleChannelSettingsCommand(ctx, chatId);
        case 'add_channel':
          return await this.handleAddChannelCommand(ctx, chatId, userId);
        case 'remove_channel':
          return await this.handleRemoveChannelCommand(ctx, chatId, userId);
        case 'trending_now':
          return await this.handleTrendingNowCommand(ctx);
        default:
          return ctx.reply('❌ Unknown channel command');
      }
    } catch (error) {
      logger.error(`Error handling channel command ${command}:`, error);
      return ctx.reply('❌ Error processing command');
    }
  }

  async handleChannelSettingsCommand(ctx, chatId) {
    try {
      const settings = await this.getChannelSettings(chatId);
      if (!settings.success) {
        return ctx.reply(settings.message);
      }

      const { show_trending, show_all_activities, channel_title, added_date } = settings.settings;
      const message = `
⚙️ **Channel Settings**

📺 **Channel:** ${channel_title || 'Unknown'}
📅 **Added:** ${new Date(added_date).toLocaleDateString()}

**Alert Settings:**
🔥 Trending alerts: ${show_trending ? '✅ ON' : '❌ OFF'}
📊 All activity alerts: ${show_all_activities ? '✅ ON' : '❌ OFF'}

*Use inline buttons below to change settings.*
      `;

      const keyboard = [
        [
          { text: `🔥 Trending: ${show_trending ? 'ON' : 'OFF'}`, callback_data: `channel_toggle_trending` },
          { text: `📊 All Activity: ${show_all_activities ? 'ON' : 'OFF'}`, callback_data: `channel_toggle_activity` }
        ],
        [{ text: '🔄 Refresh', callback_data: 'channel_settings' }]
      ];

      await ctx.replyWithMarkdown(message, {
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      logger.error('Error in channel settings command:', error);
      ctx.reply('❌ Error retrieving channel settings');
    }
  }

  async handleTrendingNowCommand(ctx) {
    try {
      if (!this.trending) {
        return ctx.reply('❌ Trending service not available');
      }

      const trendingTokens = await this.trending.getTrendingTokens();
      const message = this.formatTrendingBroadcast(trendingTokens);
      await ctx.replyWithMarkdown(message);
    } catch (error) {
      logger.error('Error in trending now command:', error);
      ctx.reply('❌ Error retrieving trending information');
    }
  }

  async getActiveChannelsCount() {
    try {
      const result = await this.db.get(
        'SELECT COUNT(*) as count FROM channels WHERE is_active = 1'
      );
      return result ? result.count : 0;
    } catch (error) {
      logger.error('Error getting active channels count:', error);
      return 0;
    }
  }

  async getChannelStats() {
    try {
      const stats = await this.db.get(`
        SELECT 
          COUNT(*) as total_channels,
          COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_channels,
          COUNT(CASE WHEN show_trending = 1 THEN 1 END) as trending_enabled,
          COUNT(CASE WHEN show_all_activities = 1 THEN 1 END) as activity_enabled
        FROM channels
      `);
      return stats || {
        total_channels: 0,
        active_channels: 0,
        trending_enabled: 0,
        activity_enabled: 0
      };
    } catch (error) {
      logger.error('Error getting channel stats:', error);
      return {
        total_channels: 0,
        active_channels: 0,
        trending_enabled: 0,
        activity_enabled: 0
      };
    }
  }
}

module.exports = ChannelService;