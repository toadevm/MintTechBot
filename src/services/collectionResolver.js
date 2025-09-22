const logger = require('./logger');

class CollectionResolver {
  constructor() {
    this.cache = new Map(); // Cache resolved collection slugs
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
  }

  async resolveCollectionSlug(contractAddress, chain = 'ethereum') {
    try {
      const cacheKey = `${contractAddress}:${chain}`;
      const cached = this.cache.get(cacheKey);

      // Check cache first
      if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
        logger.debug(`Cache hit for ${contractAddress} on ${chain}: ${cached.slug}`);
        return cached.slug;
      }

      // Try OpenSea API to resolve collection slug
      const slug = await this.fetchCollectionSlugFromAPI(contractAddress, chain);

      if (slug) {
        // Cache the result
        this.cache.set(cacheKey, {
          slug,
          timestamp: Date.now()
        });
        logger.info(`Resolved collection slug for ${contractAddress} on ${chain}: ${slug}`);
        return slug;
      }

      return null;
    } catch (error) {
      logger.error(`Error resolving collection slug for ${contractAddress}:`, error);
      return null;
    }
  }

  async fetchCollectionSlugFromAPI(contractAddress, chain = 'ethereum') {
    try {
      if (!process.env.OPENSEA_API_KEY) {
        logger.warn('No OpenSea API key available for collection resolution');
        return null;
      }

      // Use OpenSea's direct contract NFT endpoint for more reliable results
      const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${contractAddress}/nfts?limit=1`;

      const options = {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-api-key': process.env.OPENSEA_API_KEY
        }
      };

      const response = await fetch(url, options);

      if (!response.ok) {
        logger.warn(`OpenSea API error ${response.status} for ${contractAddress} on ${chain}`);
        return null;
      }

      const data = await response.json();

      if (data.nfts && data.nfts.length > 0) {
        const nft = data.nfts[0];
        const collectionSlug = nft.collection;
        logger.info(`Found collection: ${nft.name} (${collectionSlug}) for contract ${contractAddress}`);
        return collectionSlug;
      }

      logger.warn(`No NFTs found for contract ${contractAddress} on ${chain}`);
      return null;
    } catch (error) {
      logger.error(`API error resolving collection for ${contractAddress}:`, error);
      return null;
    }
  }

  // Method to manually add known mappings
  addKnownMapping(contractAddress, chain, collectionSlug) {
    const cacheKey = `${contractAddress}:${chain}`;
    this.cache.set(cacheKey, {
      slug: collectionSlug,
      timestamp: Date.now()
    });
    logger.info(`Added known mapping: ${contractAddress} (${chain}) -> ${collectionSlug}`);
  }

  // Pre-populate with known popular collections
  initializeKnownCollections() {
    const knownCollections = [
      // Ethereum
      { address: '0xBd3531dA5CF5857e7CfAA92426877b022e612cf8', chain: 'ethereum', slug: 'pudgy-penguins' },
      { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', chain: 'ethereum', slug: 'boredapeyachtclub' },
      { address: '0x60e4d786628fea6478f785a6d7e704777c86a7c6', chain: 'ethereum', slug: 'mutant-ape-yacht-club' },
      { address: '0xed5af388653567af2f388e6224dc7c4b3241c544', chain: 'ethereum', slug: 'azuki' },
      { address: '0x23581767a106ae21c074b2276d25e5c3e136a68b', chain: 'ethereum', slug: 'proof-moonbirds' },
      { address: '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e', chain: 'ethereum', slug: 'doodles-official' },
      { address: '0x49cf6f5d44e70224e2e23fdcdd2c053f30ada28b', chain: 'ethereum', slug: 'clonex' },

      // Base chain
      { address: '0x4e1f41613c9084fdb9e34e11fae9412427480e56', chain: 'base', slug: 'zorb' },

      // Polygon
      { address: '0x9fb7d8b8c52154bb0b54bb0b57b08b84b2ed1b7b', chain: 'polygon', slug: 'polygon-ape-yacht-club' },
    ];

    knownCollections.forEach(({ address, chain, slug }) => {
      this.addKnownMapping(address, chain, slug);
    });

    logger.info(`Initialized ${knownCollections.length} known collection mappings`);
  }

  // Get all chains where a contract might exist
  async resolveAllChains(contractAddress) {
    const chains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
    const results = [];

    for (const chain of chains) {
      const slug = await this.resolveCollectionSlug(contractAddress, chain);
      if (slug) {
        results.push({ chain, slug });
      }
    }

    return results;
  }

  clearCache() {
    this.cache.clear();
    logger.info('Collection resolver cache cleared');
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, value]) => ({
        key,
        slug: value.slug,
        age: Date.now() - value.timestamp
      }))
    };
  }
}

module.exports = CollectionResolver;