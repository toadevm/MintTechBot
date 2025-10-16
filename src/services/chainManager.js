const logger = require('./logger');

class ChainManager {
  constructor(database) {
    this.db = database;
    this.chains = new Map(); // Cache for chain configurations
    this.initialized = false;
  }

  async initialize() {
    try {
      await this.loadChainConfigurations();
      this.initialized = true;
      logger.info('ChainManager initialized with supported chains');
      return true;
    } catch (error) {
      logger.error('Failed to initialize ChainManager:', error);
      throw error;
    }
  }

  async loadChainConfigurations() {
    try {
      // Get Alchemy API key from environment
      const alchemyApiKey = process.env.ALCHEMY_API_KEY;

      // Hardcoded chain configurations with multichain payment support
      const chainConfigs = [
        {
          name: 'ethereum',
          chainId: 1,
          displayName: 'Ethereum',
          currencySymbol: 'ETH',
          emoji: '🔷',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'ethereum',
          rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x4704eaF9d285a1388c0370Bc7d05334d313f92Be'
        },
        {
          name: 'arbitrum',
          chainId: 42161,
          displayName: 'Arbitrum',
          currencySymbol: 'ETH',
          emoji: '🔵',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'arbitrum',
          rpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'optimism',
          chainId: 10,
          displayName: 'Optimism',
          currencySymbol: 'ETH',
          emoji: '🔴',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'optimism',
          rpcUrl: `https://opt-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'avalanche',
          chainId: 43114,
          displayName: 'Avalanche',
          currencySymbol: 'AVAX',
          emoji: '🏔️',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'avalanche',
          rpcUrl: `https://avax-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'hyperblast',
          chainId: 1891,
          displayName: 'HyperEVM',
          currencySymbol: 'ETH',
          emoji: '⚡',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'hyperevm',
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'berachain',
          chainId: 80084,
          displayName: 'Berachain',
          currencySymbol: 'BERA',
          emoji: '🐻',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'bera_chain',
          rpcUrl: `https://berachain-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'apechain',
          chainId: 33139,
          displayName: 'APE Chain',
          currencySymbol: 'APE',
          emoji: '🐵',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'apechain',
          rpcUrl: `https://apechain-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'abstract',
          chainId: 2741,
          displayName: 'Abstract',
          currencySymbol: 'ETH',
          emoji: '🟫',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'abstract',
          rpcUrl: `https://abstract-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'base',
          chainId: 8453,
          displayName: 'Base',
          currencySymbol: 'ETH',
          emoji: '🔵',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'base',
          rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'ronin',
          chainId: 2020,
          displayName: 'Ronin',
          currencySymbol: 'RON',
          emoji: '⚔️',
          isTestnet: false,
          isActive: true,
          openSeaSupported: true,
          openSeaName: 'ronin',
          rpcUrl: `https://ronin-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
          paymentContract: '0x405792CbED87Fbb34afA505F768C8eDF8f9504E9'
        },
        {
          name: 'solana',
          chainId: 900, // Custom ID for Solana mainnet
          displayName: 'Solana',
          currencySymbol: 'SOL',
          emoji: '◎',
          isTestnet: false,
          isActive: true,
          isSolana: true, // Flag for Solana-specific handling
          openSeaSupported: false,
          magicEdenSupported: true,
          heliusWebhookSupported: true,
          rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
          paymentContract: '5dBMD7r6UrS6FA7oNLMEn5isMdXYnZqWb9kxUp3kUSzm' // Solana payment receiver address
        },
        {
          name: 'bitcoin',
          chainId: 0, // Bitcoin mainnet
          displayName: 'Bitcoin',
          currencySymbol: 'BTC',
          emoji: '₿',
          isTestnet: false,
          isActive: true,
          isBitcoin: true, // Flag for Bitcoin-specific handling
          openSeaSupported: false,
          magicEdenSupported: true,
          ordinalsSupported: true,
          hiroWebhookSupported: true,
          rpcUrl: process.env.HIRO_ORDINALS_API_URL || 'https://api.hiro.so/ordinals/v1',
          paymentContract: process.env.BITCOIN_PAYMENT_ADDRESS || 'bc1qplaceholder' // Bitcoin payment receiver address
        }
      ];

      this.chains.clear();
      for (const config of chainConfigs) {
        this.chains.set(config.name, config);
      }

      logger.info(`Loaded ${this.chains.size} active chain configurations`);
    } catch (error) {
      logger.error('Error loading chain configurations:', error);
      throw error;
    }
  }

  getChain(chainName) {
    return this.chains.get(chainName) || null;
  }

  getChainById(chainId) {
    for (const [name, config] of this.chains.entries()) {
      if (config.chainId === chainId) {
        return config;
      }
    }
    return null;
  }

  getAllChains() {
    return Array.from(this.chains.values());
  }

  getMainnetChains() {
    return Array.from(this.chains.values()).filter(chain => !chain.isTestnet);
  }

  getTestnetChains() {
    return Array.from(this.chains.values()).filter(chain => chain.isTestnet);
  }

  getOpenSeaSupportedChains() {
    return Array.from(this.chains.values()).filter(chain => chain.openSeaSupported);
  }

  getAlchemySupportedChains() {
    return Array.from(this.chains.values()).filter(chain => chain.alchemyNetwork);
  }

  getMagicEdenSupportedChains() {
    return Array.from(this.chains.values()).filter(chain => chain.magicEdenSupported);
  }

  getSolanaChains() {
    return Array.from(this.chains.values()).filter(chain => chain.isSolana);
  }

  getBitcoinChains() {
    return Array.from(this.chains.values()).filter(chain => chain.isBitcoin);
  }

  // User chain preference methods
  async getUserChainPreference(userId) {
    try {
      const preference = await this.db.get(`
        SELECT selected_chain, selected_chain_id
        FROM user_chain_preferences
        WHERE user_id = $1
      `, [userId]);

      if (preference) {
        return {
          chainName: preference.selected_chain,
          chainId: preference.selected_chain_id,
          chainConfig: this.getChain(preference.selected_chain)
        };
      }

      // Return default chain (Ethereum) if no preference set
      return {
        chainName: 'ethereum',
        chainId: 1,
        chainConfig: this.getChain('ethereum')
      };
    } catch (error) {
      logger.error(`Error getting user chain preference for ${userId}:`, error);
      return {
        chainName: 'ethereum',
        chainId: 1,
        chainConfig: this.getChain('ethereum')
      };
    }
  }

  async setUserChainPreference(userId, chainName) {
    try {
      const chainConfig = this.getChain(chainName);
      if (!chainConfig) {
        throw new Error(`Invalid chain: ${chainName}`);
      }

      await this.db.run(`
        INSERT OR REPLACE INTO user_chain_preferences
        (user_id, selected_chain, selected_chain_id, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [userId, chainName, chainConfig.chainId]);

      logger.info(`Set user ${userId} chain preference to ${chainName}`);
      return true;
    } catch (error) {
      logger.error(`Error setting user chain preference:`, error);
      throw error;
    }
  }

  // Chain selection UI helpers
  getChainSelectionKeyboard() {
    const mainnetChains = this.getMainnetChains();
    const testnetChains = this.getTestnetChains();

    const keyboard = [];

    // Add mainnet chains (2 per row)
    for (let i = 0; i < mainnetChains.length; i += 2) {
      const row = [];
      row.push({
        text: `${mainnetChains[i].emoji} ${mainnetChains[i].displayName}`,
        callback_data: `chain_select_${mainnetChains[i].name}`
      });

      if (i + 1 < mainnetChains.length) {
        row.push({
          text: `${mainnetChains[i + 1].emoji} ${mainnetChains[i + 1].displayName}`,
          callback_data: `chain_select_${mainnetChains[i + 1].name}`
        });
      }
      keyboard.push(row);
    }

    // Add testnet section if any testnets exist
    if (testnetChains.length > 0) {
      keyboard.push([{
        text: '--- Testnets ---',
        callback_data: 'chain_testnets_header'
      }]);

      for (const chain of testnetChains) {
        keyboard.push([{
          text: chain.displayName,
          callback_data: `chain_select_${chain.name}`
        }]);
      }
    }

    return keyboard;
  }

  formatChainInfo(chainName) {
    const chain = this.getChain(chainName);
    if (!chain) return 'Unknown Chain';

    const features = [];
    if (chain.alchemyNetwork) features.push('Alchemy');
    if (chain.openSeaSupported) features.push('OpenSea');

    return `🔗 **${chain.displayName}**\n` +
           `Currency: ${chain.currencySymbol}\n` +
           `Chain ID: ${chain.chainId}\n` +
           `Features: ${features.join(', ') || 'Basic'}\n` +
           `Type: ${chain.isTestnet ? 'Testnet' : 'Mainnet'}`;
  }

  // Contract address validation per chain
  validateContractAddress(address, chainName) {
    const { ethers } = require('ethers');

    // Basic Ethereum address validation works for most EVM chains
    if (!ethers.isAddress(address)) {
      return { isValid: false, reason: 'Invalid address format' };
    }

    const chain = this.getChain(chainName);
    if (!chain) {
      return { isValid: false, reason: 'Unsupported chain' };
    }

    return { isValid: true, chain };
  }

  // Get appropriate API endpoints per chain
  getApiEndpoints(chainName) {
    const chain = this.getChain(chainName);
    if (!chain) return null;

    return {
      chain: chain.name,
      alchemy: chain.alchemyNetwork,
      openSea: chain.openSeaSupported,
      chainId: chain.chainId
    };
  }

  isChainSupported(chainName) {
    return this.chains.has(chainName);
  }

  getChainEmoji(chainName) {
    const emojiMap = {
      'ethereum': '🔹',
      'polygon': '🟣',
      'arbitrum': '🔵',
      'optimism': '🔴',
      'base': '🟦',
      'sepolia': '🧪'
    };
    return emojiMap[chainName] || '🔗';
  }

  // Payment contract helper methods
  getPaymentContract(chainName) {
    const chain = this.getChain(chainName);
    return chain ? chain.paymentContract : null;
  }

  getRpcUrl(chainName) {
    const chain = this.getChain(chainName);
    return chain ? chain.rpcUrl : null;
  }


  getCurrencySymbol(chainName) {
    const chain = this.getChain(chainName);
    return chain ? chain.currencySymbol : 'ETH';
  }

  // Chain selection helpers for different contexts
  getChainsForPayments() {
    // Return all active chains that have payment contracts
    return Array.from(this.chains.values()).filter(chain =>
      chain.isActive && chain.paymentContract
    );
  }

  getChainsForTokenTracking() {
    // Return all active chains
    return Array.from(this.chains.values()).filter(chain => chain.isActive);
  }

  async getStats() {
    try {
      const stats = {};

      // Get token count per chain
      for (const [chainName, config] of this.chains.entries()) {
        const tokenCount = await this.db.get(`
          SELECT COUNT(*) as count
          FROM tracked_tokens
          WHERE blockchain_network = $1 AND is_active = true
        `, [chainName]);

        stats[chainName] = {
          ...config,
          tokenCount: tokenCount ? tokenCount.count : 0
        };
      }

      // Get user preference distribution
      const userPrefs = await this.db.all(`
        SELECT selected_chain, COUNT(*) as count
        FROM user_chain_preferences
        GROUP BY selected_chain
      `);

      stats._userPreferences = userPrefs.reduce((acc, pref) => {
        acc[pref.selected_chain] = pref.count;
        return acc;
      }, {});

      return stats;
    } catch (error) {
      logger.error('Error getting chain stats:', error);
      return {};
    }
  }
}

module.exports = ChainManager;