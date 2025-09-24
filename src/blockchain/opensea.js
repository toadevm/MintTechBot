const { OpenSeaStreamClient, EventType, Network } = require('@opensea/stream-js');
const WebSocket = require('ws');
const { LocalStorage } = require('node-localstorage');
const logger = require('../services/logger');
const PriceService = require('../services/priceService');

class OpenSeaService {
  constructor() {
    this.client = null;
    this.subscriptions = new Map(); // Track active subscriptions
    this.isConnected = false;
    this.localStorage = new LocalStorage('./tmp');
    this.priceService = new PriceService();
  }

  async initialize() {
    try {
      if (!process.env.OPENSEA_API_KEY) {
        throw new Error('OPENSEA_API_KEY not found in environment variables');
      }

      // Initialize OpenSea Stream Client following official docs
      this.client = new OpenSeaStreamClient({
        token: process.env.OPENSEA_API_KEY,
        network: Network.MAINNET,
        onError: (error) => {
          logger.error('OpenSea Stream error:', error);
          this.handleConnectionError(error);
        },
        logLevel: 'info'
      });

      // Actually connect to the WebSocket
      await this.client.connect();
      this.isConnected = true;

      logger.info('OpenSea Stream service initialized and connected successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize OpenSea Stream service:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async subscribeToCollection(collectionSlug, eventHandlers) {
    try {
      if (!this.client) {
        throw new Error('OpenSea client not initialized');
      }

      if (!this.isConnected) {
        throw new Error('OpenSea client not connected');
      }

      const subscriptionKey = `collection_${collectionSlug}`;

      // Check if already subscribed
      if (this.subscriptions.has(subscriptionKey)) {
        logger.info(`Already subscribed to collection: ${collectionSlug}`);
        return this.subscriptions.get(subscriptionKey);
      }

      logger.info(`🔗 Setting up OpenSea Stream subscription for: ${collectionSlug}`);

      const unsubscribeFunctions = [];

      // Subscribe to all available event types for the collection (excluding cancelled events)
      const eventTypes = [
        { type: 'listed', method: 'onItemListed' },
        { type: 'sold', method: 'onItemSold' },
        { type: 'transferred', method: 'onItemTransferred' },
        { type: 'metadata_updated', method: 'onItemMetadataUpdated' },
        { type: 'received_bid', method: 'onItemReceivedBid' },
        { type: 'received_offer', method: 'onItemReceivedOffer' }
      ];

      for (const eventType of eventTypes) {
        if (this.client[eventType.method]) {
          logger.info(`📡 Subscribing to ${eventType.type} events for ${collectionSlug}`);
          const unsubscribe = this.client[eventType.method](collectionSlug, async (event) => {
            logger.info(`🎯 ${eventType.type} event triggered for ${collectionSlug}`);
            await this.handleEvent(eventType.type, event, eventHandlers);
          });
          unsubscribeFunctions.push(unsubscribe);
        } else {
          logger.warn(`⚠️ Method ${eventType.method} not available on client`);
        }
      }

      // Store subscription info
      const subscription = {
        collectionSlug,
        unsubscribeFunctions,
        createdAt: new Date().toISOString()
      };

      this.subscriptions.set(subscriptionKey, subscription);
      logger.info(`✅ Successfully subscribed to ${unsubscribeFunctions.length} event types for collection: ${collectionSlug}`);

      return subscription;
    } catch (error) {
      logger.error(`❌ Failed to subscribe to collection ${collectionSlug}:`, error);
      throw error;
    }
  }

  async unsubscribeFromCollection(collectionSlug) {
    try {
      const subscriptionKey = `collection_${collectionSlug}`;
      const subscription = this.subscriptions.get(subscriptionKey);

      if (!subscription) {
        logger.warn(`No subscription found for collection: ${collectionSlug}`);
        return false;
      }

      // Call all unsubscribe functions
      for (const unsubscribe of subscription.unsubscribeFunctions) {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      }

      this.subscriptions.delete(subscriptionKey);
      logger.info(`Unsubscribed from collection: ${collectionSlug}`);
      return true;
    } catch (error) {
      logger.error(`Failed to unsubscribe from collection ${collectionSlug}:`, error);
      throw error;
    }
  }

  async handleEvent(eventType, event, eventHandlers) {
    try {
      logger.info(`🎉 OpenSea ${eventType} event received for collection`);
      logger.info('📋 Event details:', JSON.stringify(event, null, 2));

      // Extract common data from OpenSea event payload following official docs
      const eventData = await this.extractEventData(eventType, event);
      logger.info('📊 Extracted event data:', JSON.stringify(eventData, null, 2));

      // Call the appropriate handler if provided
      if (eventHandlers && typeof eventHandlers[eventType] === 'function') {
        logger.info(`🎯 Calling specific handler for ${eventType}`);
        eventHandlers[eventType](eventData, event);
      } else if (eventHandlers && typeof eventHandlers.default === 'function') {
        logger.info(`🎯 Calling default handler for ${eventType}`);
        eventHandlers.default(eventType, eventData, event);
      } else {
        logger.warn(`⚠️ No handler found for event type: ${eventType}`);
      }
    } catch (error) {
      logger.error(`❌ Error handling ${eventType} event:`, error);
    }
  }

  async extractEventData(eventType, event) {
    try {
      // Extract data following OpenSea Stream API payload structure
      // The actual payload is nested: event.payload.payload
      const payload = event.payload?.payload || event.payload || event;

      // Debug logging to understand actual payload structure
      logger.info('🐛 OpenSea payload structure debug:', JSON.stringify({
        event_type: eventType,
        has_nested_payload: !!event.payload?.payload,
        payload_keys: Object.keys(payload),
        item_structure: payload.item ? Object.keys(payload.item) : 'no item',
        nft_id: payload.item?.nft_id,
        collection_slug: payload.collection?.slug,
        payment_token: payload.payment_token ? Object.keys(payload.payment_token) : 'no payment_token'
      }, null, 2));

      // Extract NFT metadata
      const metadata = payload.item?.metadata || {};

      // Extract payment token info
      const paymentToken = payload.payment_token || {};

      // Determine price based on event type
      let price = null;
      let priceUsd = null;

      if (eventType === 'sold') {
        price = payload.sale_price;
      } else if (eventType === 'listed' || eventType === 'received_bid' || eventType === 'received_offer') {
        price = payload.base_price;
      }

      // Calculate USD value using reliable price service instead of OpenSea's unreliable usd_price
      if (price) {
        try {
          priceUsd = await this.priceService.calculateUSDValue(
            price,
            paymentToken.symbol || 'ETH',
            paymentToken.decimals || 18,
            paymentToken.address
          );

          logger.info(`💰 Reliable USD Calculation for ${eventType}:`, {
            event_type: eventType,
            price_wei: price,
            token_symbol: paymentToken.symbol,
            token_decimals: paymentToken.decimals,
            calculated_usd: priceUsd?.toFixed(2),
            payment_token_address: paymentToken.address,
            opensea_usd_price: paymentToken.usd_price, // For comparison
            method: 'reliable_price_api'
          });
        } catch (error) {
          logger.error(`Failed to calculate USD for ${eventType}:`, error);
          priceUsd = null;
        }
      } else {
        logger.warn(`⚠️ USD calculation skipped for ${eventType} - no price:`, {
          has_price: !!price,
          price_value: price,
          payment_token_symbol: paymentToken.symbol
        });
      }

      // Extract contract address and token ID from nft_id
      let contractAddress = null;
      let tokenId = null;

      if (payload.item?.nft_id) {
        // nft_id format: "ethereum/0x495f947276749ce646f68ac8c248420045cb7b5e/74630152366364009569833059154376861594951644105207272687495389092116791558145"
        const nftIdParts = payload.item.nft_id.split('/');
        if (nftIdParts.length >= 3) {
          const chain = nftIdParts[0]; // "ethereum"
          contractAddress = nftIdParts[1]; // contract address
          tokenId = nftIdParts[2]; // token ID (can be very long for some contracts)
        }
      }

      logger.info(`🔍 Extracted from nft_id: contract=${contractAddress}, tokenId=${tokenId}`);

      return {
        eventType,
        sentAt: event.sent_at || new Date().toISOString(),

        // Contract and token information
        contractAddress: contractAddress,
        tokenId: tokenId,

        // NFT Metadata
        nftName: metadata.name,
        nftImageUrl: metadata.image_url,
        nftDescription: metadata.description,

        // Collection information
        collectionSlug: payload.collection?.slug,
        collectionName: payload.collection?.name,

        // User addresses
        makerAddress: payload.maker?.address,
        takerAddress: payload.taker?.address,
        fromAddress: payload.from_account?.address,
        toAddress: payload.to_account?.address,

        // Transaction information
        transactionHash: payload.transaction?.hash,
        blockNumber: payload.transaction?.block_number,

        // Enhanced price information
        price: price,
        priceUsd: priceUsd,
        paymentTokenSymbol: paymentToken.symbol || 'ETH',
        paymentTokenAddress: paymentToken.address,
        paymentTokenDecimals: paymentToken.decimals || 18,
        paymentTokenUsdPrice: paymentToken.usd_price,

        // Event-specific data
        orderHash: payload.order_hash,
        isPrivate: payload.is_private,
        expirationDate: payload.expiration_date,
        quantity: payload.quantity || 1,
        protocolData: payload.protocol_data,

        // Marketplace and fees
        marketplace: 'OpenSea',
        totalFees: payload.protocol_data?.parameters?.totalOriginalAdditionalRecipients || 0,

        // Raw payload for debugging
        rawPayload: payload
      };
    } catch (error) {
      logger.error('Error extracting event data:', error);
      return {
        eventType,
        sentAt: new Date().toISOString(),
        error: error.message,
        rawPayload: event
      };
    }
  }

  handleConnectionError(error) {
    logger.error('OpenSea Stream connection error:', error);
    this.isConnected = false;

    // Implement reconnection logic
    setTimeout(() => {
      logger.info('Attempting to reconnect to OpenSea Stream...');
      this.reconnect();
    }, 5000);
  }

  async reconnect() {
    try {
      // Store current subscriptions
      const currentSubscriptions = Array.from(this.subscriptions.values());

      // Clear current subscriptions
      this.subscriptions.clear();

      // Reinitialize client
      await this.initialize();

      // Resubscribe to all collections
      for (const subscription of currentSubscriptions) {
        logger.info(`Resubscribing to collection: ${subscription.collectionSlug}`);
        // Note: This would need the original event handlers, which we'd need to store
        // For now, log that manual resubscription is needed
        logger.warn(`Manual resubscription needed for: ${subscription.collectionSlug}`);
      }

      logger.info('OpenSea Stream reconnection completed');
    } catch (error) {
      logger.error('Failed to reconnect to OpenSea Stream:', error);
      // Retry after longer delay
      setTimeout(() => this.reconnect(), 30000);
    }
  }

  async getActiveSubscriptions() {
    return Array.from(this.subscriptions.entries()).map(([key, subscription]) => ({
      key,
      collectionSlug: subscription.collectionSlug,
      createdAt: subscription.createdAt,
      eventTypes: subscription.unsubscribeFunctions.length
    }));
  }

  async disconnect() {
    try {
      logger.info('🔌 Disconnecting OpenSea Stream service...');

      // Unsubscribe from all collections
      for (const [key, subscription] of this.subscriptions.entries()) {
        await this.unsubscribeFromCollection(subscription.collectionSlug);
      }

      // Disconnect the client following official docs
      if (this.client && typeof this.client.disconnect === 'function') {
        await this.client.disconnect();
      }

      this.isConnected = false;
      logger.info('✅ OpenSea Stream service disconnected successfully');
    } catch (error) {
      logger.error('❌ Error disconnecting OpenSea Stream service:', error);
      this.isConnected = false;
    }
  }

  async validateContract(contractAddress, chainName = 'ethereum') {
    try {
      if (!contractAddress || typeof contractAddress !== 'string') {
        return { isValid: false, reason: 'Invalid contract address format' };
      }

      // Basic format validation for Ethereum address
      if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
        return { isValid: false, reason: 'Invalid Ethereum address format' };
      }

      // Map chain names to OpenSea API chain identifiers
      const chainMapping = {
        'ethereum': 'ethereum',
        'arbitrum': 'arbitrum',
        'optimism': 'optimism',
        'avalanche': 'avalanche',
        'moonbeam': 'moonbeam',
        'bsc': 'bsc',
        'hyperblast': 'hyperevm',
        'berachain': 'bera_chain'
        // zkSync Era not yet supported by OpenSea API v2
      };

      const openSeaChain = chainMapping[chainName] || 'ethereum';

      // Use OpenSea API to validate contract and get metadata
      const axios = require('axios');
      const url = `https://api.opensea.io/api/v2/chain/${openSeaChain}/contract/${contractAddress}/nfts`;

      const headers = {
        'Accept': 'application/json',
        'X-API-KEY': process.env.OPENSEA_API_KEY
      };

      logger.info(`Validating contract ${contractAddress} on ${chainName} (${openSeaChain}) using OpenSea API`);
      const response = await axios.get(url, { headers, timeout: 10000 });

      // Enhanced debugging: Log the full API response structure
      logger.info(`OpenSea API response for ${contractAddress} on ${chainName}:`, JSON.stringify(response.data, null, 2));

      if (response.data && response.data.nfts && response.data.nfts.length > 0) {
        const firstNft = response.data.nfts[0];

        // Enhanced metadata extraction for OpenSea v2 API response structure
        let collectionName = 'Unknown Collection';
        let collectionSlug = null;
        let collectionSymbol = '';
        let tokenType = 'ERC721';

        // OpenSea v2 API structure: contract is string, collection is string
        // Extract collection name from NFT name (e.g., "Slingshot Genesis #0" -> "Slingshot Genesis")
        if (firstNft.name) {
          const nameParts = firstNft.name.split('#');
          if (nameParts.length > 1) {
            collectionName = nameParts[0].trim();
          } else {
            collectionName = firstNft.name;
          }
        }

        // Collection slug is the collection string field
        if (typeof firstNft.collection === 'string') {
          collectionSlug = firstNft.collection;
          logger.info(`🎯 COLLECTION SLUG EXTRACTED: "${collectionSlug}" for ${contractAddress} on ${chainName}`);
        } else {
          logger.warn(`⚠️ COLLECTION FIELD NOT STRING: type=${typeof firstNft.collection}, value=${JSON.stringify(firstNft.collection)} for ${contractAddress} on ${chainName}`);
        }

        // Enhanced symbol extraction with smart generation
        if (collectionSlug) {
          // Try to generate symbol from collection slug
          collectionSymbol = this.generateSymbolFromSlug(collectionSlug);
        } else if (collectionName && collectionName !== 'Unknown Collection') {
          // Fallback: generate symbol from collection name
          collectionSymbol = this.generateSymbolFromName(collectionName);
        }

        // Extract token standard
        if (firstNft.token_standard) {
          tokenType = firstNft.token_standard.toUpperCase();
        }

        logger.info(`Extracted metadata for ${contractAddress} on ${chainName}: name="${collectionName}", symbol="${collectionSymbol}", type="${tokenType}"`);
        logger.info(`Valid NFT contract: ${contractAddress} on ${chainName} (${collectionName})`);
        logger.info(`🔍 FINAL VALIDATION RESULT: collectionSlug="${collectionSlug}" for ${contractAddress} on ${chainName}`);

        const result = {
          isValid: true,
          valid: true,
          tokenType: tokenType,
          name: collectionName,
          collectionName: collectionName,
          collectionSlug: collectionSlug,
          symbol: collectionSymbol,
          totalSupply: null,
          contractAddress: contractAddress,
          floorPrice: null,
          currency: null
        };

        logger.info(`📋 RETURNING VALIDATION OBJECT: ${JSON.stringify(result, null, 2)}`);
        return result;
      } else {
        logger.warn(`Contract ${contractAddress} has no NFTs or is not an NFT contract`);
        return { isValid: false, reason: 'Contract has no NFTs or is not an NFT contract' };
      }
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn(`Contract ${contractAddress} not found on OpenSea`);
        return { isValid: false, reason: 'Contract not found on OpenSea' };
      } else if (error.response?.status === 429) {
        logger.warn(`Rate limited by OpenSea API when validating ${contractAddress}`);
        return { isValid: false, reason: 'OpenSea API rate limit exceeded' };
      } else {
        logger.error(`Failed to validate contract ${contractAddress}:`, error.message);
        return { isValid: false, reason: error.message };
      }
    }
  }

  async validateCollection(collectionSlug) {
    try {
      // Basic validation - check if collection slug format is valid
      if (!collectionSlug || typeof collectionSlug !== 'string') {
        return { isValid: false, reason: 'Invalid collection slug format' };
      }

      if (collectionSlug.includes(' ') || collectionSlug.includes('/')) {
        return { isValid: false, reason: 'Collection slug contains invalid characters' };
      }

      return {
        isValid: true,
        collectionSlug,
        note: 'Collection slug format is valid. Real validation requires OpenSea API call.'
      };
    } catch (error) {
      logger.error(`Failed to validate collection ${collectionSlug}:`, error);
      return { isValid: false, reason: error.message };
    }
  }

  /**
   * Generate a smart symbol from OpenSea collection slug
   * @param {string} slug - Collection slug (e.g., "slingshot-genesis", "booga-beras-5")
   * @returns {string} Generated symbol (e.g., "SLNG", "BOGA")
   */
  generateSymbolFromSlug(slug) {
    if (!slug || typeof slug !== 'string') return '';

    // Clean and normalize the slug
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '');

    // Split by hyphens and get meaningful parts
    const parts = cleanSlug.split('-').filter(part => part.length > 0);

    if (parts.length === 0) return '';

    // Strategy: Take first 2-3 letters from each significant word, max 6 chars
    let symbol = '';

    for (const part of parts) {
      if (symbol.length >= 6) break;

      // Skip common words and numbers
      if (['the', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with'].includes(part)) continue;
      if (/^\d+$/.test(part)) continue; // Skip pure numbers

      // Take first 2-3 letters from each meaningful part
      const lettersToTake = symbol.length < 2 ? 3 : 2;
      symbol += part.substring(0, lettersToTake);

      if (symbol.length >= 4) break; // Good enough with 4+ chars
    }

    // If we don't have enough, take more from first part
    if (symbol.length < 3 && parts[0]) {
      symbol = parts[0].substring(0, 4);
    }

    return symbol.toUpperCase();
  }

  /**
   * Generate a smart symbol from collection name
   * @param {string} name - Collection name (e.g., "Slingshot Genesis", "Arbzukiswap")
   * @returns {string} Generated symbol (e.g., "SLNG", "ARBZ")
   */
  generateSymbolFromName(name) {
    if (!name || typeof name !== 'string') return '';

    // Clean the name - remove special characters, keep alphanumeric and spaces
    const cleanName = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();

    // Split into words
    const words = cleanName.split(/\s+/).filter(word => word.length > 0);

    if (words.length === 0) return '';

    // If single word, take first 4-6 letters
    if (words.length === 1) {
      return words[0].substring(0, 5).toUpperCase();
    }

    // Multiple words: take first 2-3 letters from each important word
    let symbol = '';

    for (const word of words) {
      if (symbol.length >= 6) break;

      // Skip common words
      if (['the', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'nft', 'collection'].includes(word.toLowerCase())) continue;

      // Take first 2-3 letters
      const lettersToTake = symbol.length === 0 ? 3 : 2;
      symbol += word.substring(0, lettersToTake);

      if (symbol.length >= 4) break;
    }

    // Fallback: if we still don't have enough, use first word
    if (symbol.length < 3 && words[0]) {
      symbol = words[0].substring(0, 4);
    }

    return symbol.toUpperCase();
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      activeSubscriptions: this.subscriptions.size,
      hasClient: !!this.client
    };
  }
}

module.exports = OpenSeaService;