const axios = require('axios');
const logger = require('../services/logger');

class MagicEdenOrdinalsService {
  constructor() {
    this.apiBaseUrl = 'https://api-mainnet.magiceden.dev/v2/ord/btc';
    this.apiKey = process.env.MAGIC_EDEN_API_KEY;
    this.isConnected = false;
  }

  async initialize() {
    try {
      logger.info('₿ Initializing Magic Eden Ordinals service...');

      if (!this.apiKey) {
        logger.warn('₿ Magic Eden API key not provided - Ordinals service will have limited functionality');
        this.isConnected = false;
        return true;
      }

      // Skip connectivity test during initialization to avoid timeout issues
      // The poller will test connectivity during its first poll attempt
      logger.info('₿ Magic Eden API key configured - skipping connectivity test (will verify during first poll)');
      this.isConnected = true; // Optimistically mark as connected
      logger.info('₿ Magic Eden Ordinals service initialized ✅');
      return true;

    } catch (error) {
      logger.error(`₿ Failed to initialize Magic Eden Ordinals service:`, error.message || error.toString());
      // Even on error, mark as connected and let the poller handle failures
      this.isConnected = true;
      return true;
    }
  }

  /**
   * Validate a Bitcoin Ordinals collection symbol
   * @param {string} collectionSymbol - Magic Eden Ordinals collection symbol
   * @returns {Promise<Object>} Validation result with collection info
   */
  async validateCollectionSymbol(collectionSymbol) {
    try {
      if (!collectionSymbol || typeof collectionSymbol !== 'string') {
        return { isValid: false, reason: 'Invalid collection symbol format' };
      }

      // Basic validation (alphanumeric, hyphens, underscores)
      if (!/^[a-zA-Z0-9_-]+$/.test(collectionSymbol)) {
        return { isValid: false, reason: 'Collection symbol contains invalid characters' };
      }

      logger.info(`Validating Bitcoin Ordinals collection: ${collectionSymbol}`);

      // Fetch collection metadata from Magic Eden
      const url = `${this.apiBaseUrl}/collections/${collectionSymbol}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });

      if (response.data) {
        const collection = response.data;

        logger.info(`Valid Bitcoin Ordinals collection: ${collection.name || collectionSymbol}`);

        return {
          isValid: true,
          valid: true,
          collectionSymbol: collectionSymbol,
          name: collection.name || collectionSymbol,
          collectionSlug: collectionSymbol,
          description: collection.description || null,
          image: collection.imageURI || collection.image || null,
          floorPrice: collection.fp ? this.formatSatsToBTC(collection.fp) : null,
          totalVolume: collection.totalVol ? this.formatSatsToBTC(collection.totalVol) : null,
          supply: collection.supply || null
        };
      }

      return { isValid: false, reason: 'Collection not found on Magic Eden' };

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Bitcoin Ordinals collection ${collectionSymbol} not found on Magic Eden`);
        return { isValid: false, reason: 'Collection not found on Magic Eden' };
      } else if (error.response?.status === 429) {
        logger.warn(`Rate limited by Magic Eden API when validating ${collectionSymbol}`);
        return { isValid: false, reason: 'Magic Eden API rate limit exceeded' };
      } else {
        logger.error(`Failed to validate Ordinals collection ${collectionSymbol}:`, error.message);
        return { isValid: false, reason: error.message };
      }
    }
  }

  /**
   * Get collection activities (transfers, sales, listings)
   * @param {string} collectionSymbol - Magic Eden collection symbol
   * @param {number} limit - Number of activities to fetch per type
   * @param {string} kind - Activity type: 'buying_broadcasted', 'list', or 'transfer'
   * @returns {Promise<Array>} Array of activities
   */
  async getCollectionActivities(collectionSymbol, limit = 20, kind = null) {
    try {
      const url = `${this.apiBaseUrl}/activities`;

      // Ensure limit is multiple of 20
      const validLimit = Math.ceil(limit / 20) * 20;

      // Valid kind values: 'buying_broadcasted', 'list', 'transfer'
      // If no kind specified, fetch all types
      if (kind) {
        const response = await axios.get(url, {
          params: {
            collectionSymbol: collectionSymbol,
            limit: validLimit,
            kind: kind
          },
          timeout: 30000,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json'
          }
        });

        return response.data?.activities || [];
      }

      // Fetch all activity types and combine
      const activityTypes = ['buying_broadcasted', 'list', 'transfer'];
      const allActivities = [];

      for (const activityKind of activityTypes) {
        try {
          const response = await axios.get(url, {
            params: {
              collectionSymbol: collectionSymbol,
              limit: validLimit,
              kind: activityKind
            },
            timeout: 30000,
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Accept': 'application/json'
            }
          });

          const activities = response.data?.activities || [];
          allActivities.push(...activities);
        } catch (kindError) {
          logger.warn(`₿ Failed to fetch ${activityKind} activities: ${kindError.message}`);
        }
      }

      // Remove duplicates based on unique identifier (if any)
      const uniqueActivities = Array.from(
        new Map(allActivities.map(a => [a.id || JSON.stringify(a), a])).values()
      );

      // Sort by timestamp (most recent first)
      uniqueActivities.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.created_at || 0).getTime();
        const timeB = new Date(b.createdAt || b.created_at || 0).getTime();
        return timeB - timeA;
      });

      return uniqueActivities.slice(0, validLimit);
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        logger.warn(`₿ Timeout getting activities for ${collectionSymbol} - API may be slow`);
      } else {
        logger.error(`₿ Failed to get activities for ${collectionSymbol}:`, error.message);
        if (error.response) {
          logger.error(`   HTTP Status: ${error.response.status}`);
          logger.error(`   Response: ${JSON.stringify(error.response.data)}`);
        }
      }
      return [];
    }
  }

  /**
   * Get inscription metadata by inscription ID
   * @param {string} inscriptionId - Bitcoin inscription ID
   * @returns {Promise<Object|null>} Inscription metadata or null
   */
  async getInscriptionMetadata(inscriptionId) {
    try {
      const url = `${this.apiBaseUrl}/tokens/${inscriptionId}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });

      return response.data || null;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.debug(`Inscription ${inscriptionId} not found on Magic Eden`);
        return null;
      }
      logger.error(`Failed to get inscription metadata for ${inscriptionId}:`, error.message);
      return null;
    }
  }

  /**
   * Parse Magic Eden Ordinals collection URL to extract collection symbol
   * @param {string} url - Magic Eden URL
   * @returns {string|null} Collection symbol or null
   */
  parseCollectionUrl(url) {
    try {
      // Magic Eden Ordinals URL format: https://magiceden.io/ordinals/marketplace/collection_symbol
      // or https://magiceden.us/ordinals/marketplace/collection_symbol
      const match = url.match(/magiceden\.(io|us)\/ordinals\/marketplace\/([a-zA-Z0-9_-]+)/);
      if (match && match[2]) {
        logger.info(`Extracted Ordinals collection symbol from URL: ${match[2]}`);
        return match[2];
      }

      // Alternative format: https://magiceden.io/ordinals/collection_symbol
      const matchAlt = url.match(/magiceden\.(io|us)\/ordinals\/([a-zA-Z0-9_-]+)/);
      if (matchAlt && matchAlt[2] && matchAlt[2] !== 'marketplace') {
        logger.info(`Extracted Ordinals collection symbol from URL: ${matchAlt[2]}`);
        return matchAlt[2];
      }

      return null;
    } catch (error) {
      logger.error('Failed to parse Magic Eden Ordinals URL:', error);
      return null;
    }
  }

  /**
   * Format satoshis to BTC with proper decimals
   * @param {number} satoshis - Amount in satoshis
   * @returns {string} Formatted BTC amount
   */
  formatSatsToBTC(satoshis) {
    if (!satoshis || satoshis === 0) return '0 BTC';

    const btc = satoshis / 100000000; // 1 BTC = 100,000,000 satoshis

    if (btc >= 1) {
      return `${btc.toFixed(4)} BTC`;
    } else if (btc >= 0.001) {
      return `${btc.toFixed(6)} BTC`;
    } else {
      return `${btc.toFixed(8)} BTC`;
    }
  }

  /**
   * Convert BTC to satoshis
   * @param {number} btc - Amount in BTC
   * @returns {number} Amount in satoshis
   */
  convertBTCToSats(btc) {
    return Math.round(btc * 100000000);
  }

  /**
   * Get popular Ordinals collections (for discovery)
   * @param {number} limit - Number of collections to fetch
   * @returns {Promise<Array>} Array of popular collections
   */
  async getPopularCollections(limit = 10) {
    try {
      const url = `${this.apiBaseUrl}/collections`;
      const response = await axios.get(url, {
        params: { limit },
        timeout: 10000,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });

      return response.data?.collections || [];
    } catch (error) {
      logger.error('Failed to get popular Ordinals collections:', error.message);
      return [];
    }
  }

  /**
   * Get connection status
   * @returns {Object} Connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      service: 'Magic Eden Ordinals',
      blockchain: 'Bitcoin'
    };
  }

  /**
   * Disconnect (cleanup)
   */
  async disconnect() {
    try {
      this.isConnected = false;
      logger.info('₿ Magic Eden Ordinals service disconnected');
    } catch (error) {
      logger.error('Error disconnecting Magic Eden Ordinals service:', error);
    }
  }
}

module.exports = MagicEdenOrdinalsService;
