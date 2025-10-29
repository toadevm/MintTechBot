const { Markup } = require('telegraf');
const logger = require('../services/logger');

/**
 * Bot Command Helpers
 *
 * Shared utility functions to eliminate code duplication in commands.js
 */

// ============================================================================
// ERROR HANDLING HELPERS
// ============================================================================

/**
 * Standardized error handler for bot commands
 * @param {Object} ctx - Telegram context
 * @param {Error} error - Error object
 * @param {string} context - Context description (e.g., "validate command")
 * @param {Object} options - Options for error handling
 */
async function handleCommandError(ctx, error, context, options = {}) {
  const {
    userMessage = '❌ An error occurred. Please try again.',
    clearState = false,
    clearSession = false,
    userId = null
  } = options;

  logger.error(`Error in ${context}:`, error);

  // Clear user state/session if requested
  if (clearState && userId && this.clearUserState) {
    this.clearUserState(userId);
  }
  if (clearSession && userId && this.clearUserSession) {
    this.clearUserSession(userId);
  }

  // Reply to user with error message
  try {
    await ctx.reply(userMessage);
  } catch (replyError) {
    logger.error(`Failed to send error message in ${context}:`, replyError);
  }
}

// ============================================================================
// KEYBOARD BUILDERS
// ============================================================================

/**
 * Build main menu keyboard
 * @returns {Object} Telegraf inline keyboard
 */
function buildMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Manage NFTs', 'menu_tokens'),
      Markup.button.callback('🔥 Trending & Boost', 'menu_trending')
    ],
    [
      Markup.button.callback('🖼️ Display NFT Image', 'menu_images'),
      Markup.button.callback('🔗 Buy Footer Ads', 'menu_footer')
    ],
    [
      Markup.button.callback('📺 Channel Settings', 'menu_channels'),
      Markup.button.callback('✅ Verify Payments', 'menu_verify')
    ],
    [
      Markup.button.callback('❓ Help & Contact', 'help_contact')
    ]
  ]);
}

/**
 * Build back to main menu button
 * @returns {Array} Inline keyboard row with back button
 */
function buildBackToMainButton() {
  return [Markup.button.callback('◀️ Back to Main Menu', 'main_menu')];
}

/**
 * Build back to menu button (generic)
 * @param {string} menuName - Menu name to return to
 * @param {string} callbackData - Callback data for button
 * @returns {Array} Inline keyboard row with back button
 */
function buildBackButton(menuName, callbackData) {
  return [Markup.button.callback(`◀️ Back to ${menuName}`, callbackData)];
}

/**
 * Build duration selection keyboard
 * @param {string} type - Type of purchase ('trending', 'image', 'footer')
 * @returns {Object} Telegraf inline keyboard
 */
function buildDurationKeyboard(type) {
  const prefix = type === 'trending' ? 'trending_duration' :
                 type === 'image' ? 'image_duration' :
                 'footer_duration';

  const buttons = [];

  if (type === 'trending') {
    buttons.push([
      Markup.button.callback('⏱️ 24 hours - 0.005 ETH', `${prefix}_24`),
      Markup.button.callback('🕐 48 hours - 0.01 ETH', `${prefix}_48`)
    ]);
    buttons.push([
      Markup.button.callback('📅 72 hours - 0.015 ETH', `${prefix}_72`),
      Markup.button.callback('🔥 7 days - 0.05 ETH', `${prefix}_168`)
    ]);
  } else {
    // Image and Footer durations (in days)
    buttons.push([
      Markup.button.callback('📅 30 days', `${prefix}_30`),
      Markup.button.callback('📆 60 days', `${prefix}_60`)
    ]);
    buttons.push([
      Markup.button.callback('🗓️ 90 days', `${prefix}_90`)
    ]);
  }

  buttons.push(buildBackToMainButton());
  return Markup.inlineKeyboard(buttons);
}

/**
 * Build payment chain selection keyboard
 * @param {Object} chainManager - ChainManager instance
 * @param {string} type - Type of purchase ('trending', 'image', 'footer')
 * @returns {Array} Inline keyboard array
 */
function buildPaymentChainKeyboard(chainManager, type) {
  if (!chainManager) {
    return [];
  }

  const chains = chainManager.getChainsForPayments();
  const keyboard = [];

  // Add chains (2 per row)
  for (let i = 0; i < chains.length; i += 2) {
    const row = [];
    const chain1 = chains[i];
    row.push({
      text: `${chain1.emoji} ${chain1.displayName}`,
      callback_data: `${type}_chain_${chain1.name}`
    });

    if (i + 1 < chains.length) {
      const chain2 = chains[i + 1];
      row.push({
        text: `${chain2.emoji} ${chain2.displayName}`,
        callback_data: `${type}_chain_${chain2.name}`
      });
    }
    keyboard.push(row);
  }

  return keyboard;
}

/**
 * Build token selection keyboard for removal
 * @param {Array} tokens - Array of tracked tokens
 * @param {number} page - Current page number
 * @param {number} perPage - Tokens per page
 * @returns {Object} Telegraf inline keyboard
 */
function buildTokenSelectionKeyboard(tokens, page = 0, perPage = 5) {
  const keyboard = [];
  const start = page * perPage;
  const end = Math.min(start + perPage, tokens.length);
  const pageTokens = tokens.slice(start, end);

  // Add token buttons
  pageTokens.forEach(token => {
    const displayName = token.token_name || token.collection_slug ||
                        (token.contract_address ? `${token.contract_address.substring(0, 8)}...` : 'Unknown');
    keyboard.push([
      Markup.button.callback(
        `🗑️ Remove ${displayName}`,
        `remove_token_${token.id}`
      )
    ]);
  });

  // Add pagination if needed
  const totalPages = Math.ceil(tokens.length / perPage);
  if (totalPages > 1) {
    const paginationRow = [];
    if (page > 0) {
      paginationRow.push(Markup.button.callback('⬅️ Previous', `tokens_page_${page - 1}`));
    }
    paginationRow.push(Markup.button.callback(`📄 ${page + 1}/${totalPages}`, 'noop'));
    if (page < totalPages - 1) {
      paginationRow.push(Markup.button.callback('➡️ Next', `tokens_page_${page + 1}`));
    }
    keyboard.push(paginationRow);
  }

  keyboard.push(buildBackToMainButton());
  return Markup.inlineKeyboard(keyboard);
}

// ============================================================================
// MESSAGE FORMATTERS
// ============================================================================

/**
 * Format welcome message
 * @returns {string} HTML formatted welcome message
 */
function formatWelcomeMessage() {
  return `🚀 <b>Welcome to Minty Rush!</b> 🚀

I help you track NFT collections and get real-time alerts for:
• New mints and transfers
• Sales and price updates
• Trending collections
• Custom NFT monitoring

<b>Get started by choosing from the menu below:</b>`;
}

/**
 * Format help message
 * @returns {string} HTML formatted help message
 */
function formatHelpMessage() {
  return `📋 <b>MintyRushBot Commands</b>

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
}

/**
 * Format payment instructions message
 * @param {Object} paymentInfo - Payment information object
 * @returns {string} HTML formatted payment instructions
 */
function formatPaymentInstructions(paymentInfo) {
  const {
    chainName,
    chainEmoji,
    chainDisplay,
    amount,
    symbol,
    address,
    duration,
    type
  } = paymentInfo;

  const typeDisplay = type === 'trending' ? 'Trending Boost' :
                      type === 'image' ? 'NFT Image Display' :
                      'Footer Advertisement';

  return `${chainEmoji} <b>${typeDisplay} Payment Instructions</b>

<b>Network:</b> ${chainDisplay}
<b>Amount:</b> ${amount} ${symbol}
<b>Duration:</b> ${duration}

<b>Send payment to:</b>
<code>${address}</code>

<b>⚠️ Important:</b>
• Send EXACTLY ${amount} ${symbol}
• Use ${chainDisplay} network
• After payment, use /validate to verify
• Payment expires in 30 minutes

Need help? Contact @YourSupportBot`;
}

/**
 * Truncate address for display
 * @param {string} address - Full address
 * @param {number} startChars - Characters to show at start
 * @param {number} endChars - Characters to show at end
 * @returns {string} Truncated address
 */
function truncateAddress(address, startChars = 6, endChars = 4) {
  if (!address || address.length <= startChars + endChars) {
    return address;
  }
  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}

/**
 * Format token list message
 * @param {Array} tokens - Array of tracked tokens
 * @param {string} chainName - Chain name (optional)
 * @returns {string} Formatted token list message
 */
function formatTokenList(tokens, chainName = null) {
  if (tokens.length === 0) {
    return chainName
      ? `🔍 You haven't added any NFTs on ${chainName} yet!\n\nUse /add_token to start tracking NFT collections.`
      : `🔍 You haven't added any tokens yet!\n\nUse /add_token to start tracking NFT collections.`;
  }

  let message = chainName
    ? `📊 <b>Your Tracked NFTs on ${chainName}</b>\n\n`
    : `📊 <b>Your Tracked NFTs</b>\n\n`;

  tokens.forEach((token, index) => {
    const name = token.token_name || token.collection_slug || 'Unknown';
    const address = truncateAddress(token.contract_address);
    const chain = token.chain_name || 'ethereum';
    message += `${index + 1}. <b>${name}</b>\n`;
    message += `   📮 <code>${address}</code>\n`;
    message += `   🔗 ${chain}\n\n`;
  });

  return message;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate contract address format
 * @param {string} address - Contract address
 * @param {string} chainName - Chain name for validation
 * @returns {Object} Validation result {isValid: boolean, reason: string}
 */
function validateContractAddress(address, chainName = 'ethereum') {
  if (!address || typeof address !== 'string') {
    return { isValid: false, reason: 'Invalid address format' };
  }

  // Ethereum and EVM chains
  if (chainName !== 'solana' && chainName !== 'bitcoin') {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!ethAddressRegex.test(address)) {
      return { isValid: false, reason: 'Invalid Ethereum address format' };
    }
  }

  // Solana
  if (chainName === 'solana') {
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!solanaAddressRegex.test(address)) {
      return { isValid: false, reason: 'Invalid Solana address format' };
    }
  }

  // Bitcoin
  if (chainName === 'bitcoin') {
    // Bitcoin uses collection symbols, not addresses
    if (address.length < 3) {
      return { isValid: false, reason: 'Invalid Bitcoin collection symbol' };
    }
  }

  return { isValid: true };
}

/**
 * Validate transaction hash format
 * @param {string} txHash - Transaction hash
 * @param {string} chainName - Chain name for validation
 * @returns {Object} Validation result {isValid: boolean, reason: string}
 */
function validateTxHash(txHash, chainName = 'ethereum') {
  if (!txHash || typeof txHash !== 'string') {
    return { isValid: false, reason: 'Invalid transaction hash' };
  }

  // Ethereum and EVM chains
  if (chainName !== 'solana' && chainName !== 'bitcoin') {
    const ethTxRegex = /^0x[a-fA-F0-9]{64}$/;
    if (!ethTxRegex.test(txHash)) {
      return { isValid: false, reason: 'Invalid Ethereum transaction hash format' };
    }
  }

  // Solana
  if (chainName === 'solana') {
    const solanaTxRegex = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
    if (!solanaTxRegex.test(txHash)) {
      return { isValid: false, reason: 'Invalid Solana transaction signature format' };
    }
  }

  // Bitcoin
  if (chainName === 'bitcoin') {
    const btcTxRegex = /^[a-fA-F0-9]{64}$/;
    if (!btcTxRegex.test(txHash)) {
      return { isValid: false, reason: 'Invalid Bitcoin transaction hash format' };
    }
  }

  return { isValid: true };
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {Object} Validation result {isValid: boolean, reason: string}
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { isValid: false, reason: 'Invalid URL' };
  }

  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, reason: 'URL must use http or https protocol' };
    }
    return { isValid: true };
  } catch (error) {
    return { isValid: false, reason: 'Invalid URL format' };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Error handling
  handleCommandError,

  // Keyboard builders
  buildMainMenuKeyboard,
  buildBackToMainButton,
  buildBackButton,
  buildDurationKeyboard,
  buildPaymentChainKeyboard,
  buildTokenSelectionKeyboard,

  // Message formatters
  formatWelcomeMessage,
  formatHelpMessage,
  formatPaymentInstructions,
  formatTokenList,
  truncateAddress,

  // Validation
  validateContractAddress,
  validateTxHash,
  validateUrl
};
