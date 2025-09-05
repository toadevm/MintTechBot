const { ethers } = require('ethers');
const logger = require('./logger');

// Smart contract ABI (generated from the Solidity contract)
const TRENDING_CONTRACT_ABI = [
  "function payForTrending(string memory tokenAddress, uint256 duration) external payable returns (uint256 paymentId)",
  "function calculateFee(uint256 duration) public view returns (uint256)",
  "function isPaymentActive(uint256 paymentId) public view returns (bool)",
  "function getActivePaymentsForToken(string memory tokenAddress) external view returns (uint256[] memory)",
  "function getPayment(uint256 paymentId) external view returns (address payer, uint256 amount, uint256 timestamp, uint256 duration, string memory tokenAddress, bool isActive, bool isExpired)",
  "function getContractBalance() external view returns (uint256)",
  "event PaymentReceived(uint256 indexed paymentId, address indexed payer, string indexed tokenAddress, uint256 amount, uint256 duration)"
];

class TrendingService {
  constructor(database, walletService) {
    this.db = database;
    this.wallet = walletService;
    this.contractAddress = process.env.TRENDING_CONTRACT_ADDRESS;
    this.contract = null;
  }

  async initialize() {
    try {
      if (!this.contractAddress) {
        logger.warn('No trending contract address provided. Trending payments will be unavailable.');
        return true;
      }

      // Create contract instance
      this.contract = this.wallet.createContract(this.contractAddress, TRENDING_CONTRACT_ABI);
      
      logger.info(`Trending service initialized with contract: ${this.contractAddress}`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize trending service:', error);
      throw error;
    }
  }

  async calculateTrendingFee(durationHours) {
    try {
      if (!this.contract) {
        throw new Error('Trending contract not available');
      }

      const fee = await this.contract.calculateFee(durationHours);
      logger.info(`Calculated trending fee for ${durationHours}h: ${this.wallet.formatEther(fee)} ETH`);
      return fee;
      
    } catch (error) {
      logger.error(`Error calculating trending fee for ${durationHours}h:`, error);
      throw error;
    }
  }

  async getTrendingOptions() {
    try {
      const options = [
        { duration: 1, label: '1 Hour' },
        { duration: 6, label: '6 Hours' },
        { duration: 12, label: '12 Hours' },
        { duration: 24, label: '1 Day' },
        { duration: 72, label: '3 Days' },
        { duration: 168, label: '1 Week' }
      ];

      const trendingOptions = [];
      
      for (const option of options) {
        try {
          const fee = await this.calculateTrendingFee(option.duration);
          trendingOptions.push({
            ...option,
            fee: fee.toString(),
            feeEth: this.wallet.formatEther(fee)
          });
        } catch (error) {
          logger.error(`Error calculating fee for ${option.duration}h:`, error);
          trendingOptions.push({
            ...option,
            fee: '0',
            feeEth: 'N/A'
          });
        }
      }

      return trendingOptions;
      
    } catch (error) {
      logger.error('Error getting trending options:', error);
      throw error;
    }
  }

  async processTrendingPayment(userId, tokenId, durationHours, paymentTxHash) {
    try {
      logger.info(`Processing trending payment: user=${userId}, token=${tokenId}, duration=${durationHours}h, tx=${paymentTxHash}`);

      // Get transaction details
      const txData = await this.wallet.getTransaction(paymentTxHash);
      
      if (!txData.receipt || txData.receipt.status !== 1) {
        throw new Error('Transaction failed or not confirmed');
      }

      // Parse transaction logs to get payment ID
      const paymentId = await this.getPaymentIdFromTransaction(txData.receipt);
      
      if (!paymentId) {
        throw new Error('Could not extract payment ID from transaction');
      }

      // Verify payment on contract
      const paymentDetails = await this.contract.getPayment(paymentId);
      
      if (!paymentDetails.isActive) {
        throw new Error('Payment is not active on contract');
      }

      // Add to database
      const dbResult = await this.db.addTrendingPayment(
        userId,
        tokenId,
        paymentDetails.amount.toString(),
        paymentTxHash,
        durationHours
      );

      logger.info(`Trending payment processed successfully: payment_id=${paymentId}, db_id=${dbResult.id}`);
      
      return {
        success: true,
        paymentId: paymentId,
        dbId: dbResult.id,
        amount: paymentDetails.amount.toString(),
        duration: durationHours
      };
      
    } catch (error) {
      logger.error(`Error processing trending payment:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getPaymentIdFromTransaction(receipt) {
    try {
      // Parse logs to find PaymentReceived event
      const iface = new ethers.Interface(TRENDING_CONTRACT_ABI);
      
      for (const log of receipt.logs) {
        try {
          if (log.address.toLowerCase() === this.contractAddress.toLowerCase()) {
            const parsed = iface.parseLog(log);
            if (parsed.name === 'PaymentReceived') {
              return parsed.args.paymentId.toString();
            }
          }
        } catch (parseError) {
          // Continue if this log isn't parseable
          continue;
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Error parsing payment ID from transaction:', error);
      return null;
    }
  }

  async getTrendingTokens() {
    try {
      await this.db.expireTrendingPayments(); // Clean up expired
      const trendingTokens = await this.db.getTrendingTokens();
      
      // Sort by payment amount (highest first) and then by recency
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
        paymentAmountEth: this.wallet.formatEther(tokenTrending.payment_amount),
        endTime: endTime.toISOString(),
        message: `🔥 Trending for ${hoursLeft} more hours`
      };
      
    } catch (error) {
      logger.error(`Error getting trending status for ${contractAddress}:`, error);
      throw error;
    }
  }

  async generatePaymentInstructions(tokenId, durationHours) {
    try {
      // Get token details
      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE id = ?',
        [tokenId]
      );

      if (!token) {
        throw new Error('Token not found');
      }

      // Calculate fee
      const fee = await this.calculateTrendingFee(durationHours);
      const feeEth = this.wallet.formatEther(fee);

      const instructions = {
        contractAddress: this.contractAddress,
        tokenAddress: token.contract_address,
        tokenName: token.token_name || 'Unknown Collection',
        duration: durationHours,
        fee: fee.toString(),
        feeEth: feeEth,
        instructions: [
          '1. Send the exact amount to the contract address',
          '2. Include the token address in the transaction data',
          '3. Wait for transaction confirmation',
          '4. Send the transaction hash to the bot'
        ]
      };

      return instructions;
      
    } catch (error) {
      logger.error('Error generating payment instructions:', error);
      throw error;
    }
  }

  formatTrendingMessage(trendingTokens) {
    if (!trendingTokens || trendingTokens.length === 0) {
      return '📊 *No trending tokens right now*\n\nBe the first to promote your NFT collection!';
    }

    let message = '🔥 *Trending NFT Collections*\n\n';
    
    trendingTokens.forEach((token, index) => {
      const endTime = new Date(token.trending_end_time);
      const now = new Date();
      const hoursLeft = Math.max(0, Math.ceil((endTime - now) / (1000 * 60 * 60)));
      
      message += `${index + 1}. *${token.token_name || 'Unknown Collection'}*\n`;
      message += `   📮 \`${token.contract_address}\`\n`;
      message += `   ⏱️ ${hoursLeft}h remaining\n`;
      message += `   💰 ${this.wallet.formatEther(token.payment_amount)} ETH\n`;
      
      if (token.floor_price && token.floor_price !== '0') {
        message += `   📊 Floor: ${this.wallet.formatEther(token.floor_price)} ETH\n`;
      }
      
      message += '\n';
    });

    return message;
  }

  async getContractBalance() {
    try {
      if (!this.contract) {
        throw new Error('Trending contract not available');
      }

      const balance = await this.contract.getContractBalance();
      return {
        wei: balance.toString(),
        eth: this.wallet.formatEther(balance)
      };
      
    } catch (error) {
      logger.error('Error getting contract balance:', error);
      throw error;
    }
  }

  async verifyPaymentTransaction(txHash, expectedAmount, expectedDuration) {
    try {
      const txData = await this.wallet.getTransaction(txHash);
      
      if (!txData.receipt || txData.receipt.status !== 1) {
        return {
          valid: false,
          reason: 'Transaction failed or not confirmed'
        };
      }

      // Check if transaction was to our contract
      if (txData.transaction.to.toLowerCase() !== this.contractAddress.toLowerCase()) {
        return {
          valid: false,
          reason: 'Transaction not sent to trending contract'
        };
      }

      // Check amount
      const actualAmount = txData.transaction.value;
      if (actualAmount.toString() !== expectedAmount.toString()) {
        return {
          valid: false,
          reason: `Amount mismatch: expected ${this.wallet.formatEther(expectedAmount)} ETH, got ${this.wallet.formatEther(actualAmount)} ETH`
        };
      }

      return {
        valid: true,
        paymentId: await this.getPaymentIdFromTransaction(txData.receipt),
        amount: actualAmount.toString()
      };
      
    } catch (error) {
      logger.error(`Error verifying payment transaction ${txHash}:`, error);
      return {
        valid: false,
        reason: `Verification error: ${error.message}`
      };
    }
  }
}

module.exports = TrendingService;