const logger = require('./logger');

class TrendingService {
  constructor(database) {
    this.db = database;
    this.isConnected = false;
  }

  async initialize() {
    try {
      // Simplified trending service - only database operations
      this.isConnected = true;
      logger.info('Simplified trending service initialized (database only)');
      return true;
    } catch (error) {
      logger.error('Failed to initialize trending service:', error);
      this.isConnected = false;
      return false;
    }
  }

  // Simplified methods that only work with database
  async getTrendingTokens() {
    try {
      if (!this.isConnected) {
        return [];
      }
      
      await this.db.expireTrendingPayments();
      const trendingTokens = await this.db.getTrendingTokens();

      trendingTokens.sort((a, b) => {
        const amountDiff = parseFloat(b.payment_amount) - parseFloat(a.payment_amount);
        if (amountDiff !== 0) return amountDiff;
        return new Date(b.start_time) - new Date(a.start_time);
      });

      return trendingTokens;
    } catch (error) {
      logger.error('Error getting trending tokens:', error);
      return [];
    }
  }

  async isTokenTrending(contractAddress) {
    try {
      if (!this.isConnected) {
        return false;
      }
      
      const trendingTokens = await this.getTrendingTokens();
      return trendingTokens.some(token => 
        token.contract_address.toLowerCase() === contractAddress.toLowerCase()
      );
    } catch (error) {
      logger.error(`Error checking if token ${contractAddress} is trending:`, error);
      return false;
    }
  }

  // Fallback methods for compatibility
  async calculateTrendingFee(durationHours, isPremium = false) {
    logger.warn('Legacy trending service methods not available. Use secure trending service.');
    return Promise.resolve('0');
  }

  async getTrendingOptions() {
    logger.warn('Legacy trending service methods not available. Use secure trending service.');
    return Promise.resolve([]);
  }

  async generatePaymentInstructions(tokenId, durationHours, userId, isPremium = false) {
    logger.warn('Legacy trending service methods not available. Use secure trending service.');
    return Promise.resolve({
      contractAddress: 'N/A',
      tokenName: 'N/A',
      fee: '0',
      feeEth: '0.0',
      instructions: ['Service temporarily unavailable - use secure trending service']
    });
  }
}

module.exports = TrendingService;