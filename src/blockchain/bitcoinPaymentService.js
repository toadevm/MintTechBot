const axios = require('axios');
const logger = require('../services/logger');

/**
 * Bitcoin Payment Verification Service
 *
 * Handles verification of BTC payments for:
 * - Trending boosts
 * - Image fee payments
 * - Footer advertisement payments
 *
 * Uses Blockstream API (free, no API key required) for transaction verification
 */
class BitcoinPaymentService {
  constructor(paymentAddress = null) {
    // Your BTC payment receiver address
    this.paymentAddress = paymentAddress || process.env.BITCOIN_PAYMENT_ADDRESS;

    // Blockstream API (free, reliable)
    this.apiUrl = 'https://blockstream.info/api';

    // Satoshis per BTC
    this.SATS_PER_BTC = 100000000;

    logger.info(`BitcoinPaymentService initialized`);
    logger.info(`💰 BTC Payment address: ${this.paymentAddress}`);
  }

  /**
   * Initialize the Bitcoin payment service
   */
  async initialize() {
    try {
      // Test API connectivity by getting latest block
      const response = await axios.get(`${this.apiUrl}/blocks/tip/height`, {
        timeout: 10000
      });

      const blockHeight = response.data;
      logger.info(`✅ Bitcoin API connected successfully. Latest block: ${blockHeight}`);
      logger.info(`💰 Payment receiver address: ${this.paymentAddress}`);

      return true;
    } catch (error) {
      logger.error('Failed to initialize Bitcoin API connection:', error.message);
      throw error;
    }
  }

  /**
   * Get transaction details from Bitcoin blockchain
   * @param {string} txid - Transaction ID (hash)
   * @returns {Promise<Object>} Transaction details
   */
  async getTransaction(txid) {
    try {
      logger.info(`Fetching Bitcoin transaction: ${txid}`);

      const response = await axios.get(`${this.apiUrl}/tx/${txid}`, {
        timeout: 15000
      });

      if (!response.data) {
        throw new Error('Transaction not found');
      }

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Transaction not found. Make sure the transaction is confirmed on the Bitcoin blockchain.');
      }
      logger.error(`Error fetching Bitcoin transaction ${txid}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if transaction is confirmed
   * @param {string} txid - Transaction ID
   * @returns {Promise<Object>} Confirmation status with block info
   */
  async getTransactionConfirmations(txid) {
    try {
      const tx = await this.getTransaction(txid);

      if (!tx.status || !tx.status.confirmed) {
        return {
          confirmed: false,
          confirmations: 0
        };
      }

      // Get current block height
      const currentHeightResponse = await axios.get(`${this.apiUrl}/blocks/tip/height`, {
        timeout: 10000
      });
      const currentHeight = currentHeightResponse.data;

      // Calculate confirmations
      const confirmations = currentHeight - tx.status.block_height + 1;

      return {
        confirmed: true,
        confirmations: confirmations,
        blockHeight: tx.status.block_height,
        blockTime: tx.status.block_time
      };
    } catch (error) {
      logger.error(`Error checking confirmations for ${txid}:`, error.message);
      throw error;
    }
  }

  /**
   * Validate a Bitcoin transaction for payment
   * @param {string} txid - Transaction ID
   * @param {number} expectedBTC - Expected amount in BTC
   * @param {string} expectedRecipient - Expected recipient address (defaults to payment address)
   * @param {number} minConfirmations - Minimum confirmations required (default: 1)
   * @returns {Promise<Object>} Validation result
   */
  async validateBitcoinTransaction(txid, expectedBTC, expectedRecipient = null, minConfirmations = 1) {
    try {
      const recipient = expectedRecipient || this.paymentAddress;
      logger.info(`Validating Bitcoin payment: txid=${txid}, expected=${expectedBTC} BTC, recipient=${recipient}`);

      // 1. Fetch transaction
      const tx = await this.getTransaction(txid);

      // 2. Check if transaction is confirmed
      const confirmationInfo = await this.getTransactionConfirmations(txid);

      if (!confirmationInfo.confirmed) {
        return {
          valid: false,
          reason: 'Transaction not yet confirmed on Bitcoin blockchain. Please wait for at least 1 confirmation.'
        };
      }

      if (confirmationInfo.confirmations < minConfirmations) {
        return {
          valid: false,
          reason: `Transaction needs ${minConfirmations} confirmations, currently has ${confirmationInfo.confirmations}`
        };
      }

      // 3. Find output to our payment address
      let amountReceived = 0;
      let outputFound = false;

      for (const vout of tx.vout) {
        if (vout.scriptpubkey_address === recipient) {
          amountReceived += vout.value; // value is in satoshis
          outputFound = true;
        }
      }

      if (!outputFound) {
        return {
          valid: false,
          reason: `Payment recipient ${recipient} not found in transaction outputs`
        };
      }

      if (amountReceived <= 0) {
        return {
          valid: false,
          reason: `No BTC received by payment address. Amount: ${amountReceived / this.SATS_PER_BTC} BTC`
        };
      }

      // 4. Verify amount matches expected (with small tolerance for rounding)
      const expectedSats = Math.round(expectedBTC * this.SATS_PER_BTC);
      const tolerance = 1000; // Allow 0.00001 BTC tolerance for rounding

      if (Math.abs(amountReceived - expectedSats) > tolerance) {
        return {
          valid: false,
          reason: `Amount mismatch: expected ${expectedBTC} BTC (${expectedSats} sats), received ${amountReceived / this.SATS_PER_BTC} BTC (${amountReceived} sats)`
        };
      }

      // 5. Get sender (first input address)
      let sender = 'unknown';
      if (tx.vin && tx.vin.length > 0 && tx.vin[0].prevout) {
        sender = tx.vin[0].prevout.scriptpubkey_address || 'unknown';
      }

      logger.info(`✅ Bitcoin payment validated: ${amountReceived / this.SATS_PER_BTC} BTC from ${sender}, ${confirmationInfo.confirmations} confirmations`);

      return {
        valid: true,
        amount: amountReceived.toString(),
        amountBTC: amountReceived / this.SATS_PER_BTC,
        sender: sender,
        recipient: recipient,
        confirmations: confirmationInfo.confirmations,
        blockHeight: confirmationInfo.blockHeight,
        blockTime: confirmationInfo.blockTime,
        txid: txid
      };

    } catch (error) {
      logger.error(`Error validating Bitcoin transaction ${txid}:`, error.message);
      return {
        valid: false,
        reason: `Validation error: ${error.message}`
      };
    }
  }

  /**
   * Convert BTC to satoshis
   * @param {number} btc - Amount in BTC
   * @returns {number} Amount in satoshis
   */
  convertBTCToSats(btc) {
    return Math.round(btc * this.SATS_PER_BTC);
  }

  /**
   * Convert satoshis to BTC
   * @param {number} sats - Amount in satoshis
   * @returns {number} Amount in BTC
   */
  convertSatsToBTC(sats) {
    return sats / this.SATS_PER_BTC;
  }

  /**
   * Get current balance of payment address
   * @returns {Promise<number>} Balance in BTC
   */
  async getPaymentAddressBalance() {
    try {
      const response = await axios.get(`${this.apiUrl}/address/${this.paymentAddress}`, {
        timeout: 10000
      });

      const addressInfo = response.data;
      const balanceSats = addressInfo.chain_stats.funded_txo_sum - addressInfo.chain_stats.spent_txo_sum;

      return balanceSats / this.SATS_PER_BTC;
    } catch (error) {
      logger.error('Error getting payment address balance:', error.message);
      throw error;
    }
  }

  /**
   * Get address transaction history
   * @param {string} address - Bitcoin address
   * @returns {Promise<Array>} Array of transactions
   */
  async getAddressTransactions(address = null) {
    try {
      const addr = address || this.paymentAddress;
      const response = await axios.get(`${this.apiUrl}/address/${addr}/txs`, {
        timeout: 15000
      });

      return response.data;
    } catch (error) {
      logger.error(`Error getting transactions for address ${address}:`, error.message);
      throw error;
    }
  }

  /**
   * Format transaction ID for display (shortened)
   * @param {string} txid - Full transaction ID
   * @returns {string} Shortened txid
   */
  shortenTxid(txid) {
    if (!txid || txid.length < 16) return txid;
    return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
  }

  /**
   * Get Blockstream Explorer URL for transaction
   * @param {string} txid - Transaction ID
   * @returns {string} Explorer URL
   */
  getExplorerUrl(txid) {
    return `https://blockstream.info/tx/${txid}`;
  }

  /**
   * Get Blockchain.com Explorer URL for transaction (alternative)
   * @param {string} txid - Transaction ID
   * @returns {string} Blockchain.com URL
   */
  getBlockchainComUrl(txid) {
    return `https://www.blockchain.com/btc/tx/${txid}`;
  }

  /**
   * Get Mempool.space Explorer URL for transaction (alternative)
   * @param {string} txid - Transaction ID
   * @returns {string} Mempool.space URL
   */
  getMempoolSpaceUrl(txid) {
    return `https://mempool.space/tx/${txid}`;
  }

  /**
   * Validate address format
   * @param {string} address - Bitcoin address
   * @returns {boolean} True if valid format
   */
  isValidAddress(address) {
    // Basic validation for Bitcoin addresses
    // bc1 (bech32), 1 (P2PKH), 3 (P2SH)
    const regex = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/;
    return regex.test(address);
  }
}

module.exports = BitcoinPaymentService;
