/**
 * Centralized Payment Addresses Configuration
 *
 * All blockchain payment addresses for the bot are defined here.
 * Change these addresses in ONE place instead of scattered across the codebase.
 */

module.exports = {
  // ========================================
  // ETHEREUM PAYMENT ADDRESSES
  // ========================================

  ethereum: {
    // Primary payment receiver contract for trending boosts, image fees, footer ads
    paymentContract: '0x4704eaF9d285a1388c0370Bc7d05334d313f92Be',

    // Legacy/deprecated contracts (kept for reference)
    legacyTrendingContract: '0xC8b19a7CF4Aed5f4BB7315f706e6971b504F1c3b', // Deprecated

    // Sample/test NFT contracts
    mongsInspiredNFT: '0xb4a7d131436ed8EC06aD696FA3BF8d23C0aB3Acf'
  },

  // ========================================
  // SOLANA PAYMENT ADDRESSES
  // ========================================

  solana: {
    // Wallet address for receiving SOL payments (trending, image fees, footer ads)
    paymentWallet: '5dBMD7r6UrS6FA7oNLMEn5isMdXYnZqWb9kxUp3kUSzm',

    // Magic Eden program address (for tracking Solana NFT marketplace)
    magicEdenProgram: 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K'
  },

  // ========================================
  // BITCOIN PAYMENT ADDRESSES
  // ========================================

  bitcoin: {
    // Bitcoin wallet address for receiving BTC payments
    paymentWallet: 'bc1qssersue5jn8u03qra5y3a7uxh9y8ydftjnfh57'
  },

  // ========================================
  // MULTI-CHAIN CONFIGURATION
  // ========================================

  // Get payment address for any chain
  getPaymentAddress(chainName) {
    const normalized = chainName.toLowerCase();

    switch (normalized) {
      case 'ethereum':
      case 'eth':
      case 'polygon':
      case 'arbitrum':
      case 'base':
      case 'zksync':
      case 'optimism':
      case 'avalanche':
      case 'bnb':
      case 'ronin':
      case 'sei':
        // All EVM chains use the same Ethereum payment contract
        return this.ethereum.paymentContract;

      case 'solana':
      case 'sol':
        return this.solana.paymentWallet;

      case 'bitcoin':
      case 'btc':
        return this.bitcoin.paymentWallet;

      default:
        throw new Error(`Unknown chain: ${chainName}`);
    }
  },

  // Get payment type for a chain (contract vs wallet)
  getPaymentType(chainName) {
    const normalized = chainName.toLowerCase();

    if (['ethereum', 'eth', 'polygon', 'arbitrum', 'base', 'zksync', 'optimism', 'avalanche', 'bnb', 'ronin', 'sei'].includes(normalized)) {
      return 'contract';
    } else if (['solana', 'sol'].includes(normalized)) {
      return 'wallet';
    } else if (['bitcoin', 'btc'].includes(normalized)) {
      return 'wallet';
    }
    return 'unknown';
  }
};
