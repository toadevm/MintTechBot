/**
 * Blockchain Utilities
 *
 * Shared utility functions for blockchain services to eliminate code duplication
 * and provide a single source of truth for common operations.
 */

const logger = require('../services/logger');

// ============================================================================
// CURRENCY CONVERSION UTILITIES
// ============================================================================

/**
 * Convert BTC to satoshis
 * @param {number} btc - Amount in BTC
 * @returns {number} Amount in satoshis
 */
function convertBTCToSats(btc) {
  return Math.round(btc * 100000000);
}

/**
 * Convert satoshis to BTC
 * @param {number} sats - Amount in satoshis
 * @returns {number} Amount in BTC
 */
function convertSatsToBTC(sats) {
  return sats / 100000000;
}

/**
 * Convert SOL to lamports
 * @param {number} sol - Amount in SOL
 * @returns {number} Amount in lamports
 */
function convertSolToLamports(sol) {
  return Math.round(sol * 1000000000);
}

/**
 * Convert lamports to SOL
 * @param {number} lamports - Amount in lamports
 * @returns {number} Amount in SOL
 */
function convertLamportsToSol(lamports) {
  return lamports / 1000000000;
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

/**
 * Format satoshis to BTC with proper decimals
 * @param {number} satoshis - Amount in satoshis
 * @param {number} minDecimals - Minimum decimal places (default: 4)
 * @param {number} maxDecimals - Maximum decimal places (default: 8)
 * @returns {string} Formatted BTC amount
 */
function formatBTC(satoshis, minDecimals = 4, maxDecimals = 8) {
  if (!satoshis || satoshis === 0) return '0 BTC';

  const btc = satoshis / 100000000;

  if (btc >= 1) {
    return `${btc.toFixed(minDecimals)} BTC`;
  } else if (btc >= 0.001) {
    return `${btc.toFixed(6)} BTC`;
  } else {
    return `${btc.toFixed(maxDecimals)} BTC`;
  }
}

/**
 * Format lamports to SOL with proper decimals
 * @param {number} lamports - Amount in lamports
 * @param {number} minDecimals - Minimum decimal places (default: 2)
 * @param {number} maxDecimals - Maximum decimal places (default: 4)
 * @returns {string} Formatted SOL amount
 */
function formatSOL(lamports, minDecimals = 2, maxDecimals = 4) {
  if (!lamports || lamports === 0) return '0 SOL';

  const sol = lamports / 1000000000;

  if (sol >= 1) {
    return `${sol.toFixed(minDecimals)} SOL`;
  } else if (sol >= 0.001) {
    return `${sol.toFixed(3)} SOL`;
  } else {
    return `${sol.toFixed(maxDecimals)} SOL`;
  }
}

// ============================================================================
// TRANSACTION/ADDRESS UTILITIES
// ============================================================================

/**
 * Shorten a hash/address for display
 * @param {string} hash - Full hash or address
 * @param {number} prefixLen - Number of characters to show at start (default: 8)
 * @param {number} suffixLen - Number of characters to show at end (default: 8)
 * @returns {string} Shortened hash (e.g., "1234abcd...5678efgh")
 */
function shortenHash(hash, prefixLen = 8, suffixLen = 8) {
  if (!hash || hash.length < (prefixLen + suffixLen + 3)) {
    return hash;
  }
  return `${hash.slice(0, prefixLen)}...${hash.slice(-suffixLen)}`;
}

/**
 * Validate Bitcoin address format
 * Supports: bc1 (bech32), 1 (P2PKH), 3 (P2SH)
 * @param {string} address - Bitcoin address
 * @returns {boolean} True if valid format
 */
function isValidBitcoinAddress(address) {
  if (!address || typeof address !== 'string') return false;
  const regex = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/;
  return regex.test(address);
}

/**
 * Validate Ethereum address format
 * @param {string} address - Ethereum address
 * @returns {boolean} True if valid format
 */
function isValidEthereumAddress(address) {
  if (!address || typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate Solana address format (base58, 32-44 chars)
 * @param {string} address - Solana address
 * @returns {boolean} True if valid format
 */
function isValidSolanaAddress(address) {
  if (!address || typeof address !== 'string') return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

// ============================================================================
// EXPLORER URL UTILITIES
// ============================================================================

/**
 * Get Bitcoin explorer URL
 * @param {string} txid - Transaction ID
 * @param {string} explorer - Explorer name: 'blockstream', 'blockchain', 'mempool' (default: 'blockstream')
 * @returns {string} Explorer URL
 */
function getBitcoinExplorerUrl(txid, explorer = 'blockstream') {
  const explorers = {
    'blockstream': `https://blockstream.info/tx/${txid}`,
    'blockchain': `https://www.blockchain.com/btc/tx/${txid}`,
    'mempool': `https://mempool.space/tx/${txid}`
  };
  return explorers[explorer] || explorers['blockstream'];
}

/**
 * Get Solana explorer URL
 * @param {string} signature - Transaction signature
 * @param {string} explorer - Explorer name: 'solscan', 'solana' (default: 'solscan')
 * @param {string} cluster - Network cluster: 'mainnet-beta', 'devnet', 'testnet' (default: 'mainnet-beta')
 * @returns {string} Explorer URL
 */
function getSolanaExplorerUrl(signature, explorer = 'solscan', cluster = 'mainnet-beta') {
  if (explorer === 'solana') {
    return `https://explorer.solana.com/tx/${signature}${cluster !== 'mainnet-beta' ? `?cluster=${cluster}` : ''}`;
  }
  // Default: Solscan
  return `https://solscan.io/tx/${signature}`;
}

/**
 * Get Ethereum explorer URL
 * @param {string} txHash - Transaction hash
 * @param {string} network - Network name: 'mainnet', 'sepolia', etc. (default: 'mainnet')
 * @returns {string} Etherscan URL
 */
function getEthereumExplorerUrl(txHash, network = 'mainnet') {
  if (network === 'mainnet') {
    return `https://etherscan.io/tx/${txHash}`;
  }
  return `https://${network}.etherscan.io/tx/${txHash}`;
}

// ============================================================================
// API ERROR HANDLING UTILITIES
// ============================================================================

/**
 * Standardized API error handler
 * @param {Error} error - Axios error object
 * @param {string} context - Context description (e.g., "validating mint address")
 * @param {Object} options - Options for error handling
 * @returns {Object} Standardized error response
 */
function handleApiError(error, context, options = {}) {
  const {
    notFoundMessage = 'Resource not found',
    rateLimitMessage = 'API rate limit exceeded',
    defaultMessage = 'API request failed'
  } = options;

  // Handle 404 - Not Found
  if (error.response?.status === 404) {
    logger.warn(`${context}: Not found (404)`);
    return {
      success: false,
      isValid: false,
      reason: notFoundMessage,
      statusCode: 404
    };
  }

  // Handle 429 - Rate Limited
  if (error.response?.status === 429) {
    logger.warn(`${context}: Rate limited (429)`);
    return {
      success: false,
      isValid: false,
      reason: rateLimitMessage,
      statusCode: 429
    };
  }

  // Handle timeout
  if (error.code === 'ECONNABORTED') {
    logger.warn(`${context}: Request timeout`);
    return {
      success: false,
      isValid: false,
      reason: 'Request timeout - API may be slow',
      statusCode: 408
    };
  }

  // Handle generic errors
  logger.error(`${context}:`, error.message);
  return {
    success: false,
    isValid: false,
    reason: error.response?.data?.message || error.message || defaultMessage,
    statusCode: error.response?.status || 500
  };
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate collection slug format
 * @param {string} slug - Collection slug
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
function validateCollectionSlug(slug, options = {}) {
  const {
    allowSpaces = false,
    allowSlashes = false,
    pattern = null
  } = options;

  if (!slug || typeof slug !== 'string') {
    return { isValid: false, reason: 'Invalid collection slug format' };
  }

  // Check for spaces (if not allowed)
  if (!allowSpaces && slug.includes(' ')) {
    return { isValid: false, reason: 'Collection slug contains spaces' };
  }

  // Check for slashes (if not allowed)
  if (!allowSlashes && slug.includes('/')) {
    return { isValid: false, reason: 'Collection slug contains slashes' };
  }

  // Check custom pattern
  if (pattern && !pattern.test(slug)) {
    return { isValid: false, reason: 'Collection slug contains invalid characters' };
  }

  return {
    isValid: true,
    collectionSlug: slug,
    note: 'Collection slug format is valid'
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Currency conversions
  convertBTCToSats,
  convertSatsToBTC,
  convertSolToLamports,
  convertLamportsToSol,

  // Formatting
  formatBTC,
  formatSOL,

  // Transaction/address utilities
  shortenHash,
  isValidBitcoinAddress,
  isValidEthereumAddress,
  isValidSolanaAddress,

  // Explorer URLs
  getBitcoinExplorerUrl,
  getSolanaExplorerUrl,
  getEthereumExplorerUrl,

  // Error handling
  handleApiError,

  // Validation
  validateCollectionSlug
};
