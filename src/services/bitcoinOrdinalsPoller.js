const logger = require('./logger');

/**
 * Bitcoin Ordinals Poller Service
 * Polls Magic Eden API every 5 minutes to detect new NFT activities
 * Replaces webhook-based Hiro Chainhooks with simpler polling approach
 */
class BitcoinOrdinalsPoller {
  constructor(database, magicEdenOrdinalsService, webhookHandlers = null) {
    this.db = database;
    this.magicEden = magicEdenOrdinalsService;
    this.webhookHandlers = webhookHandlers;
    this.pollingInterval = null;
    this.isRunning = false;
    this.trackedCollections = new Map(); // collectionSymbol -> last_checked_timestamp
    this.POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Initialize the poller and load tracked Bitcoin collections
   */
  async initialize() {
    try {
      logger.info('₿ Initializing Bitcoin Ordinals Poller...');

      if (!this.magicEden || !this.magicEden.isConnected) {
        logger.warn('₿ Magic Eden Ordinals service not available - poller disabled');
        return false;
      }

      // Load tracked Bitcoin Ordinals collections from database
      await this.loadTrackedCollections();

      logger.info(`₿ Bitcoin Ordinals Poller initialized with ${this.trackedCollections.size} collections`);
      return true;
    } catch (error) {
      logger.error('₿ Failed to initialize Bitcoin Ordinals Poller:', error);
      // Don't throw - return false to indicate poller is disabled
      return false;
    }
  }

  /**
   * Load tracked Bitcoin collections from database
   */
  async loadTrackedCollections() {
    try {
      const tokens = await this.db.all(
        `SELECT id, contract_address, collection_slug, token_name, last_activity_check
         FROM tracked_tokens
         WHERE chain_name = $1 AND is_active = true`,
        ['bitcoin']
      );

      logger.info(`₿ Found ${tokens.length} active Bitcoin Ordinals collections`);

      for (const token of tokens) {
        if (token.collection_slug) {
          const lastCheck = token.last_activity_check
            ? new Date(token.last_activity_check).getTime()
            : Date.now() - (24 * 60 * 60 * 1000); // Default: check last 24 hours

          this.trackedCollections.set(token.collection_slug, {
            tokenId: token.id,
            collectionSymbol: token.collection_slug,
            collectionName: token.token_name,
            lastChecked: lastCheck
          });

          logger.info(`   ✅ Tracking: ${token.token_name} (${token.collection_slug})`);
        }
      }
    } catch (error) {
      logger.error('Error loading tracked Bitcoin collections:', error);
      throw error;
    }
  }

  /**
   * Start the polling scheduler
   */
  start() {
    if (this.isRunning) {
      logger.warn('₿ Bitcoin Ordinals Poller already running');
      return;
    }

    logger.info(`₿ Starting Bitcoin Ordinals Poller (polling every ${this.POLL_INTERVAL_MS / 1000}s)`);

    // Do initial poll immediately
    this.pollAllCollections().catch(error => {
      logger.error('Error in initial poll:', error);
    });

    // Set up recurring polling
    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollAllCollections();
      } catch (error) {
        logger.error('Error in polling interval:', error);
      }
    }, this.POLL_INTERVAL_MS);

    this.isRunning = true;
    logger.info('₿ Bitcoin Ordinals Poller started successfully');
  }

  /**
   * Stop the polling scheduler
   */
  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isRunning = false;
    logger.info('₿ Bitcoin Ordinals Poller stopped');
  }

  /**
   * Poll all tracked collections for new activities
   */
  async pollAllCollections() {
    if (this.trackedCollections.size === 0) {
      logger.debug('₿ No Bitcoin collections to poll');
      return;
    }

    const pollStartTime = Date.now();
    const timestamp = new Date().toLocaleString('en-US', {
      hour12: true,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Clear visual separator
    console.log('\n' + '━'.repeat(80));
    logger.info(`₿ 🔄 BITCOIN ORDINALS POLL STARTED - ${timestamp}`);
    logger.info(`₿ 📊 Checking ${this.trackedCollections.size} collections for new activities...`);
    console.log('━'.repeat(80));

    let totalNewActivities = 0;
    const collectionResults = [];

    for (const [collectionSymbol, collectionData] of this.trackedCollections) {
      try {
        const result = await this.pollCollection(collectionSymbol, collectionData);
        collectionResults.push({
          symbol: collectionSymbol,
          name: collectionData.collectionName,
          newActivities: result.newActivities || 0,
          totalChecked: result.totalChecked || 0
        });

        if (result.newActivities > 0) {
          totalNewActivities += result.newActivities;
        }

        // Rate limiting: wait 1 second between collections
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`₿ ❌ Error polling collection ${collectionSymbol}:`, error);
        collectionResults.push({
          symbol: collectionSymbol,
          name: collectionData.collectionName,
          error: true
        });
      }
    }

    const pollDuration = ((Date.now() - pollStartTime) / 1000).toFixed(2);

    // Summary
    console.log('━'.repeat(80));
    logger.info(`₿ 📋 POLL SUMMARY:`);
    collectionResults.forEach(result => {
      if (result.error) {
        logger.error(`   ❌ ${result.name} (${result.symbol}): Error`);
      } else if (result.newActivities > 0) {
        logger.info(`   🔔 ${result.name}: ${result.newActivities} new activities`);
      } else {
        logger.info(`   ✅ ${result.name}: No new activities (checked ${result.totalChecked})`);
      }
    });

    if (totalNewActivities > 0) {
      logger.info(`₿ 🎉 Found ${totalNewActivities} total new activities!`);
    } else {
      logger.info(`₿ ✅ No new activities found`);
    }

    logger.info(`₿ ⏱️  Poll completed in ${pollDuration}s`);
    logger.info(`₿ ⏰ Next poll in ${this.POLL_INTERVAL_MS / 1000}s (${this.POLL_INTERVAL_MS / 60000} minutes)`);
    console.log('━'.repeat(80) + '\n');
  }

  /**
   * Poll a single collection for new activities
   * @param {string} collectionSymbol - Magic Eden collection symbol
   * @param {Object} collectionData - Collection tracking data
   * @returns {Object} Result with newActivities and totalChecked counts
   */
  async pollCollection(collectionSymbol, collectionData) {
    try {
      logger.debug(`₿ Polling collection: ${collectionSymbol}`);

      // Fetch recent activities from Magic Eden
      const activities = await this.magicEden.getCollectionActivities(collectionSymbol, 20);

      if (!activities || activities.length === 0) {
        logger.debug(`   No activities found for ${collectionSymbol}`);
        return { newActivities: 0, totalChecked: 0 };
      }

      // Filter activities that are newer than last check
      const lastCheckedTime = collectionData.lastChecked;
      const newActivities = activities.filter(activity => {
        const activityTime = new Date(activity.createdAt || activity.blockTime * 1000).getTime();
        return activityTime > lastCheckedTime;
      });

      if (newActivities.length === 0) {
        logger.debug(`   No new activities for ${collectionSymbol} (checked ${activities.length} total)`);
        return { newActivities: 0, totalChecked: activities.length };
      }

      logger.info(`₿ Found ${newActivities.length} new activities for ${collectionSymbol}`);

      // Process each new activity
      for (const activity of newActivities) {
        await this.processActivity(collectionSymbol, activity, collectionData);
      }

      // Update last checked timestamp
      const newLastChecked = Date.now();
      collectionData.lastChecked = newLastChecked;

      // Update database
      await this.db.run(
        `UPDATE tracked_tokens
         SET last_activity_check = $1
         WHERE id = $2`,
        [new Date(newLastChecked).toISOString(), collectionData.tokenId]
      );

      logger.debug(`   ✅ Updated last check for ${collectionSymbol}`);

      return { newActivities: newActivities.length, totalChecked: activities.length };

    } catch (error) {
      logger.error(`Error polling collection ${collectionSymbol}:`, error);
      return { newActivities: 0, totalChecked: 0, error: true };
    }
  }

  /**
   * Process a single activity (sale, listing, etc.)
   * @param {string} collectionSymbol - Collection symbol
   * @param {Object} activity - Activity data from Magic Eden API
   * @param {Object} collectionData - Collection tracking data
   */
  async processActivity(collectionSymbol, activity, collectionData) {
    try {
      const activityType = activity.kind || activity.type || 'unknown';
      const txId = activity.txId || activity.signature;
      const inscriptionId = activity.tokenId || activity.inscription_id;

      // Skip transfer events for Bitcoin Ordinals (inscriptions)
      if (activityType === 'transfer') {
        logger.debug(`   ⏭️  Skipping transfer event for Bitcoin Ordinals`);
        return;
      }

      // Create unique activity ID
      const activityId = this.generateActivityId(activity);

      // Check if already processed to prevent duplicates
      const alreadyProcessed = await this.isActivityProcessed(activityId, collectionSymbol);
      if (alreadyProcessed) {
        logger.debug(`   ⏭️  Activity already processed: ${activityId.substring(0, 20)}...`);
        return;
      }

      logger.info(`₿ Processing ${activityType}: ${txId?.substring(0, 12)}...`);
      logger.debug(`₿ Raw activity data - kind: ${activity.kind}, price: ${activity.price}, listedPrice: ${activity.listedPrice}, amount: ${activity.amount}`);

      // Convert Magic Eden activity to standardized format
      // Magic Eden uses different field names for different activity types
      const priceValue = activity.price || activity.listedPrice || activity.amount || null;

      const eventData = {
        type: 'BITCOIN_ORDINALS_ACTIVITY',
        activityType: activityType,
        collectionSymbol: collectionSymbol,
        collectionName: collectionData.collectionName,

        // Transaction details
        txId: txId,
        inscriptionId: inscriptionId,

        // Price and marketplace
        price: priceValue ? this.formatSatsToReadable(priceValue) : null,
        priceRaw: priceValue,
        marketplace: 'Magic Eden',

        // Parties involved
        seller: activity.seller || activity.from,
        buyer: activity.buyer || activity.to,

        // Timing
        timestamp: activity.createdAt || activity.blockTime,
        blockTime: activity.blockTime,

        // For tracking
        activityId: activityId,

        // Raw data for debugging
        rawActivity: activity
      };

      // Mark activity as processed in database
      await this.markActivityProcessed(activityId, collectionSymbol, eventData);

      // Log activity to database
      await this.logActivity(collectionSymbol, eventData);

      // Send notification via webhook handlers
      if (this.webhookHandlers) {
        await this.webhookHandlers.handleBitcoinOrdinalsActivity(eventData);
        logger.info(`   ✅ Notification sent for ${activityType}`);
      } else {
        logger.warn('No webhook handlers available - activity logged but not notified');
      }

    } catch (error) {
      logger.error(`Error processing activity for ${collectionSymbol}:`, error);
    }
  }

  /**
   * Generate unique activity ID from activity data
   * @param {Object} activity - Activity data
   * @returns {string} Unique activity ID
   */
  generateActivityId(activity) {
    // Use combination of fields to create unique ID
    const txId = activity.txId || activity.signature || '';
    const inscriptionId = activity.tokenId || activity.inscription_id || '';
    const timestamp = activity.createdAt || activity.blockTime || Date.now();
    const type = activity.kind || activity.type || 'unknown';

    // Create hash-like unique ID
    return `${type}_${inscriptionId}_${txId}_${timestamp}`.substring(0, 255);
  }

  /**
   * Check if activity was already processed
   * @param {string} activityId - Unique activity ID
   * @param {string} collectionSymbol - Collection symbol
   * @returns {boolean} True if already processed
   */
  async isActivityProcessed(activityId, collectionSymbol) {
    try {
      const result = await this.db.get(
        `SELECT id FROM bitcoin_ordinals_activities
         WHERE activity_id = $1 AND collection_symbol = $2`,
        [activityId, collectionSymbol]
      );

      return !!result;
    } catch (error) {
      logger.error('Error checking if activity processed:', error);
      return false; // On error, process anyway to avoid missing events
    }
  }

  /**
   * Mark activity as processed in database
   * @param {string} activityId - Unique activity ID
   * @param {string} collectionSymbol - Collection symbol
   * @param {Object} eventData - Event data
   */
  async markActivityProcessed(activityId, collectionSymbol, eventData) {
    try {
      await this.db.run(
        `INSERT INTO bitcoin_ordinals_activities
         (activity_id, collection_symbol, inscription_id, activity_type, from_address, to_address, price, marketplace, activity_timestamp, notified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
         ON CONFLICT (activity_id, collection_symbol) DO NOTHING`,
        [
          activityId,
          collectionSymbol,
          eventData.inscriptionId || null,
          eventData.activityType,
          eventData.seller || null,
          eventData.buyer || null,
          eventData.priceRaw || null,
          'magiceden',
          eventData.timestamp || new Date().toISOString()
        ]
      );
    } catch (error) {
      logger.error('Error marking activity as processed:', error);
    }
  }

  /**
   * Log activity to database
   * @param {string} collectionSymbol - Collection symbol
   * @param {Object} eventData - Processed event data
   */
  async logActivity(collectionSymbol, eventData) {
    try {
      // Find the token record
      const token = await this.db.get(
        'SELECT id, contract_address FROM tracked_tokens WHERE collection_slug = $1 AND chain_name = $2',
        [collectionSymbol, 'bitcoin']
      );

      if (!token) {
        logger.warn(`Token not found for collection ${collectionSymbol}`);
        return;
      }

      // Log to nft_activities table
      await this.db.run(
        `INSERT INTO nft_activities
         (contract_address, token_id, activity_type, from_address, to_address, price, transaction_hash, marketplace, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          token.contract_address,
          eventData.inscriptionId || 'unknown',
          eventData.activityType,
          eventData.seller || null,
          eventData.buyer || null,
          eventData.priceRaw || null,
          eventData.txId || null,
          'magiceden',
          eventData.timestamp || new Date().toISOString()
        ]
      );

      logger.debug(`   Logged activity to database for ${collectionSymbol}`);
    } catch (error) {
      logger.error(`Error logging activity to database:`, error);
    }
  }

  /**
   * Format satoshis to readable BTC amount
   * @param {number} sats - Amount in satoshis
   * @returns {string} Formatted string
   */
  formatSatsToReadable(sats) {
    if (!sats || sats === 0) return '0 BTC';

    const btc = sats / 100000000;

    if (btc >= 1) {
      return `${btc.toFixed(4)} BTC`;
    } else if (btc >= 0.001) {
      return `${btc.toFixed(6)} BTC`;
    } else {
      return `${btc.toFixed(8)} BTC`;
    }
  }

  /**
   * Add a new collection to polling
   * @param {string} collectionSymbol - Collection symbol to track
   * @param {number} tokenId - Database token ID
   * @param {string} collectionName - Collection name
   */
  async addCollection(collectionSymbol, tokenId, collectionName) {
    try {
      logger.info(`₿ Adding collection to poller: ${collectionName} (${collectionSymbol})`);

      // Add to tracked collections
      this.trackedCollections.set(collectionSymbol, {
        tokenId: tokenId,
        collectionSymbol: collectionSymbol,
        collectionName: collectionName,
        lastChecked: Date.now() - (24 * 60 * 60 * 1000) // Check last 24 hours initially
      });

      // Update database
      await this.db.run(
        `UPDATE tracked_tokens
         SET last_activity_check = $1
         WHERE id = $2`,
        [new Date().toISOString(), tokenId]
      );

      logger.info(`   ✅ Collection added to Bitcoin Ordinals poller`);

      // Do an immediate poll for this collection
      const collectionData = this.trackedCollections.get(collectionSymbol);
      await this.pollCollection(collectionSymbol, collectionData);

    } catch (error) {
      logger.error(`Error adding collection ${collectionSymbol} to poller:`, error);
      throw error;
    }
  }

  /**
   * Remove a collection from polling
   * @param {string} collectionSymbol - Collection symbol to stop tracking
   */
  removeCollection(collectionSymbol) {
    if (this.trackedCollections.has(collectionSymbol)) {
      this.trackedCollections.delete(collectionSymbol);
      logger.info(`₿ Removed collection from poller: ${collectionSymbol}`);
    }
  }

  /**
   * Get poller status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      trackedCollections: this.trackedCollections.size,
      pollInterval: this.POLL_INTERVAL_MS / 1000,
      collections: Array.from(this.trackedCollections.keys())
    };
  }

  /**
   * Cleanup on shutdown
   */
  async cleanup() {
    this.stop();
    logger.info('₿ Bitcoin Ordinals Poller cleanup complete');
  }
}

module.exports = BitcoinOrdinalsPoller;
