const axios = require('axios');
const logger = require('../services/logger');
const {
  formatSOL,
  handleApiError,
  validateCollectionSlug
} = require('./utils');

class MagicEdenService {
  constructor() {
    this.apiBaseUrl = 'https://api-mainnet.magiceden.dev/v2';
    this.apiKey = process.env.MAGIC_EDEN_API_KEY;
    this.client = null;
    this.isConnected = false;
  }

  async initialize() {
    try {
      if (!this.apiKey) {
        logger.warn('🪄 Magic Eden API key not provided - service will have limited functionality');
        this.isConnected = false;
        return false;
      }

      // Test API connectivity with a lightweight endpoint (mad_lads collection stats)
      // Using a specific collection instead of /popular to avoid rate limiting
      const response = await axios.get(`${this.apiBaseUrl}/collections/mad_lads/stats`, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.status === 200) {
        this.isConnected = true;
        logger.info('🪄 Magic Eden API service initialized successfully');
        return true;
      }

      throw new Error('Failed to connect to Magic Eden API');
    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn('🪄 Magic Eden API rate limited during initialization - service may still work');
        this.isConnected = true; // Still mark as connected since auth works
        return true;
      }
      logger.error('Failed to initialize Magic Eden service:', error.message);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Validate a Solana NFT mint address and get collection metadata
   * @param {string} mintAddress - Solana NFT mint address
   * @returns {Promise<Object>} Validation result with collection info
   */
  async validateMintAddress(mintAddress) {
    try {
      if (!mintAddress || typeof mintAddress !== 'string') {
        return { isValid: false, reason: 'Invalid mint address format' };
      }

      // Basic Solana address validation (base58, 32-44 chars)
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress)) {
        return { isValid: false, reason: 'Invalid Solana address format' };
      }

      logger.info(`Validating Solana NFT mint address: ${mintAddress}`);

      // Fetch NFT metadata from Magic Eden
      const url = `${this.apiBaseUrl}/tokens/${mintAddress}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.data) {
        const nftData = response.data;

        // Extract collection information
        const collectionSymbol = nftData.collection || nftData.collectionName || 'Unknown Collection';
        const nftName = nftData.name || `NFT ${mintAddress.slice(0, 8)}`;
        const collectionTitle = nftData.collectionTitle || nftData.collection || collectionSymbol;

        logger.info(`Valid Solana NFT: ${nftName} from collection ${collectionSymbol}`);

        return {
          isValid: true,
          valid: true,
          mintAddress: mintAddress,
          name: nftName,
          collectionSymbol: collectionSymbol,
          collectionTitle: collectionTitle,
          collectionSlug: collectionSymbol, // Magic Eden uses symbol as slug
          image: nftData.image || null,
          attributes: nftData.attributes || [],
          owner: nftData.owner || null
        };
      }

      return { isValid: false, reason: 'NFT not found on Magic Eden' };

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Solana NFT mint ${mintAddress} not found on Magic Eden`);
        return { isValid: false, reason: 'NFT not found on Magic Eden' };
      } else if (error.response?.status === 429) {
        logger.warn(`Rate limited by Magic Eden API when validating ${mintAddress}`);
        return { isValid: false, reason: 'Magic Eden API rate limit exceeded' };
      } else {
        logger.error(`Failed to validate Solana mint ${mintAddress}:`, error.message);
        return { isValid: false, reason: error.message };
      }
    }
  }

  /**
   * Get collection metadata by collection symbol
   * @param {string} collectionSymbol - Magic Eden collection symbol
   * @returns {Promise<Object>} Collection metadata
   */
  async getCollectionMetadata(collectionSymbol) {
    try {
      if (!collectionSymbol) {
        return { isValid: false, reason: 'Collection symbol required' };
      }

      logger.info(`Fetching Magic Eden collection metadata: ${collectionSymbol}`);

      const url = `${this.apiBaseUrl}/collections/${collectionSymbol}/stats`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.data) {
        const stats = response.data;

        return {
          isValid: true,
          collectionSymbol: collectionSymbol,
          floorPrice: stats.floorPrice ? (stats.floorPrice / 1e9).toFixed(2) : null, // Convert lamports to SOL
          listedCount: stats.listedCount || 0,
          volumeAll: stats.volumeAll ? (stats.volumeAll / 1e9).toFixed(2) : null,
          currency: 'SOL'
        };
      }

      return { isValid: false, reason: 'Collection not found' };

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Collection ${collectionSymbol} not found on Magic Eden`);
        return { isValid: false, reason: 'Collection not found' };
      }
      logger.error(`Failed to get collection metadata for ${collectionSymbol}:`, error.message);
      return { isValid: false, reason: error.message };
    }
  }

  /**
   * Get collection activities (sales, listings)
   * @param {string} collectionSymbol - Magic Eden collection symbol
   * @param {number} limit - Number of activities to fetch
   * @returns {Promise<Array>} Array of activities
   */
  async getCollectionActivities(collectionSymbol, limit = 20) {
    try {
      const url = `${this.apiBaseUrl}/collections/${collectionSymbol}/activities`;
      const response = await axios.get(url, {
        params: { limit },
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return response.data || [];
    } catch (error) {
      logger.error(`Failed to get activities for ${collectionSymbol}:`, error.message);
      return [];
    }
  }

  /**
   * Get popular collections (for discovery)
   * @param {number} limit - Number of collections to fetch
   * @returns {Promise<Array>} Array of popular collections
   */
  async getPopularCollections(limit = 10) {
    try {
      const url = `${this.apiBaseUrl}/collections/popular`;
      const response = await axios.get(url, {
        params: { limit },
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return response.data || [];
    } catch (error) {
      logger.error('Failed to get popular collections:', error.message);
      return [];
    }
  }

  /**
   * Validate collection slug format - delegates to shared utility
   * @param {string} collectionSlug - Collection slug/symbol
   * @returns {Object} Validation result
   */
  validateCollectionSlug(collectionSlug) {
    // Magic Eden collection slugs are alphanumeric with underscores and hyphens
    return validateCollectionSlug(collectionSlug, {
      pattern: /^[a-zA-Z0-9_-]+$/
    });
  }

  /**
   * Parse Magic Eden collection URL to extract collection symbol
   * @param {string} url - Magic Eden URL
   * @returns {string|null} Collection symbol or null
   */
  parseCollectionUrl(url) {
    try {
      // Magic Eden URL format: https://magiceden.io/marketplace/collection_symbol
      const match = url.match(/magiceden\.io\/marketplace\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        logger.info(`Extracted collection symbol from URL: ${match[1]}`);
        return match[1];
      }

      // Alternative format: https://magiceden.us/marketplace/collection_symbol
      const matchUs = url.match(/magiceden\.us\/marketplace\/([a-zA-Z0-9_-]+)/);
      if (matchUs && matchUs[1]) {
        logger.info(`Extracted collection symbol from URL: ${matchUs[1]}`);
        return matchUs[1];
      }

      return null;
    } catch (error) {
      logger.error('Failed to parse Magic Eden URL:', error);
      return null;
    }
  }

  /**
   * Get NFT metadata by mint address
   * @param {string} mintAddress - Solana NFT mint address
   * @returns {Promise<Object|null>} NFT metadata or null
   */
  async getNFTMetadata(mintAddress) {
    try {
      const url = `${this.apiBaseUrl}/tokens/${mintAddress}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return response.data || null;
    } catch (error) {
      logger.error(`Failed to get NFT metadata for ${mintAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Format lamports to SOL with proper decimals - delegates to shared utility
   * @param {number} lamports - Amount in lamports
   * @returns {string} Formatted SOL amount
   */
  formatLamportsToSol(lamports) {
    return formatSOL(lamports);
  }

  /**
   * Get connection status
   * @returns {Object} Connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      service: 'Magic Eden',
      blockchain: 'Solana'
    };
  }

  /**
   * Disconnect (cleanup)
   */
  async disconnect() {
    try {
      this.isConnected = false;
      logger.info('🪄 Magic Eden service disconnected');
    } catch (error) {
      logger.error('Error disconnecting Magic Eden service:', error);
    }
  }
}

module.exports = MagicEdenService;
