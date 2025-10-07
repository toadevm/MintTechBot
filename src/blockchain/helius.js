const axios = require('axios');
const logger = require('../services/logger');

class HeliusService {
  constructor() {
    this.apiKey = process.env.HELIUS_API_KEY;
    this.apiBaseUrl = 'https://api.helius.xyz/v0';
    this.webhookAuthToken = process.env.HELIUS_WEBHOOK_AUTH_TOKEN;
    this.magicEdenProgram = 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K'; // Magic Eden v2 program
    this.webhooks = new Map(); // Track active webhooks by collection/mint
    this.isConnected = false;
  }

  async initialize() {
    try {
      if (!this.apiKey) {
        throw new Error('HELIUS_API_KEY not found in environment variables');
      }

      if (!this.webhookAuthToken) {
        throw new Error('HELIUS_WEBHOOK_AUTH_TOKEN not found in environment variables');
      }

      // Test API connectivity by listing existing webhooks
      await this.listWebhooks();

      this.isConnected = true;
      logger.info('🌟 Helius service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Helius service:', error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Create a webhook for monitoring Magic Eden NFT sales
   * @param {string} webhookURL - The URL to receive webhook notifications
   * @param {Array<string>} accountAddresses - Solana addresses to monitor (optional, defaults to Magic Eden program)
   * @param {string} webhookName - Optional name for the webhook
   * @returns {Promise<Object>} Webhook creation result with webhook ID
   */
  async createWebhook(webhookURL, accountAddresses = null, webhookName = null) {
    try {
      logger.info(`Creating Helius webhook for Magic Eden sales...`);

      // Default to monitoring Magic Eden program for all NFT sales
      const addresses = accountAddresses || [this.magicEdenProgram];

      const payload = {
        webhookURL: webhookURL,
        transactionTypes: ['NFT_SALE'],
        accountAddresses: addresses,
        webhookType: 'enhanced', // Enhanced webhooks provide parsed, human-readable data
        authHeader: this.webhookAuthToken
      };

      // Note: Helius API does not support 'name' field - webhookName parameter ignored

      const url = `${this.apiBaseUrl}/webhooks?api-key=${this.apiKey}`;
      const response = await axios.post(url, payload, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.webhookID) {
        const webhookId = response.data.webhookID;
        logger.info(`✅ Helius webhook created successfully: ${webhookId}`);
        logger.info(`   Monitoring addresses: ${addresses.join(', ')}`);

        // Track webhook
        this.webhooks.set(webhookId, {
          webhookId,
          webhookURL,
          accountAddresses: addresses,
          createdAt: new Date().toISOString()
        });

        return {
          success: true,
          webhookId: webhookId,
          webhookURL: response.data.webhookURL,
          accountAddresses: addresses
        };
      }

      throw new Error('Failed to create webhook - no webhook ID returned');

    } catch (error) {
      logger.error('Failed to create Helius webhook:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Delete a webhook by ID
   * @param {string} webhookId - The webhook ID to delete
   * @returns {Promise<Object>} Deletion result
   */
  async deleteWebhook(webhookId) {
    try {
      logger.info(`Deleting Helius webhook: ${webhookId}`);

      const url = `${this.apiBaseUrl}/webhooks/${webhookId}?api-key=${this.apiKey}`;
      const response = await axios.delete(url, {
        timeout: 10000
      });

      if (response.status === 200) {
        logger.info(`✅ Helius webhook deleted successfully: ${webhookId}`);
        this.webhooks.delete(webhookId);

        return {
          success: true,
          webhookId: webhookId
        };
      }

      throw new Error('Failed to delete webhook');

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Webhook ${webhookId} not found (may have been already deleted)`);
        this.webhooks.delete(webhookId);
        return {
          success: true,
          webhookId: webhookId,
          note: 'Webhook not found (already deleted)'
        };
      }

      logger.error(`Failed to delete Helius webhook ${webhookId}:`, error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Update a webhook (e.g., add/remove monitored addresses)
   * @param {string} webhookId - The webhook ID to update
   * @param {Object} updates - Updates to apply (accountAddresses, webhookURL, etc.)
   * @returns {Promise<Object>} Update result
   */
  async updateWebhook(webhookId, updates) {
    try {
      logger.info(`Updating Helius webhook: ${webhookId}`);

      const url = `${this.apiBaseUrl}/webhooks/${webhookId}?api-key=${this.apiKey}`;
      const response = await axios.put(url, updates, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        logger.info(`✅ Helius webhook updated successfully: ${webhookId}`);

        // Update local tracking
        if (this.webhooks.has(webhookId)) {
          const existing = this.webhooks.get(webhookId);
          this.webhooks.set(webhookId, {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
          });
        }

        return {
          success: true,
          webhookId: webhookId,
          updates: updates
        };
      }

      throw new Error('Failed to update webhook');

    } catch (error) {
      logger.error(`Failed to update Helius webhook ${webhookId}:`, error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * List all webhooks for this account
   * @returns {Promise<Array>} Array of webhooks
   */
  async listWebhooks() {
    try {
      const url = `${this.apiBaseUrl}/webhooks?api-key=${this.apiKey}`;
      const response = await axios.get(url, {
        timeout: 10000
      });

      const webhooks = response.data || [];
      logger.info(`📋 Found ${webhooks.length} active Helius webhooks`);

      // Update local tracking
      webhooks.forEach(webhook => {
        if (webhook.webhookID) {
          this.webhooks.set(webhook.webhookID, {
            webhookId: webhook.webhookID,
            webhookURL: webhook.webhookURL,
            accountAddresses: webhook.accountAddresses || [],
            transactionTypes: webhook.transactionTypes || [],
            createdAt: webhook.createdAt || null
          });
        }
      });

      return webhooks;

    } catch (error) {
      logger.error('Failed to list Helius webhooks:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get webhook details by ID
   * @param {string} webhookId - The webhook ID
   * @returns {Promise<Object|null>} Webhook details or null
   */
  async getWebhook(webhookId) {
    try {
      const url = `${this.apiBaseUrl}/webhooks/${webhookId}?api-key=${this.apiKey}`;
      const response = await axios.get(url, {
        timeout: 10000
      });

      return response.data || null;

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Webhook ${webhookId} not found`);
        return null;
      }

      logger.error(`Failed to get webhook ${webhookId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Verify webhook auth header (for incoming requests)
   * @param {string} authHeader - The auth header from the request
   * @returns {boolean} True if valid, false otherwise
   */
  verifyWebhookAuth(authHeader) {
    if (!authHeader || !this.webhookAuthToken) {
      logger.warn('Missing auth header or webhook token');
      return false;
    }

    const isValid = authHeader === this.webhookAuthToken;
    if (!isValid) {
      logger.warn('Invalid webhook auth header');
    }

    return isValid;
  }

  /**
   * Parse Helius enhanced webhook payload for NFT sales
   * @param {Object} transaction - The transaction object from Helius webhook
   * @returns {Object} Parsed NFT sale data
   */
  parseNFTSaleEvent(transaction) {
    try {
      if (transaction.type !== 'NFT_SALE') {
        return null;
      }

      // Extract NFT sale data from enhanced webhook
      const nftEvent = transaction.events?.nft;
      if (!nftEvent) {
        logger.warn('NFT sale event missing NFT data');
        return null;
      }

      // Parse sale details
      const saleData = {
        type: 'NFT_SALE',
        signature: transaction.signature,
        timestamp: transaction.timestamp,
        slot: transaction.slot,

        // Sale details
        amount: nftEvent.amount, // Price in lamports
        amountSol: nftEvent.amount ? (nftEvent.amount / 1e9).toFixed(4) : '0',
        seller: nftEvent.seller,
        buyer: nftEvent.buyer,

        // NFT details
        nfts: nftEvent.nfts || [],
        mintAddress: nftEvent.nfts?.[0]?.mint || null,

        // Source (marketplace)
        source: nftEvent.source || 'Magic Eden',

        // Fee payer
        feePayer: transaction.feePayer,

        // Transaction details
        fee: transaction.fee,
        nativeTransfers: transaction.nativeTransfers || [],

        // Raw event for debugging
        rawEvent: nftEvent
      };

      logger.info(`📊 Parsed NFT sale: ${saleData.amountSol} SOL`);
      return saleData;

    } catch (error) {
      logger.error('Error parsing NFT sale event:', error);
      return null;
    }
  }

  /**
   * Create webhook for specific NFT collection monitoring
   * @param {string} collectionSymbol - Magic Eden collection symbol
   * @param {string} webhookURL - Webhook endpoint URL
   * @returns {Promise<Object>} Webhook creation result
   */
  async createCollectionWebhook(collectionSymbol, webhookURL) {
    try {
      // For collection-wide monitoring, we use the Magic Eden program address
      // Helius will send all NFT sales on Magic Eden, and we filter by collection in our handler
      const webhookName = `Magic Eden - ${collectionSymbol}`;

      return await this.createWebhook(webhookURL, [this.magicEdenProgram], webhookName);
    } catch (error) {
      logger.error(`Failed to create collection webhook for ${collectionSymbol}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get connection status
   * @returns {Object} Connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      service: 'Helius',
      blockchain: 'Solana',
      activeWebhooks: this.webhooks.size,
      magicEdenProgram: this.magicEdenProgram
    };
  }

  /**
   * Cleanup all webhooks (for shutdown)
   */
  async cleanup() {
    try {
      logger.info('🧹 Cleaning up Helius webhooks...');

      const webhookIds = Array.from(this.webhooks.keys());
      for (const webhookId of webhookIds) {
        await this.deleteWebhook(webhookId);
      }

      this.isConnected = false;
      logger.info('✅ Helius cleanup completed');
    } catch (error) {
      logger.error('Error during Helius cleanup:', error);
    }
  }

  /**
   * Disconnect (cleanup without deleting webhooks)
   */
  async disconnect() {
    try {
      this.isConnected = false;
      logger.info('🌟 Helius service disconnected (webhooks preserved)');
    } catch (error) {
      logger.error('Error disconnecting Helius service:', error);
    }
  }
}

module.exports = HeliusService;
