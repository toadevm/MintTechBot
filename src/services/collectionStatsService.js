const axios = require('axios');
const logger = require('./logger');

/**
 * Service for fetching and caching OpenSea collection statistics
 * Handles API rate limiting, caching, and periodic updates
 */
class CollectionStatsService {
  constructor(database) {
    this.db = database;
    this.apiKey = process.env.OPENSEA_API_KEY;
    this.baseUrl = 'https://api.opensea.io/api/v2';

    // In-memory cache: Map<collection_slug, {stats, timestamp}>
    this.cache = new Map();
    this.CACHE_TTL = 10 * 1000; // 10 seconds

    // Rate limiting: OpenSea allows ~4 requests/second
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.REQUEST_DELAY = 300; // 300ms between requests (3-4 req/sec)
  }

  /**
   * Fetch collection stats from OpenSea API
   * @param {string} collection_slug - OpenSea collection slug
   * @returns {Promise<Object>} Stats object with volume_24h, floor_price, etc.
   */
  async fetchCollectionStats(collection_slug) {
    if (!collection_slug) {
      logger.warn('[CollectionStats] No collection_slug provided');
      return null;
    }

    if (!this.apiKey) {
      logger.error('[CollectionStats] OPENSEA_API_KEY not configured');
      return null;
    }

    try {
      const url = `${this.baseUrl}/collections/${collection_slug}/stats`;

      const headers = {
        'Accept': 'application/json',
        'X-API-KEY': this.apiKey
      };

      logger.info(`[CollectionStats] Fetching stats for: ${collection_slug}`);
      const response = await axios.get(url, { headers, timeout: 10000 });

      if (response.data && response.data.total) {
        const stats = {
          volume_24h: null,
          floor_price: null,
          sales_24h: null,
          volume_change_24h: null,
          volume_diff_24h: null,
          sales_diff_24h: null,
          average_price_24h: null,
          market_cap: null,
          floor_price_symbol: null,
          num_owners: response.data.total.num_owners || 0
        };

        // Extract 24h stats from intervals
        if (response.data.intervals && Array.isArray(response.data.intervals)) {
          const oneDayInterval = response.data.intervals.find(i => i.interval === 'one_day');
          if (oneDayInterval) {
            const volume = parseFloat(oneDayInterval.volume) || 0;
            const volumeDiff = parseFloat(oneDayInterval.volume_diff) || 0;

            stats.volume_24h = volume.toString();
            stats.sales_24h = oneDayInterval.sales || 0;
            stats.volume_diff_24h = volumeDiff.toString();
            stats.sales_diff_24h = oneDayInterval.sales_diff || 0;
            stats.average_price_24h = oneDayInterval.average_price ? oneDayInterval.average_price.toString() : null;

            // Calculate volume change manually using volume_diff
            // percentage = (volume_diff / previous_volume) * 100
            // where previous_volume = current_volume - volume_diff
            if (volumeDiff !== 0) {
              const previousVolume = volume - volumeDiff;
              if (previousVolume > 0) {
                const changeDecimal = volumeDiff / previousVolume;
                stats.volume_change_24h = changeDecimal.toString();
                logger.info(`[CollectionStats] 📊 Calculated volume change: ${(changeDecimal * 100).toFixed(1)}% (diff: ${volumeDiff.toFixed(4)} ETH)`);
              } else if (previousVolume === 0 && volume > 0) {
                // New collection with no previous volume
                stats.volume_change_24h = '1.0'; // 100% increase
                logger.info(`[CollectionStats] 📊 New volume detected: +100%`);
              }
            } else {
              // OpenSea API returned 0 for both volume_change and volume_diff
              stats.volume_change_24h = (oneDayInterval.volume_change !== null && oneDayInterval.volume_change !== undefined)
                ? oneDayInterval.volume_change.toString()
                : null;
            }
          }
        }

        // Get floor price and other total stats
        if (response.data.total.floor_price) {
          stats.floor_price = response.data.total.floor_price.toString();
        }
        if (response.data.total.market_cap) {
          stats.market_cap = response.data.total.market_cap.toString();
        }
        if (response.data.total.floor_price_symbol) {
          stats.floor_price_symbol = response.data.total.floor_price_symbol;
        }

        logger.info(`[CollectionStats] ✅ ${collection_slug}: Volume=${stats.volume_24h || '0'} ETH, Floor=${stats.floor_price || '0'} ETH, Sales=${stats.sales_24h || 0}`);
        return stats;

      } else {
        logger.warn(`[CollectionStats] Invalid response structure for ${collection_slug}`);
        return null;
      }

    } catch (error) {
      if (error.response) {
        // API returned error response
        if (error.response.status === 404) {
          logger.warn(`[CollectionStats] Collection not found: ${collection_slug}`);
        } else if (error.response.status === 429) {
          logger.error(`[CollectionStats] Rate limit exceeded for ${collection_slug}`);
        } else {
          logger.error(`[CollectionStats] API error for ${collection_slug}:`, error.response.status, error.response.statusText);
        }
      } else if (error.request) {
        logger.error(`[CollectionStats] Network error for ${collection_slug}:`, error.message);
      } else {
        logger.error(`[CollectionStats] Error fetching stats for ${collection_slug}:`, error.message);
      }
      return null;
    }
  }

  /**
   * Get stats from cache or fetch from API
   * @param {string} collection_slug - OpenSea collection slug
   * @returns {Promise<Object>} Stats object or null
   */
  async getStats(collection_slug) {
    if (!collection_slug) return null;

    // Check in-memory cache first
    const cached = this.cache.get(collection_slug);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      logger.debug(`[CollectionStats] Cache hit for ${collection_slug}`);
      return cached.stats;
    }

    // Fetch from API with rate limiting
    return new Promise((resolve) => {
      this.requestQueue.push(async () => {
        const stats = await this.fetchCollectionStats(collection_slug);

        // Cache the result (even if null, to avoid repeated failed requests)
        this.cache.set(collection_slug, {
          stats,
          timestamp: Date.now()
        });

        resolve(stats);
      });

      this.processQueue();
    });
  }

  /**
   * Process request queue with rate limiting
   */
  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      await request();

      // Delay between requests to respect rate limits
      if (this.requestQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.REQUEST_DELAY));
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Update stats for a single token in database
   * @param {number} token_id - Database token ID
   * @param {string} collection_slug - OpenSea collection slug
   * @returns {Promise<boolean>} Success status
   */
  async updateTokenStats(token_id, collection_slug) {
    if (!collection_slug) {
      logger.debug(`[CollectionStats] Token ${token_id} has no collection_slug, skipping`);
      return false;
    }

    try {
      const stats = await this.getStats(collection_slug);

      if (!stats) {
        logger.warn(`[CollectionStats] Failed to fetch stats for token ${token_id} (${collection_slug})`);
        return false;
      }

      // Update database with all stats
      await this.db.run(
        `UPDATE tracked_tokens
         SET volume_24h = $1,
             floor_price_24h = $2,
             volume_change_24h = $3,
             sales_24h = $4,
             volume_diff_24h = $5,
             sales_diff_24h = $6,
             average_price_24h = $7,
             market_cap = $8,
             floor_price_symbol = $9,
             stats_updated_at = NOW()
         WHERE id = $10`,
        [
          stats.volume_24h,
          stats.floor_price,
          stats.volume_change_24h,
          stats.sales_24h,
          stats.volume_diff_24h,
          stats.sales_diff_24h,
          stats.average_price_24h,
          stats.market_cap,
          stats.floor_price_symbol,
          token_id
        ]
      );

      logger.info(`[CollectionStats] Updated token ${token_id} (${collection_slug})`);
      return true;

    } catch (error) {
      logger.error(`[CollectionStats] Error updating token ${token_id}:`, error);
      return false;
    }
  }

  /**
   * Update stats for all active trending tokens
   * @returns {Promise<Object>} Update results
   */
  async updateAllTrendingStats() {
    try {
      logger.info('[CollectionStats] Starting batch update for trending tokens...');

      // Get all active trending tokens with collection_slug
      const trendingTokens = await this.db.all(`
        SELECT DISTINCT tt.id, tt.collection_slug, tt.token_name
        FROM tracked_tokens tt
        JOIN trending_payments tp ON tt.id = tp.token_id
        WHERE tp.is_active = true
          AND tp.end_time > NOW()
          AND tt.collection_slug IS NOT NULL
        ORDER BY tt.id
      `);

      if (trendingTokens.length === 0) {
        logger.info('[CollectionStats] No trending tokens with collection_slug found');
        return { total: 0, updated: 0, failed: 0 };
      }

      logger.info(`[CollectionStats] Found ${trendingTokens.length} trending tokens to update`);

      let updated = 0;
      let failed = 0;

      // Update each token
      for (const token of trendingTokens) {
        const success = await this.updateTokenStats(token.id, token.collection_slug);
        if (success) {
          updated++;
        } else {
          failed++;
        }
      }

      logger.info(`[CollectionStats] Batch update complete: ${updated} updated, ${failed} failed out of ${trendingTokens.length} total`);

      return {
        total: trendingTokens.length,
        updated,
        failed
      };

    } catch (error) {
      logger.error('[CollectionStats] Error in batch update:', error);
      return { total: 0, updated: 0, failed: 0 };
    }
  }

  /**
   * Get stats from database cache (for tokens that were recently updated)
   * @param {number} token_id - Database token ID
   * @returns {Promise<Object>} Cached stats or null
   */
  async getStatsFromDatabase(token_id) {
    try {
      const result = await this.db.get(
        `SELECT volume_24h, floor_price_24h, stats_updated_at
         FROM tracked_tokens
         WHERE id = $1`,
        [token_id]
      );

      if (result && result.stats_updated_at) {
        // Check if cache is still fresh (within 15 minutes)
        const cacheAge = Date.now() - new Date(result.stats_updated_at).getTime();
        if (cacheAge < 15 * 60 * 1000) {
          return {
            volume_24h: result.volume_24h,
            floor_price: result.floor_price_24h
          };
        }
      }

      return null;
    } catch (error) {
      logger.error(`[CollectionStats] Error reading stats from database for token ${token_id}:`, error);
      return null;
    }
  }

  /**
   * Clear in-memory cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('[CollectionStats] Cache cleared');
  }
}

module.exports = CollectionStatsService;
