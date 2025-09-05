const { ethers } = require('ethers');
const logger = require('../services/logger');

class WalletService {
  constructor() {
    // Initialize provider for Sepolia testnet with timeout and retry settings
    const primaryUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    const connectionInfo = {
      url: primaryUrl,
      timeout: 20000, // 20 second timeout
      throttleLimit: 10,
      throttleSlotInterval: 100
    };
    
    this.provider = new ethers.JsonRpcProvider(connectionInfo);
    
    // Fallback providers in case primary fails
    this.fallbackProviders = [
      'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161', // Public Infura
      'https://rpc2.sepolia.org',
      'https://rpc.sepolia.org'
    ];
    
    this.networkName = 'sepolia';
    this.chainId = 11155111; // Sepolia chain ID
  }

  async initialize(retryCount = 2) {
    // Try primary provider first
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        logger.info(`Connecting to Sepolia network via Alchemy (attempt ${attempt}/${retryCount})...`);
        
        // Test the connection with timeout
        const networkPromise = this.provider.getNetwork();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Network connection timeout')), 10000)
        );
        
        const network = await Promise.race([networkPromise, timeoutPromise]);
        logger.info(`✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
        return true;
        
      } catch (error) {
        logger.warn(`❌ Alchemy connection attempt ${attempt} failed:`, error.message);
        
        if (attempt < retryCount) {
          const waitTime = 2000; // 2 seconds
          logger.info(`⏳ Retrying in ${waitTime/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // Try fallback providers
    logger.info('🔄 Alchemy failed, trying fallback providers...');
    for (let i = 0; i < this.fallbackProviders.length; i++) {
      try {
        const fallbackUrl = this.fallbackProviders[i];
        logger.info(`🔗 Trying fallback provider ${i + 1}: ${fallbackUrl}`);
        
        const fallbackProvider = new ethers.JsonRpcProvider({
          url: fallbackUrl,
          timeout: 10000
        });
        
        const networkPromise = fallbackProvider.getNetwork();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Fallback connection timeout')), 8000)
        );
        
        const network = await Promise.race([networkPromise, timeoutPromise]);
        
        // If successful, replace the provider
        this.provider = fallbackProvider;
        logger.info(`✅ Connected via fallback: ${network.name} (Chain ID: ${network.chainId})`);
        logger.warn('⚠️  Using fallback provider - some features may be limited');
        return true;
        
      } catch (error) {
        logger.warn(`❌ Fallback provider ${i + 1} failed:`, error.message);
      }
    }
    
    // All providers failed
    logger.error('❌ All providers failed. Network issues detected:');
    logger.error('1. Check your internet connection');
    logger.error('2. Verify Alchemy API key is valid');
    logger.error('3. Check if Ethereum RPC services are accessible');
    throw new Error('Unable to connect to any Ethereum provider');
  }

  // Validate if address is a valid Ethereum address
  isValidAddress(address) {
    try {
      return ethers.isAddress(address);
    } catch (error) {
      return false;
    }
  }

  // Get balance of an address
  async getBalance(address) {
    try {
      if (!this.isValidAddress(address)) {
        throw new Error('Invalid address');
      }

      const balance = await this.provider.getBalance(address);
      logger.info(`Balance for ${address}: ${ethers.formatEther(balance)} ETH`);
      return balance;
      
    } catch (error) {
      logger.error(`Error getting balance for ${address}:`, error);
      throw error;
    }
  }

  // Format Wei to Ether string
  formatEther(weiAmount) {
    try {
      return ethers.formatEther(weiAmount);
    } catch (error) {
      logger.error('Error formatting ether amount:', error);
      return '0.0';
    }
  }

  // Parse Ether to Wei
  parseEther(etherAmount) {
    try {
      return ethers.parseEther(etherAmount.toString());
    } catch (error) {
      logger.error('Error parsing ether amount:', error);
      throw error;
    }
  }

  // Get current gas price
  async getGasPrice() {
    try {
      const gasPrice = await this.provider.getFeeData();
      logger.info(`Current gas price: ${ethers.formatUnits(gasPrice.gasPrice, 'gwei')} gwei`);
      return gasPrice;
    } catch (error) {
      logger.error('Error getting gas price:', error);
      throw error;
    }
  }

  // Get transaction details
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

  // Wait for transaction confirmation
  async waitForTransaction(txHash, confirmations = 1) {
    try {
      logger.info(`Waiting for transaction ${txHash} with ${confirmations} confirmations...`);
      const receipt = await this.provider.waitForTransaction(txHash, confirmations);
      
      if (receipt.status === 1) {
        logger.info(`Transaction ${txHash} confirmed successfully`);
      } else {
        logger.error(`Transaction ${txHash} failed`);
      }
      
      return receipt;
      
    } catch (error) {
      logger.error(`Error waiting for transaction ${txHash}:`, error);
      throw error;
    }
  }

  // Create a contract instance
  createContract(contractAddress, abi) {
    try {
      if (!this.isValidAddress(contractAddress)) {
        throw new Error('Invalid contract address');
      }

      return new ethers.Contract(contractAddress, abi, this.provider);
      
    } catch (error) {
      logger.error('Error creating contract instance:', error);
      throw error;
    }
  }

  // Create a wallet instance (for signing transactions)
  createWallet(privateKey) {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider);
      logger.info(`Wallet created: ${wallet.address}`);
      return wallet;
      
    } catch (error) {
      logger.error('Error creating wallet:', error);
      throw error;
    }
  }

  // Get ENS name for address (if available)
  async getEnsName(address) {
    try {
      if (!this.isValidAddress(address)) {
        return null;
      }

      const ensName = await this.provider.lookupAddress(address);
      if (ensName) {
        logger.info(`ENS name for ${address}: ${ensName}`);
      }
      return ensName;
      
    } catch (error) {
      // ENS lookup can fail without being a critical error
      logger.debug(`ENS lookup failed for ${address}:`, error.message);
      return null;
    }
  }

  // Resolve ENS name to address
  async resolveEnsName(ensName) {
    try {
      const address = await this.provider.resolveName(ensName);
      if (address) {
        logger.info(`ENS ${ensName} resolved to: ${address}`);
      }
      return address;
      
    } catch (error) {
      logger.debug(`ENS resolution failed for ${ensName}:`, error.message);
      return null;
    }
  }

  // Estimate gas for a transaction
  async estimateGas(transactionRequest) {
    try {
      const gasEstimate = await this.provider.estimateGas(transactionRequest);
      logger.info(`Gas estimate: ${gasEstimate.toString()}`);
      return gasEstimate;
      
    } catch (error) {
      logger.error('Error estimating gas:', error);
      throw error;
    }
  }

  // Get current block number
  async getCurrentBlock() {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      logger.info(`Current block number: ${blockNumber}`);
      return blockNumber;
      
    } catch (error) {
      logger.error('Error getting current block:', error);
      throw error;
    }
  }

  // Get block details
  async getBlock(blockNumber) {
    try {
      const block = await this.provider.getBlock(blockNumber);
      return block;
      
    } catch (error) {
      logger.error(`Error getting block ${blockNumber}:`, error);
      throw error;
    }
  }

  // Send a transaction (requires wallet with private key)
  async sendTransaction(wallet, to, value, data = '0x') {
    try {
      if (!wallet || typeof wallet.sendTransaction !== 'function') {
        throw new Error('Invalid wallet instance');
      }

      const tx = {
        to: to,
        value: value,
        data: data
      };

      // Get gas estimate and fee data
      const gasEstimate = await this.estimateGas(tx);
      const feeData = await this.getGasPrice();

      tx.gasLimit = gasEstimate;
      tx.gasPrice = feeData.gasPrice;

      logger.info(`Sending transaction: ${JSON.stringify(tx)}`);
      const txResponse = await wallet.sendTransaction(tx);
      logger.info(`Transaction sent: ${txResponse.hash}`);
      
      return txResponse;
      
    } catch (error) {
      logger.error('Error sending transaction:', error);
      throw error;
    }
  }

  // Helper to format transaction for display
  formatTransactionForDisplay(tx, receipt = null) {
    const formatted = {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: `${this.formatEther(tx.value)} ETH`,
      gasPrice: `${ethers.formatUnits(tx.gasPrice, 'gwei')} gwei`,
      gasLimit: tx.gasLimit.toString(),
      blockNumber: tx.blockNumber || 'pending'
    };

    if (receipt) {
      formatted.status = receipt.status === 1 ? '✅ Success' : '❌ Failed';
      formatted.gasUsed = receipt.gasUsed.toString();
    }

    return formatted;
  }

  // Get provider instance for external use
  getProvider() {
    return this.provider;
  }

  // Get network information
  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.getCurrentBlock();
      const gasPrice = await this.getGasPrice();

      return {
        name: network.name,
        chainId: Number(network.chainId),
        blockNumber: blockNumber,
        gasPrice: {
          standard: ethers.formatUnits(gasPrice.gasPrice, 'gwei'),
          fast: ethers.formatUnits(gasPrice.maxFeePerGas || gasPrice.gasPrice, 'gwei')
        }
      };
      
    } catch (error) {
      logger.error('Error getting network info:', error);
      throw error;
    }
  }
}

module.exports = WalletService;