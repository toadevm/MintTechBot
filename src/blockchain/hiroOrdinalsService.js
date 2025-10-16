const axios = require('axios');
const logger = require('../services/logger');

class HiroOrdinalsService {
  constructor() {
    this.apiKey = process.env.HIRO_API_KEY;
    this.apiBaseUrl = process.env.HIRO_ORDINALS_API_URL || 'https://api.hiro.so/ordinals/v1';
    this.chainhookApiUrl = 'https://api.hiro.so/chainhooks/v1';
    this.webhookAuthToken = process.env.HIRO_WEBHOOK_AUTH_TOKEN;
    this.chainhooks = new Map(); // Track active chainhooks
    this.isConnected = false;
  }

  async initialize() {
    try {
      if (!this.apiKey) {
        throw new Error('HIRO_API_KEY not found in environment variables');
      }

      if (!this.webhookAuthToken) {
        throw new Error('HIRO_WEBHOOK_AUTH_TOKEN not found in environment variables');
      }

      // Test API connectivity by fetching a sample inscription
      const response = await axios.get(`${this.apiBaseUrl}/inscriptions`, {
        params: { limit: 1 },
        timeout: 10000,
        headers: {
          'X-API-Key': this.apiKey,
          'Accept': 'application/json'
        }
      });

      if (response.status === 200) {
        this.isConnected = true;
        logger.info('₿ Hiro Ordinals service initialized successfully');

        // List existing chainhooks
        await this.listChainhooks();
        return true;
      }

      throw new Error('Failed to connect to Hiro Ordinals API');
    } catch (error) {
      logger.error('Failed to initialize Hiro Ordinals service:', error.message);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Create a Chainhook for monitoring Bitcoin Ordinals transfers
   * @param {string} webhookURL - The URL to receive chainhook notifications
   * @param {Object} predicates - Chainhook predicates for filtering
   * @param {string} name - Optional name for the chainhook
   * @returns {Promise<Object>} Chainhook creation result
   */
  async createChainhook(webhookURL, predicates, name = null) {
    try {
      logger.info(`Creating Hiro Chainhook for Bitcoin Ordinals...`);

      const payload = {
        chain: 'bitcoin',
        version: 1,
        uuid: name || `ordinals-${Date.now()}`,
        name: name || `Bitcoin Ordinals Tracker`,
        networks: {
          mainnet: {
            if_this: predicates,
            then_that: {
              http_post: {
                url: webhookURL,
                authorization_header: this.webhookAuthToken
              }
            }
          }
        }
      };

      const url = `${this.chainhookApiUrl}/chainhooks`;
      const response = await axios.post(url, payload, {
        timeout: 15000,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.uuid) {
        const chainhookId = response.data.uuid;
        logger.info(`✅ Hiro Chainhook created successfully: ${chainhookId}`);
        logger.info(`   Webhook URL: ${webhookURL}`);

        // Track chainhook
        this.chainhooks.set(chainhookId, {
          chainhookId,
          webhookURL,
          predicates,
          createdAt: new Date().toISOString()
        });

        return {
          success: true,
          chainhookId: chainhookId,
          webhookURL: webhookURL,
          predicates: predicates
        };
      }

      throw new Error('Failed to create chainhook - no UUID returned');

    } catch (error) {
      logger.error('Failed to create Hiro Chainhook:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Delete a chainhook by UUID
   * @param {string} chainhookId - The chainhook UUID to delete
   * @returns {Promise<Object>} Deletion result
   */
  async deleteChainhook(chainhookId) {
    try {
      logger.info(`Deleting Hiro Chainhook: ${chainhookId}`);

      const url = `${this.chainhookApiUrl}/chainhooks/${chainhookId}`;
      const response = await axios.delete(url, {
        timeout: 10000,
        headers: {
          'X-API-Key': this.apiKey
        }
      });

      if (response.status === 200 || response.status === 204) {
        logger.info(`✅ Hiro Chainhook deleted successfully: ${chainhookId}`);
        this.chainhooks.delete(chainhookId);

        return {
          success: true,
          chainhookId: chainhookId
        };
      }

      throw new Error('Failed to delete chainhook');

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Chainhook ${chainhookId} not found (may have been already deleted)`);
        this.chainhooks.delete(chainhookId);
        return {
          success: true,
          chainhookId: chainhookId,
          note: 'Chainhook not found (already deleted)'
        };
      }

      logger.error(`Failed to delete Hiro Chainhook ${chainhookId}:`, error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * List all chainhooks for this account
   * @returns {Promise<Array>} Array of chainhooks
   */
  async listChainhooks() {
    try {
      const url = `${this.chainhookApiUrl}/chainhooks`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'X-API-Key': this.apiKey
        }
      });

      const chainhooks = response.data || [];
      logger.info(`📋 Found ${chainhooks.length} active Hiro Chainhooks`);

      // Update local tracking
      chainhooks.forEach(chainhook => {
        if (chainhook.uuid) {
          this.chainhooks.set(chainhook.uuid, {
            chainhookId: chainhook.uuid,
            name: chainhook.name,
            predicates: chainhook.networks?.mainnet?.if_this || {},
            createdAt: chainhook.created_at || null
          });
        }
      });

      return chainhooks;

    } catch (error) {
      // 404 is expected when no chainhooks exist yet - not an error
      if (error.response?.status === 404) {
        logger.info('📋 No existing Hiro Chainhooks found (this is normal for new setup)');
        return [];
      }
      logger.error('Failed to list Hiro Chainhooks:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get chainhook details by UUID
   * @param {string} chainhookId - The chainhook UUID
   * @returns {Promise<Object|null>} Chainhook details or null
   */
  async getChainhook(chainhookId) {
    try {
      const url = `${this.chainhookApiUrl}/chainhooks/${chainhookId}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'X-API-Key': this.apiKey
        }
      });

      return response.data || null;

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Chainhook ${chainhookId} not found`);
        return null;
      }

      logger.error(`Failed to get chainhook ${chainhookId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Verify chainhook auth header (for incoming requests)
   * @param {string} authHeader - The auth header from the request
   * @returns {boolean} True if valid, false otherwise
   */
  verifyChainhookAuth(authHeader) {
    if (!authHeader || !this.webhookAuthToken) {
      logger.warn('Missing auth header or webhook token');
      return false;
    }

    const isValid = authHeader === this.webhookAuthToken;
    if (!isValid) {
      logger.warn('Invalid chainhook auth header');
    }

    return isValid;
  }

  /**
   * Parse inscription transfer event from Chainhook
   * @param {Object} event - The event object from Hiro Chainhook
   * @returns {Object} Parsed inscription transfer data
   */
  parseInscriptionTransfer(event) {
    try {
      // Hiro Chainhook event structure for ordinals transfers
      const transaction = event.transaction;
      if (!transaction) {
        logger.warn('Chainhook event missing transaction data');
        return null;
      }

      // Extract inscription transfer details
      const metadata = transaction.metadata || {};
      const ordinalsEvents = metadata.ordinal_operations || [];

      if (ordinalsEvents.length === 0) {
        logger.debug('No ordinal operations found in transaction');
        return null;
      }

      // Parse first ordinal operation (transfer)
      const ordinalOp = ordinalsEvents[0];

      const transferData = {
        type: 'INSCRIPTION_TRANSFER',
        txid: transaction.transaction_identifier?.hash,
        timestamp: event.timestamp,
        block_height: transaction.metadata?.block_height,

        // Inscription details
        inscription_id: ordinalOp.inscription_id,
        inscription_number: ordinalOp.inscription_number,

        // Transfer details
        sender: ordinalOp.sender || this.extractSender(transaction),
        recipient: ordinalOp.recipient || this.extractRecipient(transaction),

        // Collection info (if available in metadata)
        collection_symbol: metadata.collection_symbol || null,

        // Raw event for debugging
        rawEvent: event
      };

      logger.info(`📊 Parsed Inscription Transfer: ${transferData.inscription_id}`);
      return transferData;

    } catch (error) {
      logger.error('Error parsing inscription transfer event:', error);
      return null;
    }
  }

  /**
   * Extract sender address from transaction
   * @param {Object} transaction - Transaction object
   * @returns {string|null} Sender address
   */
  extractSender(transaction) {
    try {
      const operations = transaction.operations || [];
      for (const op of operations) {
        if (op.type === 'spent_in_input' && op.account?.address) {
          return op.account.address;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract recipient address from transaction
   * @param {Object} transaction - Transaction object
   * @returns {string|null} Recipient address
   */
  extractRecipient(transaction) {
    try {
      const operations = transaction.operations || [];
      for (const op of operations) {
        if (op.type === 'credited_in_output' && op.account?.address) {
          return op.account.address;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get inscription metadata by ID
   * @param {string} inscriptionId - The inscription ID
   * @returns {Promise<Object|null>} Inscription metadata or null
   */
  async getInscriptionMetadata(inscriptionId) {
    try {
      const url = `${this.apiBaseUrl}/inscriptions/${inscriptionId}`;
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'X-API-Key': this.apiKey,
          'Accept': 'application/json'
        }
      });

      return response.data || null;

    } catch (error) {
      if (error.response?.status === 404) {
        logger.debug(`Inscription ${inscriptionId} not found`);
        return null;
      }
      logger.error(`Failed to get inscription metadata for ${inscriptionId}:`, error.message);
      return null;
    }
  }

  /**
   * Get connection status
   * @returns {Object} Connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      service: 'Hiro Ordinals',
      blockchain: 'Bitcoin',
      activeChainhooks: this.chainhooks.size
    };
  }

  /**
   * Cleanup all chainhooks (for shutdown)
   */
  async cleanup() {
    try {
      logger.info('🧹 Cleaning up Hiro Chainhooks...');

      const chainhookIds = Array.from(this.chainhooks.keys());
      for (const chainhookId of chainhookIds) {
        await this.deleteChainhook(chainhookId);
      }

      this.isConnected = false;
      logger.info('✅ Hiro cleanup completed');
    } catch (error) {
      logger.error('Error during Hiro cleanup:', error);
    }
  }

  /**
   * Disconnect (cleanup without deleting chainhooks)
   */
  async disconnect() {
    try {
      this.isConnected = false;
      logger.info('₿ Hiro Ordinals service disconnected (chainhooks preserved)');
    } catch (error) {
      logger.error('Error disconnecting Hiro Ordinals service:', error);
    }
  }
}

module.exports = HiroOrdinalsService;
