const logger = require('./logger');

class PriceService {
  constructor() {
    this.cachedPrices = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
  }

  async getTokenPrice(tokenSymbol, tokenAddress = null) {
    try {
      const cacheKey = tokenSymbol.toLowerCase();
      const cached = this.cachedPrices.get(cacheKey);

      // Return cached price if still valid
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        logger.info(`💰 Using cached price for ${tokenSymbol}: $${cached.price}`);
        return cached.price;
      }

      // Fetch fresh price from CoinGecko API
      const price = await this.fetchTokenPriceFromAPI(tokenSymbol, tokenAddress);

      // Cache the result
      this.cachedPrices.set(cacheKey, {
        price,
        timestamp: Date.now()
      });

      logger.info(`💰 Fetched fresh price for ${tokenSymbol}: $${price}`);
      return price;
    } catch (error) {
      logger.error(`Failed to get price for ${tokenSymbol}:`, error);

      // Return cached price if available, even if expired
      const cached = this.cachedPrices.get(tokenSymbol.toLowerCase());
      if (cached) {
        logger.warn(`Using expired cached price for ${tokenSymbol}: $${cached.price}`);
        return cached.price;
      }

      // Fallback to approximate ETH price
      if (tokenSymbol.toLowerCase() === 'eth' || tokenSymbol.toLowerCase() === 'weth') {
        logger.warn('Using fallback ETH price: $2500');
        return 2500;
      }

      return null;
    }
  }

  async fetchTokenPriceFromAPI(tokenSymbol, tokenAddress) {
    try {
      // Map token symbols to CoinGecko IDs
      const tokenMap = {
        'eth': 'ethereum',
        'weth': 'ethereum', // WETH tracks ETH price
        'usdc': 'usd-coin',
        'usdt': 'tether',
        'dai': 'dai',
        'matic': 'matic-network',
        'bnb': 'binancecoin'
      };

      const coinId = tokenMap[tokenSymbol.toLowerCase()] || 'ethereum';

      // Use CoinGecko API (free tier, no API key needed)
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        {
          headers: {
            'Accept': 'application/json',
          },
          timeout: 10000
        }
      );

      if (!response.ok) {
        throw new Error(`API response not ok: ${response.status}`);
      }

      const data = await response.json();
      const price = data[coinId]?.usd;

      if (!price) {
        throw new Error(`No price data found for ${coinId}`);
      }

      return price;
    } catch (error) {
      logger.error(`Failed to fetch price from CoinGecko for ${tokenSymbol}:`, error);

      // Fallback to Ethereum price API
      if (tokenSymbol.toLowerCase() === 'eth' || tokenSymbol.toLowerCase() === 'weth') {
        return await this.fetchEthPriceFromAlternativeAPI();
      }

      throw error;
    }
  }

  async fetchEthPriceFromAlternativeAPI() {
    try {
      // Fallback to CryptoCompare API
      const response = await fetch(
        'https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD',
        {
          headers: {
            'Accept': 'application/json',
          },
          timeout: 10000
        }
      );

      if (!response.ok) {
        throw new Error(`CryptoCompare API response not ok: ${response.status}`);
      }

      const data = await response.json();
      return data.USD;
    } catch (error) {
      logger.error('Failed to fetch ETH price from CryptoCompare:', error);
      throw error;
    }
  }

  async calculateUSDValue(priceWei, tokenSymbol, tokenDecimals = 18, paymentTokenAddress = null) {
    try {
      const tokenPrice = await this.getTokenPrice(tokenSymbol, paymentTokenAddress);

      if (!tokenPrice || !priceWei) {
        logger.warn(`Cannot calculate USD: missing tokenPrice=${tokenPrice} or priceWei=${priceWei}`);
        return null;
      }

      // Convert wei to token amount
      const tokenAmount = parseFloat(priceWei) / Math.pow(10, tokenDecimals);

      // Calculate USD value
      const usdValue = tokenAmount * tokenPrice;

      logger.info(`💰 USD Calculation: ${tokenAmount} ${tokenSymbol} × $${tokenPrice} = $${usdValue.toFixed(2)}`);

      return usdValue;
    } catch (error) {
      logger.error('Failed to calculate USD value:', error);
      return null;
    }
  }

  // Get all cached prices for debugging
  getCachedPrices() {
    const result = {};
    for (const [symbol, data] of this.cachedPrices.entries()) {
      result[symbol] = {
        price: data.price,
        age: Math.round((Date.now() - data.timestamp) / 1000) + 's'
      };
    }
    return result;
  }
}

module.exports = PriceService;