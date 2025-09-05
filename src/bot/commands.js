const { Markup } = require('telegraf');
const logger = require('../services/logger');

class BotCommands {
  constructor(database, alchemyService, walletService, tokenTracker, trendingService, channelService) {
    this.db = database;
    this.alchemy = alchemyService;
    this.wallet = walletService;
    this.tokenTracker = tokenTracker;
    this.trending = trendingService;
    this.channels = channelService;
    
    // User session state management
    this.userStates = new Map(); // userId -> state
    this.STATE_EXPECTING_WALLET = 'expecting_wallet';
    this.STATE_EXPECTING_CONTRACT = 'expecting_contract';
  }

  // Helper methods for state management
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
    // Start command
    bot.start(async (ctx) => {
      const user = ctx.from;
      
      // Create user in database
      await this.db.createUser(user.id.toString(), user.username, user.first_name);
      
      const welcomeMessage = `🚀 *Welcome to NFT BuyBot!* 🚀

I help you track NFT collections and get real-time alerts for:
• New mints and transfers
• Sales and price updates  
• Trending collections
• Custom token monitoring

*Quick Start Commands:*
• /add\\_token - Add NFT contract to track
• /my\\_tokens - View your tracked tokens
• /trending - See trending NFT collections
• /wallet - Connect your wallet
• /help - Full command list

Ready to start tracking NFTs? Use the buttons below or /add\\_token!`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📈 View Trending', 'view_trending')],
        [Markup.button.callback('➕ Add Token', 'add_token_start')],
        [Markup.button.callback('👛 Connect Wallet', 'connect_wallet')]
      ]);

      await ctx.replyWithMarkdown(welcomeMessage, keyboard);
      logger.info(`New user started bot: ${user.id} (${user.username})`);
    });

    // Help command
    bot.help(async (ctx) => {
      const helpMessage = `📋 *NFT BuyBot Commands*

*Basic Commands:*
• /start - Welcome message and setup
• /help - Show this help message
• /status - Show your account status

*Token Management:*
• /add\\_token - Add NFT contract to track
• /remove\\_token - Remove tracked token
• /my\\_tokens - View your tracked tokens
• /search - Search for NFT collections

*Wallet & Payments:*
• /wallet - Connect/manage your wallet  
• /balance - Check your wallet balance
• /pay\\_trending - Pay to promote token

*Trending & Analytics:*
• /trending - View trending collections
• /stats - Collection statistics
• /floor\\_price - Check floor prices

*Channel Management:*
• /add\\_channel - Add bot to channel
• /channel\\_settings - Configure channel alerts

*Admin Commands:*
• /admin - Admin panel (admin only)
• /broadcast - Send message to all users (admin only)

Need help with a specific command? Just type it!`;
      
      await ctx.replyWithMarkdown(helpMessage);
    });

    // Add token command
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

    // My tokens command
    bot.command('my_tokens', async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from.id.toString());
        if (!user) {
          return ctx.reply('Please start the bot first with /start');
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

    // Trending command
    bot.command('trending', async (ctx) => {
      try {
        await this.db.expireTrendingPayments(); // Clean up expired trending
        const trendingTokens = await this.db.getTrendingTokens();
        
        if (trendingTokens.length === 0) {
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('💰 Promote Your Token', 'promote_token')]
          ]);
          
          return ctx.reply(
            '📊 *No trending tokens right now*\n\nBe the first to promote your NFT collection!',
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
          message += `   💰 Paid: ${this.wallet.formatEther(token.payment_amount)} ETH\n\n`;
          
          keyboard.push([
            Markup.button.callback(`📊 ${token.token_name || 'View'} Stats`, `stats_${token.id}`)
          ]);
        });

        keyboard.push([Markup.button.callback('💰 Promote Your Token', 'promote_token')]);

        await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(keyboard));
        
      } catch (error) {
        logger.error('Error in trending command:', error);
        ctx.reply('❌ Error retrieving trending tokens. Please try again.');
      }
    });

    // Wallet command
    bot.command('wallet', async (ctx) => {
      try {
        const user = await this.db.getUser(ctx.from.id.toString());
        if (!user) {
          return ctx.reply('Please start the bot first with /start');
        }

        if (user.wallet_address) {
          const balance = await this.wallet.getBalance(user.wallet_address);
          
          const message = `
👛 *Your Wallet*

📮 Address: \`${user.wallet_address}\`
💰 Balance: ${this.wallet.formatEther(balance)} ETH

*What you can do:*
• Pay for trending promotion
• Receive NFT sale notifications
• Track your collection activities
          `;

          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Change Wallet', 'change_wallet')],
            [Markup.button.callback('💰 Promote Token', 'promote_token')]
          ]);

          await ctx.replyWithMarkdown(message, keyboard);
        } else {
          // Set user state to expecting wallet address
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_WALLET);
          await this.showConnectWallet(ctx);
        }
        
      } catch (error) {
        logger.error('Error in wallet command:', error);
        ctx.reply('❌ Error retrieving wallet information. Please try again.');
      }
    });

    // Callback query handlers
    bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery.data;
      
      try {
        if (data === 'view_trending') {
          await ctx.answerCbQuery();
          return this.showTrendingTokens(ctx);
        }
        
        if (data === 'add_token_start') {
          await ctx.answerCbQuery();
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTRACT);
          return ctx.reply('📝 Please enter the NFT contract address to track:');
        }
        
        if (data === 'connect_wallet') {
          await ctx.answerCbQuery();
          // Set user state to expecting wallet address
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_WALLET);
          return this.showConnectWallet(ctx);
        }

        if (data === 'enter_contract') {
          await ctx.answerCbQuery();
          // Set user state to expecting contract address
          this.setUserState(ctx.from.id, this.STATE_EXPECTING_CONTRACT);
          ctx.reply('📝 Please enter the NFT contract address:');
          return;
        }

        if (data === 'search_token') {
          await ctx.answerCbQuery();
          return ctx.reply('🔍 Please enter the NFT collection name to search:');
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

        if (data === 'promote_token') {
          await ctx.answerCbQuery();
          return this.showPromoteTokenMenu(ctx);
        }

        // Handle wallet/contract disambiguation callbacks
        if (data.startsWith('wallet_')) {
          const address = data.replace('wallet_', '');
          await ctx.answerCbQuery();
          await this.handleWalletAddress(ctx, address);
          return;
        }

        if (data.startsWith('contract_')) {
          const address = data.replace('contract_', '');
          await ctx.answerCbQuery();
          await this.handleContractAddress(ctx, address);
          return;
        }

        if (data === 'cancel_wallet_connection') {
          await ctx.answerCbQuery();
          this.clearUserState(ctx.from.id);
          ctx.reply('✅ Wallet connection cancelled.');
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

        await ctx.answerCbQuery('Feature coming soon!');
        
      } catch (error) {
        logger.error('Error handling callback query:', error);
        await ctx.answerCbQuery('❌ Error processing request');
      }
    });

    // Text message handlers
    bot.on('text', async (ctx) => {
      const text = ctx.message.text;
      const userId = ctx.from.id;
      const userState = this.getUserState(userId);
      
      // Check if it's an Ethereum address (42 chars starting with 0x)
      if (text.match(/^0x[a-fA-F0-9]{40}$/)) {
        // Determine if user is expecting a wallet address or contract address
        if (userState === this.STATE_EXPECTING_WALLET) {
          await this.handleWalletAddress(ctx, text);
          return;
        } else if (userState === this.STATE_EXPECTING_CONTRACT) {
          await this.handleContractAddress(ctx, text);
          return;
        } else {
          // No specific state - ask user what they want to do
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('👛 Connect as Wallet', `wallet_${text}`)],
            [Markup.button.callback('📊 Track as NFT Contract', `contract_${text}`)]
          ]);
          
          await ctx.reply(
            '🤔 I see you sent an Ethereum address. What would you like to do with it?',
            keyboard
          );
          return;
        }
      }
      
      // Handle cancel commands
      if (text.toLowerCase() === 'cancel' || text.toLowerCase() === '/cancel') {
        this.clearUserState(userId);
        ctx.reply('✅ Operation cancelled.');
        return;
      }
      
      // Default response for unrecognized text
      if (userState === this.STATE_EXPECTING_WALLET) {
        ctx.reply('👛 Please send a valid Ethereum wallet address (starts with 0x and is 42 characters long), or type "cancel" to abort.');
      } else if (userState === this.STATE_EXPECTING_CONTRACT) {
        ctx.reply('📊 Please send a valid NFT contract address (starts with 0x and is 42 characters long), or type "cancel" to abort.');
      } else {
        ctx.reply('🤖 I didn\'t understand that. Use /help to see available commands.');
      }
    });

    // Error handling
    bot.catch((err, ctx) => {
      logger.error('Bot error:', err);
      ctx.reply('❌ Something went wrong. Please try again.');
    });

    logger.info('Bot commands setup completed');
  }

  async showConnectWallet(ctx) {
    const message = `👛 *Connect Your Wallet*

To unlock premium features like trending promotion and advanced analytics, connect your Ethereum wallet.

🔹 **What to send:** Your Ethereum wallet address (starts with 0x)
🔹 **Example:** \`0x742d35Cc6334C4532AB1b1b8c8e2e9dE4DFaB36c\`
🔹 **Network:** Ethereum Sepolia (for testing)

🔒 **Security Note:** I only need your PUBLIC wallet address for read-only access. Never share your private keys!

📲 **How to find your address:**
• Copy from MetaMask, Trust Wallet, or your wallet app
• Make sure it's 42 characters long and starts with "0x"

💡 Type "cancel" anytime to abort this process.

Please send your wallet address below:`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Cancel', 'cancel_wallet_connection')]
    ]);

    await ctx.replyWithMarkdown(message, keyboard);
  }

  async handleWalletAddress(ctx, walletAddress) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /start');
      }

      // Validate wallet address format
      if (!this.wallet.isValidAddress(walletAddress)) {
        this.clearUserState(ctx.from.id);
        return ctx.reply('❌ Invalid wallet address format. Please try again with a valid Ethereum address.');
      }

      ctx.reply('💫 Connecting your wallet...');

      try {
        // Update user's wallet address in database
        await this.db.updateUserWallet(ctx.from.id.toString(), walletAddress);
        
        // Get wallet balance
        const balance = await this.wallet.getBalance(walletAddress);
        
        // Clear the expecting wallet state
        this.clearUserState(ctx.from.id);
        
        const message = `✅ *Wallet Connected Successfully!*

👛 **Your Wallet Details:**
📮 Address: \`${walletAddress}\`
💰 Balance: ${this.wallet.formatEther(balance)} ETH

🎉 **Premium Features Unlocked:**
• Pay to promote your NFT collections
• Advanced analytics and tracking
• Priority notifications
• Channel trending broadcasts

💡 Use /trending to see promoted collections or promote your own!`;

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('🔥 View Trending', 'view_trending')],
          [Markup.button.callback('💰 Promote Token', 'promote_token')]
        ]);

        await ctx.replyWithMarkdown(message, keyboard);
        logger.info(`Wallet connected: ${walletAddress} for user ${user.id}`);
        
      } catch (dbError) {
        logger.error('Error saving wallet address:', dbError);
        this.clearUserState(ctx.from.id);
        ctx.reply('❌ Error saving wallet address. Please try again.');
      }
      
    } catch (error) {
      logger.error('Error handling wallet address:', error);
      this.clearUserState(ctx.from.id);
      ctx.reply('❌ Error connecting wallet. Please try again.');
    }
  }

  async handleContractAddress(ctx, contractAddress) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      if (!user) {
        return ctx.reply('Please start the bot first with /start');
      }

      ctx.reply('🔍 Validating and adding contract...');

      // Clear any expecting contract state
      this.clearUserState(ctx.from.id);

      // Use token tracker to add the token
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

  async toggleTokenNotification(ctx, tokenId) {
    try {
      const user = await this.db.getUser(ctx.from.id.toString());
      // This would toggle the notification setting in the database
      // Implementation depends on specific database schema
      
      await ctx.answerCbQuery('Notification setting updated!');
      // Refresh the tokens list
      return this.showMyTokens(ctx);
      
    } catch (error) {
      logger.error('Error toggling notification:', error);
      await ctx.answerCbQuery('❌ Error updating notification setting');
    }
  }

  async showTokenStats(ctx, tokenId) {
    try {
      // Get token data and show statistics
      // This would fetch from database and Alchemy
      await ctx.answerCbQuery('Loading statistics...');
      ctx.reply('📊 Token statistics feature coming soon!');
      
    } catch (error) {
      logger.error('Error showing token stats:', error);
      await ctx.answerCbQuery('❌ Error loading statistics');
    }
  }

  async showPromoteTokenMenu(ctx) {
    try {
      const userId = ctx.from.id.toString();
      const userTokens = await this.db.getUserTokens(userId);
      
      if (!userTokens || userTokens.length === 0) {
        return ctx.reply(
          '📝 You need to add some NFT collections first!\n\nUse /add\\_token to track your first NFT collection.',
          { parse_mode: 'Markdown' }
        );
      }

      const trendingOptions = await this.trending.getTrendingOptions();
      
      let message = '🔥 *Promote Your NFT Collection*\n\n';
      message += 'Choose a collection to promote and select duration:\n\n';
      message += '*Available Collections:*\n';
      
      userTokens.forEach((token, index) => {
        message += `${index + 1}. ${token.token_name || 'Unknown Collection'}\n`;
        message += `   📮 \`${token.contract_address}\`\n`;
      });

      message += '\n*Trending Pricing:*\n';
      trendingOptions.forEach(option => {
        message += `• ${option.label}: ${option.feeEth} ETH\n`;
      });

      const keyboard = [];
      
      // Add token selection buttons
      userTokens.forEach((token, index) => {
        keyboard.push([Markup.button.callback(
          `Promote ${token.token_name || `Token ${index + 1}`}`, 
          `promote_${token.id}`
        )]);
      });

      keyboard.push([Markup.button.callback('◀️ Back to Menu', 'main_menu')]);

      return ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(keyboard)
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
      
      let message = `🔥 *Promote: ${token.token_name || 'Unknown Collection'}*\n\n`;
      message += `📮 \`${token.contract_address}\`\n\n`;
      message += '*Select promotion duration:*\n\n';

      const keyboard = [];
      
      trendingOptions.forEach(option => {
        message += `💰 **${option.label}**: ${option.feeEth} ETH\n`;
        keyboard.push([Markup.button.callback(
          `${option.label} - ${option.feeEth} ETH`, 
          `duration_${tokenId}_${option.duration}`
        )]);
      });

      keyboard.push([Markup.button.callback('◀️ Back', 'promote_token')]);

      return ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard(keyboard)
      });

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
      [Markup.button.callback('🔍 Search', 'search_token')],
      [Markup.button.callback('💼 Connect Wallet', 'connect_wallet')],
      [Markup.button.callback('🚀 Promote Token', 'promote_token')]
    ];

    const message = `🚀 *NFT BuyBot Main Menu*

Choose an option:`;

    return ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
  }

  async showPaymentInstructions(ctx, tokenId, duration) {
    try {
      const instructions = await this.trending.generatePaymentInstructions(tokenId, duration);
      
      let message = `💳 *Payment Instructions*\n\n`;
      message += `🔥 **Collection**: ${instructions.tokenName}\n`;
      message += `📮 **Contract**: \`${instructions.tokenAddress}\`\n`;
      message += `⏱️ **Duration**: ${duration} hour${duration > 1 ? 's' : ''}\n`;
      message += `💰 **Fee**: ${instructions.feeEth} ETH\n\n`;
      
      message += `🏦 **Contract Address**:\n\`${instructions.contractAddress}\`\n\n`;
      
      message += `📋 **Instructions**:\n`;
      instructions.instructions.forEach((instruction, index) => {
        message += `${index + 1}. ${instruction}\n`;
      });
      
      message += `\n⚠️ **Important**: Send exactly ${instructions.feeEth} ETH to the contract address above.\n\n`;
      message += `After payment, send the transaction hash to this bot to activate your promotion!`;

      const keyboard = [
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