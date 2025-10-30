const { Markup } = require('telegraf');
const logger = require('../services/logger');
const { ethers } = require('ethers');
const addresses = require('../config/addresses');
const helpers = require('./helpers');

class BotCommands {
  constructor(database, tokenTracker, trendingService, channelService, secureTrendingService = null, chainManager = null) {
    this.db = database;
    this.tokenTracker = tokenTracker;
    this.trending = trendingService;
    this.secureTrending = secureTrendingService;
    this.channels = channelService;
    this.chainManager = chainManager;

    this.userStates = new Map();
    this.userSessions = new Map(); // Store user session data for multi-step flows

    // Original states
    this.STATE_EXPECTING_CONTEXT_SELECTION = 'expecting_context_selection';
    this.STATE_EXPECTING_CONTRACT = 'expecting_contract';
    this.STATE_EXPECTING_CHAIN_FOR_CONTRACT = 'expecting_chain_for_contract';
    this.STATE_EXPECTING_CHAIN_FOR_VIEW = 'expecting_chain_for_view';
    this.STATE_EXPECTING_TX_HASH = 'expecting_tx_hash';
    this.STATE_EXPECTING_FOOTER_CONTRACT = 'expecting_footer_contract';
    this.STATE_EXPECTING_FOOTER_TX_HASH = 'expecting_footer_tx_hash';
    this.STATE_EXPECTING_FOOTER_LINK = 'expecting_footer_link';
    this.STATE_EXPECTING_IMAGE_CONTRACT = 'expecting_image_contract';
    this.STATE_EXPECTING_IMAGE_TX_HASH = 'expecting_image_tx_hash';
    this.STATE_EXPECTING_VALIDATION_CONTRACT = 'expecting_validation_contract';
    this.STATE_EXPECTING_VALIDATION_TX_HASH = 'expecting_validation_tx_hash';
    this.STATE_EXPECTING_VALIDATION_LINK = 'expecting_validation_link';
    this.STATE_EXPECTING_VALIDATION_TICKER = 'expecting_validation_ticker';

    // New enhanced flow states
    this.STATE_FOOTER_DURATION_SELECT = 'footer_duration_select';
    this.STATE_FOOTER_CHAIN_SELECT = 'footer_chain_select';
    this.STATE_FOOTER_LINK_INPUT = 'footer_link_input';
    this.STATE_FOOTER_TICKER_INPUT = 'footer_ticker_input';
    this.STATE_FOOTER_CONTRACT_INPUT = 'footer_contract_input';
    this.STATE_IMAGE_DURATION_SELECT = 'image_duration_select';
    this.STATE_IMAGE_CHAIN_SELECT = 'image_chain_select';
    this.STATE_IMAGE_CONTRACT_INPUT = 'image_contract_input';

    this.pendingPayments = new Map();
  }


  setUserState(userId, state) {
    this.userStates.set(userId.toString(), state);
    logger.debug(`Set user ${userId} state to: ${state}`);
  }

  getUserState(userId) {
    return this.userStates.get(userId.toString()) || null;
  }

  clearUserState(userId) {
    this.userStates.delete(userId.toString());
    logger.debug(`Cleared state for user ${userId}`);
  }

  // Session data management for multi-step flows
  setUserSession(userId, data) {
    const userIdStr = userId.toString();
    const existingData = this.userSessions.get(userIdStr) || {};
    this.userSessions.set(userIdStr, { ...existingData, ...data });
    logger.debug(`Set user ${userId} session data:`, data);
  }

  getUserSession(userId) {
    return this.userSessions.get(userId.toString()) || {};
  }

  clearUserSession(userId) {
    this.userSessions.delete(userId.toString());
    logger.debug(`Cleared session for user ${userId}`);
  }

  // Helper function to truncate address for display
  truncateAddress(address, startChars = 6, endChars = 4) {
    return helpers.truncateAddress(address, startChars, endChars);
  }

  // Wrapper for command error handling
  async handleCommandWithErrorWrapper(ctx, commandName, handler) {
    try {
      await handler();
    } catch (error) {
      logger.error(`Error in ${commandName}:`, error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  // Helper to send/edit menu messages with fallback
  async sendOrEditMenu(ctx, message, keyboard) {
    try {
      return await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup
      });
    } catch (error) {
      return await ctx.replyWithHTML(message, keyboard);
    }
  }

  // Helper for callback query answers
  async answerCallback(ctx, message = null) {
    try {
      await ctx.answerCbQuery(message);
    } catch (error) {
      logger.debug('Error answering callback query:', error.message);
    }
  }

  clearUserSessionData(userId, type) {
    const userIdStr = userId.toString();
    if (type === 'footer') {
      this.userStates.delete(userIdStr + '_footer_contract');
      this.userStates.delete(userIdStr + '_footer_tx');
    } else if (type === 'image') {
      this.userStates.delete(userIdStr + '_image_contract');
    } else if (type === 'validation') {
      this.userStates.delete(userIdStr + '_validation_type');
      this.userStates.delete(userIdStr + '_validation_contract');
      this.userStates.delete(userIdStr + '_validation_tx');
    }
    logger.debug(`Cleared ${type} session data for user ${userId}`);
  }

  // Normalize chat context for consistent storage
  normalizeChatContext(ctx) {
    const chatType = ctx.chat.type;
    const chatId = ctx.chat.id.toString();

    // Always use the actual chat ID (needed for Telegram notifications)
    // Private chats get their numeric ID, groups/channels also use their ID
    if (chatType === 'private') {
      logger.debug(`Chat context: ${chatType} (${chatId})`);
      return chatId; // Return actual chat ID for notifications to work
    }

    // For groups, supergroups, and channels, use the actual chat ID
    // This ensures separation between different groups/channels
    logger.debug(`Chat context normalized: ${chatType} (${chatId}) → "${chatId}"`);
    return chatId;
  }

  // ============================================================================
  // SESSION MANAGEMENT METHODS
  // ============================================================================

  /**
   * Set user session value
   * @param {number} userId - User ID
   * @param {string} key - Session key
   * @param {*} value - Session value
   */
  setUserSession(userId, key, value) {
    const sessionKey = `${userId}_session_${key}`;
    this.userStates.set(sessionKey, value);
  }

  /**
   * Get user session value
   * @param {number} userId - User ID
   * @param {string} key - Session key
   * @returns {*} Session value or undefined
   */
  getUserSession(userId, key) {
    const sessionKey = `${userId}_session_${key}`;
    return this.userStates.get(sessionKey);
  }

  /**
   * Clear user session
   * @param {number} userId - User ID
   * @param {string|null} key - Specific key to clear, or null to clear all
   */
  clearUserSession(userId, key = null) {
    if (key) {
      this.userStates.delete(`${userId}_session_${key}`);
    } else {
      // Clear all sessions for user
      for (const [k] of this.userStates) {
        if (k.startsWith(`${userId}_session_`)) {
          this.userStates.delete(k);
        }
      }
    }
  }

  // ============================================================================
  // GROUP MANAGEMENT HELPERS
  // ============================================================================

  /**
   * Check if user is admin in a group
   * @param {number} userId - User's Telegram ID
   * @param {string} groupChatId - Group chat ID
   * @param {Object} ctx - Telegram context
   * @returns {boolean} True if user is admin
   */
  async isUserGroupAdmin(userId, groupChatId, ctx) {
    try {
      const admins = await ctx.telegram.getChatAdministrators(groupChatId);
      logger.debug(`Checking admin status for user ${userId} in group ${groupChatId}`);
      logger.debug(`Admins:`, admins.map(a => ({ id: a.user.id, username: a.user.username, status: a.status })));

      const isAdmin = admins.some(admin => admin.user.id === userId);
      logger.debug(`User ${userId} is admin: ${isAdmin}`);

      return isAdmin;
    } catch (error) {
      // "chat not found" is expected when bot is removed from a group - no need to log as error
      if (error.response?.description?.includes('chat not found')) {
        logger.debug(`Chat not found: ${groupChatId} (bot likely removed from group)`);
      } else {
        logger.error('Error checking admin status:', error);
      }
      return false;
    }
  }

  /**
   * Resolve chat_id to human-readable context label
   * @param {string} chatId - Chat ID to resolve
   * @param {Object} ctx - Telegram context
   * @param {string} userTelegramId - User's Telegram ID
   * @returns {Promise<string>} Context label (e.g., "Private" or "GroupName")
   */
  async resolveContextLabel(chatId, ctx, userTelegramId) {
    try {
      // Fetch group/channel title
      try {
        const chat = await ctx.telegram.getChat(chatId);
        return chat.title || 'Group';
      } catch (error) {
        logger.warn(`Failed to resolve context for chat_id ${chatId}:`, error);
        return 'Group';
      }
    } catch (error) {
      logger.error('Error resolving context label:', error);
      return 'Unknown';
    }
  }

  /**
   * Resolve context labels for all tokens in parallel
   * @param {Array} tokens - Array of tokens with chat_id
   * @param {Object} ctx - Telegram context
   * @param {string} userTelegramId - User's Telegram ID
   * @returns {Promise<Array>} Tokens with contextLabel added
   */
  async resolveAllContexts(tokens, ctx, userTelegramId) {
    try {
      // Get unique chat_ids
      const uniqueChatIds = [...new Set(tokens.map(t => t.chat_id))];

      // Resolve all context labels in parallel
      const contextMap = {};
      await Promise.all(
        uniqueChatIds.map(async (chatId) => {
          contextMap[chatId] = await this.resolveContextLabel(chatId, ctx, userTelegramId);
        })
      );

      // Add contextLabel to each token
      return tokens.map(token => ({
        ...token,
        contextLabel: contextMap[token.chat_id]
      }));
    } catch (error) {
      logger.error('Error resolving all contexts:', error);
      return tokens; // Return tokens without labels on error
    }
  }

  /**
   * Check if bot should respond to a message in a group
   * Bot responds in groups only when:
   * 1. Message is a reply to the bot's message
   * 2. Message mentions/tags the bot (@botname)
   * @param {Object} ctx - Telegram context
   * @returns {boolean} True if bot should respond, false if should ignore
   */
  shouldRespondInGroup(ctx) {
    // If message is a reply to the bot's message, respond
    if (ctx.message.reply_to_message && ctx.message.reply_to_message.from.is_bot) {
      logger.debug(`Group message is reply to bot - will respond`);
      return true;
    }

    // Check if bot is mentioned in the message
    if (ctx.message.entities) {
      const botUsername = ctx.botInfo.username;

      for (const entity of ctx.message.entities) {
        // Check for mention entity type
        if (entity.type === 'mention') {
          const mention = ctx.message.text.substring(entity.offset, entity.offset + entity.length);
          if (mention === `@${botUsername}`) {
            logger.debug(`Group message mentions bot @${botUsername} - will respond`);
            return true;
          }
        }

        // Check for text_mention entity type (for users without username)
        if (entity.type === 'text_mention' && entity.user && entity.user.is_bot) {
          logger.debug(`Group message has text_mention of bot - will respond`);
          return true;
        }
      }
    }

    // Also check message text for @botname (fallback)
    if (ctx.message.text && ctx.botInfo && ctx.botInfo.username) {
      const botUsername = ctx.botInfo.username;
      if (ctx.message.text.includes(`@${botUsername}`)) {
        logger.debug(`Group message contains @${botUsername} - will respond`);
        return true;
      }
    }

    logger.debug(`Group message has no reply/mention - will ignore`);
    return false;
  }

  async setupCommands(bot) {

    bot.command('startminty', async (ctx) => {
      const chatType = ctx.chat.type;

      // Handle group/supergroup context
      if (chatType === 'group' || chatType === 'supergroup') {
        return this.handleGroupStart(ctx);
      }

      // Handle private chat context (existing behavior)
      const user = ctx.from;
      await this.db.createUser(user.id.toString(), user.username, user.first_name);
      const welcomeMessage = helpers.formatWelcomeMessage();
      const keyboard = helpers.buildMainMenuKeyboard();

      await ctx.replyWithHTML(welcomeMessage, keyboard);
      logger.info(`New user started bot: ${user.id} (${user.username})`);
    });

    // Add /start command that works the same as /startminty but with parameter handling
    bot.start(async (ctx) => {
      const user = ctx.from;
      await this.db.createUser(user.id.toString(), user.username, user.first_name);

      // Check for start parameters (deep links)
      const startPayload = ctx.startPayload;

      logger.info(`[BOT_START] User ${user.id} (${user.username}) started bot with payload: ${startPayload || 'NONE'}`);

      // Handle group setup deep link
      if (startPayload && startPayload.startsWith('setup_')) {
        const setupToken = startPayload.replace('setup_', '');
        logger.info(`[BOT_START] Detected group setup token: ${setupToken}`);

        // Validate token and get group context
        const groupContext = await this.db.getGroupContextByToken(setupToken);

        if (groupContext) {
          logger.info(`[BOT_START] Found group context: ${groupContext.group_title} (${groupContext.group_chat_id})`);

          // Verify user is still admin (use Telegram ID, not database user ID)
          const isAdmin = await this.isUserGroupAdmin(ctx.from.id, groupContext.group_chat_id, ctx);

          if (isAdmin) {
            // Store pending session for auto-detection
            this.setUserSession(user.id, 'pending_group_setup', setupToken);

            logger.info(`[BOT_START] Stored pending group setup session for user ${user.id}`);

            // Show normal welcome message
            const welcomeMessage = helpers.formatWelcomeMessage();
            const keyboard = helpers.buildMainMenuKeyboard();
            return await ctx.replyWithHTML(welcomeMessage, keyboard);
          } else {
            logger.warn(`[BOT_START] User ${ctx.from.id} is NOT admin in group ${groupContext.group_chat_id}`);
            return ctx.reply('⚠️ You are no longer an admin in that group.');
          }
        } else {
          logger.warn(`[BOT_START] Invalid setup token: ${setupToken}`);
          return ctx.reply('❌ Invalid or expired setup link. Please run /startminty in the group again.');
        }
      }

      // Handle footer ads deep link
      if (startPayload === 'buy_footer') {
        logger.info(`[BOT_START] Routing to footer menu`);
        return this.showFooterMenu(ctx);
      }

      // Default start behavior - show welcome menu (including from group redirects)
      logger.info(`[BOT_START] Showing welcome menu`);
      const welcomeMessage = helpers.formatWelcomeMessage();
      const keyboard = helpers.buildMainMenuKeyboard();

      await ctx.replyWithHTML(welcomeMessage, keyboard);
    });

    bot.help(async (ctx) => {
      const helpMessage = helpers.formatHelpMessage();
      await ctx.replyWithHTML(helpMessage);
    });

    // Manual transaction validation command
    bot.command('validate', async (ctx) => {
      try {
        if (!this.secureTrending) {
          return ctx.reply('❌ Validation service not available.');
        }

        // Trigger the verify trending button flow instead of text-based command
        return this.showVerifyTokenSelection(ctx, 'trending');

      } catch (error) {
        logger.error('Error in validate command:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
      }
    });

    bot.command('buy_image', async (ctx) => {
      try {
        if (!this.secureTrending) {
          return ctx.reply('❌ Image fee system not available.');
        }

        // Trigger the buy image button flow instead of text-based command
        return this.showImageTokenSelection(ctx);

      } catch (error) {
        logger.error('Error in buy_image command:', error);
        ctx.reply('⚠️ An error occurred. Please try again.');
      }
    });

    bot.command('validate_image', async (ctx) => {
      try {
        if (!this.secureTrending) {
          return ctx.reply('❌ Image fee system not available.');
        }

        // Trigger the verify image button flow instead of text-based command
        return this.showVerifyTokenSelection(ctx, 'image');

      } catch (error) {
        logger.error('Error in validate_image command:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
      }
    });

    bot.command('buy_footer', async (ctx) => {
      try {
        if (!this.secureTrending) {
          return ctx.reply('❌ Footer ad system not available.');
        }

        // Initialize session for footer payment flow
        this.setUserSession(ctx.from.id, { flow: 'footer_payment' });
        // Trigger the buy footer button flow (shows chain selection first)
        return this.showChainSelection(ctx, 'footer');

      } catch (error) {
        logger.error('Error in buy_footer command:', error);
        ctx.reply('⚠️ An error occurred. Please try again.');
      }
    });

    bot.command('validate_footer', async (ctx) => {
      try {
        if (!this.secureTrending) {
          return ctx.reply('❌ Footer ad system not available.');
        }

        // Trigger the verify footer button flow instead of text-based command
        return this.showFooterTickerSelection(ctx);

      } catch (error) {
        logger.error('Error in validate_footer command:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
      }
    });


    bot.command('add_token', async (ctx) => {
      // Show context selection menu first (same as button flow)
      this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTEXT_SELECTION);
      return this.showContextSelectionMenu(ctx, 0);
    });


    bot.command('my_tokens', async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from.id.toString());
        if (!user) {
          return ctx.reply('Please start the bot first with /startminty');
        }

        // Use same context-aware logic as menu button
        return this.showMyTokens(ctx);
      } catch (error) {
        logger.error('Error in my_tokens command:', error);
        ctx.reply('❌ Error retrieving your NFTs. Please try again.');
      }
    });


    bot.command('remove_token', async (ctx) => {
      try {
        // Use the same working logic as showMyTokens() which has working remove buttons
        return this.showMyTokens(ctx);
      } catch (error) {
        logger.error('Error in remove_token command:', error);
        ctx.reply('❌ Error loading your NFTs. Please try again.');
      }
    });



    bot.command('trending', async (ctx) => {
      try {
        await this.db.expireTrendingPayments();
        const trendingTokens = await this.db.getTrendingTokens();
        if (trendingTokens.length === 0) {
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('💰 Buy Normal', 'promote_token'), Markup.button.callback('⭐ Buy Premium', 'promote_token_premium')],
            [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
          ]);
          return ctx.replyWithMarkdown(
            '📊 *No trending NFTs right now*\n\nBe the first to boost your NFT collection!',
            keyboard
          );
        }

        let message = '🔥 *Trending NFT Collections*\n\n';
        const keyboard = [];

        trendingTokens.forEach((token, index) => {
          const endTime = new Date(token.trending_end_time);
          const hoursLeft = Math.max(0, Math.ceil((endTime - new Date()) / (1000 * 60 * 60)));
          message += `${index + 1}. *${token.token_name || 'Unknown Collection'}*\n`;
          message += `   📮 \`${token.contract_address}\`\n`;
          message += `   ⏱️ ${hoursLeft}h left\n`;
          message += `   💰 Paid: ${ethers.formatEther(token.payment_amount)} ETH\n\n`;
          keyboard.push([
            Markup.button.callback(`📊 ${token.token_name || 'View'} Stats`, `stats_${token.id}`)
          ]);
        });

        keyboard.push([Markup.button.callback('💰 Boost Your Token', 'promote_token')]);

        await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(keyboard));
      } catch (error) {
        logger.error('Error in trending command:', error);
        ctx.reply('❌ Error retrieving trending tokens. Please try again.');
      }
    });


    bot.command('buy_trending', async (ctx) => {
      const message = `🚀 *Buy Trending Menu*

Choose your trending boost option:`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💫 Buy Trending', 'buy_trending_normal')],
        [Markup.button.callback('⭐ Buy Trending Premium', 'buy_trending_premium')],
        [Markup.button.callback('🔥 View Current Trending', 'view_trending')]
      ]);

      await ctx.replyWithMarkdown(message, keyboard);
    });


    bot.command('add_channel', async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();
        const chatType = ctx.chat.type;

        if (chatType !== 'channel' && chatType !== 'supergroup') {
          return ctx.reply('❌ This command only works in channels or groups. Add me to a channel first, then use this command there.');
        }
        const channelTitle = ctx.chat.title || 'Unknown Channel';
        const userId = ctx.from?.id;
        if (!userId) {
          return ctx.reply('❌ Unable to identify user. Please try again.');
        }
        const result = await this.channels.addChannel(chatId, channelTitle, userId);
        await ctx.reply(result.message);
      } catch (error) {
        logger.error('Error in add_channel command:', error);
        ctx.reply('❌ Error adding channel. Please try again.');
      }
    });

    bot.command('channel_settings', async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();
        const chatType = ctx.chat.type;

        if (chatType !== 'channel' && chatType !== 'supergroup') {
          return ctx.reply('❌ This command only works in channels or groups.');
        }
        await this.channels.handleChannelSettingsCommand(ctx, chatId);
      } catch (error) {
        logger.error('Error in channel_settings command:', error);
        ctx.reply('❌ Error retrieving channel settings. Please try again.');
      }
    });

    bot.command('get_chat_id', async (ctx) => {
      try {
        const chatId = ctx.chat.id;
        const chatType = ctx.chat.type;
        const chatTitle = ctx.chat.title || ctx.chat.first_name || 'Unknown';
        const message = `
🆔 *Chat Information*

**Chat ID:** \`${chatId}\`
**Type:** ${chatType}
**Title:** ${chatTitle}

*Use this chat ID to configure notifications in your bot settings.*
        `;
        await ctx.replyWithMarkdown(message);
      } catch (error) {
        logger.error('Error in get_chat_id command:', error);
        ctx.reply('❌ Error getting chat information.');
      }
    });


    bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery.data;
      logger.info(`[CALLBACK_DEBUG] Received callback: ${data}`);
      try {
        if (data === 'view_trending') {
          await ctx.answerCbQuery();
          return this.showTrendingCommand(ctx);
        }
        if (data === 'add_token_start') {
          await ctx.answerCbQuery();

          // Check for pending group setup session (auto-detection from deep link)
          const pendingSetupToken = this.getUserSession(ctx.from.id, 'pending_group_setup');

          if (pendingSetupToken) {
            logger.info(`[ADD_TOKEN] Auto-detecting group from setup token: ${pendingSetupToken}`);

            // Validate token and get group context
            const groupContext = await this.db.getGroupContextByToken(pendingSetupToken);

            if (groupContext) {
              // Ensure user exists and verify admin status (use Telegram ID for admin check)
              await this.db.createUser(ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
              const user = await this.db.getUser(ctx.from.id.toString());
              const isAdmin = await this.isUserGroupAdmin(ctx.from.id, groupContext.group_chat_id, ctx);

              if (isAdmin) {
                // Auto-set group context for token addition
                this.setUserSession(ctx.from.id, 'configuring_group', groupContext.group_chat_id);
                this.setUserSession(ctx.from.id, 'group_title', groupContext.group_title);

                // Clear pending session (one-shot consumption)
                this.clearUserSession(ctx.from.id, 'pending_group_setup');

                logger.info(`[ADD_TOKEN] Auto-detected group: ${groupContext.group_title} (${groupContext.group_chat_id})`);

                // Show chain selection with group indicator and escape hatch
                if (!this.chainManager) {
                  return ctx.reply('❌ Chain manager not available');
                }

                const message = `🎯 <b>Adding NFT to:</b> ${groupContext.group_title}\n\n` +
                  `Please select the blockchain chain:`;

                // Use dynamic chain manager for all chains
                const chainKeyboard = this.chainManager.getChainSelectionKeyboard();
                chainKeyboard.push([
                  { text: '🔄 Switch Group', callback_data: 'switch_group_context' },
                  { text: '🏠 Main Menu', callback_data: 'main_menu' }
                ]);

                const keyboard = Markup.inlineKeyboard(chainKeyboard);
                this.setUserState(ctx.from.id, this.STATE_EXPECTING_CHAIN_FOR_CONTRACT);
                return ctx.replyWithHTML(message, keyboard);
              } else {
                // User is no longer admin - clear session and show error
                this.clearUserSession(ctx.from.id, 'pending_group_setup');
                logger.warn(`[ADD_TOKEN] User ${ctx.from.id} is NOT admin in group ${groupContext.group_chat_id}`);

                // Fallback to normal context selection
                this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTEXT_SELECTION);
                await ctx.reply('⚠️ You are no longer an admin in that group. Please select a different context:');
                return this.showContextSelectionMenu(ctx, 0);
              }
            } else {
              // Invalid token - clear session and fallback
              this.clearUserSession(ctx.from.id, 'pending_group_setup');
              logger.warn(`[ADD_TOKEN] Invalid setup token: ${pendingSetupToken}`);

              // Fallback to normal context selection
              this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTEXT_SELECTION);
              return this.showContextSelectionMenu(ctx, 0);
            }
          }

          // No pending session - show normal context selection menu
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTEXT_SELECTION);
          return this.showContextSelectionMenu(ctx, 0);
        }

        // Switch Group escape hatch handler
        if (data === 'switch_group_context') {
          await ctx.answerCbQuery();

          // Clear group configuration sessions
          const userId = ctx.from.id.toString();
          this.clearUserSession(userId, 'configuring_group');
          this.clearUserSession(userId, 'group_title');

          logger.info(`[SWITCH_GROUP] User ${userId} manually switching context`);

          // Show context selection menu
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTEXT_SELECTION);
          return this.showContextSelectionMenu(ctx, 0);
        }

        // Context selection handlers
        if (data.startsWith('context_select_group_')) {
          await ctx.answerCbQuery();

          // Parse: context_select_group_{chatId}_{page}
          const parts = data.replace('context_select_group_', '').split('_');
          const page = parts.pop(); // Last part is page number
          const chatId = parts.join('_'); // Rest is chat_id

          // Get group title
          let groupTitle = 'Group';
          try {
            const chat = await ctx.telegram.getChat(chatId);
            groupTitle = chat.title || 'Group';
          } catch (error) {
            logger.warn(`Failed to get chat title for ${chatId}:`, error);
          }

          // Set session for group configuration
          const userId = ctx.from.id.toString();
          this.setUserSession(userId, 'configuring_group', chatId);
          this.setUserSession(userId, 'group_title', groupTitle);

          // Show chain selection
          if (!this.chainManager) {
            return ctx.reply('❌ Chain manager not available');
          }

          const chainKeyboard = this.chainManager.getChainSelectionKeyboard();
          chainKeyboard.push([{
            text: '◀️ Back to Context Selection',
            callback_data: 'add_token_start'
          }]);
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CHAIN_FOR_CONTRACT);

          const message = `🔗 <b>Select Blockchain Network</b>\n\n👥 <b>Adding to: ${groupTitle}</b>\n\nChoose the blockchain where your NFT collection exists:`;
          const keyboard = Markup.inlineKeyboard(chainKeyboard);
          return this.sendOrEditMenu(ctx, message, keyboard);
        }

        if (data.startsWith('context_page_')) {
          await ctx.answerCbQuery();
          const page = parseInt(data.replace('context_page_', ''));
          return this.showContextSelectionMenu(ctx, page);
        }

        if (data === 'noop') {
          // No-op for page indicator button
          await ctx.answerCbQuery();
          return;
        }
        if (data === 'boost_trending') {
          await ctx.answerCbQuery();
          return this.showPromoteTokenMenu(ctx);
        }
        if (data === 'buy_trending_normal') {
          await ctx.answerCbQuery();
          return this.showTrendingTypeMenu(ctx, false); // false = normal trending
        }
        if (data === 'buy_trending_premium') {
          await ctx.answerCbQuery();
          return this.showTrendingTypeMenu(ctx, true); // true = premium trending
        }
        if (data === 'back_to_buy_trending') {
          await ctx.answerCbQuery();
          // Simulate the /buy_trending command
          const message = `🚀 *Buy Trending Menu*

Choose your trending boost option:`;
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('💫 Buy Trending', 'buy_trending_normal')],
            [Markup.button.callback('⭐ Buy Trending Premium', 'buy_trending_premium')],
            [Markup.button.callback('🔥 View Current Trending', 'view_trending')]
          ]);
          try {
            return ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });
          } catch (error) {
            return ctx.replyWithMarkdown(message, keyboard);
          }
        }

        // Main menu navigation handlers
        if (data === 'menu_tokens') {
          await ctx.answerCbQuery();
          return this.showTokensMenu(ctx);
        }
        if (data === 'menu_trending') {
          await ctx.answerCbQuery();
          return this.showTrendingMenu(ctx);
        }
        if (data === 'menu_images') {
          await ctx.answerCbQuery();
          return this.showImagesMenu(ctx);
        }
        if (data === 'menu_footer') {
          await ctx.answerCbQuery();
          // Clear any footer flow state when returning to menu
          this.clearUserState(ctx.from.id);
          this.clearUserSession(ctx.from.id);
          return this.showFooterMenu(ctx);
        }
        if (data === 'menu_channels') {
          await ctx.answerCbQuery();
          return this.showChannelsMenu(ctx);
        }
        if (data === 'menu_verify') {
          await ctx.answerCbQuery();
          return this.showVerifyMenu(ctx);
        }
        if (data === 'main_menu') {
          await ctx.answerCbQuery();
          return this.showMainMenu(ctx);
        }

        // Cancel group setup - removed duplicate handler, see line ~894 for current implementation

        // Public configuration (in-group setup)
        if (data.startsWith('public_config_')) {
          const setupToken = data.replace('public_config_', '');
          await ctx.answerCbQuery();
          logger.info(`[CALLBACK] Public config selected, token: ${setupToken}`);
          return this.handlePublicGroupConfig(ctx, setupToken);
        }


        // Chain selection handlers for multi-chain support
        if (data.startsWith('chain_select_')) {
          await ctx.answerCbQuery();
          const chainName = data.replace('chain_select_', '');
          const userState = this.getUserState(ctx.from.id);

          logger.info(`[CHAIN_SELECT] User ${ctx.from.id} selected chain: ${chainName}`);
          logger.info(`[CHAIN_SELECT] User state: ${userState || 'NONE'}`);

          if (userState === this.STATE_EXPECTING_CHAIN_FOR_CONTRACT) {
            // User selected chain for adding a contract
            if (chainName === 'all') {
              try {
                return ctx.editMessageText('❌ Please select a specific blockchain network for adding tokens.');
              } catch (error) {
                return ctx.reply('❌ Please select a specific blockchain network for adding tokens.');
              }
            }

            const chainConfig = this.chainManager.getChain(chainName);
            if (!chainConfig) {
              try {
                return ctx.editMessageText('❌ Invalid blockchain network selected.');
              } catch (error) {
                return ctx.reply('❌ Invalid blockchain network selected.');
              }
            }


            // Store the selected chain in user session data
            this.userStates.set(ctx.from.id.toString() + '_selected_chain', chainName);
            this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTRACT);

            // Customize message based on chain type
            let message;
            if (chainName === 'solana') {
              message = `◎ <b>Solana</b> selected!\n\n📝 Please enter the collection symbol:\n\nExample: <code>mad_lads</code>\n\n💡 The collection must exist on Magic Eden marketplace.`;
            } else if (chainName === 'bitcoin') {
              message = `₿ <b>Bitcoin</b> selected!\n\n📝 Please enter the collection name:\n\nExample: <code>bitcoin-puppets</code> or <code>NodeMonkes</code>\n\n💡 The collection must exist on Magic Eden Ordinals marketplace.`;
            } else {
              message = `🔗 <b>${chainConfig.displayName}</b> selected!\n\n📝 Please enter the NFT contract address to track on ${chainConfig.displayName}:\n\n💡 Make sure the contract exists on ${chainConfig.displayName} network.`;
            }

            const keyboard = Markup.inlineKeyboard([
              [Markup.button.callback('◀️ Back to Chain Selection', 'back_to_chain_selection')]
            ]);

            return this.sendOrEditMenu(ctx, message, keyboard);

          } else if (userState === this.STATE_EXPECTING_CHAIN_FOR_VIEW) {
            // User selected chain for viewing tokens
            if (chainName === 'all') {
              this.clearUserState(ctx.from.id);
              return this.showTokensForAllChains(ctx);
            }

            const chainConfig = this.chainManager.getChain(chainName);
            if (!chainConfig) {
              try {
                return ctx.editMessageText('❌ Invalid blockchain network selected.');
              } catch (error) {
                return ctx.reply('❌ Invalid blockchain network selected.');
              }
            }

            this.clearUserState(ctx.from.id);
            return this.showTokensForChain(ctx, chainName, chainConfig);

          } else {
            try {
              return ctx.editMessageText('❌ No active chain selection process found.');
            } catch (error) {
              return ctx.reply('❌ No active chain selection process found.');
            }
          }
        }

        // Handle cancel operations - clear states and redirect to appropriate menu
        if (data === 'cancel_footer' || (data === 'menu_footer' && this.getUserState(ctx.from.id))) {
          await ctx.answerCbQuery();
          this.clearUserState(ctx.from.id);
          this.clearUserSessionData(ctx.from.id, 'footer');
          return this.showFooterMenu(ctx);
        }
        if (data === 'cancel_images' || (data === 'menu_images' && this.getUserState(ctx.from.id))) {
          await ctx.answerCbQuery();
          this.clearUserState(ctx.from.id);
          this.clearUserSessionData(ctx.from.id, 'image');
          return this.showImagesMenu(ctx);
        }
        if (data === 'cancel_verify' || (data === 'menu_verify' && this.getUserState(ctx.from.id))) {
          await ctx.answerCbQuery();
          this.clearUserState(ctx.from.id);
          this.clearUserSessionData(ctx.from.id, 'validation');
          return this.showVerifyMenu(ctx);
        }
        if (data === 'cancel_token_add') {
          await ctx.answerCbQuery();
          this.clearUserState(ctx.from.id);
          this.userStates.delete(ctx.from.id.toString() + '_selected_chain');
          return this.showTokensMenu(ctx);
        }

        // cancel_group_setup handler removed - no longer needed (no special group setup flow)
        if (data === 'back_to_chain_selection') {
          await ctx.answerCbQuery();

          // Go back to context selection (start of the flow)
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTEXT_SELECTION);
          this.userStates.delete(ctx.from.id.toString() + '_selected_chain');

          return this.showContextSelectionMenu(ctx, 0);
        }

        // Submenu handlers
        if (data === 'my_tokens') {
          await ctx.answerCbQuery();
          return this.showMyTokens(ctx);
        }
        if (data === 'remove_token') {
          await ctx.answerCbQuery();
          // Use the same working logic as showMyTokens() which has working remove buttons
          return this.showMyTokens(ctx);
        }
        if (data === 'buy_image_menu') {
          await ctx.answerCbQuery();
          return this.showImageTokenSelection(ctx);
        }
        if (data === 'buy_footer_menu') {
          await ctx.answerCbQuery();
          // Initialize session for footer payment flow
          this.setUserSession(ctx.from.id, { flow: 'footer_payment' });
          // Show chain selection FIRST for footer ads
          return this.showChainSelection(ctx, 'footer');
        }
        if (data === 'channel_add') {
          await ctx.answerCbQuery();
          try {
            return ctx.editMessageText('💡 <b>Add Bot to Channel</b>\n\n1. Add this bot to your channel as an admin\n2. Use the command: <code>/add_channel</code> in the channel\n3. Configure notifications with <code>/channel_settings</code>', {
              parse_mode: 'HTML',
              reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Channels Menu', 'menu_channels')]])
            });
          } catch (error) {
            return ctx.reply('💡 <b>Add Bot to Channel</b>\n\n1. Add this bot to your channel as an admin\n2. Use the command: <code>/add_channel</code> in the channel\n3. Configure notifications with <code>/channel_settings</code>', {
              parse_mode: 'HTML',
              reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Channels Menu', 'menu_channels')]])
            });
          }
        }
        if (data === 'get_chat_id') {
          await ctx.answerCbQuery();
          const chatId = ctx.chat.id;
          const chatType = ctx.chat.type;
          const chatTitle = ctx.chat.title || ctx.chat.first_name || 'Unknown';
          const message = `🆔 <b>Chat Information</b>\n\n<b>Chat ID:</b> <code>${chatId}</code>\n<b>Type:</b> ${chatType}\n<b>Title:</b> ${chatTitle}\n\n<i>Use this chat ID to configure notifications in your bot settings.</i>`;
          try {
            return ctx.editMessageText(message, {
              parse_mode: 'HTML',
              reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Channels Menu', 'menu_channels')]])
            });
          } catch (error) {
            return ctx.replyWithHTML(message, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Channels Menu', 'menu_channels')]]));
          }
        }
        if (data === 'verify_trending') {
          await ctx.answerCbQuery();
          return this.showVerifyTokenSelection(ctx, 'trending');
        }
        if (data === 'verify_image') {
          await ctx.answerCbQuery();
          return this.showVerifyTokenSelection(ctx, 'image');
        }
        if (data === 'verify_footer') {
          await ctx.answerCbQuery();
          return this.showFooterTickerSelection(ctx);
        }

        // Duration selection handlers for enhanced payment flow
        if (data.startsWith('image_duration_')) {
          await ctx.answerCbQuery();
          const duration = parseInt(data.replace('image_duration_', ''));
          const session = this.getUserSession(ctx.from.id);
          if (!session || session.flow !== 'image_payment') {
            try {
              return ctx.editMessageText('❌ Session expired. Please try again.');
            } catch (error) {
              return ctx.reply('❌ Session expired. Please try again.');
            }
          }

          // Store duration in session and proceed to chain selection
          // Note: amount will be calculated after chain selection
          session.duration = duration;
          this.setUserSession(ctx.from.id, session);

          return this.showChainSelection(ctx, 'image');
        }

        // Duration selection handlers for token-based image payment flow
        if (data.startsWith('token_image_duration_')) {
          await ctx.answerCbQuery();
          const duration = parseInt(data.replace('token_image_duration_', ''));
          const session = this.getUserSession(ctx.from.id);
          if (!session || session.flow !== 'image_payment' || !session.contractAddress) {
            try {
              return ctx.editMessageText('❌ Session expired. Please start again.');
            } catch (error) {
              return ctx.reply('❌ Session expired. Please start again.');
            }
          }

          // Store duration in session and proceed directly to payment (skip chain selection)
          session.duration = duration;
          // Calculate amount using the token's chain
          const chain = session.chain || 'ethereum';
          session.amount = this.secureTrending.calculateImageFee(duration, chain);
          this.setUserSession(ctx.from.id, session);

          return this.showTokenImagePaymentInstructions(ctx, session);
        }

        if (data.startsWith('footer_duration_')) {
          await ctx.answerCbQuery();
          const duration = parseInt(data.replace('footer_duration_', ''));
          const session = this.getUserSession(ctx.from.id);
          if (!session || session.flow !== 'footer_payment' || !session.chain) {
            try {
              return ctx.editMessageText('❌ Session expired. Please try again.');
            } catch (error) {
              return ctx.reply('❌ Session expired. Please try again.');
            }
          }

          // Store duration in session
          session.duration = duration;

          // Hardcoded footer ad prices for all chains
          const footerPrices = {
            'ethereum': { 30: '1', 60: '2', 90: '3', 180: '6', 365: '12', symbol: 'ETH' },
            'bitcoin': { 30: '0.051', 60: '0.10', 90: '0.15', 180: '0.30', 365: '0.61', symbol: 'BTC' },
            'solana': { 30: '23', 60: '46', 90: '69', 180: '138', 365: '276', symbol: 'SOL' },
            'bsc': { 30: '7.66', 60: '15.32', 90: '22.98', 180: '45.96', 365: '91.92', symbol: 'BNB' },
            'arbitrum': { 30: '1', 60: '2', 90: '3', 180: '6', 365: '12', symbol: 'ETH' },
            'optimism': { 30: '1', 60: '2', 90: '3', 180: '6', 365: '12', symbol: 'ETH' },
            'hyperevm': { 30: '574', 60: '1150', 90: '1724', 180: '3448', 365: '6896', symbol: 'HYPE' },
            'berachain': { 30: '3066', 60: '6132', 90: '9198', 180: '18396', 365: '36792', symbol: 'BERA' },
            'avalanche': { 30: '460', 60: '920', 90: '1380', 180: '2760', 365: '5520', symbol: 'AVAX' },
            'cronos': { 30: '65714', 60: '131428', 90: '197142', 180: '394284', 365: '788568', symbol: 'CRO' },
            'moonbeam': { 30: '76666', 60: '153332', 90: '229998', 180: '459996', 365: '919992', symbol: 'GLMR' },
            'zksync': { 30: '1', 60: '2', 90: '3', 180: '6', 365: '12', symbol: 'ETH' },
            'base': { 30: '1', 60: '2', 90: '3', 180: '6', 365: '12', symbol: 'ETH' },
            'sei': { 30: '32857', 60: '65714', 90: '98571', 180: '197142', 365: '394284', symbol: 'SEI' },
            'apechain': { 30: '15333', 60: '30666', 90: '45999', 180: '91998', 365: '183996', symbol: 'APE' },
            'abstract': { 30: '1', 60: '2', 90: '3', 180: '6', 365: '12', symbol: 'ETH' },
            'ronin': { 30: '10000', 60: '20000', 90: '30000', 180: '60000', 365: '120000', symbol: 'RON' }
          };

          // Get prices for selected chain (default to ethereum if not found)
          const chainPrices = footerPrices[session.chain] || footerPrices['ethereum'];
          const priceString = chainPrices[duration];
          const currencySymbol = chainPrices.symbol;

          // Store amount based on chain type
          if (session.chain === 'solana') {
            const solAmount = parseFloat(priceString);
            session.amount = this.secureTrending.solanaPaymentService.convertSolToLamports(solAmount);
            session.amountFormatted = `${priceString} ${currencySymbol}`;
          } else if (session.chain === 'bitcoin') {
            const btcAmount = parseFloat(priceString);
            session.amount = this.secureTrending.bitcoinPaymentService.convertBTCToSats(btcAmount);
            session.amountFormatted = `${priceString} ${currencySymbol}`;
          } else {
            // For all EVM chains (ethereum, bsc, arbitrum, etc.)
            const { ethers } = require('ethers');
            session.amount = ethers.parseEther(priceString);
            session.amountFormatted = `${priceString} ${currencySymbol}`;
          }

          this.setUserSession(ctx.from.id, session);

          // Proceed to link input (footer ads need custom link)
          return this.showLinkInput(ctx);
        }

        // Trending selection handlers
        if (data.startsWith('trending_normal_') || data.startsWith('trending_premium_')) {
          await ctx.answerCbQuery();
          const parts = data.split('_');
          const isPremium = parts[1] === 'premium';
          const tokenId = parts[2];

          // Auto-detect chain from selected token (like image payment flow)
          const token = await this.db.get('SELECT * FROM tracked_tokens WHERE id = $1', [tokenId]);
          if (!token) {
            return ctx.reply('❌ NFT collection not found.');
          }
          const autoDetectedChain = token.chain_name || 'ethereum';

          return this.showTrendingDurationSelection(ctx, tokenId, isPremium, autoDetectedChain);
        }

        // Trending chain selection handler
        if (data.startsWith('trending_chain_')) {
          await ctx.answerCbQuery();
          const parts = data.split('_');
          const tokenId = parts[2];
          const isPremium = parts[3] === 'premium';
          const chain = parts[4];
          return this.showTrendingDurationSelection(ctx, tokenId, isPremium, chain);
        }

        // Back to trending chain selection
        if (data.startsWith('trending_back_to_chain_')) {
          await ctx.answerCbQuery();
          const parts = data.split('_');
          const tokenId = parts[4];
          const isPremium = parts[5] === 'premium';
          return this.showTrendingChainSelection(ctx, tokenId, isPremium);
        }

        // Back to trending duration selection
        if (data.startsWith('trending_back_to_duration_')) {
          await ctx.answerCbQuery();
          const parts = data.split('_');
          const tokenId = parts[4];
          const isPremium = parts[5] === 'premium';
          const chain = parts[6];
          return this.showTrendingDurationSelection(ctx, tokenId, isPremium, chain);
        }

        // Trending duration selection handler
        if (data.startsWith('trending_duration_')) {
          await ctx.answerCbQuery();
          const parts = data.split('_');
          const tokenId = parts[2];
          const duration = parseInt(parts[3]);
          const isPremium = parts[4] === 'premium';
          const chain = parts[5] || 'ethereum'; // Default to ethereum if not provided for backwards compatibility
          return this.showPaymentInstructions(ctx, tokenId, duration, isPremium, chain);
        }


        // Chain selection handlers for enhanced payment flow
        if (data.startsWith('chain_image_') || data.startsWith('chain_footer_')) {
          await ctx.answerCbQuery();
          const parts = data.split('_');
          const paymentType = parts[1]; // 'image' or 'footer'
          const chainName = parts[2]; // 'ethereum', 'arbitrum', etc.

          const session = this.getUserSession(ctx.from.id);
          if (!session || session.flow !== `${paymentType}_payment`) {
            try {
              return ctx.editMessageText('❌ Session expired. Please try again.');
            } catch (error) {
              return ctx.reply('❌ Session expired. Please try again.');
            }
          }

          // Store chain in session and proceed to next step
          session.chain = chainName;
          this.setUserSession(ctx.from.id, session);

          // For footer ads, show duration selection AFTER chain is selected
          // For image fees, ask for contract
          if (paymentType === 'footer') {
            return this.showFooterDurationSelection(ctx);
          } else {
            return this.showContractInput(ctx, paymentType);
          }
        }

        // Token selection handlers for image purchase flow
        if (data.startsWith('image_select_token_')) {
          await ctx.answerCbQuery();
          const tokenId = data.replace('image_select_token_', '');
          return this.handleImageTokenSelection(ctx, tokenId);
        }

        // Token selection handlers for verification flows
        if (data.startsWith('verify_image_token_')) {
          await ctx.answerCbQuery();
          const tokenId = data.replace('verify_image_token_', '');
          return this.handleVerifyTokenSelection(ctx, tokenId, 'image');
        }

        if (data.startsWith('verify_trending_token_')) {
          await ctx.answerCbQuery();
          const tokenId = data.replace('verify_trending_token_', '');
          return this.handleVerifyTokenSelection(ctx, tokenId, 'trending');
        }
        if (data.startsWith('verify_footer_ticker_')) {
          await ctx.answerCbQuery();
          const footerAdId = data.replace('verify_footer_ticker_', '');
          return this.handleFooterTickerSelection(ctx, footerAdId);
        }

        // Back button handlers for enhanced payment flow
        if (data === 'back_to_chain_image') {
          await ctx.answerCbQuery();
          return this.showChainSelection(ctx, 'image');
        }

        if (data === 'back_to_chain_footer') {
          await ctx.answerCbQuery();
          return this.showChainSelection(ctx, 'footer');
        }

        if (data === 'back_to_link_footer') {
          await ctx.answerCbQuery();
          return this.showLinkInput(ctx);
        }

        if (data === 'back_to_ticker_footer') {
          await ctx.answerCbQuery();
          return this.showTickerInput(ctx);
        }

        // Back to contract input handlers
        if (data === 'back_to_contract_image') {
          await ctx.answerCbQuery();
          return this.showContractInput(ctx, 'image');
        }

        if (data === 'back_to_contract_footer') {
          await ctx.answerCbQuery();
          return this.showContractInput(ctx, 'footer');
        }

        // Enhanced transaction submission handlers
        if (data === 'submit_enhanced_image_tx') {
          await ctx.answerCbQuery();
          const session = this.getUserSession(ctx.from.id);
          if (!session || session.flow !== 'image_payment') {
            try {
              return ctx.editMessageText('⚠️ Session expired. Please start again.');
            } catch (error) {
              return ctx.reply('⚠️ Session expired. Please start again.');
            }
          }

          // Set state to expect transaction hash
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_IMAGE_TX_HASH);

          const chainConfig = session?.chain && this.chainManager ? this.chainManager.getChain(session.chain) : null;
          const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : 'the selected blockchain';

          const message = `📝 <b>Submit Transaction Hash</b>\n\nPlease send me your ${chainDisplay} transaction hash for the image fee payment.\n\n<i>Example: 0xabc123456789def...</i>\n\n`;
          const keyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_images')]]);
          try {
            return ctx.editMessageText(message, {
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } catch (error) {
            return ctx.replyWithHTML(message, keyboard);
          }
        }

        // Token-based image transaction submission handler
        if (data === 'submit_token_image_tx') {
          await ctx.answerCbQuery();
          const session = this.getUserSession(ctx.from.id);
          if (!session || session.flow !== 'image_payment' || !session.contractAddress) {
            try {
              return ctx.editMessageText('⚠️ Session expired. Please start again.');
            } catch (error) {
              return ctx.reply('⚠️ Session expired. Please start again.');
            }
          }

          // Set state to expect transaction hash
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_IMAGE_TX_HASH);

          const chainConfig = session?.chain && this.chainManager ? this.chainManager.getChain(session.chain) : null;
          const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : 'the selected blockchain';

          const message = `📝 <b>Submit Transaction Hash</b>\n\n` +
            `🎯 <b>NFT:</b> ${session.tokenName} (${session.tokenSymbol})\n` +
            `🔗 <b>Chain:</b> ${chainDisplay}\n\n` +
            `Please send me your transaction hash for the image fee payment.\n\n` +
            `<i>Example: 0xabc123456789def...</i>\n\n`;

          const keyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_images')]]);
          try {
            return ctx.editMessageText(message, {
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } catch (error) {
            return ctx.replyWithHTML(message, keyboard);
          }
        }

        if (data === 'submit_enhanced_footer_tx') {
          await ctx.answerCbQuery();
          const session = this.getUserSession(ctx.from.id);
          if (!session || session.flow !== 'footer_payment') {
            try {
              return ctx.editMessageText('⚠️ Session expired. Please start again.');
            } catch (error) {
              return ctx.reply('⚠️ Session expired. Please start again.');
            }
          }

          // Set state to expect transaction hash
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_FOOTER_TX_HASH);

          const chainConfig = session?.chain && this.chainManager ? this.chainManager.getChain(session.chain) : null;
          const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : 'the selected blockchain';

          const message = `📝 <b>Submit Transaction Hash</b>\n\nPlease send me your ${chainDisplay} transaction hash for the footer payment.\n\n<i>Example: 0xabc123456789def...</i>\n\n`;
          const keyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]]);
          return ctx.replyWithHTML(message, keyboard);
        }

        // Submit buttons for transactions
        if (data === 'submit_footer_tx') {
          await ctx.answerCbQuery();
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_FOOTER_TX_HASH);

          const session = this.getUserSession(ctx.from.id);
          const chainConfig = session?.chain && this.chainManager ? this.chainManager.getChain(session.chain) : null;
          const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : 'the selected blockchain';

          const message = `📝 <b>Submit Transaction Hash</b>\n\nPlease send me your ${chainDisplay} transaction hash for the footer payment.\n\n<i>Example: 0xabc123456789def...</i>\n\n`;
          const keyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]]);
          return ctx.replyWithHTML(message, keyboard);
        }
        if (data === 'submit_image_tx') {
          await ctx.answerCbQuery();
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_IMAGE_TX_HASH);

          const session = this.getUserSession(ctx.from.id);
          const chainConfig = session?.chain && this.chainManager ? this.chainManager.getChain(session.chain) : null;
          const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : 'the selected blockchain';

          return ctx.reply(`📝 <b>Submit Transaction Hash</b>\n\nPlease send me your ${chainDisplay} transaction hash for the image fee payment.\n\n<i>Example: 0xabc123456789def...</i>\n\n`, {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_images')]])
          });
        }

        // enter_contract handler removed - dead code from old fallback flow


        if (data.startsWith('remove_')) {
          await ctx.answerCbQuery();

          // Parse pattern: remove_{tokenId} or remove_{tokenId}_{chatId}
          const parts = data.replace('remove_', '').split('_');
          const tokenId = parts[0];
          const explicitChatId = parts.length > 1 ? parts.slice(1).join('_') : null;

          logger.info(`[remove callback] tokenId: ${tokenId}, explicitChatId: ${explicitChatId}`);
          await this.handleRemoveToken(ctx, tokenId, explicitChatId);
          return;
        }

        if (data.startsWith('stats_')) {
          const tokenId = data.replace('stats_', '');
          await this.showTokenStats(ctx, tokenId);
          return;
        }

        if (data.startsWith('remove_token_')) {
          await ctx.answerCbQuery();

          // Parse pattern: remove_token_{tokenId} or remove_token_{tokenId}_{chatId}
          const parts = data.replace('remove_token_', '').split('_');
          const tokenId = parts[0];
          const explicitChatId = parts.length > 1 ? parts.slice(1).join('_') : null;

          logger.info(`[remove_token callback] tokenId: ${tokenId}, explicitChatId: ${explicitChatId}`);
          await this.handleRemoveToken(ctx, tokenId, explicitChatId);
          return;
        }

        if (data === 'promote_token') {
          await ctx.answerCbQuery();
          return this.showPromoteTokenMenu(ctx, false); // false = normal trending
        }
        if (data === 'promote_token_premium') {
          await ctx.answerCbQuery();
          return this.showPromoteTokenMenu(ctx, true); // true = premium trending
        }


        if (data.startsWith('contract_')) {
          const address = data.replace('contract_', '');
          await ctx.answerCbQuery();
          await this.handleContractAddress(ctx, address);
          return;
        }

        if (data.startsWith('promote_premium_')) {
          const tokenId = data.replace('promote_premium_', '');
          await ctx.answerCbQuery();
          return this.showPromoteDurationMenu(ctx, tokenId, true); // true = premium
        }
        if (data.startsWith('promote_')) {
          const tokenId = data.replace('promote_', '');
          await ctx.answerCbQuery();
          return this.showPromoteDurationMenu(ctx, tokenId, false); // false = normal
        }

        if (data === 'main_menu') {
          await ctx.answerCbQuery();
          return this.showMainMenu(ctx);
        }

        if (data.startsWith('duration_')) {
          const parts = data.split('_');
          const tokenId = parts[1];
          const duration = parseInt(parts[2]);
          const isPremium = parts[3] === 'premium';
          const chain = parts[4] || 'ethereum'; // Extract auto-detected chain parameter
          await ctx.answerCbQuery();
          return this.showPaymentInstructions(ctx, tokenId, duration, isPremium, chain);
        }

        if (data.startsWith('submit_tx_')) {
          const parts = data.split('_');
          const tokenId = parts[2];
          const duration = parseInt(parts[3]);
          const isPremium = parts[4] === 'premium';
          const chain = parts[5] || 'ethereum'; // Default to ethereum if not provided for backwards compatibility
          await ctx.answerCbQuery();

          // Store payment type for validation
          const userId = ctx.from.id.toString();
          const pendingPayment = this.pendingPayments.get(userId) || {};
          pendingPayment.isPremium = isPremium;
          pendingPayment.chain = chain;
          this.pendingPayments.set(userId, pendingPayment);

          this.setUserState(ctx.from.id, this.STATE_EXPECTING_TX_HASH);

          // Get chain configuration
          const chainConfig = this.chainManager ? this.chainManager.getChain(chain) : null;
          const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : chain.charAt(0).toUpperCase() + chain.slice(1);
          const currencySymbol = chainConfig ? chainConfig.currencySymbol : 'ETH';
          const contractAddress = chainConfig ? chainConfig.paymentContract : addresses.ethereum.paymentContract;

          const message = `📝 **Submit Transaction Hash**

Please send your ${chainDisplay} transaction hash now.

The transaction hash should:
• Start with 0x
• Be 66 characters long
• Be from a transaction sent to: \`${contractAddress}\`

Example: \`0x1234567890abcdef...\`

`;

          return ctx.replyWithMarkdown(message, {
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_verify')]])
          });
        }


        if (data === 'channel_settings') {
          await ctx.answerCbQuery();
          const chatId = ctx.chat.id.toString();
          return this.channels.handleChannelSettingsCommand(ctx, chatId);
        }

        if (data === 'channel_remove_trending') {
          await ctx.answerCbQuery();
          const chatId = ctx.chat.id.toString();

          const settings = await this.channels.getChannelSettings(chatId);
          if (settings.success) {
            const newValue = !settings.settings.show_trending;
            const result = await this.channels.updateChannelSettings(chatId, {
              show_trending: newValue ? 1 : 0
            });
            if (result.success) {

              return this.channels.handleChannelSettingsCommand(ctx, chatId);
            } else {
              return ctx.reply(result.message);
            }
          } else {
            return ctx.reply(settings.message);
          }
        }

        if (data === 'channel_remove_activity') {
          await ctx.answerCbQuery();
          const chatId = ctx.chat.id.toString();

          const settings = await this.channels.getChannelSettings(chatId);
          if (settings.success) {
            const newValue = !settings.settings.show_all_activities;
            const result = await this.channels.updateChannelSettings(chatId, {
              show_all_activities: newValue ? 1 : 0
            });
            if (result.success) {

              return this.channels.handleChannelSettingsCommand(ctx, chatId);
            } else {
              return ctx.reply(result.message);
            }
          } else {
            return ctx.reply(settings.message);
          }
        }
        if (data === '/buy_trending') {
          await ctx.answerCbQuery();
          const message = `🚀 *Buy Trending Menu*

Choose your trending boost option:`;
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('💫 Buy Trending', 'buy_trending_normal')],
            [Markup.button.callback('⭐ Buy Trending Premium', 'buy_trending_premium')],
            [Markup.button.callback('🔥 View Current Trending', 'view_trending')]
          ]);
          return ctx.replyWithMarkdown(message, keyboard);
        }
        if (data === 'help_contact') {
          await ctx.answerCbQuery();
          const contactMessage = `📞 <b>Help & Contact</b>

🌐 <b>Web:</b> https://www.candycodex.com

📧 <b>Mail:</b> support@candycodex.com

💬 <b>Telegram:</b> @CandyCodex

<i>Need help? Feel free to reach out through any of these channels!</i>`;
          return ctx.replyWithHTML(contactMessage);
        }

        await ctx.answerCbQuery('Feature coming soon!');
      } catch (error) {
        logger.error('Error handling callback query:', error);
        await ctx.answerCbQuery('❌ Error processing request');
      }
    });


    bot.on('text', async (ctx) => {
      const text = ctx.message.text;
      const userId = ctx.from.id;
      const userState = this.getUserState(userId);

      // In groups/supergroups, only respond to replies or mentions
      const chatType = ctx.chat.type;
      if (chatType === 'group' || chatType === 'supergroup') {
        if (!this.shouldRespondInGroup(ctx)) {
          // Silently ignore messages that aren't replies or mentions
          return;
        }
      }

      // Handle cancel command first
      if (text.toLowerCase() === 'cancel' || text.toLowerCase() === '/cancel') {
        this.clearUserState(userId);
        ctx.reply('✅ Operation cancelled.');
        return;
      }

      // Route based on user state first (this takes priority)
      if (userState === this.STATE_EXPECTING_CONTRACT) {
        await this.handleContractAddress(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_TX_HASH) {
        if (text.toLowerCase() === 'cancel') {
          this.clearUserState(ctx.from.id);
          this.pendingPayments.delete(ctx.from.id.toString());
          ctx.reply('✅ Transaction submission cancelled.');
          return;
        }
        await this.handleTransactionHash(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_FOOTER_CONTRACT) {
        await this.handleFooterContract(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_FOOTER_TX_HASH) {
        await this.handleFooterTxHash(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_FOOTER_LINK) {
        await this.handleFooterLink(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_IMAGE_CONTRACT) {
        await this.handleImageContract(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_IMAGE_TX_HASH) {
        await this.handleImageTxHash(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_VALIDATION_CONTRACT) {
        await this.handleValidationContract(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_VALIDATION_TX_HASH) {
        await this.handleValidationTxHash(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_VALIDATION_LINK) {
        await this.handleValidationLink(ctx, text);
        return;
      } else if (userState === this.STATE_EXPECTING_VALIDATION_TICKER) {
        await this.handleValidationTicker(ctx, text);
        return;
      } else if (userState === this.STATE_IMAGE_CONTRACT_INPUT) {
        await this.handleEnhancedImageContract(ctx, text);
        return;
      } else if (userState === this.STATE_FOOTER_LINK_INPUT) {
        await this.handleFooterLinkInput(ctx, text);
        return;
      } else if (userState === this.STATE_FOOTER_TICKER_INPUT) {
        await this.handleFooterTickerInput(ctx, text);
        return;
      } else if (userState === this.STATE_FOOTER_CONTRACT_INPUT) {
        await this.handleEnhancedFooterContract(ctx, text);
        return;
      }

      // Handle NFT addresses without specific state (fallback for add_token)
      // EVM address pattern
      if (text.match(/^0x[a-fA-F0-9]{40}$/)) {
        await this.handleContractAddress(ctx, text);
        return;
      }

      // Solana address pattern (base58, 32-44 characters)
      if (text.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
        await this.handleContractAddress(ctx, text);
        return;
      }

      // Magic Eden collection symbol or URL
      if (text.match(/^[a-zA-Z0-9_-]+$/) && text.length < 50 && this.getUserState(userId) === this.STATE_EXPECTING_CONTRACT) {
        await this.handleContractAddress(ctx, text);
        return;
      }

      // No matching state or pattern - ignore
      return;
    });


    bot.on('channel_post', async (ctx) => {
      try {
        const text = ctx.channelPost.text;
        if (!text) return;

        logger.debug(`Channel post received: "${text}" in channel ${ctx.chat.id}`);


        let command = null;
        if (text.startsWith('/')) {

          command = text.split(' ')[0].replace('/', '');
        } else if (ctx.botInfo && ctx.botInfo.username && text.includes(`@${ctx.botInfo.username}`)) {

          const parts = text.split(' ');
          const mentionedCommand = parts.find(part => part.includes(`@${ctx.botInfo.username}`));
          if (mentionedCommand && mentionedCommand.startsWith('/')) {
            command = mentionedCommand.split('@')[0].replace('/', '');
          }
        }

        if (!command) return;

        logger.info(`Processing channel command: ${command} in channel ${ctx.chat.id}`);


        switch (command) {
          case 'add_channel':
            const chatId = ctx.chat.id.toString();
            const chatType = ctx.chat.type;
            if (chatType !== 'channel' && chatType !== 'supergroup') {
              return ctx.reply('❌ This command only works in channels or groups. Add me to a channel first, then use this command there.');
            }
            const channelTitle = ctx.chat.title || 'Unknown Channel';

            let userId = null;
            if (ctx.from) {

              userId = ctx.from.id.toString();
            } else {

              try {
                const chatAdmins = await ctx.telegram.getChatAdministrators(chatId);
                const owner = chatAdmins.find(admin => admin.status === 'creator');
                if (owner && owner.user) {
                  userId = owner.user.id.toString();
                  logger.info(`Using channel owner ${userId} for anonymous channel post`);
                } else {

                  userId = `channel_${chatId}`;
                  logger.info(`Using channel ID ${userId} for anonymous channel post`);
                }
              } catch (error) {
                logger.warn('Could not get channel admins, using channel ID as user:', error.message);
                userId = `channel_${chatId}`;
              }
            }
            const result = await this.channels.addChannel(chatId, channelTitle, userId);
            await ctx.reply(result.message);
            break;

          case 'channel_settings':
            const settingsChatId = ctx.chat.id.toString();
            const settingsChatType = ctx.chat.type;
            if (settingsChatType !== 'channel' && settingsChatType !== 'supergroup') {
              return ctx.reply('❌ This command only works in channels or groups.');
            }
            await this.channels.handleChannelSettingsCommand(ctx, settingsChatId);
            break;

          case 'get_chat_id':
            const chatInfo = {
              id: ctx.chat.id,
              type: ctx.chat.type,
              title: ctx.chat.title || 'N/A'
            };
            await ctx.reply(`📋 Chat Info:\nID: ${chatInfo.id}\nType: ${chatInfo.type}\nTitle: ${chatInfo.title}`);
            break;

          case 'help':
            const helpMessage = `📋 <b>MintyRushBot Commands</b>

🎯 <b>NFT Management:</b>
• /add_token - Add NFT collection to track
• /remove_token - Remove tracked NFT  
• /my_tokens - View your tracked NFTs

💰 <b>Trending &amp; Boost:</b>
• /trending - View trending collections
• /buy_trending - Boost NFT trending
• /validate &lt;txhash&gt; - Validate trending payment
• /buy_image &lt;contract&gt; - Pay fee for real NFT images
• /validate_image &lt;contract&gt; &lt;txhash&gt; - Validate image fee
• /buy_footer &lt;contract&gt; - Pay fee for footer advertisement
• /validate_footer &lt;contract&gt; &lt;txhash&gt; &lt;link&gt; - Validate footer ad

📺 <b>Channel Commands:</b>
• /add_channel - Add bot to channel
• /channel_settings - Configure channel alerts

• /startminty - Welcome message
• /help - Show this help

Simple and focused - boost your NFTs easily! 🚀`;
            await ctx.replyWithHTML(helpMessage);
            break;

          default:
            logger.debug(`Unhandled channel command: ${command}`);
            break;
        }

      } catch (error) {
        logger.error('Error handling channel post:', error);
        try {
          await ctx.reply('❌ An error occurred processing the command. Please try again.');
        } catch (replyError) {
          logger.error('Failed to send error message for channel post:', replyError);
        }
      }
    });

    logger.info('Bot commands setup completed');
  }

  // ============================================================================
  // GROUP SETUP METHODS
  // ============================================================================

  /**
   * Handle /startminty command in group context
   * Generates deep link for private configuration
   */
  async handleGroupStart(ctx) {
    try {
      const groupId = ctx.chat.id.toString();
      const groupTitle = ctx.chat.title || 'this group';
      const userId = ctx.from.id;

      logger.info(`[GROUP_START] User ${userId} (${ctx.from.username}) ran /startminty in group ${groupId} (${groupTitle})`);

      // Check if user is admin
      const isAdmin = await this.isUserGroupAdmin(userId, groupId, ctx);
      if (!isAdmin) {
        logger.warn(`[GROUP_START] User ${userId} is NOT an admin in group ${groupId}`);
        return ctx.reply('⚠️ Only group admins can configure NFT tracking.');
      }

      logger.info(`[GROUP_START] User ${userId} verified as admin`);

      // Ensure user exists in database
      await this.db.createUser(ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);
      const user = await this.db.getUser(ctx.from.id.toString());

      // Generate setup token for public setup
      const crypto = require('crypto');
      const setupToken = crypto.randomBytes(16).toString('hex');

      // Save group context for public setup
      await this.db.createGroupContext(groupId, groupTitle, setupToken, user.id);

      // Show message with two buttons
      const message = `🎉 <b>Welcome to MintyRush!</b>

To configure bot for <b>${groupTitle}</b>
select an option below:`;

      // Create deep link for private setup with setup token for auto-detection
      const botUsername = ctx.botInfo.username;
      const deepLink = `https://t.me/${botUsername}?start=setup_${setupToken}`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💬 Setup in TG Chat', `public_config_${setupToken}`)],
        [Markup.button.url('🤖 Setup inside bot chat', deepLink)]
      ]);

      await ctx.replyWithHTML(message, keyboard);
      logger.info(`[GROUP_START] ✅ Setup options shown to group ${groupId}`);
    } catch (error) {
      logger.error('[GROUP_START] ❌ Error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  // handleGroupSetupFlow() method removed - no longer needed
  // Users now use context selection menu to choose which group to add tokens to

  /**
   * Handle public group configuration (in-group setup)
   * Shows welcome message and main menu directly in the group
   */
  async handlePublicGroupConfig(ctx, setupToken) {
    try {
      logger.info(`[PUBLIC_CONFIG] User ${ctx.from.id} chose public setup with token: ${setupToken}`);

      // Validate setup token and get group context
      const groupContext = await this.db.getGroupContextByToken(setupToken);

      if (!groupContext) {
        logger.warn(`[PUBLIC_CONFIG] Invalid/expired token: ${setupToken}`);
        return ctx.reply('❌ Invalid or expired setup link. Please run /startminty in the group again.');
      }

      logger.info(`[PUBLIC_CONFIG] Found group context: ${groupContext.group_title} (${groupContext.group_chat_id})`);

      const userId = ctx.from.id;

      // Verify user is still admin
      const isAdmin = await this.isUserGroupAdmin(userId, groupContext.group_chat_id, ctx);
      if (!isAdmin) {
        logger.warn(`[PUBLIC_CONFIG] User ${userId} is NOT admin in group ${groupContext.group_chat_id}`);
        return ctx.reply('⚠️ Only group admins can configure tracking.');
      }

      logger.info(`[PUBLIC_CONFIG] User ${userId} verified as admin`);

      // Ensure user exists in database
      await this.db.createUser(ctx.from.id.toString(), ctx.from.username, ctx.from.first_name);

      // Show welcome message and main menu in the group (edit the setup message)
      const welcomeMessage = helpers.formatWelcomeMessage();
      const keyboard = helpers.buildMainMenuKeyboard();

      try {
        await ctx.editMessageText(welcomeMessage, {
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        });
        logger.info(`[PUBLIC_CONFIG] ✅ Main menu shown in group ${groupContext.group_chat_id}`);
      } catch (error) {
        // If edit fails, send new message
        await ctx.replyWithHTML(welcomeMessage, keyboard);
        logger.info(`[PUBLIC_CONFIG] ✅ Main menu sent to group ${groupContext.group_chat_id} (edit failed, sent new message)`);
      }
    } catch (error) {
      logger.error('[PUBLIC_CONFIG] ❌ Error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  }


  async handleContractAddress(ctx, contractAddress) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Get selected chain from user session data
      const selectedChain = this.userStates.get(ctx.from.id.toString() + '_selected_chain') || 'ethereum';
      const chainConfig = this.chainManager ? this.chainManager.getChain(selectedChain) : null;

      logger.info(`Token addition - Telegram ID: ${ctx.from.id}, Database User ID: ${user.id}, Address: ${contractAddress}, Chain: ${selectedChain}`);

      // Customize validation message based on chain
      let validationMessage = `🔍 Validating and adding on ${chainConfig ? chainConfig.displayName : selectedChain}...`;
      if (selectedChain === 'solana') {
        validationMessage = `◎ Validating Solana NFT via Magic Eden...`;
      }
      const validatingMsg = await ctx.reply(validationMessage);

      // Auto-delete validation message after 1 minute
      setTimeout(() => {
        try {
          ctx.deleteMessage(validatingMsg.message_id).catch(() => {});
        } catch (error) {
          // Ignore deletion errors
        }
      }, 60000);

      this.clearUserState(ctx.from.id);
      // Clear the selected chain from session data
      this.userStates.delete(ctx.from.id.toString() + '_selected_chain');

      // Check if user selected a group context via context selection menu
      const configuringGroupId = this.getUserSession(ctx.from.id, 'configuring_group');

      // Block private chat tracking - users must add tokens in groups/channels only
      if (ctx.chat.type === 'private' && !configuringGroupId) {
        return ctx.replyWithHTML(
          '❌ <b>Private tracking is not available</b>\n\n' +
          'Please add this bot to a group or channel and use the <b>Setup inside bot chat</b> button to track NFTs.\n\n' +
          'You can still view your tracked NFTs from groups here in DM.'
        );
      }

      // Determine chat context
      const chatId = configuringGroupId || this.normalizeChatContext(ctx);

      const result = await this.tokenTracker.addToken(
        contractAddress,
        user.id,
        ctx.from.id.toString(),
        chatId,
        selectedChain
      );

      logger.info(`Token addition result for user ${user.id}:`, result.success);

      if (result.success) {
        // Clear group session after successful addition (if it was set)
        if (configuringGroupId) {
          this.clearUserSession(ctx.from.id, 'configuring_group');
          this.clearUserSession(ctx.from.id, 'group_title');
        }

        // Show success message
        const keyboard = {
          inline_keyboard: [
            [
              {
                text: 'BOOST YOUR NFT🟢',
                callback_data: '/buy_trending'
              }
            ],
            [
              {
                text: '🏠 Main Menu',
                callback_data: 'main_menu'
              }
            ]
          ]
        };

        const successMsg = await ctx.replyWithMarkdown(result.message, {
          reply_markup: keyboard
        });
        logger.info(`Token added: ${contractAddress} by user ${user.id}`);

        // Auto-delete success message after 1 minute
        setTimeout(() => {
          try {
            ctx.deleteMessage(successMsg.message_id).catch(() => {});
          } catch (error) {
            // Ignore deletion errors
          }
        }, 60000);

        // Immediately verify the token appears in user's list for better UX
        setTimeout(async () => {
          try {
            const verifyTokens = await this.db.getUserTrackedTokens(user.id);
            const addedToken = verifyTokens.find(t => t.contract_address.toLowerCase() === contractAddress.toLowerCase());
            if (addedToken) {
              const successMessage = '✅ Verification: Token is now in your tracking list!';
              const keyboard = Markup.inlineKeyboard([[Markup.button.callback('👁️ View My NFTs', 'my_tokens')]]);
              const verifyMsg = await ctx.replyWithHTML(successMessage, keyboard);

              // Auto-delete verification message after 1 minute
              setTimeout(() => {
                try {
                  ctx.deleteMessage(verifyMsg.message_id).catch(() => {});
                } catch (error) {
                  // Ignore deletion errors
                }
              }, 60000);
            } else {
              // Token added successfully - no warning message needed
            }
          } catch (error) {
            logger.error('Error in token verification:', error);
          }
        }, 2000);
      } else {
        await ctx.reply(`❌ ${result.message}\n\nIf you think this is a mistake, try again or contact support.`);
        logger.error(`Failed to add token ${contractAddress} for user ${user.id}: ${result.message}`);
      }
    } catch (error) {
      logger.error('Error handling NFT address:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ Error adding token. Please check the NFT address and try again.');
    }
  }

  async handleTransactionHash(ctx, txHash) {
    try {
      const userId = ctx.from.id.toString();
      const pendingPayment = this.pendingPayments.get(userId);
      if (!pendingPayment) {
        this.clearUserState(userId);
        return ctx.reply('❌ No pending payment found. Please start the boost process again.');
      }


      if (!txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
        return ctx.reply('❌ Invalid transaction hash format. Please send a valid transaction hash (starts with 0x and is 64 characters long).\n\nOr type "cancel" to abort.');
      }

      ctx.reply('🔍 Validating your transaction... This may take a few moments.');


      const result = await this.trending.processSimplePayment(
        userId,
        txHash
      );

      this.clearUserState(userId);
      this.pendingPayments.delete(userId);

      if (result.success) {
        const successMessage = `✅ **Payment Confirmed!**

🔥 **${result.tokenName}** is now trending for ${result.duration} hour${result.duration > 1 ? 's' : ''}!

💰 Amount: ${ethers.formatEther(result.amount)} ETH
📝 Transaction: \`${txHash}\`
🆔 Payment ID: ${result.paymentId}

Your collection will appear in the trending list and be promoted in channels. Thank you for boosting the ecosystem! 🚀`;

        await ctx.replyWithMarkdown(successMessage);
      } else {
        const errorMessage = `❌ **Payment Validation Failed**

${result.error}

Please check:
• Transaction was sent to: \`${process.env.TRENDING_CONTRACT_ADDRESS}\`
• Exact amount was sent: ${ethers.formatEther(pendingPayment.expectedAmount)} ETH
• Transaction is confirmed on blockchain

You can try again with a different transaction hash or contact support.`;

        await ctx.replyWithMarkdown(errorMessage);
      }

    } catch (error) {
      logger.error('Error handling transaction hash:', error);
      this.clearUserState(ctx.from.id);
      this.pendingPayments.delete(ctx.from.id.toString());
      ctx.reply('❌ Error validating transaction. Please try again or contact support.');
    }
  }

  async handleRemoveToken(ctx, tokenId, explicitChatId = null) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('❌ User not found. Please start the bot first with /startminty');
      }

      // Use explicit chatId if provided (for context-aware removal from DMs)
      // Otherwise use current chat context
      const chatId = explicitChatId || this.normalizeChatContext(ctx);

      // Get token info for the success message
      const token = await this.db.get('SELECT * FROM tracked_tokens WHERE id = $1', [tokenId]);
      if (!token) {
        return ctx.reply('❌ NFT not found.');
      }

      // Check if user has subscription in this chat context
      const subscription = await this.db.get(
        'SELECT * FROM user_subscriptions WHERE user_id = $1 AND token_id = $2 AND chat_id = $3',
        [user.id, tokenId, chatId]
      );

      if (!subscription) {
        return ctx.reply('❌ You are not subscribed to this NFT in this chat context.');
      }

      // Remove subscription from this specific chat context
      const unsubscribeResult = await this.db.unsubscribeUserFromToken(user.id, tokenId, chatId);
      logger.info(`🔄 REMOVE_TOKEN DEBUG: Unsubscribed user ${user.id} from token ${tokenId} in chat ${chatId}, removed ${unsubscribeResult.changes} subscription(s)`);

      // Check if there are any remaining subscriptions for this NFT
      const remainingSubscriptions = await this.db.all(
        'SELECT COUNT(*) as count FROM user_subscriptions WHERE token_id = $1',
        [tokenId]
      );

      logger.info(`🔍 REMOVE_TOKEN DEBUG: Subscription count query result:`, remainingSubscriptions);
      logger.info(`🔍 REMOVE_TOKEN DEBUG: remainingSubscriptions.length = ${remainingSubscriptions.length}`);
      logger.info(`🔍 REMOVE_TOKEN DEBUG: remainingSubscriptions[0].count = ${remainingSubscriptions[0].count}`);
      // Convert count to number to handle string vs number comparison
      const subscriptionCount = parseInt(remainingSubscriptions[0].count) || 0;
      logger.info(`🔍 REMOVE_TOKEN DEBUG: subscriptionCount (parsed) = ${subscriptionCount}`);
      logger.info(`🔍 REMOVE_TOKEN DEBUG: Will call tokenTracker.removeToken()? ${remainingSubscriptions.length > 0 && subscriptionCount === 0}`);

      // If no subscriptions remain, use proper tokenTracker.removeToken() logic
      if (remainingSubscriptions.length > 0 && subscriptionCount === 0) {
        logger.info(`🔄 No remaining subscriptions for token ${token.contract_address}, delegating to tokenTracker.removeToken()`);

        // Use the enhanced removal logic that handles premium features and OpenSea unsubscription
        const removalResult = await this.tokenTracker.removeToken(token.contract_address, user.id);

        if (!removalResult.success) {
          logger.error(`Failed to remove token via tokenTracker: ${removalResult.message}`);
          return ctx.reply('❌ Error completing token removal. Please try again.');
        }

        const contextName = chatId === 'private' ? 'private messages' : `group chat (${chatId})`;
        const successMessage = `✅ <b>Token Removed Successfully</b>

🗑️ <b>${token.token_name || 'Unknown Collection'}</b> has been completely removed from tracking.

📮 Contract: <code>${token.contract_address}</code>`;

        await ctx.replyWithHTML(successMessage);
        logger.info(`Token completely removed via tokenTracker: ${token.contract_address} by user ${user.id}`);
        return;
      } else {
        logger.info(`🔄 REMOVE_TOKEN DEBUG: NOT calling tokenTracker.removeToken() - token still has ${subscriptionCount} remaining subscriptions`);
      }

      const contextName = chatId === 'private' ? 'private messages' : `group chat (${chatId})`;
      const successMessage = `✅ <b>Token Removed Successfully</b>

🗑️ <b>${token.token_name || 'Unknown Collection'}</b> has been removed from your tracking list in ${contextName}.

📮 Contract: <code>${token.contract_address}</code>

You will no longer receive notifications for this NFT in this chat context.`;

      await ctx.replyWithHTML(successMessage);
      logger.info(`Token subscription removed: ${token.contract_address} by user ${user.id} in chat ${chatId}`);

    } catch (error) {
      logger.error('Error removing token:', error);
      ctx.reply('❌ Error removing token. Please try again.');
    }
  }

  async toggleTokenNotification(ctx, tokenId) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());


      await ctx.answerCbQuery('Notification setting updated!');

      return this.showMyTokens(ctx);
    } catch (error) {
      logger.error('Error toggling notification:', error);
      await ctx.answerCbQuery('❌ Error updating notification setting');
    }
  }

  async showTokenStats(ctx, tokenId) {
    try {


      await ctx.answerCbQuery('Loading statistics...');
      ctx.reply('📊 Token statistics feature coming soon!');
    } catch (error) {
      logger.error('Error showing token stats:', error);
      await ctx.answerCbQuery('❌ Error loading statistics');
    }
  }

  async showTrendingCommand(ctx) {
    try {
      await this.db.expireTrendingPayments();
      const trendingTokens = await this.db.getTrendingTokens();
      if (trendingTokens.length === 0) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('💰 Buy Normal', 'promote_token'), Markup.button.callback('⭐ Buy Premium', 'promote_token_premium')],
          [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
        ]);
        return ctx.replyWithMarkdown(
          '📊 *No trending NFTs right now*\n\nBe the first to boost your NFT collection!',
          keyboard
        );
      }

      let message = '🔥 *Trending NFT Collections*\n\n';
      const keyboard = [];

      trendingTokens.forEach((token, index) => {
        const endTime = new Date(token.trending_end_time);
        const hoursLeft = Math.max(0, Math.ceil((endTime - new Date()) / (1000 * 60 * 60)));
        message += `${index + 1}. *${token.token_name || 'Unknown Collection'}*\n`;
        message += `   📮 \`${token.contract_address}\`\n`;
        message += `   ⏱️ ${hoursLeft}h left\n`;
        message += `   💰 Paid: ${ethers.formatEther(token.payment_amount)} ETH\n\n`;
        keyboard.push([
          Markup.button.callback(`📊 ${token.token_name || 'View'} Stats`, `stats_${token.id}`)
        ]);
      });

      keyboard.push([Markup.button.callback('💰 Boost Your Token', 'promote_token')]);

      await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error in showTrendingCommand:', error);
      ctx.reply('❌ Error loading trending tokens. Please try again.');
    }
  }

  async showPromoteTokenMenu(ctx, isPremium = false) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // In private chat, fetch ALL tokens across all contexts (same as View My NFTs)
      let userTokens;
      if (ctx.chat.type === 'private') {
        userTokens = await this.db.getUserTrackedTokensWithContext(user.id);
      } else {
        const chatId = this.normalizeChatContext(ctx);
        userTokens = await this.db.getUserTrackedTokens(user.id, chatId);
      }

      // Debug logging
      console.log(`[showPromoteTokenMenu] User: ${user.id}, ChatType: ${ctx.chat.type}, Tokens found: ${userTokens.length}, isPremium: ${isPremium}`);
      if (!userTokens || userTokens.length === 0) {
        const message = '📝 You need to add some NFT collections first!';
        const keyboard = Markup.inlineKeyboard([[Markup.button.callback('➕ Add NFT Collection', 'add_token_start')]]);
        return ctx.replyWithHTML(message, keyboard);
      }

      const trendingType = isPremium ? 'Premium' : 'Normal';
      const message = `🚀 Select an NFT collection for ${trendingType} trending boost:`;

      const keyboard = [];

      userTokens.forEach((token, index) => {
        keyboard.push([{
          text: `🚀 ${token.token_name || `Token ${index + 1}`}`,
          callback_data: isPremium ? `promote_premium_${token.id}` : `promote_${token.id}`
        }]);
      });

      keyboard.push([{
        text: '◀️ Back to Trending & Boost',
        callback_data: 'menu_trending'
      }]);

      try {
        return await ctx.editMessageText(message, {
          reply_markup: {
            inline_keyboard: keyboard
          }
        });
      } catch (error) {
        // Ignore "message is not modified" error (happens when clicking the same button twice)
        if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
          logger.debug('Message content unchanged, skipping edit');
          return;
        }
        return ctx.reply(message, {
          reply_markup: {
            inline_keyboard: keyboard
          }
        });
      }

    } catch (error) {
      logger.error('Error showing promote token menu:', error);
      return ctx.reply('❌ Error loading promotion menu. Please try again.');
    }
  }

  async showPromoteDurationMenu(ctx, tokenId, isPremium = false) {
    try {
      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE id = $1',
        [tokenId]
      );

      if (!token) {
        return ctx.reply('❌ NFT not found.');
      }

      // Auto-detect chain from selected token
      const autoDetectedChain = token.chain_name || 'ethereum';
      const chainConfig = this.chainManager ? this.chainManager.getChain(autoDetectedChain) : null;
      const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : autoDetectedChain.charAt(0).toUpperCase() + autoDetectedChain.slice(1);
      const currencySymbol = chainConfig ? chainConfig.currencySymbol : 'ETH';

      // Use secure trending service with fallback to old service
      const trendingService = this.secureTrending || this.trending;
      const trendingOptions = await trendingService.getTrendingOptions();
      logger.info(`Trending options loaded: ${trendingOptions.length} options`);

      const trendingType = isPremium ? 'Premium' : 'Normal';
      const trendingIcon = isPremium ? '⭐' : '💫';

      let message = `🚀 <b>${trendingType} Trending Boost</b>\n\n`;
      message += `${trendingIcon} <b>${token.token_name || 'Unknown Collection'}</b>\n`;
      message += `📮 <code>${token.contract_address}</code>\n`;
      message += `🔗 Chain: <b>${chainDisplay}</b> <i>(auto-detected)</i>\n\n`;
      message += `<b>Select ${trendingType.toLowerCase()} boost duration:</b>`;

      const buttons = [];

      // Add only the relevant trending options based on type
      trendingOptions.forEach(option => {
        const feeEth = isPremium ? option.premiumFeeEth : option.normalFeeEth;
        const buttonIcon = isPremium ? '🌟' : '💰';
        const type = isPremium ? 'premium' : 'normal';

        buttons.push([Markup.button.callback(
          `${buttonIcon} ${option.duration}h - ${feeEth} ${currencySymbol}`,
          `duration_${tokenId}_${option.duration}_${type}_${autoDetectedChain}`
        )]);
      });

      buttons.push([Markup.button.callback('◀️ Back', isPremium ? 'promote_token_premium' : 'promote_token')]);

      const keyboard = Markup.inlineKeyboard(buttons);

      try {
        return await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        });
      } catch (error) {
        try {
          return await ctx.replyWithHTML(message, keyboard);
        } catch (replyError) {
          logger.error('Error sending duration menu message:', replyError);
          return await ctx.reply(`🚀 Boost: ${token.token_name || 'Unknown Collection'}\n\nSelect boost duration:`, keyboard);
        }
      }

    } catch (error) {
      logger.error('Error showing promote duration menu:', error);
      return ctx.reply('❌ Error loading duration options.');
    }
  }

  // Duplicate showMainMenu removed - using the complete version at line 2047

  async showPaymentInstructions(ctx, tokenId, duration, isPremium = false, chain = 'ethereum') {
    try {
      const telegramId = ctx.from.id.toString();

      // Ensure user exists in database and get the database ID
      const userResult = await this.db.createUser(telegramId, ctx.from.username, ctx.from.first_name);
      const userId = userResult.id;

      if (!userId) {
        throw new Error('Failed to create or retrieve user');
      }

      // Get chain configuration
      const chainConfig = this.chainManager ? this.chainManager.getChain(chain) : null;
      const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : chain.charAt(0).toUpperCase() + chain.slice(1);
      const currencySymbol = chainConfig ? chainConfig.currencySymbol : 'ETH';
      const paymentContract = chainConfig ? chainConfig.paymentContract : addresses.ethereum.paymentContract;
      const truncatedAddress = this.truncateAddress(paymentContract);

      // Use secure trending service with fallback to old service
      const trendingService = this.secureTrending || this.trending;
      const instructions = await trendingService.generatePaymentInstructions(tokenId, duration, userId, isPremium, chain);

      let message = `💳 <b>Simple Payment Instructions</b>\n\n`;
      message += `🔗 Chain: <b>${chainDisplay}</b>\n`;
      message += `🔥 Collection: ${instructions.tokenName}\n`;
      message += `📮 Contract: <code>${instructions.tokenAddress}</code>\n`;
      message += `⏱️ Duration: ${duration} hours\n`;
      message += `💰 Fee: ${instructions.feeEth} ${currencySymbol}\n\n`;
      message += `🏦 <b>Payment Address (${truncatedAddress}):</b>\n\n`;
      message += `<code>${paymentContract}</code>\n\n`;
      message += `📋 Payment Instructions:\n`;
      message += `1. Send ${instructions.feeEth} ${currencySymbol} to the payment address above\n`;
      message += `2. Make sure you're sending from ${chainDisplay} network\n`;
      message += `3. Tap the address above to copy it\n`;
      message += `4. Copy your transaction hash after the transfer\n`;
      message += `5. Submit the transaction hash using the button below\n\n`;
      message += `✅ Simple Process: Just send a regular ${currencySymbol} transfer - no complex contract calls needed!\n`;
      message += `⏰ Payment expires in 30 minutes\n\n`;
      message += `After successful transaction, submit your transaction hash below:`;

      this.pendingPayments.set(telegramId, {
        tokenId: tokenId,
        duration: duration,
        isPremium: isPremium,
        chain: chain,
        expectedAmount: instructions.fee
      });

      const keyboard = [
        [Markup.button.callback('📝 Submit Transaction Hash', `submit_tx_${tokenId}_${duration}_${isPremium ? 'premium' : 'normal'}_${chain}`)],
        [Markup.button.callback('◀️ Back to Duration', `trending_back_to_duration_${tokenId}_${isPremium ? 'premium' : 'normal'}_${chain}`)],
        [Markup.button.callback('🏠 Main Menu', 'main_menu')]
      ];

      return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));

    } catch (error) {
      logger.error('Error showing payment instructions:', error);
      return ctx.reply('❌ Error loading payment instructions. Please try again.');
    }
  }

  // Menu Navigation Functions
  async showMainMenu(ctx) {
    const welcomeMessage = helpers.formatWelcomeMessage();
    const keyboard = helpers.buildMainMenuKeyboard();

    // Check if this is called from a start command (deep link) or callback query
    // If it's from start command, there's no message to edit, so use reply directly
    if (ctx.startPayload || !ctx.callbackQuery) {
      return ctx.replyWithHTML(welcomeMessage, keyboard);
    }

    // Otherwise, try to edit the existing message
    try {
      return ctx.editMessageText(welcomeMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard.reply_markup
      });
    } catch (error) {
      return ctx.replyWithHTML(welcomeMessage, keyboard);
    }
  }

  /**
   * Show context selection menu for adding tokens
   * Allows user to choose Private or a Group context
   */
  async showContextSelectionMenu(ctx, page = 0) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Get all available group contexts where bot has been set up
      const allGroupContexts = await this.db.getAllAvailableGroupContexts();

      logger.info(`[CONTEXT_SELECTION] Found ${allGroupContexts.length} groups in database`);
      allGroupContexts.forEach(g => logger.info(`  - ${g.group_title} (${g.group_chat_id})`));

      // Filter groups where user is admin (check in parallel)
      const groupsWithAdminCheck = await Promise.all(
        allGroupContexts.map(async (context) => {
          try {
            const isAdmin = await this.isUserGroupAdmin(ctx.from.id, context.group_chat_id, ctx);
            logger.info(`[CONTEXT_SELECTION] ${context.group_title}: isAdmin=${isAdmin}`);
            return {
              chat_id: context.group_chat_id,
              title: context.group_title || 'Group',
              isAdmin
            };
          } catch (error) {
            logger.warn(`[CONTEXT_SELECTION] Failed to check admin for ${context.group_title} (${context.group_chat_id}):`, error);
            return null;
          }
        })
      );

      // Keep only groups where user is admin
      const groupsWithTitles = groupsWithAdminCheck.filter(g => g && g.isAdmin);
      logger.info(`[CONTEXT_SELECTION] User ${ctx.from.id} is admin in ${groupsWithTitles.length} groups`);

      // Pagination settings
      const groupsPerPage = 6;
      const totalPages = Math.ceil(groupsWithTitles.length / groupsPerPage);
      const startIdx = page * groupsPerPage;
      const endIdx = startIdx + groupsPerPage;
      const pageGroups = groupsWithTitles.slice(startIdx, endIdx);

      // Build keyboard
      const keyboard = [];

      // Add group buttons (2 per row)
      for (let i = 0; i < pageGroups.length; i += 2) {
        const row = [];

        const group1 = pageGroups[i];
        row.push(Markup.button.callback(
          `👥 ${group1.title.slice(0, 20)}`,
          `context_select_group_${group1.chat_id}_${page}`
        ));

        if (i + 1 < pageGroups.length) {
          const group2 = pageGroups[i + 1];
          row.push(Markup.button.callback(
            `👥 ${group2.title.slice(0, 20)}`,
            `context_select_group_${group2.chat_id}_${page}`
          ));
        }

        keyboard.push(row);
      }

      // Add pagination buttons if needed
      if (totalPages > 1) {
        const paginationRow = [];

        if (page > 0) {
          paginationRow.push(Markup.button.callback('◀️ Prev', `context_page_${page - 1}`));
        }

        paginationRow.push(Markup.button.callback(`Page ${page + 1}/${totalPages}`, 'noop'));

        if (page < totalPages - 1) {
          paginationRow.push(Markup.button.callback('Next ▶️', `context_page_${page + 1}`));
        }

        keyboard.push(paginationRow);
      }

      // Cancel button
      keyboard.push([Markup.button.callback('◀️ Back', 'menu_tokens')]);

      const message = `🎯 <b>Where do you want to add this NFT?</b>\n\nChoose context:`;

      return this.sendOrEditMenu(ctx, message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error showing context selection menu:', error);
      ctx.reply('❌ Error loading contexts. Please try again.');
    }
  }

  async showTokensMenu(ctx) {
    const message = `📊 <b>NFT Management</b>

<b>Manage your NFT collections:</b>`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add NFT Collection', 'add_token_start'), Markup.button.callback('👁️ View My NFTs', 'my_tokens')],
      [Markup.button.callback('🗑️ Remove NFT Collection', 'remove_token')],
      [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
    ]);

    return this.sendOrEditMenu(ctx, message, keyboard);
  }

  async showTrendingMenu(ctx) {
    const message = `🔥 <b>Trending & Boost</b>

<b>Promote your NFT collections:</b>`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Buy Normal', 'promote_token'), Markup.button.callback('⭐ Buy Premium', 'promote_token_premium')],
      [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
    ]);

    return this.sendOrEditMenu(ctx, message, keyboard);
  }

  async showImagesMenu(ctx) {
    const message = `🖼️ <b>NFT Image Display</b>

<b>Enable real NFT images instead of CandyCodex image:</b>`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💳 Display NFT Image', 'buy_image_menu')],
      [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
    ]);

    return this.sendOrEditMenu(ctx, message, keyboard);
  }

  async showImageTokenSelection(ctx) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // In private chat, fetch ALL tokens across all contexts (same as View My NFTs)
      let tokens;
      if (ctx.chat.type === 'private') {
        tokens = await this.db.getUserTrackedTokensWithContext(user.id);
      } else {
        const chatId = this.normalizeChatContext(ctx);
        tokens = await this.db.getUserTrackedTokens(user.id, chatId);
      }

      // Determine if this is from a callback query (has message to edit) or command (no message)
      const isCallback = ctx.callbackQuery && ctx.callbackQuery.message;

      if (tokens.length === 0) {
        const message = `🖼️ <b>Select NFT for Image Display</b>\n\n` +
          `📝 You need to add some NFT collections first!\n\n` +
          `Add your NFTs to track them and enable image display.`;

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Your First NFT', 'add_token_start')],
          [Markup.button.callback('◀️ Back to Images Menu', 'menu_images')]
        ]);

        if (isCallback) {
          try {
            return await ctx.editMessageText(message, {
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } catch (error) {
            // Ignore "message is not modified" error (happens when clicking the same button twice)
            if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
              logger.debug('Message content unchanged, skipping edit');
              return;
            }
            return ctx.replyWithHTML(message, keyboard);
          }
        } else {
          return ctx.replyWithHTML(message, keyboard);
        }
      }

      const message = `🖼️ <b>Select NFT for Image Display</b>\n\n` +
        `Choose which NFT collection to enable real image display for:`;

      const keyboard = [];

      // Group tokens by rows (2 per row)
      for (let i = 0; i < tokens.length; i += 2) {
        const row = [];

        for (let j = i; j < Math.min(i + 2, tokens.length); j++) {
          const token = tokens[j];
          const chainName = token.chain_name || 'ethereum';
          const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
          const chainEmoji = chainConfig ? chainConfig.emoji : '🔷';

          const tokenDisplay = `${chainEmoji} ${token.token_name || 'Unknown'}`;
          const truncatedDisplay = tokenDisplay.length > 25 ? tokenDisplay.substring(0, 22) + '...' : tokenDisplay;

          row.push(Markup.button.callback(truncatedDisplay, `image_select_token_${token.id}`));
        }

        keyboard.push(row);
      }

      // Navigation buttons
      keyboard.push([
        Markup.button.callback('◀️ Back to Images Menu', 'menu_images'),
        Markup.button.callback('🏠 Main Menu', 'main_menu')
      ]);

      if (isCallback) {
        try {
          return await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
          });
        } catch (error) {
          // Ignore "message is not modified" error
          if (error.response?.error_code === 400 && error.response?.description?.includes('message is not modified')) {
            logger.debug('Message content unchanged, skipping edit');
            return;
          }
          return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
        }
      } else {
        return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
      }
    } catch (error) {
      logger.error('Error showing image token selection:', error);
      ctx.reply('❌ Error loading your NFTs. Please try again.');
    }
  }

  async handleImageTokenSelection(ctx, tokenId) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Get token details from database
      const chatId = this.normalizeChatContext(ctx);
      const tokens = await this.db.getUserTrackedTokens(user.id, chatId);
      const selectedToken = tokens.find(token => token.id.toString() === tokenId.toString());

      if (!selectedToken) {
        return ctx.reply('❌ Token not found. Please try again.');
      }

      // Store token selection in user session
      this.setUserSession(ctx.from.id, {
        flow: 'image_payment',
        selectedTokenId: selectedToken.id,
        contractAddress: selectedToken.contract_address,
        tokenName: selectedToken.token_name,
        tokenSymbol: selectedToken.token_symbol,
        chain: selectedToken.chain_name || 'ethereum'
      });

      // Show duration selection with selected token context
      return this.showImageDurationSelectionWithToken(ctx, selectedToken);
    } catch (error) {
      logger.error('Error handling image token selection:', error);
      ctx.reply('❌ Error processing token selection. Please try again.');
    }
  }

  async showImageDurationSelectionWithToken(ctx, selectedToken) {
    try {
      const chainName = selectedToken.chain_name || 'ethereum';
      const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
      const chainEmoji = chainConfig ? chainConfig.emoji : '🔷';
      const chainDisplay = chainConfig ? chainConfig.displayName : chainName.charAt(0).toUpperCase() + chainName.slice(1);

      // Get chain-specific pricing
      const chainNormalized = this.secureTrending.normalizeChainName(chainName);
      const durations = [30, 60, 90, 180, 365];
      const prices = {};
      const symbol = this.secureTrending.getChainConfig(chainNormalized).symbol;

      durations.forEach(duration => {
        const fee = this.secureTrending.calculateImageFee(duration, chainName);
        prices[duration] = this.secureTrending.formatChainAmount(fee, chainNormalized);
      });

      const message = `🎨 <b>Image Fee - Select Duration</b>\n\n` +
        `🎯 <b>Selected NFT:</b> ${selectedToken.token_name || 'Unknown'} (${selectedToken.token_symbol || 'N/A'})\n` +
        `🔗 <b>Blockchain:</b> ${chainEmoji} ${chainDisplay}\n\n` +
        `Choose how long you want NFT images displayed instead of the CandyCodex image:\n\n` +
        `🔹 <b>30 days</b> - ${prices[30]} ${symbol}\n` +
        `🔹 <b>60 days</b> - ${prices[60]} ${symbol}\n` +
        `🔹 <b>90 days</b> - ${prices[90]} ${symbol}\n` +
        `🔹 <b>180 days</b> - ${prices[180]} ${symbol}\n` +
        `🔹 <b>365 days</b> - ${prices[365]} ${symbol}\n\n` +
        `✨ Longer durations offer better value per day!`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`30 days - ${prices[30]} ${symbol}`, 'token_image_duration_30'),
          Markup.button.callback(`60 days - ${prices[60]} ${symbol}`, 'token_image_duration_60')
        ],
        [
          Markup.button.callback(`90 days - ${prices[90]} ${symbol}`, 'token_image_duration_90'),
          Markup.button.callback(`180 days - ${prices[180]} ${symbol}`, 'token_image_duration_180')
        ],
        [
          Markup.button.callback(`365 days - ${prices[365]} ${symbol}`, 'token_image_duration_365')
        ],
        [
          Markup.button.callback('◀️ Back to Token Selection', 'buy_image_menu'),
          Markup.button.callback('🏠 Main Menu', 'main_menu')
        ]
      ]);

      // Set user state
      this.setUserState(ctx.from.id, this.STATE_IMAGE_DURATION_SELECT);

      await ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error showing image duration selection with token:', error);
      ctx.reply('❌ Error showing duration options. Please try again.');
    }
  }

  async showTokenImagePaymentInstructions(ctx, session) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      const { contractAddress, tokenName, tokenSymbol, chain, duration, amount } = session;

      // Check if image fee is already active
      const isActive = await this.secureTrending.isImageFeeActive(contractAddress);
      if (isActive) {
        return ctx.reply('✅ Image fee is already active for this contract. Actual NFT images are being displayed.', {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Back to Token Selection', 'buy_image_menu')],
            [Markup.button.callback('🏠 Main Menu', 'main_menu')]
          ])
        });
      }

      const chainConfig = this.chainManager ? this.chainManager.getChain(chain) : null;
      const chainEmoji = chainConfig ? chainConfig.emoji : '🔷';
      const chainDisplay = chainConfig ? chainConfig.displayName : chain.charAt(0).toUpperCase() + chain.slice(1);

      const durationText = `${duration} days`;

      const instructions = await this.secureTrending.generateImagePaymentInstructions(contractAddress, user.id, duration, chain);
      const truncatedAddress = this.truncateAddress(instructions.contractAddress);

      const message = `💰 <b>Image Fee Payment Instructions</b>\n\n` +
        `🎯 <b>Selected NFT:</b> ${tokenName || 'Unknown'} (${tokenSymbol || 'N/A'})\n` +
        `🔗 <b>Blockchain:</b> ${chainEmoji} ${chainDisplay}\n` +
        `📮 <b>Contract:</b> <code>${contractAddress}</code>\n` +
        `📅 <b>Duration:</b> ${durationText}\n` +
        `💸 <b>Fee:</b> ${instructions.feeEth} ${instructions.symbol}\n\n` +
        `🏦 <b>Payment Contract (${truncatedAddress}):</b>\n\n` +
        `<code>${instructions.contractAddress}</code>\n\n` +
        `📋 <b>Payment Steps:</b>\n` +
        instructions.instructions.join('\n') + '\n\n' +
        `After making the payment, click the button below to submit your transaction hash.`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📝 Submit Transaction Hash', 'submit_token_image_tx')
        ],
        [
          Markup.button.callback('◀️ Back to Duration Selection', 'buy_image_menu'),
          Markup.button.callback('🏠 Main Menu', 'main_menu')
        ]
      ]);

      await ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error showing token image payment instructions:', error);
      ctx.reply('❌ Error generating payment instructions. Please try again.');
    }
  }

  async showFooterMenu(ctx) {
    const message = `🔗 <b>Footer Advertisement</b>

<b>Advertise your Project in notification footers:</b>`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💳 Pay for Footer Ads', 'buy_footer_menu')],
      [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
    ]);

    // Check if this is called from a start command (deep link) or callback query
    if (ctx.startPayload || !ctx.callbackQuery) {
      return ctx.replyWithHTML(message, keyboard);
    }

    return this.sendOrEditMenu(ctx, message, keyboard);
  }

  async showChannelsMenu(ctx) {
    const message = `📺 <b>Channel Management</b>

<b>Configure bot for your channels:</b>`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add to Channel', 'channel_add'), Markup.button.callback('⚙️ Configure Alerts', 'channel_settings')],
      [Markup.button.callback('🆔 Get Chat ID', 'get_chat_id')],
      [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
    ]);

    return this.sendOrEditMenu(ctx, message, keyboard);
  }

  async showVerifyMenu(ctx) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      const message = `✅ <b>Verify Your Payments</b>\n\n` +
        `Select the type of payment you want to verify:\n\n`
        

      const keyboard = [
        [Markup.button.callback('🔍 Verify Trending', 'verify_trending')],
        [Markup.button.callback('🖼️ Verify Image', 'verify_image')],
        [Markup.button.callback('🔗 Verify Footer', 'verify_footer')],
        [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')]
      ];

      try {
        return ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
        });
      } catch (error) {
        return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
      }
    } catch (error) {
      logger.error('Error in showVerifyMenu:', error);
      ctx.reply('❌ Error loading verification options. Please try again.');
    }
  }

  async showVerifyTokenSelection(ctx, verificationType) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      const chatId = this.normalizeChatContext(ctx);
      const tokens = await this.db.getUserTrackedTokens(user.id, chatId);

      // Determine if this is from a callback query (has message to edit) or command (no message)
      const isCallback = ctx.callbackQuery && ctx.callbackQuery.message;

      if (tokens.length === 0) {
        const verifyTypeText = verificationType === 'image' ? 'Image Fee' : 'Trending';
        const message = `🔍 <b>Verify ${verifyTypeText} Payment</b>\n\n` +
          `📝 You need to add some NFT collections first!\n\n` +
          `Add your NFTs to track them before verifying payments.`;

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Your First NFT', 'add_token_start')],
          [Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]
        ]);

        if (isCallback) {
          return ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup
          });
        } else {
          return ctx.replyWithHTML(message, keyboard);
        }
      }

      const verifyTypeText = verificationType === 'image' ? 'Image Fee' : 'Trending';
      const verifyEmoji = verificationType === 'image' ? '🖼️' : '🔍';
      const message = `${verifyEmoji} <b>Verify ${verifyTypeText} Payment</b>\n\n` +
        `Select the NFT collection you made the payment for:`;

      const keyboard = [];

      // Group tokens by rows (2 per row)
      for (let i = 0; i < tokens.length; i += 2) {
        const row = [];

        for (let j = i; j < Math.min(i + 2, tokens.length); j++) {
          const token = tokens[j];
          const chainName = token.chain_name || 'ethereum';
          const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
          const chainEmoji = chainConfig ? chainConfig.emoji : '🔷';

          const tokenDisplay = `${chainEmoji} ${token.token_name || 'Unknown'}`;
          const truncatedDisplay = tokenDisplay.length > 25 ? tokenDisplay.substring(0, 22) + '...' : tokenDisplay;

          row.push(Markup.button.callback(truncatedDisplay, `verify_${verificationType}_token_${token.id}`));
        }

        keyboard.push(row);
      }

      // Navigation buttons
      keyboard.push([
        Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify'),
        Markup.button.callback('🏠 Main Menu', 'main_menu')
      ]);

      if (isCallback) {
        return ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
        });
      } else {
        return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
      }
    } catch (error) {
      logger.error(`Error showing verify token selection for ${verificationType}:`, error);
      ctx.reply('❌ Error loading your NFTs. Please try again.');
    }
  }

  async handleVerifyTokenSelection(ctx, tokenId, verificationType) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Get token details from database
      const chatId = this.normalizeChatContext(ctx);
      const tokens = await this.db.getUserTrackedTokens(user.id, chatId);
      const selectedToken = tokens.find(token => token.id.toString() === tokenId.toString());

      if (!selectedToken) {
        return ctx.reply('❌ Token not found. Please try again.');
      }

      // Store token selection for verification
      const userId = ctx.from.id.toString();
      this.userStates.set(userId + '_validation_type', verificationType);
      this.userStates.set(userId + '_validation_contract', selectedToken.contract_address);
      this.userStates.set(userId + '_validation_token_id', selectedToken.id);
      this.userStates.set(userId + '_validation_chain', selectedToken.chain_name || 'ethereum');

      // Move to transaction hash input
      this.setUserState(ctx.from.id, this.STATE_EXPECTING_VALIDATION_TX_HASH);

      const chainName = selectedToken.chain_name || 'ethereum';
      const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
      const chainEmoji = chainConfig ? chainConfig.emoji : '🔷';
      const chainDisplay = chainConfig ? chainConfig.displayName : chainName.charAt(0).toUpperCase() + chainName.slice(1);

      const verifyTypeText = verificationType === 'image' ? 'Image Fee' : 'Trending';
      const verifyEmoji = verificationType === 'image' ? '🖼️' : '🔍';

      const message = `📝 <b>Submit Transaction Hash</b>\n\n` +
        `${verifyEmoji} <b>Payment Type:</b> ${verifyTypeText}\n` +
        `🎯 <b>NFT:</b> ${selectedToken.token_name || 'Unknown'} (${selectedToken.token_symbol || 'N/A'})\n` +
        `${chainEmoji} <b>Blockchain:</b> ${chainDisplay}\n\n` +
        `Please send me your transaction hash for the ${verifyTypeText.toLowerCase()} payment.\n\n` +
        `<i>Example: 0xabc123456789def...</i>`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]);
      return ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error(`Error handling verify token selection for ${verificationType}:`, error);
      ctx.reply('❌ Error processing token selection. Please try again.');
    }
  }

  async handleFooterTickerSelection(ctx, footerAdId) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Get footer ad details from database
      const footerAds = await this.db.getUserFooterAds(user.id);
      const selectedFooterAd = footerAds.find(ad => ad.id.toString() === footerAdId.toString());

      if (!selectedFooterAd) {
        return ctx.reply('❌ Footer advertisement not found. Please try again.');
      }

      // Store footer ad selection for verification
      const userId = ctx.from.id.toString();
      const ticker = selectedFooterAd.ticker_symbol || selectedFooterAd.token_symbol || selectedFooterAd.contract_address.slice(0, 8);

      this.userStates.set(userId + '_validation_type', 'footer');
      this.userStates.set(userId + '_validation_ticker', ticker);
      this.userStates.set(userId + '_validation_footer_ad_id', selectedFooterAd.id);

      // Move to transaction hash input
      this.setUserState(ctx.from.id, this.STATE_EXPECTING_VALIDATION_TX_HASH);

      const message = `📝 <b>Submit Transaction Hash</b>\n\n` +
        `🔗 <b>Payment Type:</b> Footer Advertisement\n` +
        `💲 <b>Ticker:</b> ${ticker}\n` +
        `📎 <b>Link:</b> ${selectedFooterAd.custom_link || 'N/A'}\n\n` +
        `Please send me your transaction hash for the footer advertisement payment.\n\n` +
        `<i>Example: 0xabc123456789def...</i>`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]);
      return ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error handling footer ticker selection:', error);
      ctx.reply('❌ Error processing ticker selection. Please try again.');
    }
  }

  async showVerifyFooterTickerInput(ctx) {
    try {
      const message = `🔗 <b>Verify Footer Payment</b>\n\n` +
        `Please enter the ticker symbol you used when creating your footer advertisement.\n\n` +
        `💡 <b>Include the $ prefix if you used one</b>\n\n` +
        `<i>Examples: $PEPE, $BAYC, $AZUKI</i>\n<i>Or without $: PEPE, BAYC, AZUKI</i>`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]);

      this.setUserState(ctx.from.id, this.STATE_EXPECTING_VALIDATION_TICKER);
      this.userStates.set(ctx.from.id.toString() + '_validation_type', 'footer');

      return this.sendOrEditMenu(ctx, message, keyboard);
    } catch (error) {
      logger.error('Error showing footer ticker input:', error);
      ctx.reply('❌ Error showing ticker input. Please try again.');
    }
  }

  async showFooterTickerSelection(ctx) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Get user's purchased footer ads
      const footerAds = await this.db.getUserFooterAds(user.id);

      // Determine if this is from a callback query (has message to edit) or command (no message)
      const isCallback = ctx.callbackQuery && ctx.callbackQuery.message;

      if (footerAds.length === 0) {
        const message = `🔗 <b>Verify Footer Payments</b>\n\n` +
          `❌ <b>No footer advertisements found!</b>\n\n` +
          `You haven't purchased any footer ads yet. Purchase a footer advertisement first to verify payments.`;

        const keyboard = [
          [Markup.button.callback('💰 Buy Footer Ad', 'buy_footer_menu')],
          [Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]
        ];

        if (isCallback) {
          return ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
          });
        } else {
          return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
        }
      }

      const message = `🔗 <b>Verify Footer Payments</b>\n\n` +
        `Select which footer advertisement to verify:\n\n` +
        `💡 Choose from your purchased tickers:`;

      const keyboard = [];

      // Add button for each footer ad ticker
      for (const footerAd of footerAds.slice(0, 10)) { // Limit to 10 ads
        const displayTicker = footerAd.ticker_symbol || footerAd.token_symbol || footerAd.contract_address.slice(0, 8);
        const buttonText = `🔗 ${displayTicker}`;
        keyboard.push([Markup.button.callback(buttonText, `verify_footer_ticker_${footerAd.id}`)]);
      }

      // Add navigation buttons
      keyboard.push([Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]);

      if (isCallback) {
        return ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
        });
      } else {
        return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
      }
    } catch (error) {
      logger.error('Error showing footer ticker selection:', error);
      ctx.reply('❌ Error loading footer advertisements. Please try again.');
    }
  }

  /**
   * Group tokens by context, then by chain
   * @param {Array} tokens - Tokens with contextLabel added
   * @param {string} userTelegramId - User's Telegram ID
   * @returns {Object} Grouped tokens: { Private: {...}, GroupName: {...} }
   */
  groupByContext(tokens, userTelegramId) {
    const grouped = {};

    tokens.forEach(token => {
      const contextLabel = token.contextLabel || 'Unknown';

      if (!grouped[contextLabel]) {
        grouped[contextLabel] = {};
      }

      const chainName = token.chain_name || 'ethereum';
      if (!grouped[contextLabel][chainName]) {
        grouped[contextLabel][chainName] = [];
      }

      grouped[contextLabel][chainName].push(token);
    });

    // Sort contexts alphabetically (groups only)
    const sortedGrouped = {};
    Object.keys(grouped)
      .sort()
      .forEach(key => {
        sortedGrouped[key] = grouped[key];
      });

    return sortedGrouped;
  }

  /**
   * Render one context section (Private or Group)
   * @param {string} contextLabel - Context name
   * @param {Object} chainTokens - Tokens grouped by chain
   * @param {Array} keyboard - Keyboard array to append buttons to
   * @returns {string} Formatted message section
   */
  renderContextSection(contextLabel, chainTokens, keyboard) {
    let section = '';
    const totalTokens = Object.values(chainTokens).reduce((sum, tokens) => sum + tokens.length, 0);

    // Context header with emoji (groups/channels only)
    const contextEmoji = '👥';
    section += `${contextEmoji} <b>${contextLabel}</b> (${totalTokens} token${totalTokens !== 1 ? 's' : ''})\n`;

    // Group by chain within this context
    for (const [chainName, tokens] of Object.entries(chainTokens)) {
      const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
      const chainEmoji = this.chainManager ? this.chainManager.getChainEmoji(chainName) : '🔗';
      const chainDisplay = chainConfig ? `${chainEmoji} ${chainConfig.displayName}` : chainName;

      section += `  🔗 <b>${chainDisplay}</b> (${tokens.length})\n`;

      tokens.forEach((token, index) => {
        section += `     ${index + 1}. <b>${token.token_name || 'Unknown'}</b> (${token.token_symbol || 'N/A'})\n`;
        section += `        📮 <code>${token.contract_address}</code>\n`;

        // Add context-aware remove button
        const buttonText = `🗑️ Remove ${token.token_name || token.contract_address.slice(0, 8)}... from ${contextLabel}`;
        keyboard.push([
          Markup.button.callback(
            buttonText,
            `remove_${token.id}_${token.chat_id}`
          )
        ]);
      });

      section += '\n';
    }

    return section;
  }

  /**
   * Show all user tokens across all contexts (for DM view)
   * Displays Private tokens + tokens from all groups user is tracking in
   */
  async showMyTokensAllContexts(ctx) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Fetch ALL tokens across all contexts
      const allTokens = await this.db.getUserTrackedTokensWithContext(user.id);
      logger.info(`[showMyTokensAllContexts] User ${user.id}: Found ${allTokens.length} tokens across all contexts`);

      if (allTokens.length === 0) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Your First NFT', 'add_token_start')],
          [Markup.button.callback('◀️ Back to NFTs Menu', 'menu_tokens')]
        ]);
        const message = '🔍 You haven\'t added any tokens yet!\n\nUse the button below to start tracking NFT collections.';

        if (ctx.callbackQuery) {
          try {
            return await ctx.editMessageText(message, {
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } catch (error) {
            return ctx.replyWithHTML(message, keyboard);
          }
        } else {
          return ctx.replyWithHTML(message, keyboard);
        }
      }

      // Resolve context labels (group names) in parallel
      const tokensWithLabels = await this.resolveAllContexts(allTokens, ctx, user.telegram_id);

      // Group by context first, then by chain
      const byContext = this.groupByContext(tokensWithLabels, user.telegram_id);

      // Build message
      const totalTokens = allTokens.length;
      const contextCount = Object.keys(byContext).length;
      let message = `🎯 <b>Your Tracked NFTs</b> (${totalTokens} total across ${contextCount} context${contextCount !== 1 ? 's' : ''})\n\n`;

      const keyboard = [];

      // Render each context section
      for (const [contextLabel, chainTokens] of Object.entries(byContext)) {
        message += this.renderContextSection(contextLabel, chainTokens, keyboard);
      }

      // Add action buttons
      keyboard.push([
        Markup.button.callback('➕ Add More NFTs', 'add_token_start'),
        Markup.button.callback('◀️ Back to NFTs Menu', 'menu_tokens')
      ]);

      // Send or edit message
      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
          });
        } catch (error) {
          await ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
        }
      } else {
        await ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
      }
    } catch (error) {
      logger.error('Error in showMyTokensAllContexts:', error);
      ctx.reply('❌ Error retrieving your NFTs. Please try again.');
    }
  }

  async showMyTokens(ctx) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Route to appropriate view based on chat type
      const chatType = ctx.chat.type;
      logger.info(`[showMyTokens] User ${user.id}, ChatType: ${chatType}`);

      // If in DM (private chat), show all contexts view
      if (chatType === 'private') {
        logger.info(`[showMyTokens] Routing to all contexts view for DM`);
        return await this.showMyTokensAllContexts(ctx);
      }

      // If in group, show only group's tokens (existing behavior)
      const chatId = this.normalizeChatContext(ctx);
      logger.info(`[showMyTokens] Showing group-specific tokens for chat ${chatId}`);
      const tokens = await this.db.getUserTrackedTokens(user.id, chatId);
      logger.info(`[showMyTokens] Found ${tokens.length} tokens for user ${user.id} in chat ${chatId}`);

      if (tokens.length === 0) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Your First NFT', 'add_token_start')],
          [Markup.button.callback('◀️ Back to NFTs Menu', 'menu_tokens')]
        ]);
        const message = '🔍 You haven\'t added any tokens yet!\n\nUse the button below to start tracking NFT collections.';

        // Check if this is a callback query (has callbackQuery) or command
        if (ctx.callbackQuery) {
          try {
            return await ctx.editMessageText(message, {
              parse_mode: 'HTML',
              reply_markup: keyboard.reply_markup
            });
          } catch (error) {
            // If edit fails, send new message
            return ctx.replyWithHTML(message, keyboard);
          }
        } else {
          // Direct command - send new message
          return ctx.replyWithHTML(message, keyboard);
        }
      }

      // Group tokens by chain
      const tokensByChain = {};
      tokens.forEach(token => {
        const chainName = token.chain_name || 'ethereum';
        if (!tokensByChain[chainName]) {
          tokensByChain[chainName] = [];
        }
        tokensByChain[chainName].push(token);
      });

      let message = `🎯 <b>Your Tracked NFTs</b> (${tokens.length} total)\n\n`;
      const keyboard = [];

      for (const [chainName, chainTokens] of Object.entries(tokensByChain)) {
        const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
        // Use custom emoji if available
        const chainEmoji = this.chainManager ? this.chainManager.getChainEmoji(chainName) : '🔗';
        const chainDisplay = chainConfig ? `${chainEmoji} ${chainConfig.displayName}` : chainName;

        message += `🔗 <b>${chainDisplay}</b> (${chainTokens.length})\n`;

        chainTokens.forEach((token, index) => {
          message += `   ${index + 1}. <b>${token.token_name || 'Unknown'}</b> (${token.token_symbol || 'N/A'})\n`;
          message += `      📮 <code>${token.contract_address}</code>\n`;
          message += `      🟢 Status: Active\n`;

          // Show tracking status
          if (token.collection_slug || token.chain_name === 'solana' || token.chain_name === 'bitcoin') {
            message += `      📊 Tracking: ✅ Active\n`;
          }
          message += '\n';

          keyboard.push([
            Markup.button.callback(
              `🗑️ Remove ${token.token_name || token.contract_address.slice(0, 8)}...`,
              `remove_${token.id}`
            )
          ]);
        });
        message += '\n';
      }

      keyboard.push([Markup.button.callback('➕ Add More NFTs', 'add_token_start'), Markup.button.callback('◀️ Back to NFTs Menu', 'menu_tokens')]);

      // Check if this is a callback query or command
      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
          });
        } catch (error) {
          await ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
        }
      } else {
        // Direct command - send new message
        await ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
      }
    } catch (error) {
      logger.error('Error in showMyTokens:', error);
      ctx.reply('❌ Error retrieving your NFTs. Please try again.');
    }
  }

  async showTrendingTypeMenu(ctx, isPremium = false) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      const chatId = this.normalizeChatContext(ctx);
      const tokens = await this.db.getUserTrackedTokens(user.id, chatId);

      // Debug logging
      console.log(`[showTrendingTypeMenu] User: ${user.id}, ChatId: ${chatId}, Tokens found: ${tokens.length} (using database)`);
      if (tokens.length > 0) {
        console.log(`[showTrendingTypeMenu] Token details:`, tokens.map(t => ({ id: t.id, name: t.token_name, address: t.contract_address })));
      }

      if (tokens.length === 0) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Your First NFT', 'add_token_start')]
        ]);
        return ctx.reply('📝 You need to add some NFT collections first!\n\nUse /add_token to track your first NFT collection.', keyboard);
      }

      const trendingType = isPremium ? 'Premium' : 'Normal';
      const message = `🚀 <b>${trendingType} Trending Boost</b>

Select an NFT collection to boost:`;

      const keyboard = [];
      tokens.forEach((token, index) => {
        keyboard.push([{
          text: `${index + 1}. ${token.token_name || 'Unknown Collection'}`,
          callback_data: `trending_${isPremium ? 'premium' : 'normal'}_${token.id}`
        }]);
      });

      keyboard.push([{
        text: '🔄 Back to Buy Trending Menu',
        callback_data: 'back_to_buy_trending'
      }]);

      return ctx.replyWithHTML(message, { reply_markup: { inline_keyboard: keyboard } });
    } catch (error) {
      logger.error('Error showing trending type menu:', error);
      return ctx.reply('❌ Error loading your NFTs. Please try again.');
    }
  }

  async showTrendingChainSelection(ctx, tokenId, isPremium = false) {
    try {
      const token = await this.db.get('SELECT * FROM tracked_tokens WHERE id = $1', [tokenId]);
      if (!token) {
        return ctx.reply('❌ NFT collection not found.');
      }

      const trendingType = isPremium ? 'Premium' : 'Normal';
      const message = `🚀 <b>${trendingType} Trending - ${token.token_name || 'Unknown Collection'}</b>

🔗 Select blockchain network for payment:`;

      const chainOptions = [];

      if (this.chainManager) {
        const supportedChains = this.chainManager.getChainsForPayments();
        supportedChains.forEach(chain => {
          chainOptions.push([Markup.button.callback(`${chain.emoji} ${chain.displayName}`, `trending_chain_${tokenId}_${isPremium ? 'premium' : 'normal'}_${chain.name}`)]);
        });
      } else {
        // Fallback if chainManager not available
        chainOptions.push([Markup.button.callback('🔷 Ethereum', `trending_chain_${tokenId}_${isPremium ? 'premium' : 'normal'}_ethereum`)]);
      }

      // Navigation buttons
      chainOptions.push([
        Markup.button.callback('◀️ Back to NFT Selection', `buy_trending_${isPremium ? 'premium' : 'normal'}`),
        Markup.button.callback('🏠 Main Menu', 'main_menu')
      ]);

      const keyboard = Markup.inlineKeyboard(chainOptions);

      return ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error showing trending chain selection:', error);
      return ctx.reply('❌ Error loading chain options. Please try again.');
    }
  }

  async showTrendingDurationSelection(ctx, tokenId, isPremium = false, chain = 'ethereum') {
    try {
      const token = await this.db.get('SELECT * FROM tracked_tokens WHERE id = $1', [tokenId]);
      if (!token) {
        return ctx.reply('❌ NFT collection not found.');
      }

      const trendingType = isPremium ? 'Premium' : 'Normal';
      const chainConfig = this.chainManager ? this.chainManager.getChain(chain) : null;
      const chainDisplay = chainConfig ? `${chainConfig.emoji} ${chainConfig.displayName}` : chain.charAt(0).toUpperCase() + chain.slice(1);

      const message = `🚀 <b>${trendingType} Trending - ${token.token_name || 'Unknown Collection'}</b>

🔗 Chain: <b>${chainDisplay}</b> <i>(auto-detected)</i>

Select trending duration:`;

      const durations = [6, 12, 18, 24];
      const keyboard = [];

      // Get chain config for proper symbol display
      const chainNormalized = this.secureTrending.normalizeChainName(chain);
      const chainSymbol = this.secureTrending.getChainConfig(chainNormalized).symbol;

      durations.forEach(duration => {
        const fee = this.secureTrending.calculateTrendingFee(duration, isPremium, chain);
        const feeFormatted = this.secureTrending.formatChainAmount(fee, chainNormalized);
        keyboard.push([Markup.button.callback(`${duration}h - ${feeFormatted} ${chainSymbol}`, `trending_duration_${tokenId}_${duration}_${isPremium ? 'premium' : 'normal'}_${chain}`)]);
      });

      keyboard.push([
        Markup.button.callback('🔄 Choose Different Chain', `trending_back_to_chain_${tokenId}_${isPremium ? 'premium' : 'normal'}`),
        Markup.button.callback('🏠 Main Menu', 'main_menu')
      ]);

      return ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error showing trending duration selection:', error);
      return ctx.reply('❌ Error loading trending options. Please try again.');
    }
  }

  // Button-Driven Flow Handlers
  async handleFooterContract(ctx, contractAddress) {
    try {
      if (contractAddress.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showFooterMenu(ctx);
      }

      // Validate NFT address format - silently ignore invalid messages
      if (!contractAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return; // Silently ignore invalid messages instead of showing error
      }

      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Check if user has too many pending operations
      const pendingCount = await this.checkUserPendingOperations(user.id);
      if (pendingCount >= 5) {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ You have too many pending operations. Please complete or cancel existing operations before starting new ones.');
      }

      // Check if contract is already tracked, if not validate and add it
      ctx.reply('🔍 Validating NFT address...');

      let token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        // Contract not tracked yet, validate and add it
        const chatId = this.normalizeChatContext(ctx);
        const session = this.getUserSession(ctx.from.id);
        const chainName = session?.chain || this.userStates.get(ctx.from.id.toString() + '_selected_chain') || 'ethereum';
        const result = await this.tokenTracker.addToken(contractAddress, user.id, ctx.from.id.toString(), chatId, chainName);
        if (!result.success) {
          this.clearUserState(ctx.from.id);
          return ctx.reply(`❌ Contract validation failed: ${result.error}`);
        }
        // Get the newly added token
        token = await this.db.getTrackedToken(contractAddress);
      }

      // Store NFT address and generate payment instructions
      this.userStates.set(ctx.from.id.toString() + '_footer_contract', contractAddress);

      const instructions = await this.secureTrending.generateFooterPaymentInstructions(contractAddress, user.id);

      const message =
        `💰 <b>Footer Advertisement Payment</b>\n\n` +
        `🎨 <b>Collection:</b> ${instructions.tokenName || 'Unknown'}\n` +
        `🎯 <b>Token:</b> ${instructions.tokenSymbol || 'N/A'}\n` +
        `💸 <b>Fee:</b> ${instructions.feeEth || '1.0'} ${instructions.symbol || 'ETH'}\n` +
        `⏰ <b>Duration:</b> ${instructions.duration || '30 days'}\n` +
        `📮 <b>Contract:</b> <code>${instructions.contractAddress || contractAddress}</code>\n\n` +
        `📋 <b>Payment Steps:</b>\n` +
        (instructions.instructions || ['Send payment to NFT address']).map((step, i) => `${i + 1}. ${step}`).join('\n') + '\n\n';

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📝 Submit Transaction Hash', 'submit_footer_tx')],
        [Markup.button.callback('◀️ Back to Footer Menu', 'menu_footer')]
      ]);

      await ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error handling footer contract:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleFooterTxHash(ctx, txHash) {
    try {
      if (txHash.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showFooterMenu(ctx);
      }

      // Validate transaction hash format
      if (!txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
        const errorMessage = '⚠️ Invalid transaction hash format. Please send a valid transaction hash (starts with 0x and is 64 characters long).';
        const keyboard = Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]]);
        return ctx.replyWithHTML(errorMessage, keyboard);
      }

      const userId = ctx.from.id.toString();

      // Check both old and new session formats
      let contractAddress = this.userStates.get(userId + '_footer_contract'); // Old format
      let durationDays = 30; // Default duration for old format
      let isEnhancedFlow = false;
      let isNewFlow = false; // New flow without contract address

      // Check new enhanced session format
      const session = this.getUserSession(ctx.from.id);
      if (session && session.flow === 'footer_payment') {
        if (session.contractAddress) {
          // Old enhanced flow with contract address
          contractAddress = session.contractAddress;
          durationDays = session.duration || 30;
          isEnhancedFlow = true;
        } else if (session.customLink && session.tickerSymbol) {
          // New flow without contract address requirement
          durationDays = session.duration || 30;
          isNewFlow = true;
        }
      }

      if (!contractAddress && !isNewFlow) {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      await ctx.reply('⏳ Validating your footer advertisement payment...');

      if (isNewFlow) {
        // New flow: validate payment without contract requirement, include chain
        const paymentChain = session.chain || 'ethereum';
        const paymentValidation = await this.secureTrending.validateFooterTransactionWithoutContract(txHash, session.customLink, userId, durationDays, session.tickerSymbol, paymentChain);

        if (!paymentValidation.success) {
          this.clearUserState(ctx.from.id);
          this.clearUserSession(ctx.from.id);
          return ctx.reply(`❌ Payment validation failed: ${paymentValidation.error}\n\nPlease ensure you sent the correct amount to the payment contract.`);
        }

        // Footer ad created successfully
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return ctx.reply(`✅ ${paymentValidation.message}`);
      } else {
        // Old flow: validate payment with contract requirement
        const paymentChain = session?.chain || 'ethereum';
        const paymentValidation = await this.secureTrending.validateFooterPayment(contractAddress, txHash, durationDays, paymentChain);

        if (!paymentValidation.success) {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return ctx.reply(`❌ Payment validation failed: ${paymentValidation.error}\n\nPlease ensure you sent the correct amount to the payment contract.`);
      }

      if (isEnhancedFlow) {
        // For enhanced flow, store transaction hash in session and ask for link
        session.txHash = txHash;
        this.setUserSession(ctx.from.id, session);
        this.setUserState(ctx.from.id, this.STATE_EXPECTING_FOOTER_LINK);

        // Use pre-formatted amount that already includes the correct symbol
        const amountText = session.amountFormatted || '0 ETH';

        return ctx.reply(`✅ <b>Payment Verified!</b>\n\n` +
          `🎨 Collection: <b>${session.tokenName}</b>\n` +
          `💰 Amount: ${amountText}\n` +
          `📅 Duration: <b>${durationDays} days</b>\n\n` +
          `🔗 <b>Custom Link</b>\n\nNow please send me the custom link you want to display in the footer ads.\n\n<i>Example: https://mytoken.com</i>`, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]])
        });
      } else {
        // For old flow, use old session storage method
        this.userStates.set(userId + '_footer_tx', txHash);
        this.userStates.set(userId + '_payment_validated', true);
        this.setUserState(ctx.from.id, this.STATE_EXPECTING_FOOTER_LINK);

        return ctx.reply('✅ <b>Payment Verified!</b>\n\n🔗 <b>Custom Link</b>\n\nNow please send me the custom link you want to display in the footer ads.\n\n<i>Example: https://mytoken.com</i>\n\n', {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]])
        });
        }
      }
    } catch (error) {
      logger.error('Error handling footer tx hash:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleFooterLink(ctx, customLink) {
    try {
      if (customLink.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showFooterMenu(ctx);
      }

      const userId = ctx.from.id.toString();

      // Check both old and new session formats
      let contractAddress = this.userStates.get(userId + '_footer_contract'); // Old format
      let txHash = this.userStates.get(userId + '_footer_tx'); // Old format
      let paymentValidated = this.userStates.get(userId + '_payment_validated'); // Old format
      let durationDays = 30; // Default for old format

      // Check new enhanced session format
      const session = this.getUserSession(ctx.from.id);
      if (session && session.flow === 'footer_payment' && session.contractAddress && session.txHash) {
        contractAddress = session.contractAddress;
        txHash = session.txHash;
        paymentValidated = true; // Enhanced flow only reaches here if payment was validated
        durationDays = session.duration || 30;
      }

      if (!contractAddress || !txHash || !paymentValidated) {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return ctx.reply('❌ Session expired or payment not validated. Please start again.');
      }

      // Validate URL format
      try {
        new URL(customLink);
      } catch (e) {
        return ctx.reply('❌ Invalid URL format. Please provide a valid URL (e.g., https://mytoken.com).', {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]])
        });
      }

      await ctx.reply('⏳ Creating your footer advertisement...');

      const user = await this.db.getUser(userId);
      const result = await this.secureTrending.finalizeFooterAd(contractAddress, txHash, customLink, user.id, durationDays);

      this.clearUserState(ctx.from.id);
      this.clearUserSession(ctx.from.id);
      this.userStates.delete(userId + '_footer_contract');
      this.userStates.delete(userId + '_footer_tx');
      this.userStates.delete(userId + '_payment_validated');

      if (result.success) {
        await ctx.replyWithHTML(`✅ ${result.message}`, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Footer Menu', 'menu_footer')]]));
      } else {
        await ctx.replyWithHTML(`❌ ${result.error}`, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Footer Menu', 'menu_footer')]]));
      }
    } catch (error) {
      logger.error('Error handling footer link:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleImageContract(ctx, contractAddress) {
    try {
      if (contractAddress.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showImagesMenu(ctx);
      }

      // Validate NFT address format - silently ignore invalid messages
      if (!contractAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return; // Silently ignore invalid messages instead of showing error
      }

      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Check if user has too many pending operations
      const pendingCount = await this.checkUserPendingOperations(user.id);
      if (pendingCount >= 5) {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ You have too many pending operations. Please complete or cancel existing operations before starting new ones.');
      }

      // Check if contract is already tracked, if not validate and add it
      ctx.reply('🔍 Validating NFT address...');

      let token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        // Contract not tracked yet, validate and add it
        const chatId = this.normalizeChatContext(ctx);
        const session = this.getUserSession(ctx.from.id);
        const chainName = session?.chain || this.userStates.get(ctx.from.id.toString() + '_selected_chain') || 'ethereum';
        const result = await this.tokenTracker.addToken(contractAddress, user.id, ctx.from.id.toString(), chatId, chainName);
        if (!result.success) {
          this.clearUserState(ctx.from.id);
          return ctx.reply(`❌ Contract validation failed: ${result.error}`);
        }
        // Get the newly added token
        token = await this.db.getTrackedToken(contractAddress);
      }

      // Check if image fee is already active
      const isActive = await this.secureTrending.isImageFeeActive(contractAddress);
      if (isActive) {
        return ctx.reply('✅ Image fee is already active for this contract. Actual NFT images are being displayed.', {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Image Spots Menu', 'menu_images')]])
        });
      }

      const instructions = await this.secureTrending.generateImagePaymentInstructions(contractAddress, user.id);
      const truncatedAddress = this.truncateAddress(instructions.contractAddress);

      const message = `💰 <b>Image Fee Payment Instructions</b>\n\n` +
        `🎨 Collection: <b>${instructions.tokenName}</b>\n` +
        `📮 Contract: <code>${instructions.tokenAddress}</code>\n` +
        `💸 Fee: <b>${instructions.feeEth} ${instructions.symbol}</b> (${instructions.duration} days)\n\n` +
        `🏦 <b>Payment Address (${truncatedAddress}):</b>\n\n` +
        `<code>${instructions.contractAddress}</code>\n\n` +
        `📋 <b>Payment Steps:</b>\n` +
        instructions.instructions.join('\n') + '\n\n';

      // Store NFT address for later validation
      this.userStates.set(ctx.from.id.toString() + '_image_contract', contractAddress);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📝 Submit Transaction Hash', 'submit_image_tx')],
        [Markup.button.callback('◀️ Back to Image Spots Menu', 'menu_images')]
      ]);

      await ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error handling image contract:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleImageTxHash(ctx, txHash) {
    try {
      if (txHash.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showImagesMenu(ctx);
      }

      // Validate transaction hash format
      if (!txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
        return ctx.reply('❌ Invalid transaction hash format. Please send a valid transaction hash (starts with 0x and is 64 characters long).', {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_images')]])
        });
      }

      const userId = ctx.from.id.toString();

      // Check both old and new session formats
      let contractAddress = this.userStates.get(userId + '_image_contract'); // Old format
      let durationDays = 30; // Default duration for old format

      // Check new enhanced session format
      const session = this.getUserSession(ctx.from.id);
      if (session && session.flow === 'image_payment' && session.contractAddress) {
        contractAddress = session.contractAddress;
        durationDays = session.duration || 30;
      }

      if (!contractAddress) {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      await ctx.reply('⏳ Validating your image fee transaction...');

      const user = await this.db.getUser(userId);
      const chain = session.chain || 'ethereum';
      const result = await this.secureTrending.validateImageFeeTransaction(user.id, contractAddress, txHash, durationDays, chain);

      this.clearUserState(ctx.from.id);
      this.clearUserSession(ctx.from.id);
      this.userStates.delete(userId + '_image_contract');

      if (result.success) {
        const symbol = result.symbol || 'ETH';
        const successMessage = `✅ <b>Image Fee Payment Validated!</b>\n\n` +
          `🎨 Collection: <b>${result.tokenName}</b>\n` +
          `📮 Contract: <code>${result.contractAddress}</code>\n` +
          `💰 Amount: ${result.amountEth} ${symbol}\n` +
          `📅 Duration: <b>${durationDays} days</b>\n` +
          `📝 Transaction: <code>${result.txHash}</code>\n` +
          `👤 Payer: <code>${result.payer}</code>\n\n` +
          `🖼️ <b>Actual NFT images will now be displayed for this contract for ${durationDays} days!</b>`;

        await ctx.replyWithHTML(successMessage, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Image Spots Menu', 'menu_images')]]));
      } else {
        await ctx.reply(`❌ Validation failed: ${result.error}`, {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Image Spots Menu', 'menu_images')]])
        });
      }
    } catch (error) {
      logger.error('Error handling image tx hash:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleValidationContract(ctx, contractAddress) {
    try {
      if (contractAddress.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showVerifyMenu(ctx);
      }

      // Validate NFT address format - silently ignore invalid messages
      if (!contractAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return; // Silently ignore invalid messages instead of showing error
      }

      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Check if contract is already tracked, if not validate and add it
      ctx.reply('🔍 Validating NFT address...');

      let token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        // Contract not tracked yet, validate and add it
        const chatId = this.normalizeChatContext(ctx);
        const result = await this.tokenTracker.addToken(contractAddress, user.id, ctx.from.id.toString(), chatId);
        if (!result.success) {
          this.clearUserState(ctx.from.id);
          return ctx.reply(`❌ Contract validation failed: ${result.error}`);
        }
        // Get the newly added token
        token = await this.db.getTrackedToken(contractAddress);
      }

      const userId = ctx.from.id.toString();
      const validationType = this.userStates.get(userId + '_validation_type');

      // Store NFT address and move to next step
      this.userStates.set(userId + '_validation_contract', contractAddress);
      this.setUserState(ctx.from.id, this.STATE_EXPECTING_VALIDATION_TX_HASH);

      const message = `📝 <b>Transaction Hash Required</b>\n\nNow please send me the transaction hash for your ${validationType} payment.\n\n<i>Example: 0xabc123456789def...</i>`;
      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Payments', 'cancel_verify')]]);
      return ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error handling validation contract:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleValidationTxHash(ctx, txHash) {
    try {
      if (txHash.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showVerifyMenu(ctx);
      }

      // Validate transaction hash format
      if (!txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
        return ctx.reply('❌ Invalid transaction hash format. Please send a valid transaction hash (starts with 0x and is 64 characters long).', {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_verify')]])
        });
      }

      const telegramId = ctx.from.id.toString();
      const validationType = this.userStates.get(telegramId + '_validation_type');
      const contractAddress = this.userStates.get(telegramId + '_validation_contract');
      const validationChain = this.userStates.get(telegramId + '_validation_chain') || 'ethereum';
      const tokenId = this.userStates.get(telegramId + '_validation_token_id');

      if (validationType === 'trending') {
        // For trending, we can validate immediately with chain information
        await ctx.reply('🔍 Validating your transaction... Please wait.');

        // Get database user ID
        const user = await this.db.getUser(telegramId);
        if (!user) {
          await ctx.reply('❌ User not found. Please use /start first.');
          return;
        }

        const result = await this.secureTrending.validateUserTransaction(user.id, txHash, validationChain, tokenId);

        this.clearUserState(ctx.from.id);
        this.userStates.delete(telegramId + '_validation_type');
        this.userStates.delete(telegramId + '_validation_chain');
        this.userStates.delete(telegramId + '_validation_token_id');

        if (result.success) {
          const chain = result.chain || 'ethereum';
          const symbol = this.secureTrending.getChainConfig(chain).symbol;
          const successMessage = `✅ **Payment Validated Successfully!**\n\n` +
            `🎯 **${result.tokenName}** trending activated!\n` +
            `⏱️ Duration: ${result.duration} hours\n` +
            `💰 Amount: ${result.amountEth} ${symbol}\n` +
            `🔗 TX: \`${txHash}\`\n\n` +
            `Your NFT is now trending! 🚀`;

          await ctx.replyWithMarkdown(successMessage, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]));
        } else {
          await ctx.reply(`❌ **Validation Failed**\n\n${result.error}`, {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]])
          });
        }
      } else if (validationType === 'image') {
        // For image validation, use contract + tx hash
        if (!contractAddress) {
          this.clearUserState(ctx.from.id);
          return ctx.reply('❌ Session expired. Please start again.');
        }

        await ctx.reply('⏳ Validating your image fee transaction...');

        const user = await this.db.getUser(userId);
        const result = await this.secureTrending.validateImageFeeTransaction(user.id, contractAddress, txHash, null, validationChain);

        this.clearUserState(ctx.from.id);
        this.userStates.delete(userId + '_validation_type');
        this.userStates.delete(userId + '_validation_contract');
        this.userStates.delete(userId + '_validation_chain');
        this.userStates.delete(userId + '_validation_token_id');

        if (result.success) {
          const symbol = result.symbol || 'ETH';
          const successMessage = `✅ <b>Image Fee Payment Validated!</b>\n\n` +
            `🎨 Collection: <b>${result.tokenName}</b>\n` +
            `📮 Contract: <code>${result.contractAddress}</code>\n` +
            `💰 Amount: ${result.amountEth} ${symbol}\n` +
            `📝 Transaction: <code>${result.txHash}</code>\n` +
            `👤 Payer: <code>${result.payer}</code>\n\n` +
            `🖼️ <b>Actual NFT images will now be displayed for this contract for 30 days!</b>`;

          await ctx.replyWithHTML(successMessage, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]));
        } else {
          await ctx.reply(`❌ Validation failed: ${result.error}`, {
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]])
          });
        }
      } else if (validationType === 'footer') {
        // For footer validation, use ticker-based verification
        const ticker = this.userStates.get(userId + '_validation_ticker');
        if (!ticker) {
          this.clearUserState(ctx.from.id);
          return ctx.reply('❌ Session expired. Please start again.');
        }

        await ctx.reply('⏳ Validating your footer advertisement payment...');

        // Use ticker-based validation without contract requirement
        // For ticker-based verification, we'll let the service determine chain from transaction
        const result = await this.secureTrending.validateFooterTransactionByTicker(txHash, ticker, userId);

        this.clearUserState(ctx.from.id);
        this.userStates.delete(userId + '_validation_type');
        this.userStates.delete(userId + '_validation_ticker');

        if (result.success) {
          const symbol = result.symbol || 'ETH';
          await ctx.replyWithHTML(`✅ <b>Footer Payment Validated!</b>\n\n🔗 <b>Ticker:</b> ${ticker}\n💰 <b>Amount:</b> ${result.amountEth || 'N/A'} ${symbol}\n📝 <b>Transaction:</b> <code>${txHash}</code>\n\n📢 Your footer advertisement is now active!`,
            Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]));
        } else {
          await ctx.replyWithHTML(`❌ Footer validation failed: ${result.error}`,
            Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]));
        }
      }
    } catch (error) {
      logger.error('Error handling validation tx hash:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleValidationLink(ctx, customLink) {
    try {
      if (customLink.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showVerifyMenu(ctx);
      }

      const userId = ctx.from.id.toString();
      const contractAddress = this.userStates.get(userId + '_validation_contract');
      const txHash = this.userStates.get(userId + '_validation_tx');

      if (!contractAddress || !txHash) {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      await ctx.reply('⏳ Validating your footer advertisement transaction...');

      const user = await this.db.getUser(userId);
      const validationChain = this.userStates.get(userId + '_validation_chain') || 'ethereum';
      const result = await this.secureTrending.validateFooterTransaction(contractAddress, txHash, customLink, user.id, null, null, validationChain);

      this.clearUserState(ctx.from.id);
      this.userStates.delete(userId + '_validation_type');
      this.userStates.delete(userId + '_validation_contract');
      this.userStates.delete(userId + '_validation_tx');
      this.userStates.delete(userId + '_validation_chain');

      if (result.success) {
        await ctx.replyWithHTML(`✅ ${result.message}`, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]));
      } else {
        await ctx.replyWithHTML(`❌ ${result.error}`, Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]));
      }
    } catch (error) {
      logger.error('Error handling validation link:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleValidationTicker(ctx, ticker) {
    try {
      if (ticker.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        return this.showVerifyMenu(ctx);
      }

      // Clean and validate ticker format (should be $SYMBOL format)
      let cleanTicker = ticker.trim().toUpperCase();

      // Add $ prefix if not present
      if (!cleanTicker.startsWith('$')) {
        cleanTicker = '$' + cleanTicker;
      }

      // Validate ticker format: $SYMBOL (2-10 characters after $)
      if (!cleanTicker.match(/^\$[A-Z0-9]{2,10}$/)) {
        return ctx.reply('❌ Invalid ticker format. Please enter a valid ticker symbol.\n\n<i>Examples: $PEPE, $BAYC, $AZUKI</i>\n\n💡 Use the same ticker you used when creating your footer ad.', {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_verify')]])
        });
      }

      const userId = ctx.from.id.toString();
      this.userStates.set(userId + '_validation_ticker', cleanTicker);
      this.setUserState(ctx.from.id, this.STATE_EXPECTING_VALIDATION_TX_HASH);

      const message = `📝 <b>Submit Transaction Hash</b>\n\n` +
        `🔗 <b>Footer Ticker:</b> ${cleanTicker}\n\n` +
        `Please send me your transaction hash for the footer payment.\n\n` +
        `<i>Example: 0xabc123456789def...</i>`;

      const keyboard = Markup.inlineKeyboard([[Markup.button.callback('◀️ Back to Verify Menu', 'menu_verify')]]);
      return ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error handling validation ticker:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  // Helper method to check user's pending operations for rate limiting
  async checkUserPendingOperations(userId) {
    try {
      // Count active user states that indicate pending operations
      let pendingCount = 0;

      for (let key of this.userStates.keys()) {
        if (key.startsWith(userId + '_')) {
          pendingCount++;
        }
      }

      // Also check database for pending payments
      const pendingPayments = await this.db.get(
        'SELECT COUNT(*) as count FROM pending_payments WHERE user_id = $1 AND is_matched = false AND expires_at > NOW()',
        [userId]
      );

      return pendingCount + (pendingPayments?.count || 0);
    } catch (error) {
      logger.error('Error checking user pending operations:', error);
      return 0; // On error, don't block user
    }
  }

  // Helper method to show tokens from all chains
  async showTokensForAllChains(ctx) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      const chatId = this.normalizeChatContext(ctx);
      const tokens = await this.db.getUserTrackedTokens(user.id, chatId);

      if (tokens.length === 0) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Your First NFT', 'add_token_start')]
        ]);
        return ctx.reply('🔍 You haven\'t added any tokens yet!\n\nUse /add_token to start tracking NFT collections.', keyboard);
      }

      // Group tokens by chain
      const tokensByChain = {};
      tokens.forEach(token => {
        const chainName = token.chain_name || 'ethereum';
        if (!tokensByChain[chainName]) {
          tokensByChain[chainName] = [];
        }
        tokensByChain[chainName].push(token);
      });

      let message = `🎯 <b>Your Tracked NFTs</b> (${tokens.length} total)\n\n`;
      const keyboard = [];

      for (const [chainName, chainTokens] of Object.entries(tokensByChain)) {
        const chainConfig = this.chainManager ? this.chainManager.getChain(chainName) : null;
        // Use custom emoji if available
        const chainEmoji = this.chainManager ? this.chainManager.getChainEmoji(chainName) : '🔗';
        const chainDisplay = chainConfig ? `${chainEmoji} ${chainConfig.displayName}` : chainName;

        message += `🔗 <b>${chainDisplay}</b> (${chainTokens.length})\n`;

        chainTokens.forEach((token, index) => {
          message += `   ${index + 1}. <b>${token.token_name || 'Unknown'}</b> (${token.token_symbol || 'N/A'})\n`;
          message += `      📮 <code>${token.contract_address}</code>\n`;
          message += `      🟢 Status: Active\n`;

          // Show tracking status
          if (token.collection_slug || token.chain_name === 'solana' || token.chain_name === 'bitcoin') {
            message += `      📊 Tracking: ✅ Active\n`;
          }
          message += '\n';

          keyboard.push([
            Markup.button.callback(
              `🗑️ Remove ${token.token_name || token.contract_address.slice(0, 8)}...`,
              `remove_${token.id}`
            )
          ]);
        });
        message += '\n';
      }

      keyboard.push([Markup.button.callback('➕ Add More NFTs', 'add_token_start')]);

      await ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error showing tokens for all chains:', error);
      ctx.reply('❌ Error retrieving your NFTs. Please try again.');
    }
  }

  // Helper method to show tokens from a specific chain
  async showTokensForChain(ctx, chainName, chainConfig) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      const chatId = this.normalizeChatContext(ctx);
      const allTokens = await this.db.getUserTrackedTokens(user.id, chatId);
      const chainTokens = allTokens.filter(token => (token.chain_name || 'ethereum') === chainName);

      if (chainTokens.length === 0) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add NFT on This Chain', 'add_token_start')],
          [Markup.button.callback('🌐 View All Chains', 'chain_select_all')]
        ]);
        return ctx.reply(
          `🔍 <b>No NFTs found on ${chainConfig.displayName}</b>\n\nAdd some NFTs to start tracking on this blockchain!`,
          { parse_mode: 'HTML', reply_markup: keyboard }
        );
      }

      const chainDisplay = `${chainConfig.emoji} ${chainConfig.displayName}`;
      let message = `🎯 <b>Your ${chainDisplay} Tokens</b> (${chainTokens.length})\n\n`;
      const keyboard = [];

      chainTokens.forEach((token, index) => {
        message += `${index + 1}. <b>${token.token_name || 'Unknown'}</b> (${token.token_symbol || 'N/A'})\n`;
        message += `   📮 <code>${token.contract_address}</code>\n`;
        message += `   🟢 Status: Active\n`;

        // Show tracking status
        if (token.collection_slug || token.chain_name === 'solana' || token.chain_name === 'bitcoin') {
          message += `   📊 Tracking: ✅ Active\n`;
        }
        message += '\n';

        keyboard.push([
          Markup.button.callback(
            `🗑️ Remove ${token.token_name || token.contract_address.slice(0, 8)}...`,
            `remove_${token.id}`
          )
        ]);
      });

      keyboard.push([
        Markup.button.callback('➕ Add More NFTs', 'add_token_start'),
        Markup.button.callback('🌐 All Chains', 'chain_select_all')
      ]);

      await ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      logger.error('Error showing tokens for chain:', error);
      ctx.reply('❌ Error retrieving your NFTs. Please try again.');
    }
  }

  // Duration selection methods for enhanced payment flow
  async showImageDurationSelection(ctx) {
    try {
      const message = `🎨 <b>Image Fee - Select Duration</b>\n\n` +
        `Choose how long you want NFT images displayed instead of the CandyCodex image:\n\n` +
        `🔹 <b>30 days</b>\n` +
        `🔹 <b>60 days</b>\n` +
        `🔹 <b>90 days</b>\n` +
        `🔹 <b>180 days</b>\n` +
        `🔹 <b>365 days</b>\n\n` +
        `✨ Longer durations offer better value per day!\n` +
        `💡 Pricing will be shown after chain selection.`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('30 days', 'image_duration_30'),
          Markup.button.callback('60 days', 'image_duration_60')
        ],
        [
          Markup.button.callback('90 days', 'image_duration_90'),
          Markup.button.callback('180 days', 'image_duration_180')
        ],
        [
          Markup.button.callback('365 days', 'image_duration_365')
        ],
        [
          Markup.button.callback('◀️ Back to Image Spots Menu', 'menu_images')
        ]
      ]);

      // Set user state and initialize session
      this.setUserState(ctx.from.id, this.STATE_IMAGE_DURATION_SELECT);
      this.setUserSession(ctx.from.id, { flow: 'image_payment' });

      try {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        });
      } catch (error) {
        await ctx.replyWithHTML(message, keyboard);
      }
    } catch (error) {
      logger.error('Error showing image duration selection:', error);
      ctx.reply('❌ Error showing duration options. Please try again.');
    }
  }

  async showFooterDurationSelection(ctx) {
    try {
      // Get session to determine selected chain
      const session = this.getUserSession(ctx.from.id);
      const selectedChain = session?.chain || 'ethereum';

      // Get dynamic footer prices from secureTrendingService
      const chainNormalized = this.secureTrending.normalizeChainName(selectedChain);
      const footerOptions = this.secureTrending.getFooterFeeOptions(chainNormalized);

      const fees = {};
      footerOptions.forEach(option => {
        fees[option.duration] = option.feeFormatted;
      });

      const chainConfig = this.secureTrending.getChainConfig(chainNormalized);
      const currencySymbol = chainConfig.symbol;

      // Chain emojis for display
      const chainEmojis = {
        'ethereum': '⟠', 'bitcoin': '₿', 'solana': '◎', 'bsc': '💎',
        'arbitrum': '🔷', 'optimism': '🔴', 'hyperevm': '⚡', 'berachain': '🐻',
        'avalanche': '🔺', 'cronos': '💠', 'moonbeam': '🌙', 'zksync': '⚡',
        'base': '🔵', 'sei': '🌊', 'apechain': '🦍', 'abstract': '🎨', 'ronin': '⚔️'
      };
      const chainEmoji = chainEmojis[chainNormalized] || '🔗';

      const message = `📢 <b>Footer Advertisement - Select Duration</b>\n\n` +
        `${chainEmoji} <b>Chain:</b> ${selectedChain.charAt(0).toUpperCase() + selectedChain.slice(1)}\n\n` +
        `Choose how long your footer ad will be displayed:\n\n` +
        `🔹 <b>30 days</b> - ${fees[30]} ${currencySymbol}\n` +
        `🔹 <b>60 days</b> - ${fees[60]} ${currencySymbol}\n` +
        `🔹 <b>90 days</b> - ${fees[90]} ${currencySymbol}\n` +
        `🔹 <b>180 days</b> - ${fees[180]} ${currencySymbol}\n` +
        `🔹 <b>365 days</b> - ${fees[365]} ${currencySymbol}\n\n` +
        `💡 Your ad will appear at the bottom of all token notifications!`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`30 days - ${fees[30]} ${currencySymbol}`, 'footer_duration_30'),
          Markup.button.callback(`60 days - ${fees[60]} ${currencySymbol}`, 'footer_duration_60')
        ],
        [
          Markup.button.callback(`90 days - ${fees[90]} ${currencySymbol}`, 'footer_duration_90'),
          Markup.button.callback(`180 days - ${fees[180]} ${currencySymbol}`, 'footer_duration_180')
        ],
        [
          Markup.button.callback(`365 days - ${fees[365]} ${currencySymbol}`, 'footer_duration_365')
        ],
        [
          Markup.button.callback('◀️ Back to Footer Menu', 'menu_footer')
        ]
      ]);

      // Set user state (preserve existing session with chain)
      this.setUserState(ctx.from.id, this.STATE_FOOTER_DURATION_SELECT);

      await this.sendOrEditMenu(ctx, message, keyboard);
    } catch (error) {
      logger.error('Error showing footer duration selection:', error);
      ctx.reply('❌ Error showing duration options. Please try again.');
    }
  }

  async showChainSelection(ctx, paymentType) {
    try {
      const session = this.getUserSession(ctx.from.id);

      // For footer ads, we select chain FIRST (no session needed yet)
      // For image fees, we select chain AFTER duration (session required)
      if (paymentType === 'image' && !session) {
        return ctx.reply('❌ Session expired. Please try again.');
      }

      let message;
      if (paymentType === 'image') {
        const durationText = `${session.duration} days`;

        message = `🎨 <b>Image Fee Payment - Select Chain</b>\n\n` +
          `📅 Duration: <b>${durationText}</b>\n\n` +
          `🔗 Select the blockchain network:\n` +
          `💡 Pricing varies by chain and will be shown on the payment screen.`;
      } else {
        // Footer ads - chain selection comes first
        message = `📢 <b>Footer Ad Payment - Select Chain</b>\n\n` +
          `🔗 Select the blockchain network for your footer ad payment:\n\n` +
          `💡 Duration and pricing will be shown on the next step.`;
      }

      // Build chain options from chainManager - all chains with payment contracts
      const chainOptions = [];

      if (this.chainManager) {
        const supportedChains = this.chainManager.getChainsForPayments();
        supportedChains.forEach(chain => {
          // For image payments, show the price in the button
          if (paymentType === 'image' && session?.duration) {
            const fee = this.secureTrending.calculateImageFee(session.duration, chain.name);
            const chainNormalized = this.secureTrending.normalizeChainName(chain.name);
            const feeFormatted = this.secureTrending.formatChainAmount(fee, chainNormalized);
            const chainConfig = this.secureTrending.getChainConfig(chainNormalized);
            chainOptions.push([Markup.button.callback(`${chain.emoji} ${chain.displayName} - ${feeFormatted} ${chainConfig.symbol}`, `chain_${paymentType}_${chain.name}`)]);
          } else {
            chainOptions.push([Markup.button.callback(`${chain.emoji} ${chain.displayName}`, `chain_${paymentType}_${chain.name}`)]);
          }
        });
      } else {
        // Fallback if chainManager not available
        chainOptions.push([Markup.button.callback('🔷 Ethereum', `chain_${paymentType}_ethereum`)]);
      }

      // Navigation buttons
      const backButtonText = paymentType === 'image' ? '◀️ Back to Duration Selection' : '◀️ Back to Footer Menu';
      const backButtonCallback = paymentType === 'image' ? 'buy_image_menu' : 'menu_footer';
      chainOptions.push([
        Markup.button.callback(backButtonText, backButtonCallback),
        Markup.button.callback('🏠 Main Menu', 'main_menu')
      ]);

      const keyboard = Markup.inlineKeyboard(chainOptions);

      // Update state
      const stateKey = paymentType === 'image' ? this.STATE_IMAGE_CHAIN_SELECT : this.STATE_FOOTER_CHAIN_SELECT;
      this.setUserState(ctx.from.id, stateKey);

      await this.sendOrEditMenu(ctx, message, keyboard);
    } catch (error) {
      logger.error('Error showing chain selection:', error);
      ctx.reply('❌ Error showing chain selection. Please try again.');
    }
  }

  async showContractInput(ctx, paymentType) {
    try {
      const session = this.getUserSession(ctx.from.id);
      if (!session) {
        return ctx.reply('❌ Session expired. Please try again.');
      }

      const durationText = `${session.duration} days`;
      // Use pre-formatted amount that already includes the correct symbol
      const amountText = session.amountFormatted || 'N/A';
      const chainText = session.chain || 'Unknown';

      const message = paymentType === 'image' ?
        `🎨 <b>Image Fee Payment - Enter Contract</b>\n\n` +
        `📅 Duration: <b>${durationText}</b>\n` +
        `💰 Amount: <b>${amountText}</b>\n` +
        `🔗 Chain: <b>${chainText.charAt(0).toUpperCase() + chainText.slice(1)}</b>\n\n` +
        `📝 Please enter the NFT address:\n\n` +
        `<i>Example: 0x1234567890abcdef...</i>` :
        `📢 <b>Footer Ad Payment - Enter Contract</b>\n\n` +
        `📅 Duration: <b>${durationText}</b>\n` +
        `💰 Amount: <b>${amountText}</b>\n` +
        `🔗 Chain: <b>${chainText.charAt(0).toUpperCase() + chainText.slice(1)}</b>\n\n` +
        `📝 Please enter the NFT address:\n\n` +
        `<i>Example: 0x1234567890abcdef...</i>`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('◀️ Back to Chain Selection', paymentType === 'image' ? 'back_to_chain_image' : 'back_to_chain_footer')
        ],
        [
          Markup.button.callback('❌ Cancel', paymentType === 'image' ? 'cancel_images' : 'cancel_footer'),
          Markup.button.callback('🏠 Main Menu', 'main_menu')
        ]
      ]);

      // Update state to expect contract input
      const stateKey = paymentType === 'image' ? this.STATE_IMAGE_CONTRACT_INPUT : this.STATE_FOOTER_CONTRACT_INPUT;
      this.setUserState(ctx.from.id, stateKey);

      await this.sendOrEditMenu(ctx, message, keyboard);
    } catch (error) {
      logger.error('Error showing contract input:', error);
      ctx.reply('❌ Error showing contract input. Please try again.');
    }
  }

  async handleEnhancedImageContract(ctx, contractAddress) {
    try {
      if (contractAddress.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return this.showImagesMenu(ctx);
      }

      // Validate NFT address format - silently ignore invalid messages
      if (!contractAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return; // Silently ignore invalid messages instead of showing error
      }

      const session = this.getUserSession(ctx.from.id);
      if (!session || session.flow !== 'image_payment') {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Validate and track contract if needed
      ctx.reply('🔍 Validating NFT address...');

      let token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        const chatId = this.normalizeChatContext(ctx);
        const result = await this.tokenTracker.addToken(contractAddress, user.id, ctx.from.id.toString(), chatId);
        if (!result.success) {
          this.clearUserState(ctx.from.id);
          this.clearUserSession(ctx.from.id);
          return ctx.reply(`❌ Contract validation failed: ${result.error}`);
        }
        token = await this.db.getTrackedToken(contractAddress);
      }

      // Store contract in session and generate payment instructions
      session.contractAddress = contractAddress;
      session.tokenName = token.token_name;
      this.setUserSession(ctx.from.id, session);

      const chain = session.chain || 'ethereum';
      const durationText = `${session.duration} days`;

      const instructions = await this.secureTrending.generateImagePaymentInstructions(contractAddress, user.id, session.duration, chain);
      const truncatedAddress = this.truncateAddress(instructions.contractAddress);

      const message = `🎨 <b>Image Fee Payment Instructions</b>\n\n` +
        `🎨 Collection: <b>${instructions.tokenName}</b>\n` +
        `📮 Contract: <code>${instructions.tokenAddress}</code>\n` +
        `📅 Duration: <b>${durationText}</b>\n` +
        `💸 Fee: <b>${instructions.feeEth} ${instructions.symbol}</b>\n\n` +
        `🏦 <b>Payment Address (${truncatedAddress}):</b>\n\n` +
        `<code>${instructions.contractAddress}</code>\n\n` +
        `📋 <b>Payment Steps:</b>\n` +
        instructions.instructions.join('\n') + '\n\n' +
        `After making the payment, click the button below to submit your transaction hash.`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📝 Submit Transaction Hash', 'submit_enhanced_image_tx')
        ],
        [
          Markup.button.callback('◀️ Back to Contract Input', 'back_to_contract_image'),
          Markup.button.callback('❌ Cancel', 'cancel_images')
        ]
      ]);

      await ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error handling enhanced image contract:', error);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async showLinkInput(ctx) {
    try {
      const session = this.getUserSession(ctx.from.id);
      const chainText = session?.chain ? `🔗 Chain: <b>${session.chain.charAt(0).toUpperCase() + session.chain.slice(1)}</b>\n\n` : '';

      const message = `🔗 <b>Footer Advertisement - Custom Link</b>\n\n` +
        chainText +
        `Please send me the custom link you want users to visit when they click your footer ad.\n\n` +
        `<i>Example: https://mytoken.com or https://twitter.com/myproject</i>`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Back to Chain Selection', 'back_to_chain_footer')],
        [
          Markup.button.callback('❌ Cancel', 'cancel_footer'),
          Markup.button.callback('🏠 Main Menu', 'main_menu')
        ]
      ]);

      this.setUserState(ctx.from.id, this.STATE_FOOTER_LINK_INPUT);
      await this.sendOrEditMenu(ctx, message, keyboard);
    } catch (error) {
      logger.error('Error showing link input:', error);
      ctx.reply('❌ Error showing link input. Please try again.');
    }
  }

  async showTickerInput(ctx) {
    try {
      const message = `💰 <b>Footer Advertisement - Ticker Symbol</b>\n\n` +
        `Please send me the ticker symbol you want to display in the footer.\n\n` +
        `<i>Examples: $CANDY, $PEPE, $MYTOKEN</i>\n\n` +
        `⭐️ Your ticker will appear as: <b>⭐️$YOURTICKER</b>`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Back to Link Input', 'back_to_link_footer')],
        [
          Markup.button.callback('❌ Cancel', 'cancel_footer'),
          Markup.button.callback('🏠 Main Menu', 'main_menu')
        ]
      ]);

      this.setUserState(ctx.from.id, this.STATE_FOOTER_TICKER_INPUT);
      await this.sendOrEditMenu(ctx, message, keyboard);
    } catch (error) {
      logger.error('Error showing ticker input:', error);
      ctx.reply('❌ Error showing ticker input. Please try again.');
    }
  }

  async handleFooterLinkInput(ctx, customLink) {
    try {
      if (customLink.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return this.showFooterMenu(ctx);
      }

      // Validate URL format
      try {
        new URL(customLink);
      } catch (e) {
        return ctx.reply('❌ Invalid URL format. Please provide a valid URL starting with http:// or https://.\n\n<i>Example: https://mytoken.com</i>', {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]])
        });
      }

      const session = this.getUserSession(ctx.from.id);
      if (!session || session.flow !== 'footer_payment') {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      // Store link in session and proceed to ticker input
      session.customLink = customLink;
      this.setUserSession(ctx.from.id, session);

      return this.showTickerInput(ctx);
    } catch (error) {
      logger.error('Error handling footer link input:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleFooterTickerInput(ctx, tickerInput) {
    try {
      if (tickerInput.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return this.showFooterMenu(ctx);
      }

      // Clean up ticker input (remove extra $, spaces, etc.)
      let ticker = tickerInput.trim().toUpperCase();
      if (!ticker.startsWith('$')) {
        ticker = '$' + ticker;
      }

      // Validate ticker format
      if (!ticker.match(/^\$[A-Z0-9]{1,10}$/)) {
        return ctx.reply('❌ Invalid ticker format. Please use only letters and numbers, max 10 characters. <b>No spaces allowed.</b>\n\n<i>Examples: $CANDY, $PEPE, $MYTOKEN</i>', {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_footer')]])
        });
      }

      const session = this.getUserSession(ctx.from.id);
      if (!session || session.flow !== 'footer_payment') {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      // Store ticker in session and proceed directly to payment instructions
      session.tickerSymbol = ticker;
      this.setUserSession(ctx.from.id, session);

      return this.showFooterPaymentInstructions(ctx);
    } catch (error) {
      logger.error('Error handling footer ticker input:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async handleEnhancedFooterContract(ctx, contractAddress) {
    try {
      if (contractAddress.toLowerCase() === 'cancel') {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return this.showFooterMenu(ctx);
      }

      // Validate NFT address format - silently ignore invalid messages
      if (!contractAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return; // Silently ignore invalid messages instead of showing error
      }

      const session = this.getUserSession(ctx.from.id);
      if (!session || session.flow !== 'footer_payment') {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startminty');
      }

      // Validate and track contract if needed
      ctx.reply('🔍 Validating NFT address...');

      let token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        const chatId = this.normalizeChatContext(ctx);
        const result = await this.tokenTracker.addToken(contractAddress, user.id, ctx.from.id.toString(), chatId);
        if (!result.success) {
          this.clearUserState(ctx.from.id);
          this.clearUserSession(ctx.from.id);
          return ctx.reply(`❌ Contract validation failed: ${result.error}`);
        }
        token = await this.db.getTrackedToken(contractAddress);
      }

      // Store contract in session and generate payment instructions
      session.contractAddress = contractAddress;
      session.tokenName = token.token_name;
      this.setUserSession(ctx.from.id, session);

      const chain = session.chain || 'ethereum';
      const durationText = `${session.duration} days`;

      const instructions = await this.secureTrending.generateFooterPaymentInstructions(contractAddress, user.id, session.duration, chain);
      const truncatedAddress = this.truncateAddress(instructions.contractAddress);

      const message = `📢 <b>Footer Advertisement Payment Instructions</b>\n\n` +
        `🎨 Collection: <b>${instructions.tokenName}</b>\n` +
        `📮 Contract: <code>${instructions.tokenAddress}</code>\n` +
        `🔗 Custom Link: ${session.customLink}\n` +
        `⭐️ Ticker: <b>${session.tickerSymbol}</b>\n` +
        `📅 Duration: <b>${durationText}</b>\n` +
        `💸 Fee: <b>${instructions.feeEth} ${instructions.symbol}</b>\n\n` +
        `🏦 <b>Payment Address (${truncatedAddress}):</b>\n\n` +
        `<code>${instructions.contractAddress}</code>\n\n` +
        `📋 <b>Payment Steps:</b>\n` +
        instructions.instructions.join('\n') + '\n\n' +
        `After making the payment, click the button below to submit your transaction hash.`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📝 Submit Transaction Hash', 'submit_enhanced_footer_tx')
        ],
        [
          Markup.button.callback('◀️ Back to Contract Input', 'back_to_contract_footer'),
          Markup.button.callback('❌ Cancel', 'cancel_footer')
        ]
      ]);

      await ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error handling enhanced footer contract:', error);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

  async showFooterPaymentInstructions(ctx) {
    try {
      const session = this.getUserSession(ctx.from.id);
      if (!session || session.flow !== 'footer_payment') {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ Session expired. Please start again.');
      }

      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        this.clearUserState(ctx.from.id);
        this.clearUserSession(ctx.from.id);
        return ctx.reply('❌ Please register first using /start');
      }

      const durationText = `${session.duration} days`;
      // Use pre-formatted amount that handles all chain types (Solana lamports, Bitcoin sats, EVM wei)
      // session.amountFormatted already includes the symbol (e.g., "479.4 SOL")
      const amountText = session.amountFormatted || '0 ETH';

      // Get chain-specific configuration
      const chainConfig = session?.chain && this.chainManager ? this.chainManager.getChain(session.chain) : null;
      const paymentContract = chainConfig ? chainConfig.paymentContract : this.secureTrending.simplePaymentContract;
      const chainDisplay = chainConfig ? chainConfig.displayName : 'Ethereum';
      const chainEmoji = chainConfig ? chainConfig.emoji : '🔷';
      const truncatedAddress = this.truncateAddress(paymentContract);

      const message = `📢 <b>Footer Advertisement Payment Instructions</b>\n\n` +
        `🔗 Custom Link: ${session.customLink}\n` +
        `⭐️ Ticker: <b>${session.tickerSymbol}</b>\n` +
        `📅 Duration: <b>${durationText}</b>\n` +
        `💸 Fee: <b>${amountText}</b>\n` +
        `${chainEmoji} Chain: <b>${chainDisplay}</b>\n\n` +
        `🏦 <b>Payment Address (${truncatedAddress}):</b>\n\n` +
        `<code>${paymentContract}</code>\n\n` +
        `📋 <b>Payment Steps:</b>\n` +
        `1. <b>SEND EXACTLY ${amountText}</b> to the payment address above\n` +
        `2. Use any ${chainDisplay} wallet on ${chainDisplay.toLowerCase()} network\n` +
        `3. Tap the address above to copy it\n` +
        `4. Wait for transaction confirmation\n` +
        `5. Submit your transaction hash below\n\n` +
        `After making the payment, click the button below to submit your transaction hash.`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📝 Submit Transaction Hash', 'submit_enhanced_footer_tx')
        ],
        [
          Markup.button.callback('◀️ Back to Ticker Input', 'back_to_ticker_footer'),
          Markup.button.callback('❌ Cancel', 'cancel_footer')
        ]
      ]);

      await ctx.replyWithHTML(message, keyboard);
    } catch (error) {
      logger.error('Error showing footer payment instructions:', error);
      ctx.reply('❌ An error occurred. Please try again.');
    }
  }

}

module.exports = BotCommands;
