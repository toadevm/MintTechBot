const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const logger = require('../services/logger');
const addresses = require('../config/addresses');
const {
  convertSolToLamports,
  convertLamportsToSol,
  shortenHash,
  getSolanaExplorerUrl
} = require('./utils');

/**
 * Solana Payment Verification Service
 *
 * Handles verification of SOL payments for:
 * - Trending boosts
 * - Image fee payments
 * - Footer advertisement payments
 *
 * Uses Helius RPC for reliable transaction fetching
 */
class SolanaPaymentService {
  constructor(rpcUrl = null, paymentAddress = null) {
    // Use Helius RPC if available, otherwise public RPC
    this.rpcUrl = rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    // Your SOL payment receiver address (from centralized config)
    this.paymentAddress = paymentAddress || addresses.solana.paymentWallet;

    // Initialize Solana connection
    this.connection = null;

    logger.info(`SolanaPaymentService initialized with RPC: ${this.rpcUrl}`);
  }

  /**
   * Initialize the Solana connection
   */
  async initialize() {
    try {
      this.connection = new Connection(this.rpcUrl, 'confirmed');

      // Test connection by getting slot
      const slot = await this.connection.getSlot();
      logger.info(`✅ Solana RPC connected successfully at slot: ${slot}`);
      logger.info(`💰 Payment receiver address: ${this.paymentAddress}`);

      return true;
    } catch (error) {
      logger.error('Failed to initialize Solana connection:', error);
      throw error;
    }
  }

  /**
   * Get transaction details from Solana blockchain
   * @param {string} signature - Transaction signature (base58)
   * @returns {Promise<Object>} Transaction details
   */
  async getTransaction(signature) {
    try {
      logger.info(`Fetching Solana transaction: ${signature}`);

      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });

      if (!tx) {
        throw new Error('Transaction not found. It may not be confirmed yet.');
      }

      return tx;
    } catch (error) {
      logger.error(`Error fetching Solana transaction ${signature}:`, error);
      throw error;
    }
  }

  /**
   * Validate a Solana transaction for payment
   * @param {string} signature - Transaction signature
   * @param {number} expectedSol - Expected amount in SOL
   * @param {string} expectedRecipient - Expected recipient address (defaults to payment address)
   * @returns {Promise<Object>} Validation result
   */
  async validateSolanaTransaction(signature, expectedSol, expectedRecipient = null) {
    try {
      const recipient = expectedRecipient || this.paymentAddress;
      logger.info(`Validating Solana payment: signature=${signature}, expected=${expectedSol} SOL, recipient=${recipient}`);

      // 1. Fetch transaction
      const tx = await this.getTransaction(signature);

      // 2. Check if transaction succeeded
      if (tx.meta.err) {
        return {
          valid: false,
          reason: `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`
        };
      }

      // 3. Parse accounts from transaction
      const { accountKeys } = tx.transaction.message;
      const { preBalances, postBalances } = tx.meta;

      // 4. Find recipient account index
      const recipientPubkey = new PublicKey(recipient);
      let recipientIndex = -1;

      for (let i = 0; i < accountKeys.length; i++) {
        if (accountKeys[i].equals(recipientPubkey)) {
          recipientIndex = i;
          break;
        }
      }

      if (recipientIndex === -1) {
        return {
          valid: false,
          reason: `Payment recipient ${recipient} not found in transaction`
        };
      }

      // 5. Calculate amount received by recipient
      const preBalance = preBalances[recipientIndex];
      const postBalance = postBalances[recipientIndex];
      const amountReceived = postBalance - preBalance;

      if (amountReceived <= 0) {
        return {
          valid: false,
          reason: `No SOL received by payment address. Amount: ${amountReceived / LAMPORTS_PER_SOL} SOL`
        };
      }

      // 6. Verify amount matches expected (with small tolerance for rounding)
      const expectedLamports = Math.round(expectedSol * LAMPORTS_PER_SOL);
      const tolerance = 1000; // Allow 0.000001 SOL tolerance for rounding

      if (Math.abs(amountReceived - expectedLamports) > tolerance) {
        return {
          valid: false,
          reason: `Amount mismatch: expected ${expectedSol} SOL (${expectedLamports} lamports), received ${amountReceived / LAMPORTS_PER_SOL} SOL (${amountReceived} lamports)`
        };
      }

      // 7. Get sender (first signer, fee payer)
      const sender = accountKeys[0].toString();

      logger.info(`✅ Solana payment validated: ${amountReceived / LAMPORTS_PER_SOL} SOL from ${sender}`);

      return {
        valid: true,
        amount: amountReceived.toString(),
        amountSol: amountReceived / LAMPORTS_PER_SOL,
        sender: sender,
        recipient: recipient,
        slot: tx.slot,
        blockTime: tx.blockTime,
        signature: signature
      };

    } catch (error) {
      logger.error(`Error validating Solana transaction ${signature}:`, error);
      return {
        valid: false,
        reason: `Validation error: ${error.message}`
      };
    }
  }

  /**
   * Convert SOL to lamports - delegates to shared utility
   * @param {number} sol - Amount in SOL
   * @returns {number} Amount in lamports
   */
  convertSolToLamports(sol) {
    return convertSolToLamports(sol);
  }

  /**
   * Convert lamports to SOL - delegates to shared utility
   * @param {number} lamports - Amount in lamports
   * @returns {number} Amount in SOL
   */
  convertLamportsToSol(lamports) {
    return convertLamportsToSol(lamports);
  }

  /**
   * Get current balance of payment address
   * @returns {Promise<number>} Balance in SOL
   */
  async getPaymentAddressBalance() {
    try {
      const pubkey = new PublicKey(this.paymentAddress);
      const balance = await this.connection.getBalance(pubkey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      logger.error('Error getting payment address balance:', error);
      throw error;
    }
  }

  /**
   * Check if a transaction is confirmed
   * @param {string} signature - Transaction signature
   * @returns {Promise<boolean>} True if confirmed
   */
  async isTransactionConfirmed(signature) {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      return status.value?.confirmationStatus === 'confirmed' ||
             status.value?.confirmationStatus === 'finalized';
    } catch (error) {
      logger.error(`Error checking confirmation status for ${signature}:`, error);
      return false;
    }
  }

  /**
   * Format transaction signature for display (shortened) - delegates to shared utility
   * @param {string} signature - Full transaction signature
   * @returns {string} Shortened signature
   */
  shortenSignature(signature) {
    return shortenHash(signature);
  }

  /**
   * Get Solana Explorer URL for transaction - delegates to shared utility
   * @param {string} signature - Transaction signature
   * @param {string} cluster - Network cluster (mainnet-beta, devnet, testnet)
   * @returns {string} Explorer URL
   */
  getExplorerUrl(signature, cluster = 'mainnet-beta') {
    return getSolanaExplorerUrl(signature, 'solana', cluster);
  }

  /**
   * Get Solscan URL for transaction (alternative explorer) - delegates to shared utility
   * @param {string} signature - Transaction signature
   * @returns {string} Solscan URL
   */
  getSolscanUrl(signature) {
    return getSolanaExplorerUrl(signature, 'solscan');
  }
}

module.exports = SolanaPaymentService;
