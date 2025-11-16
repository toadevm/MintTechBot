const logger = require('./logger');

class ChannelService {
  constructor(database, bot, trendingService, secureTrendingService = null) {
    this.db = database;
    this.bot = bot;
    this.trending = trendingService;
    this.secureTrending = secureTrendingService;
    this.scheduledMessages = new Map();
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

    setInterval(async () => {
      try {
        await this.sendTrendingUpdate();
      } catch (error) {
        logger.error('Error in scheduled trending broadcast:', error);
      }
    }, 4 * 60 * 60 * 1000);


    setTimeout(async () => {
      try {
        await this.sendTrendingUpdate();
      } catch (error) {
        logger.error('Error in initial trending broadcast:', error);
      }
    }, 60 * 1000);
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

      let totalSent = 0;
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

          const message = this.formatTrendingBroadcast(uniqueNormalTokens, 'normal');
          const result = await this.broadcastToChannelList(normalChannels, message);
          totalSent += result.sent;
          totalFailed += result.failed;
          logger.info(`Normal trending broadcast sent to ${result.sent} channels`);
        }
      }

      // Broadcast premium tier tokens
      if (premiumChannels.length > 0 && this.secureTrending) {
        try {
          const premiumTokens = await this.secureTrending.getTrendingTokens('premium');

          if (premiumTokens.length > 0) {
            logger.info(`Broadcasting ${premiumTokens.length} premium tier tokens to ${premiumChannels.length} channels`);
            premiumChannels.forEach(c => logger.debug(`  - Premium broadcast to: ${c.channel_title} (tier: ${c.trending_tier})`));

            const message = this.formatTrendingBroadcast(premiumTokens, 'premium');
            const result = await this.broadcastToChannelList(premiumChannels, message);
            totalSent += result.sent;
            totalFailed += result.failed;
            logger.info(`Premium trending broadcast sent to ${result.sent} channels`);
          } else {
            logger.debug('No premium trending tokens found');
          }
        } catch (error) {
          logger.error('Error getting premium trending tokens:', error);
        }
      } else if (premiumChannels.length > 0) {
        logger.debug('Premium channels exist but secureTrending service not available');
      }

      logger.info(`Total trending broadcast: ${totalSent} sent, ${totalFailed} failed`);
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
    // Tier header
    const tierBadge = tier === 'premium' ? '⭐ PREMIUM' : '🔵 STANDARD';
    const tierEmoji = tier === 'premium' ? '⭐' : '🔵';

    let message = `🔥 <b>${tierBadge} TRENDING NFT COLLECTIONS</b> 🔥\n\n`;

    trendingTokens.slice(0, 5).forEach((token, index) => {
      const endTime = new Date(token.trending_end_time);
      const now = new Date();
      const hoursLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60)));

      message += `${tierEmoji} <b>${index + 1}. ${token.token_name || 'Unknown Collection'}</b>\n`;
      message += `⏱️ ${hoursLeft}h remaining\n`;
      message += `💰 ${(parseFloat(token.payment_amount) / 1e18).toFixed(3)} ETH promoted\n`;

      if (token.floor_price && parseFloat(token.floor_price) > 0) {
        message += `📊 Floor: ${(parseFloat(token.floor_price) / 1e18).toFixed(3)} ETH\n`;
      }

      message += `📮 <code>${token.contract_address}</code>\n\n`;
    });
    return message;
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