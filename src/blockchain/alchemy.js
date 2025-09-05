const { Alchemy, Network, WebhookType, NftFilters } = require('alchemy-sdk');
const logger = require('../services/logger');

class AlchemyService {
  constructor() {
    this.settings = {
      apiKey: process.env.ALCHEMY_API_KEY,
      network: Network.ETH_SEPOLIA, // Using Sepolia for testing
      authToken: process.env.ALCHEMY_AUTH_TOKEN, // For webhook operations
    };
    this.alchemy = null;
    this.webhooks = new Map(); // Store created webhooks
  }

  async initialize() {
    try {
      // Only include authToken if it's provided
      const config = {
        apiKey: this.settings.apiKey,
        network: this.settings.network
      };
      
      if (process.env.ALCHEMY_AUTH_TOKEN && process.env.ALCHEMY_AUTH_TOKEN.trim() !== '') {
        config.authToken = process.env.ALCHEMY_AUTH_TOKEN;
        this.webhooksEnabled = true;
        logger.info('Alchemy SDK initialized with webhook support');
      } else {
        this.webhooksEnabled = false;
        logger.warn('Alchemy initialized without auth token - webhooks disabled');
      }
      
      this.alchemy = new Alchemy(config);
      logger.info('Alchemy SDK initialized for Sepolia testnet');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Alchemy SDK:', error);
      throw error;
    }
  }

  async createNFTActivityWebhook(contractAddresses, webhookUrl) {
    try {
      if (!this.alchemy) {
        throw new Error('Alchemy not initialized');
      }
      
      if (!this.webhooksEnabled) {
        logger.warn('Webhooks not enabled - skipping webhook creation');
        return null;
      }

      const webhook = await this.alchemy.notify.createWebhook(
        webhookUrl,
        WebhookType.NFT_ACTIVITY,
        {
          addresses: contractAddresses,
          network: Network.ETH_SEPOLIA
        }
      );

      // Store webhook for management
      this.webhooks.set(webhook.id, webhook);
      
      logger.info(`NFT Activity webhook created: ${webhook.id} for contracts: ${contractAddresses.join(', ')}`);
      return webhook;
      
    } catch (error) {
      if (error.message && error.message.includes('Unauthenticated')) {
        logger.warn('Webhook authentication failed - disabling webhooks for this session');
        this.webhooksEnabled = false;
        return null;
      }
      logger.error('Failed to create NFT Activity webhook:', error);
      return null;
    }
  }

  async updateWebhookAddresses(webhookId, newAddresses) {
    try {
      const updatedWebhook = await this.alchemy.notify.updateWebhook(webhookId, {
        addAddresses: newAddresses
      });
      
      this.webhooks.set(webhookId, updatedWebhook);
      logger.info(`Webhook ${webhookId} updated with new addresses: ${newAddresses.join(', ')}`);
      return updatedWebhook;
      
    } catch (error) {
      logger.error(`Failed to update webhook ${webhookId}:`, error);
      throw error;
    }
  }

  async getNFTsForContract(contractAddress, withMetadata = true) {
    try {
      const nfts = await this.alchemy.nft.getNftsForContract(
        contractAddress,
        { withMetadata }
      );
      
      logger.info(`Retrieved ${nfts.nfts.length} NFTs for contract ${contractAddress}`);
      return nfts.nfts;
      
    } catch (error) {
      logger.error(`Failed to get NFTs for contract ${contractAddress}:`, error);
      throw error;
    }
  }

  async getNFTMetadata(contractAddress, tokenId) {
    try {
      const metadata = await this.alchemy.nft.getNftMetadata(
        contractAddress,
        tokenId
      );
      
      logger.info(`Retrieved metadata for NFT ${contractAddress}:${tokenId}`);
      return metadata;
      
    } catch (error) {
      logger.error(`Failed to get NFT metadata ${contractAddress}:${tokenId}:`, error);
      throw error;
    }
  }

  async getOwnersForContract(contractAddress) {
    try {
      const owners = await this.alchemy.nft.getOwnersForContract(contractAddress);
      logger.info(`Found ${owners.owners.length} unique owners for contract ${contractAddress}`);
      return owners.owners;
      
    } catch (error) {
      logger.error(`Failed to get owners for contract ${contractAddress}:`, error);
      throw error;
    }
  }

  async getFloorPrice(contractAddress) {
    try {
      const floorPrice = await this.alchemy.nft.getFloorPrice(contractAddress);
      logger.info(`Floor price for ${contractAddress}: ${JSON.stringify(floorPrice)}`);
      return floorPrice;
      
    } catch (error) {
      logger.error(`Failed to get floor price for ${contractAddress}:`, error);
      throw error;
    }
  }

  async searchNFTsByName(query) {
    try {
      // This would use Alchemy's search capabilities when available
      logger.info(`Searching NFTs by name: ${query}`);
      // For now, return empty array as this feature might not be available in all SDK versions
      return [];
      
    } catch (error) {
      logger.error(`Failed to search NFTs by name "${query}":`, error);
      throw error;
    }
  }

  async validateContract(contractAddress) {
    try {
      // Try to get contract metadata to validate it exists and is an NFT contract
      const metadata = await this.alchemy.nft.getContractMetadata(contractAddress);
      
      if (metadata.tokenType === 'ERC721' || metadata.tokenType === 'ERC1155') {
        logger.info(`Valid NFT contract: ${contractAddress} (${metadata.tokenType})`);
        return {
          isValid: true,
          tokenType: metadata.tokenType,
          name: metadata.name,
          symbol: metadata.symbol,
          totalSupply: metadata.totalSupply
        };
      } else {
        logger.warn(`Contract ${contractAddress} is not an NFT contract`);
        return { isValid: false, reason: 'Not an NFT contract' };
      }
      
    } catch (error) {
      logger.error(`Failed to validate contract ${contractAddress}:`, error);
      return { isValid: false, reason: error.message };
    }
  }

  async listWebhooks() {
    try {
      if (!this.webhooksEnabled) {
        logger.debug('Webhooks not enabled - skipping webhook listing');
        return [];
      }
      
      const webhooks = await this.alchemy.notify.getAllWebhooks();
      logger.info(`Found ${webhooks.webhooks.length} existing webhooks`);
      return webhooks.webhooks;
      
    } catch (error) {
      if (error.message && error.message.includes('Unauthenticated')) {
        logger.warn('Webhook authentication failed - webhooks disabled for this session');
        this.webhooksEnabled = false;
        return [];
      }
      logger.error('Failed to list webhooks:', error);
      return [];
    }
  }

  async deleteWebhook(webhookId) {
    try {
      await this.alchemy.notify.deleteWebhook(webhookId);
      this.webhooks.delete(webhookId);
      logger.info(`Deleted webhook: ${webhookId}`);
      return true;
      
    } catch (error) {
      logger.error(`Failed to delete webhook ${webhookId}:`, error);
      throw error;
    }
  }

  getAlchemyInstance() {
    return this.alchemy;
  }
}

module.exports = AlchemyService;