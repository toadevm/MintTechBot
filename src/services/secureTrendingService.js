const { ethers } = require('ethers');
const logger = require('./logger');
const SolanaPaymentService = require('../blockchain/solanaPaymentService');

// Simple Payment Receiver ABI (minimal functions only)
const SIMPLE_PAYMENT_RECEIVER_ABI = [
  {
    "inputs": [{"internalType": "uint256", "name": "paymentId", "type": "uint256"}],
    "name": "getPayment",
    "outputs": [
      {"internalType": "address", "name": "payer", "type": "address"},
      {"internalType": "uint256", "name": "amount", "type": "uint256"},
      {"internalType": "uint256", "name": "timestamp", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getBalance",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "count", "type": "uint256"}],
    "name": "getRecentPayments",
    "outputs": [
      {"internalType": "uint256[]", "name": "paymentIds", "type": "uint256[]"},
      {"internalType": "address[]", "name": "payers", "type": "address[]"},
      {"internalType": "uint256[]", "name": "amounts", "type": "uint256[]"},
      {"internalType": "uint256[]", "name": "timestamps", "type": "uint256[]"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "uint256", "name": "paymentId", "type": "uint256"},
      {"indexed": true, "internalType": "address", "name": "payer", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"},
      {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
    ],
    "name": "PaymentReceived",
    "type": "event"
  }
];

class SecureTrendingService {
  constructor(database, chainManager = null) {
    this.db = database;
    this.chainManager = chainManager;
    this.simplePaymentContract = process.env.SIMPLE_PAYMENT_CONTRACT_ADDRESS || '0x4704eaF9d285a1388c0370Bc7d05334d313f92Be';
    this.contract = null;
    this.provider = null;

    // Solana payment service
    this.solanaPaymentService = null;
    this.solanaPaymentAddress = '5dBMD7r6UrS6FA7oNLMEn5isMdXYnZqWb9kxUp3kUSzm';
    
    // Predefined trending fees (in Wei) - no smart contract dependency
    this.trendingFees = {
      normal: {
        6: ethers.parseEther('0.0625'),   // 6hrs: 0.0625 ETH
        12: ethers.parseEther('0.1125'),  // 12hrs: 0.1125 ETH
        18: ethers.parseEther('0.151'),   // 18hrs: 0.151 ETH
        24: ethers.parseEther('0.20')     // 24hrs: 0.20 ETH
      },
      premium: {
        6: ethers.parseEther('0.125'),    // 6hrs: 0.125 ETH
        12: ethers.parseEther('0.225'),   // 12hrs: 0.225 ETH
        18: ethers.parseEther('0.32'),    // 18hrs: 0.32 ETH
        24: ethers.parseEther('0.40')     // 24hrs: 0.40 ETH
      }
    };

    // Image fee configuration (multiple durations)
    this.imageFees = {
      30: ethers.parseEther('0.004'),   // 30 days: 0.004 ETH
      60: ethers.parseEther('0.008'),   // 60 days: 0.008 ETH
      90: ethers.parseEther('0.012'),   // 90 days: 0.012 ETH
      180: ethers.parseEther('0.024'),  // 180 days: 0.024 ETH
      365: ethers.parseEther('0.048')   // 365 days: 0.048 ETH
    };

    // Footer ad fee configuration (multiple durations)
    this.footerFees = {
      30: ethers.parseEther('1.0'),     // 30 days: 1.0 ETH
      60: ethers.parseEther('2.0'),     // 60 days: 2.0 ETH
      90: ethers.parseEther('3.0'),     // 90 days: 3.0 ETH
      180: ethers.parseEther('6.0'),    // 180 days: 6.0 ETH
      365: ethers.parseEther('12.0')    // 365 days: 12.0 ETH
    };
  }

  async initialize() {
    try {
      // Initialize Ethereum payment verification
      if (!this.simplePaymentContract) {
        logger.warn('No simple payment contract address provided. ETH trending payments will be unavailable.');
      } else {
        const alchemyUrl = `https://eth-mainnet.g.alchemy.com/v2/kAmtb3hCAJaBhgQWSJBVs`;
        this.provider = new ethers.JsonRpcProvider(alchemyUrl);

        // Read-only contract instance (no private key needed)
        this.contract = new ethers.Contract(this.simplePaymentContract, SIMPLE_PAYMENT_RECEIVER_ABI, this.provider);
        logger.info(`✅ ETH payment verification initialized: ${this.simplePaymentContract}`);
      }

      // Initialize Solana payment verification
      try {
        this.solanaPaymentService = new SolanaPaymentService();
        await this.solanaPaymentService.initialize();
        logger.info(`✅ SOL payment verification initialized: ${this.solanaPaymentAddress}`);
      } catch (solanaError) {
        logger.warn('Failed to initialize Solana payment service:', solanaError.message);
        logger.warn('SOL trending payments will be unavailable.');
      }

      return true;
    } catch (error) {
      logger.error('Failed to initialize secure trending service:', error);
      throw error;
    }
  }

  // Get transaction details from blockchain (read-only)
  async getTransaction(txHash) {
    try {
      const tx = await this.provider.getTransaction(txHash);
      const receipt = await this.provider.getTransactionReceipt(txHash);
      return {
        transaction: tx,
        receipt: receipt,
        status: receipt ? (receipt.status === 1 ? 'success' : 'failed') : 'pending'
      };
    } catch (error) {
      logger.error(`Error getting transaction ${txHash}:`, error);
      throw error;
    }
  }

  // Calculate trending fee (no smart contract call needed)
  calculateTrendingFee(durationHours, isPremium = false) {
    const validDurations = [6, 12, 18, 24];
    
    if (!validDurations.includes(durationHours)) {
      throw new Error('Invalid duration. Must be 6, 12, 18, or 24 hours');
    }

    const feeType = isPremium ? 'premium' : 'normal';
    const fee = this.trendingFees[feeType][durationHours];
    
    logger.info(`Calculated ${feeType} trending fee for ${durationHours}h: ${ethers.formatEther(fee)} ETH`);
    return fee;
  }

  // Get all trending options (no smart contract dependency)
  getTrendingOptions() {
    const trendingOptions = [];
    const durations = [6, 12, 18, 24];
    
    for (const duration of durations) {
      trendingOptions.push({
        duration: duration,
        label: `${duration} Hours`,
        normalFee: this.trendingFees.normal[duration].toString(),
        normalFeeEth: ethers.formatEther(this.trendingFees.normal[duration]),
        premiumFee: this.trendingFees.premium[duration].toString(),
        premiumFeeEth: ethers.formatEther(this.trendingFees.premium[duration])
      });
    }

    return trendingOptions;
  }

  // Calculate image fee for specified duration
  calculateImageFee(durationDays) {
    const validDurations = [30, 60, 90, 180, 365];

    if (!validDurations.includes(durationDays)) {
      throw new Error('Invalid duration. Must be 30, 60, 90, 180, or 365 days');
    }

    const fee = this.imageFees[durationDays];
    logger.info(`Calculated image fee for ${durationDays} days: ${ethers.formatEther(fee)} ETH`);
    return fee;
  }

  // Calculate footer fee for specified duration
  calculateFooterFee(durationDays) {
    const validDurations = [30, 60, 90, 180, 365];

    if (!validDurations.includes(durationDays)) {
      throw new Error('Invalid duration. Must be 30, 60, 90, 180, or 365 days');
    }

    const fee = this.footerFees[durationDays];
    logger.info(`Calculated footer fee for ${durationDays} days: ${ethers.formatEther(fee)} ETH`);
    return fee;
  }

  // Get all image fee options
  getImageFeeOptions() {
    const imageOptions = [];
    const durations = [30, 60, 90, 180, 365];

    for (const duration of durations) {
      imageOptions.push({
        duration: duration,
        label: `${duration} Days`,
        fee: this.imageFees[duration].toString(),
        feeEth: ethers.formatEther(this.imageFees[duration])
      });
    }

    return imageOptions;
  }

  // ========== SOLANA FEE CALCULATION ==========

  /**
   * Calculate Solana trending fee (dynamic USD-equivalent pricing)
   * @param {number} durationHours - Duration in hours (6, 12, 18, 24)
   * @param {boolean} isPremium - Whether it's a premium trending
   * @returns {Promise<number>} Fee in SOL
   */
  async calculateSolanaTrendingFee(durationHours, isPremium = false) {
    try {
      if (!this.priceService) {
        throw new Error('Price service not available for Solana fee calculation');
      }

      // Get ETH fee in wei
      const ethFeeWei = this.calculateTrendingFee(durationHours, isPremium);
      const ethFeeAmount = parseFloat(ethers.formatEther(ethFeeWei));

      // Get current ETH and SOL prices
      const ethPrice = await this.priceService.getTokenPrice('ETH');
      const solPrice = await this.priceService.getTokenPrice('SOL');

      if (!ethPrice || !solPrice) {
        throw new Error('Failed to fetch token prices');
      }

      // Calculate USD value of ETH fee
      const usdValue = ethFeeAmount * ethPrice;

      // Calculate equivalent SOL amount
      const solAmount = usdValue / solPrice;

      logger.info(`💰 SOL Fee Calculation: ${ethFeeAmount} ETH ($${ethPrice}) = $${usdValue.toFixed(2)} = ${solAmount.toFixed(4)} SOL ($${solPrice})`);

      return solAmount;
    } catch (error) {
      logger.error('Error calculating Solana trending fee:', error);
      throw error;
    }
  }

  /**
   * Calculate Solana image fee (dynamic USD-equivalent pricing)
   * @param {number} durationDays - Duration in days (30, 60, 90, 180, 365)
   * @returns {Promise<number>} Fee in SOL
   */
  async calculateSolanaImageFee(durationDays) {
    try {
      if (!this.priceService) {
        throw new Error('Price service not available for Solana fee calculation');
      }

      const ethFeeWei = this.calculateImageFee(durationDays);
      const ethFeeAmount = parseFloat(ethers.formatEther(ethFeeWei));

      const ethPrice = await this.priceService.getTokenPrice('ETH');
      const solPrice = await this.priceService.getTokenPrice('SOL');

      if (!ethPrice || !solPrice) {
        throw new Error('Failed to fetch token prices');
      }

      const usdValue = ethFeeAmount * ethPrice;
      const solAmount = usdValue / solPrice;

      logger.info(`💰 SOL Image Fee: ${ethFeeAmount} ETH = $${usdValue.toFixed(2)} = ${solAmount.toFixed(4)} SOL`);

      return solAmount;
    } catch (error) {
      logger.error('Error calculating Solana image fee:', error);
      throw error;
    }
  }

  /**
   * Calculate Solana footer ad fee (dynamic USD-equivalent pricing)
   * @param {number} durationDays - Duration in days (30, 60, 90, 180, 365)
   * @returns {Promise<number>} Fee in SOL
   */
  async calculateSolanaFooterFee(durationDays) {
    try {
      if (!this.priceService) {
        throw new Error('Price service not available for Solana fee calculation');
      }

      const ethFeeWei = this.calculateFooterFee(durationDays);
      const ethFeeAmount = parseFloat(ethers.formatEther(ethFeeWei));

      const ethPrice = await this.priceService.getTokenPrice('ETH');
      const solPrice = await this.priceService.getTokenPrice('SOL');

      if (!ethPrice || !solPrice) {
        throw new Error('Failed to fetch token prices');
      }

      const usdValue = ethFeeAmount * ethPrice;
      const solAmount = usdValue / solPrice;

      logger.info(`💰 SOL Footer Fee: ${ethFeeAmount} ETH = $${usdValue.toFixed(2)} = ${solAmount.toFixed(4)} SOL`);

      return solAmount;
    } catch (error) {
      logger.error('Error calculating Solana footer fee:', error);
      throw error;
    }
  }

  // ========== END SOLANA FEE CALCULATION ==========

  // Get all footer fee options
  getFooterFeeOptions() {
    const footerOptions = [];
    const durations = [30, 60, 90, 180, 365];

    for (const duration of durations) {
      footerOptions.push({
        duration: duration,
        label: `${duration} Days`,
        fee: this.footerFees[duration].toString(),
        feeEth: ethers.formatEther(this.footerFees[duration])
      });
    }

    return footerOptions;
  }

  // Validate ETH transaction for trending payment
  async validateTrendingPayment(txHash, expectedAmount, expectedDuration) {
    try {
      logger.info(`Validating trending payment: tx=${txHash}, expected=${ethers.formatEther(expectedAmount)} ETH`);

      // Check if transaction already processed
      if (await this.db.isTransactionProcessed(txHash)) {
        return {
          valid: false,
          reason: 'Transaction already processed'
        };
      }

      const txData = await this.getTransaction(txHash);
      if (!txData.receipt || txData.receipt.status !== 1) {
        return {
          valid: false,
          reason: 'Transaction failed or not confirmed'
        };
      }

      // Verify transaction sent to correct contract
      if (txData.transaction.to?.toLowerCase() !== this.simplePaymentContract.toLowerCase()) {
        return {
          valid: false,
          reason: 'Transaction not sent to trending payment contract'
        };
      }

      // Verify amount matches expected payment
      const actualAmount = txData.transaction.value;
      if (actualAmount.toString() !== expectedAmount.toString()) {
        return {
          valid: false,
          reason: `Amount mismatch: expected ${ethers.formatEther(expectedAmount)} ETH, got ${ethers.formatEther(actualAmount)} ETH`
        };
      }

      return {
        valid: true,
        amount: actualAmount.toString(),
        payer: txData.transaction.from,
        blockNumber: txData.receipt.blockNumber,
        gasUsed: txData.receipt.gasUsed?.toString(),
        gasPrice: txData.transaction.gasPrice?.toString()
      };
    } catch (error) {
      logger.error(`Error validating trending payment ${txHash}:`, error);
      return {
        valid: false,
        reason: `Validation error: ${error.message}`
      };
    }
  }

  // ========== SOLANA PAYMENT VALIDATION ==========

  /**
   * Validate Solana transaction for trending payment
   * @param {string} signature - Solana transaction signature
   * @param {number} expectedSolAmount - Expected amount in SOL
   * @param {number} durationHours - Duration in hours
   * @returns {Promise<Object>} Validation result
   */
  async validateSolanaTrendingPayment(signature, expectedSolAmount, durationHours) {
    try {
      if (!this.solanaPaymentService) {
        return {
          valid: false,
          reason: 'Solana payment service not initialized'
        };
      }

      logger.info(`Validating Solana trending payment: sig=${signature}, expected=${expectedSolAmount} SOL`);

      // Check if transaction already processed
      if (await this.db.isTransactionProcessed(signature)) {
        return {
          valid: false,
          reason: 'Transaction already processed'
        };
      }

      // Validate transaction using Solana service
      const validation = await this.solanaPaymentService.validateSolanaTransaction(
        signature,
        expectedSolAmount,
        this.solanaPaymentAddress
      );

      if (!validation.valid) {
        return validation;
      }

      return {
        valid: true,
        amount: validation.amount, // lamports as string
        amountSol: validation.amountSol,
        payer: validation.sender,
        blockNumber: validation.slot,
        signature: signature
      };
    } catch (error) {
      logger.error(`Error validating Solana trending payment ${signature}:`, error);
      return {
        valid: false,
        reason: `Validation error: ${error.message}`
      };
    }
  }

  // ========== END SOLANA PAYMENT VALIDATION ==========

  // Process validated trending payment (secure - no private keys)
  async processValidatedTrendingPayment(userId, tokenId, txHash, durationHours, isPremium = false) {
    try {
      logger.info(`Processing validated trending payment: user=${userId}, token=${tokenId}, tx=${txHash}`);

      const expectedAmount = this.calculateTrendingFee(durationHours, isPremium);
      const validation = await this.validateTrendingPayment(txHash, expectedAmount, durationHours);
      
      if (!validation.valid) {
        return {
          success: false,
          error: validation.reason
        };
      }

      // Mark transaction as processed to prevent duplicates
      const purpose = isPremium ? 'premium_trending_payment' : 'normal_trending_payment';
      await this.db.markTransactionProcessed(
        txHash,
        this.simplePaymentContract,
        validation.payer,
        validation.amount,
        validation.blockNumber,
        purpose
      );

      // Add trending payment to database
      const dbResult = await this.db.addTrendingPayment(
        userId,
        tokenId,
        validation.amount,
        txHash,
        durationHours,
        validation.payer
      );

      logger.info(`Trending payment processed successfully: db_id=${dbResult.id}, tx=${txHash}`);
      
      return {
        success: true,
        dbId: dbResult.id,
        amount: validation.amount,
        amountEth: ethers.formatEther(validation.amount),
        duration: durationHours,
        isPremium: isPremium,
        payer: validation.payer,
        txHash: txHash
      };
    } catch (error) {
      logger.error(`Error processing validated trending payment:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate payment instructions (no private keys needed)
  async generatePaymentInstructions(tokenId, durationHours, userId, isPremium = false, chain = 'ethereum') {
    try {
      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE id = $1',
        [tokenId]
      );

      if (!token) {
        throw new Error('Token not found');
      }

      // Get chain-specific configuration
      const chainConfig = this.chainManager ? this.chainManager.getChain(chain) : null;
      const paymentContract = chainConfig ? chainConfig.paymentContract : this.simplePaymentContract;
      const currencySymbol = chainConfig ? chainConfig.currencySymbol : 'ETH';
      const chainDisplay = chainConfig ? chainConfig.displayName : 'Ethereum';
      const blockExplorer = this.getBlockExplorerUrl(chain, chainConfig);

      let fee, feeFormatted;

      // Calculate fee based on chain
      if (chain === 'solana') {
        // Dynamic SOL fee (USD-equivalent)
        const solFee = await this.calculateSolanaTrendingFee(durationHours, isPremium);
        fee = this.solanaPaymentService.convertSolToLamports(solFee);
        feeFormatted = solFee.toFixed(4);
      } else {
        // ETH fee (wei)
        fee = this.calculateTrendingFee(durationHours, isPremium);
        feeFormatted = ethers.formatEther(fee);
      }

      // Create pending payment record
      await this.db.createPendingPayment(userId, tokenId, fee.toString(), durationHours, chain);

      const instructions = {
        contractAddress: paymentContract,
        tokenAddress: token.contract_address,
        tokenName: token.token_name || 'Unknown Collection',
        duration: durationHours,
        fee: fee.toString(),
        feeEth: feeFormatted, // Keep name for compatibility but contains SOL for Solana
        isPremium: isPremium,
        chain: chain,
        instructions: [
          `1. <b>SEND EXACTLY ${feeEth.toUpperCase()} ${currencySymbol}</b> TO CONTRACT ADDRESS: ${paymentContract}`,
          `2. Use any ${chainDisplay} wallet on ${chainDisplay.toLowerCase()} network`,
          `3. No additional data or function calls required - just a simple ${currencySymbol} transfer`,
          '4. Wait for transaction confirmation',
          '5. Copy transaction hash and submit below'
        ],
        etherscanUrl: `${blockExplorer}/address/${paymentContract}`
      };

      return instructions;
    } catch (error) {
      logger.error('Error generating payment instructions:', error);
      throw error;
    }
  }

  getBlockExplorerUrl(chain, chainConfig) {
    if (chainConfig?.blockExplorerUrl) {
      return chainConfig.blockExplorerUrl;
    }
    // Fallback block explorer URLs
    const explorers = {
      'ethereum': 'https://etherscan.io',
      'arbitrum': 'https://arbiscan.io',
      'optimism': 'https://optimistic.etherscan.io',
      'avalanche': 'https://snowtrace.io',
      'bsc': 'https://bscscan.com',
      'moonbeam': 'https://moonscan.io'
    };
    return explorers[chain] || 'https://etherscan.io';
  }

  // Manual transaction validation for /validate command (supports both ETH and SOL)
  async validateUserTransaction(userId, txHash) {
    try {
      logger.info(`Manual validation requested: user=${userId}, tx=${txHash}`);

      // Detect chain based on transaction hash format
      // Solana signatures are base58 (~88 chars), ETH tx hashes are 0x + 64 hex (66 chars)
      const isSolana = txHash.length > 70 && !txHash.startsWith('0x');
      const chain = isSolana ? 'solana' : 'ethereum';

      logger.info(`Detected chain: ${chain} (tx length: ${txHash.length})`);

      if (isSolana) {
        return await this.validateSolanaUserTransaction(userId, txHash);
      } else {
        return await this.validateEthereumUserTransaction(userId, txHash);
      }
    } catch (error) {
      logger.error('Error in manual transaction validation:', error);
      return { success: false, error: `Validation error: ${error.message}` };
    }
  }

  // Validate Ethereum transaction (legacy method, now internal)
  async validateEthereumUserTransaction(userId, txHash) {
    try {
      // Check if transaction already processed
      if (await this.db.isTransactionProcessed(txHash)) {
        return {
          success: false,
          error: 'This transaction has already been processed.'
        };
      }

      // Get transaction details
      const txData = await this.getTransaction(txHash);
      if (!txData.receipt || txData.receipt.status !== 1) {
        return {
          success: false,
          error: 'Transaction failed or not confirmed on blockchain.'
        };
      }

      // Verify transaction sent to correct contract
      if (txData.transaction.to?.toLowerCase() !== this.simplePaymentContract.toLowerCase()) {
        return {
          success: false,
          error: `Transaction not sent to trending payment contract.\nExpected: ${this.simplePaymentContract}\nReceived: ${txData.transaction.to}`
        };
      }

      const paymentAmount = txData.transaction.value;
      const payerAddress = txData.transaction.from;

      logger.info(`Transaction validated: ${ethers.formatEther(paymentAmount)} ETH from ${payerAddress}`);

      // Find user's pending payments that match this amount (ETH chain)
      const userPendingPayments = await this.db.all(
        `SELECT pp.*, tt.token_name, tt.contract_address
         FROM pending_payments pp
         JOIN tracked_tokens tt ON pp.token_id = tt.id
         WHERE pp.user_id = $1 AND pp.expected_amount = $2 AND pp.is_matched = false AND pp.expires_at > NOW()
         AND (pp.chain_name = 'ethereum' OR pp.chain_name IS NULL)
         ORDER BY pp.created_at ASC`,
        [userId, paymentAmount.toString()]
      );

      if (userPendingPayments.length === 0) {
        return {
          success: false,
          error: `No matching pending payment found for ${ethers.formatEther(paymentAmount)} ETH.\nPlease use /buy_trending first to create a trending request.`
        };
      }

      // Take the first (oldest) matching pending payment
      const matchingPayment = userPendingPayments[0];

      logger.info(`Found matching pending payment: token=${matchingPayment.token_name}, duration=${matchingPayment.duration_hours}h`);

      // Mark transaction as processed to prevent duplicates
      await this.db.markTransactionProcessed(
        txHash,
        this.simplePaymentContract,
        payerAddress,
        paymentAmount.toString(),
        txData.receipt.blockNumber,
        'manual_trending_validation'
      );

      // Process the trending payment
      const result = await this.processValidatedTrendingPayment(
        userId,
        matchingPayment.token_id,
        txHash,
        matchingPayment.duration_hours,
        false // Normal trending for manual validation
      );

      if (result.success) {
        // Mark pending payment as matched
        await this.db.markPendingPaymentMatched(matchingPayment.id, txHash);
        logger.info(`Manual validation successful: ${matchingPayment.token_name} trending activated`);

        return {
          success: true,
          tokenName: matchingPayment.token_name,
          duration: matchingPayment.duration_hours,
          amount: paymentAmount.toString(),
          amountEth: ethers.formatEther(paymentAmount),
          txHash: txHash,
          payer: payerAddress,
          chain: 'ethereum'
        };
      } else {
        logger.error(`Failed to process manually validated payment: ${result.error}`);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logger.error('Error in ETH transaction validation:', error);
      return { success: false, error: `Validation error: ${error.message}` };
    }
  }

  // Validate Solana transaction for user
  async validateSolanaUserTransaction(userId, signature) {
    try {
      if (!this.solanaPaymentService) {
        return {
          success: false,
          error: 'Solana payment verification not available.'
        };
      }

      // Check if transaction already processed
      if (await this.db.isTransactionProcessed(signature)) {
        return {
          success: false,
          error: 'This transaction has already been processed.'
        };
      }

      // Get transaction from Solana blockchain
      const tx = await this.solanaPaymentService.getTransaction(signature);

      if (tx.meta.err) {
        return {
          success: false,
          error: 'Transaction failed on Solana blockchain.'
        };
      }

      // Parse transaction to get amount and sender
      const { accountKeys } = tx.transaction.message;
      const { preBalances, postBalances } = tx.meta;

      // Find payment address index
      const paymentPubkey = new (require('@solana/web3.js').PublicKey)(this.solanaPaymentAddress);
      let paymentIndex = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        if (accountKeys[i].equals(paymentPubkey)) {
          paymentIndex = i;
          break;
        }
      }

      if (paymentIndex === -1) {
        return {
          success: false,
          error: `Transaction does not send SOL to payment address.\nExpected: ${this.solanaPaymentAddress}`
        };
      }

      const amountLamports = postBalances[paymentIndex] - preBalances[paymentIndex];
      const amountSol = amountLamports / (require('@solana/web3.js').LAMPORTS_PER_SOL);
      const payerAddress = accountKeys[0].toString();

      logger.info(`Transaction validated: ${amountSol} SOL from ${payerAddress}`);

      // Find user's pending payments that match this amount (SOL chain)
      const userPendingPayments = await this.db.all(
        `SELECT pp.*, tt.token_name, tt.contract_address
         FROM pending_payments pp
         JOIN tracked_tokens tt ON pp.token_id = tt.id
         WHERE pp.user_id = $1 AND pp.expected_amount = $2 AND pp.is_matched = false AND pp.expires_at > NOW()
         AND pp.chain_name = 'solana'
         ORDER BY pp.created_at ASC`,
        [userId, amountLamports.toString()]
      );

      if (userPendingPayments.length === 0) {
        return {
          success: false,
          error: `No matching pending payment found for ${amountSol.toFixed(4)} SOL.\nPlease use /buy_trending first to create a trending request.`
        };
      }

      // Take the first (oldest) matching pending payment
      const matchingPayment = userPendingPayments[0];

      logger.info(`Found matching pending payment: token=${matchingPayment.token_name}, duration=${matchingPayment.duration_hours}h`);

      // Mark transaction as processed to prevent duplicates
      await this.db.markTransactionProcessed(
        signature,
        this.solanaPaymentAddress,
        payerAddress,
        amountLamports.toString(),
        tx.slot,
        'manual_trending_validation'
      );

      // Process the trending payment (need to add Solana support)
      // For now, we'll add to trending_payments directly
      const dbResult = await this.db.addTrendingPayment(
        userId,
        matchingPayment.token_id,
        amountLamports.toString(),
        signature,
        matchingPayment.duration_hours,
        payerAddress
      );

      // Mark pending payment as matched
      await this.db.markPendingPaymentMatched(matchingPayment.id, signature);
      logger.info(`Manual Solana validation successful: ${matchingPayment.token_name} trending activated`);

      return {
        success: true,
        tokenName: matchingPayment.token_name,
        duration: matchingPayment.duration_hours,
        amount: amountLamports.toString(),
        amountEth: amountSol.toFixed(4), // Use same field for compatibility
        txHash: signature,
        payer: payerAddress,
        chain: 'solana'
      };
    } catch (error) {
      logger.error('Error in Solana transaction validation:', error);
      return { success: false, error: `Validation error: ${error.message}` };
    }
  }

  // Get trending tokens (database-driven, no smart contract calls)
  async getTrendingTokens() {
    try {
      // Expire old trending payments
      await this.db.expireTrendingPayments();
      const trendingTokens = await this.db.getTrendingTokens();

      // Sort by payment amount (higher first), then by start time (recent first)
      trendingTokens.sort((a, b) => {
        const amountDiff = parseFloat(b.payment_amount) - parseFloat(a.payment_amount);
        if (amountDiff !== 0) return amountDiff;
        return new Date(b.start_time) - new Date(a.start_time);
      });

      return trendingTokens;
    } catch (error) {
      logger.error('Error getting trending tokens:', error);
      throw error;
    }
  }

  // Check if token is trending (database lookup)
  async isTokenTrending(contractAddress) {
    try {
      const trendingTokens = await this.getTrendingTokens();
      return trendingTokens.some(token => 
        token.contract_address.toLowerCase() === contractAddress.toLowerCase()
      );
    } catch (error) {
      logger.error(`Error checking if token ${contractAddress} is trending:`, error);
      return false;
    }
  }

  // Get trending status for specific token
  async getTokenTrendingStatus(contractAddress) {
    try {
      const trendingTokens = await this.getTrendingTokens();
      const tokenTrending = trendingTokens.find(token => 
        token.contract_address.toLowerCase() === contractAddress.toLowerCase()
      );

      if (!tokenTrending) {
        return {
          isTrending: false,
          message: 'This token is not currently trending'
        };
      }

      const endTime = new Date(tokenTrending.trending_end_time);
      const now = new Date();
      const hoursLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60)));

      return {
        isTrending: true,
        hoursLeft: hoursLeft,
        paymentAmount: tokenTrending.payment_amount,
        paymentAmountEth: ethers.formatEther(tokenTrending.payment_amount),
        endTime: endTime.toISOString(),
        message: `🔥 Trending for ${hoursLeft} more hours`
      };
    } catch (error) {
      logger.error(`Error getting trending status for ${contractAddress}:`, error);
      throw error;
    }
  }

  // Format trending message for display
  formatTrendingMessage(trendingTokens) {
    if (!trendingTokens || trendingTokens.length === 0) {
      return '📊 *No trending NFTs right now*\n\nBe the first to promote your NFT collection!';
    }

    let message = '🔥 *Trending NFT Collections*\n\n';
    trendingTokens.forEach((token, index) => {
      const endTime = new Date(token.trending_end_time);
      const now = new Date();
      const hoursLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60)));
      
      message += `${index + 1}. *${token.token_name || 'Unknown Collection'}*\n`;
      message += `   📮 \`${token.contract_address}\`\n`;
      message += `   ⏱️ ${hoursLeft}h remaining\n`;
      message += `   💰 ${ethers.formatEther(token.payment_amount)} ETH\n`;
      
      if (token.floor_price && token.floor_price !== '0') {
        message += `   📊 Floor: ${ethers.formatEther(token.floor_price)} ETH\n`;
      }
      message += '\n';
    });

    return message;
  }

  // Image Fee Methods
  async generateImagePaymentInstructions(contractAddress, userId, durationDays = 30) {
    try {
      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER($1)',
        [contractAddress]
      );

      if (!token) {
        throw new Error('Token not found in tracked tokens');
      }

      const fee = this.calculateImageFee(durationDays);
      const feeEth = ethers.formatEther(fee);

      const instructions = {
        contractAddress: this.simplePaymentContract,
        tokenAddress: token.contract_address,
        tokenName: token.token_name || 'Unknown Collection',
        fee: fee.toString(),
        feeEth: feeEth,
        duration: durationDays,
        instructions: [
          `1. <b>SEND EXACTLY ${feeEth.toUpperCase()} ETH</b> TO CONTRACT ADDRESS: ${this.simplePaymentContract}`,
          '2. Use any Ethereum wallet on mainnet',
          '3. No additional data or function calls required - just a simple ETH transfer',
          '4. Wait for transaction confirmation',
          '5. Copy transaction hash and submit with /validate_image command'
        ],
        etherscanUrl: `https://etherscan.io/address/${this.simplePaymentContract}`
      };

      return instructions;
    } catch (error) {
      logger.error('Error generating image payment instructions:', error);
      throw error;
    }
  }

  async validateImageFeeTransaction(userId, contractAddress, txHash, durationDays = null) {
    try {
      logger.info(`Image fee validation requested: user=${userId}, contract=${contractAddress}, tx=${txHash}, duration=${durationDays}`);

      // Check if transaction already processed
      if (await this.db.isTransactionProcessed(txHash)) {
        return {
          success: false,
          error: 'This transaction has already been processed.'
        };
      }

      // Get transaction details
      const txData = await this.getTransaction(txHash);
      if (!txData.receipt || txData.receipt.status !== 1) {
        return {
          success: false,
          error: 'Transaction failed or not confirmed on blockchain.'
        };
      }

      // Verify transaction sent to correct contract
      if (txData.transaction.to?.toLowerCase() !== this.simplePaymentContract.toLowerCase()) {
        return {
          success: false,
          error: `Transaction not sent to payment contract.\nExpected: ${this.simplePaymentContract}\nReceived: ${txData.transaction.to}`
        };
      }

      const paymentAmount = txData.transaction.value;
      const payerAddress = txData.transaction.from;

      // Auto-detect duration if not provided by checking payment amount
      let detectedDuration = durationDays;
      if (!detectedDuration) {
        const durations = [30, 60, 90, 180, 365];
        for (const duration of durations) {
          if (paymentAmount.toString() === this.imageFees[duration].toString()) {
            detectedDuration = duration;
            break;
          }
        }
      }

      if (!detectedDuration) {
        const validAmounts = Object.entries(this.imageFees).map(([days, amount]) =>
          `${days} days: ${ethers.formatEther(amount)} ETH`
        ).join(', ');
        return {
          success: false,
          error: `Invalid payment amount. Valid amounts: ${validAmounts}\nReceived: ${ethers.formatEther(paymentAmount)} ETH`
        };
      }

      // Verify correct amount for detected duration
      const expectedAmount = this.calculateImageFee(detectedDuration);
      if (paymentAmount.toString() !== expectedAmount.toString()) {
        return {
          success: false,
          error: `Incorrect payment amount for ${detectedDuration} days.\nExpected: ${ethers.formatEther(expectedAmount)} ETH\nReceived: ${ethers.formatEther(paymentAmount)} ETH`
        };
      }

      // Check if token exists
      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER($1)',
        [contractAddress]
      );

      if (!token) {
        return {
          success: false,
          error: 'Contract address not found in tracked tokens'
        };
      }

      // Mark transaction as processed
      await this.db.markTransactionProcessed(
        txHash,
        this.simplePaymentContract,
        payerAddress,
        paymentAmount.toString(),
        txData.receipt.blockNumber,
        'image_fee_payment'
      );

      // Add image fee payment to database
      const dbResult = await this.db.addImageFeePayment(
        userId,
        contractAddress,
        paymentAmount.toString(),
        txHash,
        payerAddress,
        detectedDuration
      );

      logger.info(`Image fee payment processed successfully: db_id=${dbResult.id}, tx=${txHash}, duration=${detectedDuration} days`);

      return {
        success: true,
        dbId: dbResult.id,
        tokenName: token.token_name,
        amount: paymentAmount.toString(),
        amountEth: ethers.formatEther(paymentAmount),
        duration: detectedDuration,
        payer: payerAddress,
        txHash: txHash,
        contractAddress: contractAddress
      };
    } catch (error) {
      logger.error('Error validating image fee transaction:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async isImageFeeActive(contractAddress) {
    try {
      // Expire old image fee payments
      await this.db.expireImageFeePayments();
      return await this.db.isImageFeeActive(contractAddress);
    } catch (error) {
      logger.error(`Error checking image fee status for ${contractAddress}:`, error);
      return false;
    }
  }

  async getImageFeeStatus(contractAddress) {
    try {
      // Expire old image fee payments first
      await this.db.expireImageFeePayments();

      const imageFeePayment = await this.db.get(
        `SELECT * FROM image_fee_payments
         WHERE LOWER(contract_address) = LOWER($1)
         AND is_active = 1
         AND end_time > datetime('now')
         ORDER BY created_at DESC
         LIMIT 1`,
        [contractAddress]
      );

      if (!imageFeePayment) {
        return {
          hasActiveFee: false,
          message: 'No active image fee payment found for this contract'
        };
      }

      const endTime = new Date(imageFeePayment.end_time);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60 * 24)));

      return {
        hasActiveFee: true,
        paymentId: imageFeePayment.id,
        contractAddress: imageFeePayment.contract_address,
        amount: imageFeePayment.amount,
        amountEth: ethers.formatEther(imageFeePayment.amount),
        duration: imageFeePayment.duration_days,
        daysLeft: daysLeft,
        txHash: imageFeePayment.transaction_hash,
        payer: imageFeePayment.payer_address,
        startTime: imageFeePayment.created_at,
        endTime: imageFeePayment.end_time,
        message: `✅ Image fee active - ${daysLeft} days remaining`
      };
    } catch (error) {
      logger.error(`Error getting image fee status for ${contractAddress}:`, error);
      return {
        hasActiveFee: false,
        error: error.message
      };
    }
  }

  async generateFooterPaymentInstructions(contractAddress, userId, durationDays = 30) {
    try {
      // Get token info from database
      const token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        throw new Error('Token not found in tracked tokens');
      }

      const fee = this.calculateFooterFee(durationDays);
      const feeEth = ethers.formatEther(fee);

      const instructions = {
        tokenName: token.token_name,
        tokenSymbol: token.token_symbol || 'UNKNOWN',
        contractAddress: this.simplePaymentContract,
        fee: fee.toString(),
        feeEth: feeEth,
        duration: `${durationDays} days`,
        paymentContract: this.simplePaymentContract,
        etherscanUrl: `https://etherscan.io/address/${this.simplePaymentContract}`,
        instructions: [
          `Send exactly ${feeEth} ETH to: ${this.simplePaymentContract}`,
          `Network: Ethereum Mainnet`,
          `Wait for transaction confirmation`,
          `Use /validate_footer &lt;contract&gt; &lt;txhash&gt; &lt;link&gt; to activate`
        ]
      };

      return instructions;

    } catch (error) {
      logger.error(`Error generating footer payment instructions: ${error.message}`);
      throw error;
    }
  }

  async validateFooterTransaction(contractAddress, txHash, customLink, userId, durationDays = null, tickerSymbol = null) {
    try {
      // Get transaction data
      const txData = await this.validateTransactionHelper(txHash);
      if (!txData.success) {
        return txData;
      }

      const paymentAmount = BigInt(txData.transaction.value);
      const payerAddress = txData.transaction.from;

      // Auto-detect duration if not provided by checking payment amount
      let detectedDuration = durationDays;
      if (!detectedDuration) {
        const durations = [30, 60, 90, 180, 365];
        for (const duration of durations) {
          if (paymentAmount.toString() === this.footerFees[duration].toString()) {
            detectedDuration = duration;
            break;
          }
        }
      }

      if (!detectedDuration) {
        const validAmounts = Object.entries(this.footerFees).map(([days, amount]) =>
          `${days} days: ${ethers.formatEther(amount)} ETH`
        ).join(', ');
        return {
          success: false,
          error: `Invalid payment amount. Valid amounts: ${validAmounts}\nReceived: ${ethers.formatEther(paymentAmount)} ETH`
        };
      }

      // Verify correct amount for detected duration
      const expectedAmount = this.calculateFooterFee(detectedDuration);
      if (paymentAmount.toString() !== expectedAmount.toString()) {
        return {
          success: false,
          error: `Incorrect payment amount for ${detectedDuration} days.\nExpected: ${ethers.formatEther(expectedAmount)} ETH\nReceived: ${ethers.formatEther(paymentAmount)} ETH`
        };
      }

      // Get token info for symbol
      const token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        return { success: false, error: 'Token not found in tracked tokens' };
      }

      // Validate URL format
      try {
        new URL(customLink);
      } catch (e) {
        return { success: false, error: 'Invalid URL format for custom link' };
      }

      // Check if already processed
      const existingFooterAd = await this.db.getFooterAd(contractAddress);
      if (existingFooterAd && existingFooterAd.transaction_hash === txHash) {
        return { success: false, error: 'Footer advertisement already active for this contract' };
      }

      // Add to database with ticker symbol
      const result = await this.db.addFooterAd(
        userId,
        contractAddress,
        token.token_symbol || 'UNKNOWN',
        customLink,
        paymentAmount.toString(),
        txHash,
        payerAddress,
        detectedDuration,
        tickerSymbol
      );

      logger.info(`Footer ad payment validated: ${contractAddress} - ${ethers.formatEther(paymentAmount)} ETH, duration=${detectedDuration} days, ticker=${tickerSymbol}`);

      return {
        success: true,
        message: `Footer advertisement activated!\n🎨 Token: ${tickerSymbol || token.token_symbol || 'UNKNOWN'}\n💰 Fee: ${ethers.formatEther(paymentAmount)} ETH\n⏰ Duration: ${detectedDuration} days\n🔗 Link: ${customLink}`,
        paymentId: result.id
      };

    } catch (error) {
      logger.error(`Error validating footer transaction: ${error.message}`);
      return { success: false, error: 'Failed to validate transaction. Please try again.' };
    }
  }

  async validateFooterPayment(contractAddress, txHash) {
    try {
      // Check if transaction already processed
      if (await this.db.isTransactionProcessed(txHash)) {
        return {
          success: false,
          error: 'This transaction has already been processed.'
        };
      }

      // Get transaction data
      const txData = await this.validateTransactionHelper(txHash);
      if (!txData.success) {
        return txData;
      }

      const paymentAmount = BigInt(txData.transaction.value);

      // Auto-detect duration by checking payment amount
      let detectedDuration = null;
      const durations = [30, 60, 90, 180, 365];
      for (const duration of durations) {
        if (paymentAmount.toString() === this.footerFees[duration].toString()) {
          detectedDuration = duration;
          break;
        }
      }

      if (!detectedDuration) {
        const validAmounts = Object.entries(this.footerFees).map(([days, amount]) =>
          `${days} days: ${ethers.formatEther(amount)} ETH`
        ).join(', ');
        return {
          success: false,
          error: `Invalid payment amount. Valid amounts: ${validAmounts}\nReceived: ${ethers.formatEther(paymentAmount)} ETH`
        };
      }

      // Check if footer ad already exists for this contract
      const existingFooterAd = await this.db.getFooterAd(contractAddress);
      if (existingFooterAd) {
        return { success: false, error: 'Footer advertisement already active for this contract' };
      }

      return {
        success: true,
        paymentAmount: paymentAmount.toString(),
        payerAddress: txData.transaction.from
      };

    } catch (error) {
      logger.error(`Error validating footer payment: ${error.message}`);
      return { success: false, error: 'Failed to validate payment. Please try again.' };
    }
  }

  async finalizeFooterAd(contractAddress, txHash, customLink, userId, tickerSymbol = null) {
    try {
      // Get token info for symbol
      const token = await this.db.getTrackedToken(contractAddress);
      if (!token) {
        return { success: false, error: 'Token not found in tracked tokens' };
      }

      // Double-check that transaction hasn't been processed yet
      if (await this.db.isTransactionProcessed(txHash)) {
        return {
          success: false,
          error: 'This transaction has already been processed.'
        };
      }

      // Get transaction data for payer address
      const txData = await this.validateTransactionHelper(txHash);
      if (!txData.success) {
        return txData;
      }

      const payerAddress = txData.transaction.from;
      const paymentAmount = BigInt(txData.transaction.value);

      // Auto-detect duration by checking payment amount
      let detectedDuration = null;
      const durations = [30, 60, 90, 180, 365];
      for (const duration of durations) {
        if (paymentAmount.toString() === this.footerFees[duration].toString()) {
          detectedDuration = duration;
          break;
        }
      }

      if (!detectedDuration) {
        return {
          success: false,
          error: 'Invalid payment amount for footer advertisement'
        };
      }

      // Add to database with ticker symbol
      const result = await this.db.addFooterAd(
        userId,
        contractAddress,
        token.token_symbol || token.token_name || 'Unknown',
        customLink,
        paymentAmount.toString(),
        txHash,
        payerAddress,
        detectedDuration,
        tickerSymbol
      );

      if (result.success) {
        // Mark transaction as processed
        await this.db.markTransactionProcessed(
          txHash,
          this.simplePaymentContract,
          payerAddress,
          paymentAmount.toString(),
          txData.receipt.blockNumber,
          'footer_ad_payment'
        );

        logger.info(`Footer ad finalized: ${contractAddress} - ${ethers.formatEther(paymentAmount)} ETH, duration=${detectedDuration} days, ticker=${tickerSymbol}`);

        return {
          success: true,
          message: `Footer advertisement activated!\n\n🎨 Token: ${tickerSymbol || token.token_symbol || 'Unknown'}\n💰 Payment: ${ethers.formatEther(paymentAmount)} ETH\n🔗 Link: ${customLink}\n⏰ Duration: ${detectedDuration} days\n\nYour ad will now appear in all NFT notifications for this collection!`
        };
      } else {
        return { success: false, error: result.error };
      }

    } catch (error) {
      logger.error(`Error finalizing footer ad: ${error.message}`);
      return { success: false, error: 'Failed to create footer advertisement. Please try again.' };
    }
  }

  async getActiveFooterAds() {
    try {
      // Expire old footer ads
      await this.db.expireFooterAds();
      return await this.db.getActiveFooterAds();
    } catch (error) {
      logger.error('Error getting active footer ads:', error);
      return [];
    }
  }

  // Validate footer transaction without contract requirement (new flow)
  async validateFooterTransactionWithoutContract(txHash, customLink, userId, durationDays = null, tickerSymbol = null) {
    try {
      // Get transaction data
      const txData = await this.validateTransactionHelper(txHash);
      if (!txData.success) {
        return txData;
      }

      const paymentAmount = BigInt(txData.transaction.value);
      const payerAddress = txData.transaction.from;

      // Auto-detect duration if not provided by checking payment amount
      let detectedDuration = durationDays;
      if (!detectedDuration) {
        const durations = [30, 60, 90, 180, 365];
        for (const duration of durations) {
          if (paymentAmount.toString() === this.footerFees[duration].toString()) {
            detectedDuration = duration;
            break;
          }
        }
      }

      if (!detectedDuration) {
        const validAmounts = Object.entries(this.footerFees).map(([days, amount]) =>
          `${days} days: ${ethers.formatEther(amount)} ETH`
        ).join(', ');
        return {
          success: false,
          error: `Invalid payment amount. Valid amounts: ${validAmounts}\nReceived: ${ethers.formatEther(paymentAmount)} ETH`
        };
      }

      // Verify correct amount for detected duration
      const expectedAmount = this.calculateFooterFee(detectedDuration);
      if (paymentAmount.toString() !== expectedAmount.toString()) {
        return {
          success: false,
          error: `Incorrect payment amount for ${detectedDuration} days.\nExpected: ${ethers.formatEther(expectedAmount)} ETH\nReceived: ${ethers.formatEther(paymentAmount)} ETH`
        };
      }

      // Validate URL format
      try {
        new URL(customLink);
      } catch (e) {
        return { success: false, error: 'Invalid URL format for custom link' };
      }

      // Add to database without contract address requirement
      const result = await this.db.addFooterAd(
        userId,
        null, // No contract address required
        tickerSymbol || 'PROMO', // Use ticker or fallback
        customLink,
        paymentAmount.toString(),
        txHash,
        payerAddress,
        detectedDuration,
        tickerSymbol
      );

      // Mark transaction as processed
      await this.db.markTransactionProcessed(
        txHash,
        this.simplePaymentContract,
        payerAddress,
        paymentAmount.toString(),
        txData.receipt.blockNumber,
        'footer_ad_payment'
      );

      logger.info(`Footer ad payment validated without contract: ${ethers.formatEther(paymentAmount)} ETH, duration=${detectedDuration} days, ticker=${tickerSymbol}`);

      return {
        success: true,
        message: `Footer advertisement activated!\n\n⭐️ Ticker: ${tickerSymbol}\n💰 Fee: ${ethers.formatEther(paymentAmount)} ETH\n⏰ Duration: ${detectedDuration} days\n🔗 Link: ${customLink}\n\nYour ad will now appear in all NFT notifications!`,
        paymentId: result.id
      };

    } catch (error) {
      logger.error(`Error validating footer transaction without contract: ${error.message}`);
      return { success: false, error: 'Failed to validate transaction. Please try again.' };
    }
  }

  // Helper method for transaction validation (consolidates common logic)
  async validateTransactionHelper(txHash) {
    try {
      // Check if transaction already processed
      if (await this.db.isTransactionProcessed(txHash)) {
        return {
          success: false,
          error: 'This transaction has already been processed.'
        };
      }

      // Get transaction details
      const txData = await this.getTransaction(txHash);
      if (!txData.receipt || txData.receipt.status !== 1) {
        return {
          success: false,
          error: 'Transaction failed or not confirmed on blockchain.'
        };
      }

      // Verify transaction sent to correct contract
      if (txData.transaction.to?.toLowerCase() !== this.simplePaymentContract.toLowerCase()) {
        return {
          success: false,
          error: `Transaction not sent to payment contract.\nExpected: ${this.simplePaymentContract}\nReceived: ${txData.transaction.to}`
        };
      }

      return {
        success: true,
        transaction: txData.transaction,
        receipt: txData.receipt
      };
    } catch (error) {
      logger.error(`Error validating transaction ${txHash}:`, error);
      return {
        success: false,
        error: `Validation error: ${error.message}`
      };
    }
  }

  // Get contract balance (read-only)
  async getContractBalance() {
    try {
      if (!this.contract) {
        throw new Error('Simple payment contract not available');
      }

      const balance = await this.contract.getBalance();
      return {
        wei: balance.toString(),
        eth: ethers.formatEther(balance)
      };
    } catch (error) {
      logger.error('Error getting contract balance:', error);
      throw error;
    }
  }
}

module.exports = SecureTrendingService;