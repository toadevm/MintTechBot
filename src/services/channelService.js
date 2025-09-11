const logger = require('./logger');

class ChannelService {
  constructor(database, bot, trendingService) {
    this.db = database;
    this.bot = bot;
    this.trending = trendingService;
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
        'UPDATE channels SET is_active = 0 WHERE telegram_chat_id = ?',
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
      const { show_trending, show_all_activities } = settings;
      const result = await this.db.run(`
        UPDATE channels 
        SET show_trending = COALESCE(?, show_trending),
            show_all_activities = COALESCE(?, show_all_activities)
        WHERE telegram_chat_id = ? AND is_active = 1
      `, [show_trending, show_all_activities, telegramChatId]);

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
        'SELECT * FROM channels WHERE telegram_chat_id = ? AND is_active = 1',
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
          show_trending: channel.show_trending === 1,
          show_all_activities: channel.show_all_activities === 1,
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
              'UPDATE channels SET is_active = 0 WHERE telegram_chat_id = ?',
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
      if (!this.trending) {
        logger.debug('Trending service not available, skipping broadcast');
        return;
      }

      const trendingTokens = await this.trending.getTrendingTokens();
      if (trendingTokens.length === 0) {
        logger.debug('No trending tokens, skipping broadcast');
        return;
      }

      const message = this.formatTrendingBroadcast(trendingTokens);
      const result = await this.broadcastToChannels(
        message, 
        'show_trending = 1'
      );

      logger.info(`Trending broadcast sent to ${result.sent} channels`);
    } catch (error) {
      logger.error('Error sending trending update:', error);
    }
  }

  formatTrendingBroadcast(trendingTokens) {
    let message = '🔥 **TRENDING NFT COLLECTIONS** 🔥\n\n';
    trendingTokens.slice(0, 5).forEach((token, index) => {
      const endTime = new Date(token.trending_end_time);
      const now = new Date();
      const hoursLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60)));
      message += `**${index + 1}. ${token.token_name || 'Unknown Collection'}**\n`;
      message += `⏱️ ${hoursLeft}h remaining\n`;
      message += `💰 ${(parseFloat(token.payment_amount) / 1e18).toFixed(3)} ETH promoted\n`;
      if (token.floor_price && parseFloat(token.floor_price) > 0) {
        message += `📊 Floor: ${(parseFloat(token.floor_price) / 1e18).toFixed(3)} ETH\n`;
      }
      message += `📮 \`${token.contract_address}\`\n\n`;
    });

    message += '💡 *Want to promote your NFT? Contact @YourBotUsername*';
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