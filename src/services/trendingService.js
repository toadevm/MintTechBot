const { ethers } = require('ethers');
const logger = require('./logger');

const MINTTECHBOT_CONTRACT_ABI = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "string",
        "name": "trendingType",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newFee",
        "type": "uint256"
      }
    ],
    "name": "FeesUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "paymentId",
        "type": "uint256"
      }
    ],
    "name": "PaymentExpired",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "paymentId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "string",
        "name": "tokenAddress",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isPremium",
        "type": "bool"
      }
    ],
    "name": "PaymentReceived",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "paymentId",
        "type": "uint256"
      }
    ],
    "name": "expirePayment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "tokenAddress",
        "type": "string"
      }
    ],
    "name": "getActivePaymentsForToken",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllFees",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "durations",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "normalFees",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "premiumFees",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getContractBalance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPremium",
        "type": "bool"
      }
    ],
    "name": "getFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "paymentId",
        "type": "uint256"
      }
    ],
    "name": "getPayment",
    "outputs": [
      {
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "tokenAddress",
        "type": "string"
      },
      {
        "internalType": "bool",
        "name": "isPremium",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "processed",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "since",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxResults",
        "type": "uint256"
      }
    ],
    "name": "getUnprocessedPayments",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "paymentIds",
        "type": "uint256[]"
      },
      {
        "internalType": "address[]",
        "name": "payers",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "timestamps",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "paymentId",
        "type": "uint256"
      }
    ],
    "name": "isPaymentActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      }
    ],
    "name": "isValidDuration",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "normalTrendingFees",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "tokenAddress",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPremium",
        "type": "bool"
      }
    ],
    "name": "payForTrending",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "paymentId",
        "type": "uint256"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paymentCounter",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "payments",
    "outputs": [
      {
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "tokenAddress",
        "type": "string"
      },
      {
        "internalType": "bool",
        "name": "isPremium",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "processed",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "premiumTrendingFees",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "paymentId",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "tokenAddress",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPremium",
        "type": "bool"
      }
    ],
    "name": "processSimplePayment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "tokenPayments",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "durations",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "newFees",
        "type": "uint256[]"
      }
    ],
    "name": "updateMultipleNormalTrendingFees",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "durations",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "newFees",
        "type": "uint256[]"
      }
    ],
    "name": "updateMultiplePremiumTrendingFees",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "newFee",
        "type": "uint256"
      }
    ],
    "name": "updateNormalTrendingFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "duration",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "newFee",
        "type": "uint256"
      }
    ],
    "name": "updatePremiumTrendingFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "validDurations",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
];

class TrendingService {
  constructor(database) {
    this.db = database;
    this.contractAddress = process.env.TRENDING_CONTRACT_ADDRESS;
    this.contract = null;
    this.provider = null;
  }

  async initialize() {
    try {
      if (!this.contractAddress) {
        logger.warn('No trending contract address provided. Trending payments will be unavailable.');
        return true;
      }

      const alchemyUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
      this.provider = new ethers.JsonRpcProvider(alchemyUrl);

      this.contract = new ethers.Contract(this.contractAddress, MINTTECHBOT_CONTRACT_ABI, this.provider);
      logger.info(`Trending service initialized with contract: ${this.contractAddress}`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize trending service:', error);
      throw error;
    }
  }

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

  async calculateTrendingFee(durationHours, isPremium = false) {
    try {
      if (!this.contract) {
        throw new Error('Trending contract not available');
      }

      const isValid = await this.contract.isValidDuration(durationHours);
      if (!isValid) {
        throw new Error('Invalid duration. Must be 6, 12, 18, or 24 hours');
      }

      const fee = await this.contract.getFee(durationHours, isPremium);
      logger.info(`Calculated ${isPremium ? 'premium' : 'normal'} trending fee for ${durationHours}h: ${ethers.formatEther(fee)} ETH`);
      return fee;
    } catch (error) {
      logger.error(`Error calculating trending fee for ${durationHours}h:`, error);
      throw error;
    }
  }

  async getTrendingOptions() {
    try {
      const [durations, normalFees, premiumFees] = await this.contract.getAllFees();
      
      const trendingOptions = [];
      for (let i = 0; i < durations.length; i++) {
        trendingOptions.push({
          duration: parseInt(durations[i]),
          label: `${durations[i]} Hours`,
          normalFee: normalFees[i].toString(),
          normalFeeEth: ethers.formatEther(normalFees[i]),
          premiumFee: premiumFees[i].toString(),
          premiumFeeEth: ethers.formatEther(premiumFees[i])
        });
      }

      return trendingOptions;
    } catch (error) {
      logger.error('Error getting trending options:', error);
      throw error;
    }
  }

  async processSimplePayment(userId, paymentTxHash) {
    try {
      logger.info(`Processing simple payment: user=${userId}, tx=${paymentTxHash}`);

      const txData = await this.getTransaction(paymentTxHash);
      if (!txData.receipt || txData.receipt.status !== 1) {
        throw new Error('Transaction failed or not confirmed');
      }

      if (txData.transaction.to.toLowerCase() !== this.contractAddress.toLowerCase()) {
        throw new Error('Transaction not sent to trending contract');
      }

      const paymentAmount = txData.transaction.value.toString();
      const payerAddress = txData.transaction.from;

      const pendingPayments = await this.db.getUserPendingPayments(userId);
      const matchingPending = pendingPayments.find(p => p.expected_amount === paymentAmount);

      if (!matchingPending) {
        throw new Error('No matching pending payment found. Amount: ' + ethers.formatEther(paymentAmount) + ' ETH');
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const searchSince = currentTime - (10 * 60);
      const unprocessedPayments = await this.contract.getUnprocessedPayments(searchSince, 50);

      let matchingPaymentId = null;
      for (let i = 0; i < unprocessedPayments.paymentIds.length; i++) {
        if (unprocessedPayments.amounts[i].toString() === paymentAmount && 
            unprocessedPayments.payers[i].toLowerCase() === payerAddress.toLowerCase()) {
          matchingPaymentId = unprocessedPayments.paymentIds[i];
          break;
        }
      }

      if (!matchingPaymentId) {
        throw new Error('Payment not found on contract');
      }

      await this.contract.processSimplePayment(
        matchingPaymentId,
        matchingPending.contract_address,
        matchingPending.duration_hours,
        false
      );

      await this.db.markPendingPaymentMatched(matchingPending.id, paymentTxHash);

      const dbResult = await this.db.addTrendingPayment(
        userId,
        matchingPending.token_id,
        paymentAmount,
        paymentTxHash,
        matchingPending.duration_hours,
        payerAddress
      );

      logger.info(`Simple payment processed successfully: payment_id=${matchingPaymentId}, db_id=${dbResult.id}`);
      return {
        success: true,
        paymentId: matchingPaymentId,
        dbId: dbResult.id,
        amount: paymentAmount,
        duration: matchingPending.duration_hours,
        tokenName: matchingPending.token_name
      };
    } catch (error) {
      logger.error(`Error processing simple payment:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processTrendingPayment(userId, tokenId, durationHours, paymentTxHash, isPremium = false) {
    try {
      logger.info(`Processing trending payment: user=${userId}, token=${tokenId}, duration=${durationHours}h, premium=${isPremium}, tx=${paymentTxHash}`);

      const txData = await this.getTransaction(paymentTxHash);
      if (!txData.receipt || txData.receipt.status !== 1) {
        throw new Error('Transaction failed or not confirmed');
      }

      const paymentId = await this.getPaymentIdFromTransaction(txData.receipt);
      if (!paymentId) {
        throw new Error('Could not extract payment ID from transaction');
      }

      const paymentDetails = await this.contract.getPayment(paymentId);
      if (!paymentDetails.isActive) {
        throw new Error('Payment is not active on contract');
      }

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
        duration: durationHours,
        isPremium: isPremium
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
      const iface = new ethers.Interface(MINTTECHBOT_CONTRACT_ABI);
      for (const log of receipt.logs) {
        try {
          if (log.address.toLowerCase() === this.contractAddress.toLowerCase()) {
            const parsed = iface.parseLog(log);
            if (parsed.name === 'PaymentReceived') {
              return parsed.args.paymentId.toString();
            }
          }
        } catch (parseError) {
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
      await this.db.expireTrendingPayments();
      const trendingTokens = await this.db.getTrendingTokens();

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
        paymentAmountEth: ethers.formatEther(tokenTrending.payment_amount),
        endTime: endTime.toISOString(),
        message: `🔥 Trending for ${hoursLeft} more hours`
      };
    } catch (error) {
      logger.error(`Error getting trending status for ${contractAddress}:`, error);
      throw error;
    }
  }

  async generatePaymentInstructions(tokenId, durationHours, userId, isPremium = false) {
    try {
      const token = await this.db.get(
        'SELECT * FROM tracked_tokens WHERE id = ?',
        [tokenId]
      );

      if (!token) {
        throw new Error('Token not found');
      }

      const fee = await this.calculateTrendingFee(durationHours, isPremium);
      const feeEth = ethers.formatEther(fee);

      await this.db.createPendingPayment(userId, tokenId, fee.toString(), durationHours);

      const instructions = {
        contractAddress: this.contractAddress,
        tokenAddress: token.contract_address,
        tokenName: token.token_name || 'Unknown Collection',
        duration: durationHours,
        fee: fee.toString(),
        feeEth: feeEth,
        isPremium: isPremium,
        instructions: [
          '1. Open MetaMask and ensure you\'re on Sepolia testnet',
          `2. Send exactly ${feeEth} ETH to contract address: ${this.contractAddress}`,
          '3. No additional data or function calls required - just a simple ETH transfer',
          '4. Wait for transaction confirmation',
          '5. Copy transaction hash and submit below'
        ],
        etherscanUrl: `https://sepolia.etherscan.io/address/${this.contractAddress}`
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
      message += `   💰 ${ethers.formatEther(token.payment_amount)} ETH\n`;
      if (token.floor_price && token.floor_price !== '0') {
        message += `   📊 Floor: ${ethers.formatEther(token.floor_price)} ETH\n`;
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
        eth: ethers.formatEther(balance)
      };
    } catch (error) {
      logger.error('Error getting contract balance:', error);
      throw error;
    }
  }

  async verifyPaymentTransaction(txHash, expectedAmount, expectedDuration) {
    try {
      const txData = await this.getTransaction(txHash);
      if (!txData.receipt || txData.receipt.status !== 1) {
        return {
          valid: false,
          reason: 'Transaction failed or not confirmed'
        };
      }

      if (txData.transaction.to.toLowerCase() !== this.contractAddress.toLowerCase()) {
        return {
          valid: false,
          reason: 'Transaction not sent to trending contract'
        };
      }

      const actualAmount = txData.transaction.value;
      if (actualAmount.toString() !== expectedAmount.toString()) {
        return {
          valid: false,
          reason: `Amount mismatch: expected ${ethers.formatEther(expectedAmount)} ETH, got ${ethers.formatEther(actualAmount)} ETH`
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