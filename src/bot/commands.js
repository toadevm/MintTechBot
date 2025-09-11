const { Markup } = require('telegraf');
const logger = require('../services/logger');
const { ethers } = require('ethers');

class BotCommands {
  constructor(database, alchemyService, tokenTracker, trendingService, channelService) {
    this.db = database;
    this.alchemy = alchemyService;
    this.tokenTracker = tokenTracker;
    this.trending = trendingService;
    this.channels = channelService;

    this.userStates = new Map();
    this.STATE_EXPECTING_CONTRACT = 'expecting_contract';
    this.STATE_EXPECTING_TX_HASH = 'expecting_tx_hash';

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

  async setupCommands(bot) {

    bot.command('startcandy', async (ctx) => {
      const user = ctx.from;

      await this.db.createUser(user.id.toString(), user.username, user.first_name);
      const welcomeMessage = `🚀 <b>Welcome to MintTechBot!</b> 🚀

I help you track NFT collections and get real-time alerts for:
• New mints and transfers
• Sales and price updates  
• Trending collections
• Custom token monitoring

<b>Quick Start Commands:</b>
• /add_token - Add NFT contract to track
• /my_tokens - View your tracked tokens
• /trending - See trending NFT collections
• /buy_trending - Boost NFT trending
• /help - Full command list

Ready to start tracking NFTs? Use the buttons below or /add_token!`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📈 View Trending', 'view_trending')],
        [Markup.button.callback('➕ Add Token', 'add_token_start')],
        [Markup.button.callback('🚀 Boost NFT', 'boost_trending')]
      ]);

      await ctx.replyWithHTML(welcomeMessage, keyboard);
      logger.info(`New user started bot: ${user.id} (${user.username})`);
    });


    bot.help(async (ctx) => {
      const helpMessage = `📋 <b>MintTechBot Commands</b>

🎯 <b>Token Management:</b>
• /add_token - Add NFT contract to track
• /remove_token - Remove tracked NFT  
• /my_tokens - View your tracked tokens

💰 <b>Trending &amp; Boost:</b>
• /trending - View trending collections
• /buy_trending - Boost NFT trending

📺 <b>Channel Commands:</b>
• /add_channel - Add bot to channel
• /channel_settings - Configure channel alerts

• /startcandy - Welcome message
• /help - Show this help

Simple and focused - boost your NFTs easily! 🚀`;
      await ctx.replyWithHTML(helpMessage);
    });


    bot.command('add_token', async (ctx) => {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Search by Name', 'search_token')],
        [Markup.button.callback('📝 Enter Contract Address', 'enter_contract')]
      ]);

      await ctx.reply(
        'How would you like to add a token?',
        keyboard
      );
    });


    bot.command('my_tokens', async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from.id.toString());
        if (!user) {
          return ctx.reply('Please start the bot first with /startcandy');
        }

        const tokens = await this.db.getUserTrackedTokens(user.id);
        if (tokens.length === 0) {
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Your First Token', 'add_token_start')]
          ]);
          return ctx.reply(
            '🔍 You haven\'t added any tokens yet!\n\nUse /add_token to start tracking NFT collections.',
            keyboard
          );
        }

        let message = `🎯 *Your Tracked Tokens* (${tokens.length})\n\n`;
        const keyboard = [];

        tokens.forEach((token, index) => {
          message += `${index + 1}. *${token.token_name || 'Unknown'}* (${token.token_symbol || 'N/A'})\n`;
          message += `   📮 \`${token.contract_address}\`\n`;
          message += `   🔔 Notifications: ${token.notification_enabled ? '✅' : '❌'}\n\n`;
          keyboard.push([
            Markup.button.callback(
              `${token.notification_enabled ? '🔕' : '🔔'} ${token.token_name || token.contract_address.slice(0, 8)}...`, 
              `toggle_${token.id}`
            )
          ]);
        });

        keyboard.push([Markup.button.callback('➕ Add More Tokens', 'add_token_start')]);

        await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(keyboard));
      } catch (error) {
        logger.error('Error in my_tokens command:', error);
        ctx.reply('❌ Error retrieving your tokens. Please try again.');
      }
    });


    bot.command('remove_token', async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from.id.toString());
        if (!user) {
          return ctx.reply('Please start the bot first with /startcandy');
        }

        const tokens = await this.db.getUserTrackedTokens(user.id);
        if (!tokens || tokens.length === 0) {
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Token', 'add_token_start')]
          ]);
          return ctx.reply(
            '📝 You have no tracked tokens to remove.\n\nAdd some tokens first!',
            keyboard
          );
        }

        let message = `🗑️ <b>Remove Tracked Token</b>\n\nSelect a token to remove from tracking:\n\n`;
        const keyboard = [];
        tokens.forEach((token, index) => {
          message += `${index + 1}. <b>${token.token_name || 'Unknown Collection'}</b>\n`;
          message += `   📮 <code>${token.contract_address}</code>\n\n`;
          keyboard.push([{
            text: `🗑️ Remove ${token.token_name || `Token ${index + 1}`}`,
            callback_data: `remove_token_${token.id}`
          }]);
        });

        keyboard.push([{
          text: '❌ Cancel',
          callback_data: 'main_menu'
        }]);

        await ctx.replyWithHTML(message, {
          reply_markup: {
            inline_keyboard: keyboard
          }
        });
      } catch (error) {
        logger.error('Error in remove_token command:', error);
        ctx.reply('❌ Error loading your tokens. Please try again.');
      }
    });



    bot.command('trending', async (ctx) => {
      try {
        await this.db.expireTrendingPayments();
        const trendingTokens = await this.db.getTrendingTokens();
        if (trendingTokens.length === 0) {
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🚀 Boost Your Token', 'promote_token')]
          ]);
          return ctx.reply(
            '📊 *No trending tokens right now*\n\nBe the first to boost your NFT collection!',
            { 
              parse_mode: 'Markdown',
              reply_markup: keyboard 
            }
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
      const message = `🚀 *NFT Boost Menu*

Select an option to boost your NFT collections:`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔥 View Trending', 'view_trending')],
        [Markup.button.callback('🚀 Boost My Token', 'promote_token')],
        [Markup.button.callback('📊 My Tokens', 'my_tokens')]
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
      try {
        if (data === 'view_trending') {
          await ctx.answerCbQuery();
          return this.showTrendingCommand(ctx);
        }
        if (data === 'add_token_start') {
          await ctx.answerCbQuery();
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTRACT);
          return ctx.reply('📝 Please enter the NFT contract address to track:');
        }
        if (data === 'boost_trending') {
          await ctx.answerCbQuery();
          return this.showPromoteTokenMenu(ctx);
        }

        if (data === 'enter_contract') {
          await ctx.answerCbQuery();

          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTRACT);
          ctx.reply('📝 Please enter the NFT contract address:');
          return;
        }


        if (data.startsWith('toggle_')) {
          const tokenId = data.replace('toggle_', '');
          await this.toggleTokenNotification(ctx, tokenId);
          return;
        }

        if (data.startsWith('stats_')) {
          const tokenId = data.replace('stats_', '');
          await this.showTokenStats(ctx, tokenId);
          return;
        }

        if (data.startsWith('remove_token_')) {
          const tokenId = data.replace('remove_token_', '');
          await ctx.answerCbQuery();
          await this.handleRemoveToken(ctx, tokenId);
          return;
        }

        if (data === 'promote_token') {
          await ctx.answerCbQuery();
          return this.showPromoteTokenMenu(ctx);
        }


        if (data.startsWith('contract_')) {
          const address = data.replace('contract_', '');
          await ctx.answerCbQuery();
          await this.handleContractAddress(ctx, address);
          return;
        }

        if (data.startsWith('promote_')) {
          const tokenId = data.replace('promote_', '');
          await ctx.answerCbQuery();
          return this.showPromoteDurationMenu(ctx, tokenId);
        }

        if (data === 'main_menu') {
          await ctx.answerCbQuery();
          return this.showMainMenu(ctx);
        }

        if (data.startsWith('duration_')) {
          const parts = data.split('_');
          const tokenId = parts[1];
          const duration = parseInt(parts[2]);
          await ctx.answerCbQuery();
          return this.showPaymentInstructions(ctx, tokenId, duration);
        }

        if (data.startsWith('submit_tx_')) {
          const parts = data.split('_');
          const tokenId = parts[2];
          const duration = parseInt(parts[3]);
          await ctx.answerCbQuery();

          this.setUserState(ctx.from.id, this.STATE_EXPECTING_TX_HASH);
          const message = `📝 **Submit Transaction Hash**

Please send your Ethereum transaction hash now.

The transaction hash should:
• Start with 0x
• Be 66 characters long
• Be from a transaction sent to: \`${process.env.TRENDING_CONTRACT_ADDRESS}\`

Example: \`0x1234567890abcdef...\`

Type "cancel" to abort this process.`;

          return ctx.replyWithMarkdown(message);
        }


        if (data === 'channel_settings') {
          await ctx.answerCbQuery();
          const chatId = ctx.chat.id.toString();
          return this.channels.handleChannelSettingsCommand(ctx, chatId);
        }

        if (data === 'channel_toggle_trending') {
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

        if (data === 'channel_toggle_activity') {
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

      if (text.match(/^0x[a-fA-F0-9]{40}$/)) {
        if (userState === this.STATE_EXPECTING_CONTRACT) {
          await this.handleContractAddress(ctx, text);
          return;
        } else {

          await this.handleContractAddress(ctx, text);
          return;
        }
      }

      if (text.toLowerCase() === 'cancel' || text.toLowerCase() === '/cancel') {
        this.clearUserState(userId);
        ctx.reply('✅ Operation cancelled.');
        return;
      }

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
      } else {

        return;
      }
    });


    bot.on('channel_post', async (ctx) => {
      try {
        const text = ctx.channelPost.text;
        if (!text) return;

        logger.debug(`Channel post received: "${text}" in channel ${ctx.chat.id}`);


        let command = null;
        if (text.startsWith('/')) {

          command = text.split(' ')[0].replace('/', '');
        } else if (text.includes('@testcandybot')) {

          const parts = text.split(' ');
          const mentionedCommand = parts.find(part => part.includes('@testcandybot'));
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
            const helpMessage = `📋 <b>MintTechBot Commands</b>

🎯 <b>Token Management:</b>
• /add_token - Add NFT contract to track
• /remove_token - Remove tracked NFT  
• /my_tokens - View your tracked tokens

💰 <b>Trending &amp; Boost:</b>
• /trending - View trending collections
• /buy_trending - Boost NFT trending

📺 <b>Channel Commands:</b>
• /add_channel - Add bot to channel
• /channel_settings - Configure channel alerts

• /startcandy - Welcome message
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


  async handleContractAddress(ctx, contractAddress) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startcandy');
      }

      ctx.reply('🔍 Validating and adding contract...');


      this.clearUserState(ctx.from.id);


      const result = await this.tokenTracker.addToken(
        contractAddress, 
        user.id, 
        ctx.from.id.toString()
      );

      if (result.success) {
        await ctx.replyWithMarkdown(result.message);
        logger.info(`Token added: ${contractAddress} by user ${user.id}`);
      } else {
        await ctx.reply(result.message);
      }
    } catch (error) {
      logger.error('Error handling contract address:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ Error adding token. Please check the contract address and try again.');
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
        return ctx.reply('❌ Invalid transaction hash format. Please send a valid Ethereum transaction hash (starts with 0x and is 64 characters long).\n\nOr type "cancel" to abort.');
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

  async handleRemoveToken(ctx, tokenId) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startcandy');
      }


      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE id = ? AND added_by_user_id = ?',
        [tokenId, user.id]
      );

      if (!token) {
        return ctx.reply('❌ Token not found or you don\'t have permission to remove it.');
      }


      await this.db.run(
        'UPDATE tracked_tokens SET is_active = 0 WHERE id = ? AND added_by_user_id = ?',
        [tokenId, user.id]
      );


      if (token.webhook_id && this.alchemy) {
        try {
          await this.alchemy.deleteWebhook(token.webhook_id);
          logger.info(`Webhook removed for token: ${token.contract_address}`);
        } catch (webhookError) {
          logger.warn(`Failed to remove webhook for ${token.contract_address}:`, webhookError.message);
        }
      }

      const successMessage = `✅ <b>Token Removed Successfully</b>

🗑️ <b>${token.token_name || 'Unknown Collection'}</b> has been removed from your tracking list.

📮 Contract: <code>${token.contract_address}</code>

You will no longer receive notifications for this token.`;

      await ctx.replyWithHTML(successMessage);
      logger.info(`Token removed: ${token.contract_address} by user ${user.id}`);

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
          [Markup.button.callback('💰 Boost Your Token', 'promote_token')]
        ]);
        return ctx.reply(
          '📊 *No trending tokens right now*\n\nBe the first to boost your NFT collection!',
          { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
          }
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

  async showPromoteTokenMenu(ctx) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /startcandy');
      }
      const userTokens = await this.tokenTracker.getUserTokens(user.id);
      if (!userTokens || userTokens.length === 0) {
        return ctx.reply(
          '📝 You need to add some NFT collections first!\n\nUse /add_token to track your first NFT collection.',
          { parse_mode: 'Markdown' }
        );
      }

      const message = '🚀 Select an NFT collection to boost:';

      const keyboard = [];

      userTokens.forEach((token, index) => {
        keyboard.push([{
          text: `🚀 ${token.token_name || `Token ${index + 1}`}`,
          callback_data: `promote_${token.id}`
        }]);
      });

      keyboard.push([{
        text: '◀️ Back to Menu',
        callback_data: 'main_menu'
      }]);

      return ctx.reply(message, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

    } catch (error) {
      logger.error('Error showing promote token menu:', error);
      return ctx.reply('❌ Error loading promotion menu. Please try again.');
    }
  }

  async showPromoteDurationMenu(ctx, tokenId) {
    try {
      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE id = ?',
        [tokenId]
      );

      if (!token) {
        return ctx.reply('❌ Token not found.');
      }

      const trendingOptions = await this.trending.getTrendingOptions();
      logger.info(`Trending options loaded: ${trendingOptions.length} options`);
      let message = `🚀 <b>Boost: ${token.token_name || 'Unknown Collection'}</b>\n\n`;
      message += `📮 <code>${token.contract_address}</code>\n\n`;
      message += '<b>Select boost duration:</b>';

      const buttons = [];
      trendingOptions.forEach(option => {
        buttons.push([Markup.button.callback(
          `💰 ${option.label} - ${option.feeEth} ETH`, 
          `duration_${tokenId}_${option.duration}`
        )]);
      });

      buttons.push([Markup.button.callback('◀️ Back', 'promote_token')]);

      const keyboard = Markup.inlineKeyboard(buttons);

      try {
        return await ctx.replyWithHTML(message, keyboard);
      } catch (replyError) {
        logger.error('Error sending duration menu message:', replyError);

        return await ctx.reply(`🚀 Boost: ${token.token_name || 'Unknown Collection'}\n\nSelect boost duration:`, keyboard);
      }

    } catch (error) {
      logger.error('Error showing promote duration menu:', error);
      return ctx.reply('❌ Error loading duration options.');
    }
  }

  async showMainMenu(ctx) {
    const keyboard = [
      [Markup.button.callback('🔥 View Trending', 'view_trending')],
      [Markup.button.callback('➕ Add Token', 'add_token_start')],
      [Markup.button.callback('📊 My Tokens', 'my_tokens')],
      [Markup.button.callback('🚀 Boost Token', 'promote_token')]
    ];

    const message = `🚀 *MintTechBot Main Menu*

Choose an option:`;

    return ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
  }

  async showPaymentInstructions(ctx, tokenId, duration) {
    try {
      const userId = ctx.from.id.toString();
      const instructions = await this.trending.generatePaymentInstructions(tokenId, duration, userId);
      let message = `💳 *Simple Payment Instructions*\n\n`;
      message += `🔥 **Collection**: ${instructions.tokenName}\n`;
      message += `📮 **Contract**: \`${instructions.tokenAddress}\`\n`;
      message += `⏱️ **Duration**: ${duration} hour${duration > 1 ? 's' : ''}\n`;
      message += `💰 **Fee**: ${instructions.feeEth} ETH\n\n`;
      message += `🏦 **Payment Address**:\n\`${instructions.contractAddress}\`\n\n`;
      message += `🔗 **View on Etherscan**: ${instructions.etherscanUrl}\n\n`;
      message += `📋 **Payment Instructions**:\n`;
      instructions.instructions.forEach((instruction, index) => {
        message += `${index + 1}. ${instruction}\n`;
      });
      message += `\n✅ **Simple Process**: Just send a regular ETH transfer - no complex contract calls needed!\n`;
      message += `⏰ **Payment expires in 30 minutes**\n\n`;
      message += `After successful transaction, submit your transaction hash below:`;


      this.pendingPayments.set(userId, {
        tokenId: tokenId,
        duration: duration,
        expectedAmount: instructions.fee
      });

      const keyboard = [
        [Markup.button.callback('📝 Submit Transaction Hash', `submit_tx_${tokenId}_${duration}`)],
        [Markup.button.callback('◀️ Back to Duration', `promote_${tokenId}`)],
        [Markup.button.callback('🏠 Main Menu', 'main_menu')]
      ];

      return ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(keyboard)
      });

    } catch (error) {
      logger.error('Error showing payment instructions:', error);
      return ctx.reply('❌ Error loading payment instructions. Please try again.');
    }
  }
}

module.exports = BotCommands;