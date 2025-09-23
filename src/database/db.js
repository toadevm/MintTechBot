const sqlite3 = require('sqlite3').verbose();
const logger = require('../services/logger');

class Database {
  constructor() {
    this.db = null;
    this.dbPath = process.env.DATABASE_PATH || './database.sqlite';
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Failed to connect to database:', err);
          reject(err);
        } else {
          logger.info(`Connected to SQLite database: ${this.dbPath}`);
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const tables = [

      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        wallet_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1
      )`,


      `CREATE TABLE IF NOT EXISTS tracked_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_address TEXT NOT NULL,
        chain_name TEXT NOT NULL DEFAULT 'ethereum', -- Blockchain network (ethereum, arbitrum, optimism, bsc, hyperblast)
        chain_id INTEGER NOT NULL DEFAULT 1, -- Chain ID (1, 42161, 10, 56, 1891)
        collection_slug TEXT, -- OpenSea collection slug for stream subscriptions
        token_name TEXT,
        token_symbol TEXT,
        token_type TEXT, -- ERC721 or ERC1155
        total_supply INTEGER,
        floor_price TEXT,
        added_by_user_id INTEGER,
        webhook_id TEXT, -- Keep for Alchemy compatibility during transition
        opensea_subscription_id TEXT, -- Track OpenSea stream subscriptions
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (added_by_user_id) REFERENCES users (id),
        UNIQUE(contract_address, chain_name)
      )`,


      `CREATE TABLE IF NOT EXISTS user_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL, -- Chat context: positive for private, negative for groups
        notification_enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id) ON DELETE CASCADE,
        UNIQUE(user_id, token_id, chat_id)
      )`,


      `CREATE TABLE IF NOT EXISTS pending_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        expected_amount TEXT NOT NULL, -- Amount in Wei user should pay
        duration_hours INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL, -- Pending payments expire after 30 minutes
        is_matched BOOLEAN DEFAULT 0,
        matched_tx_hash TEXT,
        matched_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id)
      )`,


      `CREATE TABLE IF NOT EXISTS trending_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        payment_amount TEXT NOT NULL, -- Amount in Wei
        transaction_hash TEXT UNIQUE NOT NULL,
        payer_address TEXT NOT NULL, -- Ethereum address that sent the payment
        trending_duration INTEGER NOT NULL, -- Duration in hours
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME NOT NULL, -- Auto-calculated end time
        is_active BOOLEAN DEFAULT 1,
        is_validated BOOLEAN DEFAULT 0, -- Whether transaction was verified on blockchain
        validation_timestamp DATETIME, -- When the transaction was validated
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id)
      )`,

      // New table for tracking processed transaction hashes to prevent duplicates
      `CREATE TABLE IF NOT EXISTS processed_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_hash TEXT UNIQUE NOT NULL,
        contract_address TEXT NOT NULL,
        payer_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        block_number INTEGER,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        purpose TEXT -- 'trending_payment', 'direct_payment', etc.
      )`,


      `CREATE TABLE IF NOT EXISTS nft_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_address TEXT NOT NULL,
        token_id TEXT,
        activity_type TEXT NOT NULL, -- transfer, sale, mint, etc.
        from_address TEXT,
        to_address TEXT,
        transaction_hash TEXT,
        block_number INTEGER,
        price TEXT, -- Price in Wei if applicable
        marketplace TEXT, -- OpenSea, LooksRare, etc.
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,


      `CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_chat_id TEXT UNIQUE NOT NULL,
        channel_title TEXT,
        added_by_user_id INTEGER,
        is_active BOOLEAN DEFAULT 1,
        show_trending BOOLEAN DEFAULT 1,
        show_all_activities BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (added_by_user_id) REFERENCES users (id)
      )`,


      `CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        processed BOOLEAN DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Image fee payments table for 0.0040 ETH image display fee
      `CREATE TABLE IF NOT EXISTS image_fee_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        contract_address TEXT NOT NULL,
        payment_amount TEXT NOT NULL, -- Amount in Wei (0.0040 ETH)
        transaction_hash TEXT UNIQUE NOT NULL,
        payer_address TEXT NOT NULL, -- Ethereum address that sent the payment
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME NOT NULL, -- Auto-calculated end time (24 hours)
        is_active BOOLEAN DEFAULT 1,
        is_validated BOOLEAN DEFAULT 0, -- Whether transaction was verified on blockchain
        validation_timestamp DATETIME, -- When the transaction was validated
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(contract_address, is_active) -- Only one active image fee per contract
      )`,

      // Footer ads table for 1 ETH footer advertisement fee
      `CREATE TABLE IF NOT EXISTS footer_ads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        contract_address TEXT NOT NULL,
        token_symbol TEXT NOT NULL, -- Custom ticker symbol to display in footer (e.g., $CANDY)
        ticker_symbol TEXT, -- Custom ticker for display (will migrate to this)
        custom_link TEXT NOT NULL, -- URL to redirect to when clicked
        payment_amount TEXT NOT NULL, -- Amount in Wei (1.0 ETH)
        transaction_hash TEXT UNIQUE NOT NULL,
        payer_address TEXT NOT NULL, -- Ethereum address that sent the payment
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME NOT NULL, -- Auto-calculated end time (30 days)
        is_active BOOLEAN DEFAULT 1,
        is_validated BOOLEAN DEFAULT 0, -- Whether transaction was verified on blockchain
        validation_timestamp DATETIME, -- When the transaction was validated
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`
    ];

    try {
      for (const table of tables) {
        await this.run(table);
      }

      await this.createIndexes();
      await this.migrateDatabase();
      logger.info('Database tables created successfully');
      return true;
    } catch (error) {
      logger.error('Failed to create database tables:', error);
      throw error;
    }
  }

  async createIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)',
      'CREATE INDEX IF NOT EXISTS idx_tracked_tokens_contract ON tracked_tokens(contract_address)',
      'CREATE INDEX IF NOT EXISTS idx_tracked_tokens_collection_slug ON tracked_tokens(collection_slug)',
      'CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_user_subscriptions_token_id ON user_subscriptions(token_id)',
      'CREATE INDEX IF NOT EXISTS idx_trending_payments_active ON trending_payments(is_active, end_time)',
      'CREATE INDEX IF NOT EXISTS idx_trending_payments_tx_hash ON trending_payments(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_processed_transactions_hash ON processed_transactions(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_processed_transactions_contract ON processed_transactions(contract_address)',
      'CREATE INDEX IF NOT EXISTS idx_nft_activities_contract ON nft_activities(contract_address)',
      'CREATE INDEX IF NOT EXISTS idx_nft_activities_created_at ON nft_activities(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_channels_chat_id ON channels(telegram_chat_id)',
      'CREATE INDEX IF NOT EXISTS idx_image_fee_payments_active ON image_fee_payments(contract_address, is_active, end_time)',
      'CREATE INDEX IF NOT EXISTS idx_image_fee_payments_tx_hash ON image_fee_payments(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_footer_ads_active ON footer_ads(is_active, end_time)',
      'CREATE INDEX IF NOT EXISTS idx_footer_ads_tx_hash ON footer_ads(transaction_hash)'
    ];

    for (const index of indexes) {
      await this.run(index);
    }
  }

  async migrateDatabase() {
    try {
      // Check if chat_id column exists in user_subscriptions
      const subscriptionsTableInfo = await this.all("PRAGMA table_info(user_subscriptions)");
      const hasChatId = subscriptionsTableInfo.some(column => column.name === 'chat_id');

      if (!hasChatId) {
        logger.info('Adding chat_id column to user_subscriptions table...');

        // Add chat_id column with default value (private chat context)
        await this.run('ALTER TABLE user_subscriptions ADD COLUMN chat_id TEXT DEFAULT "private"');

        // Update existing records to use private chat context
        await this.run('UPDATE user_subscriptions SET chat_id = "private" WHERE chat_id IS NULL');

        // We can't modify UNIQUE constraints in SQLite, so we'll handle it in application logic
        logger.info('Successfully migrated user_subscriptions table for context-specific tracking');
      }

      // Check if chain columns exist in tracked_tokens
      const tokensTableInfo = await this.all("PRAGMA table_info(tracked_tokens)");
      const hasChainName = tokensTableInfo.some(column => column.name === 'chain_name');
      const hasChainId = tokensTableInfo.some(column => column.name === 'chain_id');

      if (!hasChainName || !hasChainId) {
        logger.info('Adding chain support columns to tracked_tokens table...');

        if (!hasChainName) {
          await this.run('ALTER TABLE tracked_tokens ADD COLUMN chain_name TEXT DEFAULT "ethereum"');
          await this.run('UPDATE tracked_tokens SET chain_name = "ethereum" WHERE chain_name IS NULL');
        }

        if (!hasChainId) {
          await this.run('ALTER TABLE tracked_tokens ADD COLUMN chain_id INTEGER DEFAULT 1');
          await this.run('UPDATE tracked_tokens SET chain_id = 1 WHERE chain_id IS NULL');
        }

        logger.info('Successfully migrated tracked_tokens table for multi-chain support');
      }

      // Check if duration_days column exists in image_fee_payments
      const imageTableInfo = await this.all("PRAGMA table_info(image_fee_payments)");
      const hasImageDuration = imageTableInfo.some(column => column.name === 'duration_days');

      if (!hasImageDuration) {
        logger.info('Adding duration_days column to image_fee_payments table...');
        await this.run('ALTER TABLE image_fee_payments ADD COLUMN duration_days INTEGER DEFAULT 30');
        await this.run('UPDATE image_fee_payments SET duration_days = 30 WHERE duration_days IS NULL');
        logger.info('Successfully migrated image_fee_payments table for duration tracking');
      }

      // Check if duration_days column exists in footer_ads
      const footerTableInfo = await this.all("PRAGMA table_info(footer_ads)");
      const hasFooterDuration = footerTableInfo.some(column => column.name === 'duration_days');
      const hasTickerSymbol = footerTableInfo.some(column => column.name === 'ticker_symbol');

      if (!hasFooterDuration) {
        logger.info('Adding duration_days column to footer_ads table...');
        await this.run('ALTER TABLE footer_ads ADD COLUMN duration_days INTEGER DEFAULT 30');
        await this.run('UPDATE footer_ads SET duration_days = 30 WHERE duration_days IS NULL');
        logger.info('Successfully migrated footer_ads table for duration tracking');
      }

      if (!hasTickerSymbol) {
        logger.info('Adding ticker_symbol column to footer_ads table...');
        await this.run('ALTER TABLE footer_ads ADD COLUMN ticker_symbol TEXT');
        await this.run('UPDATE footer_ads SET ticker_symbol = token_symbol WHERE ticker_symbol IS NULL');
        logger.info('Successfully migrated footer_ads table for ticker symbol tracking');
      }
    } catch (error) {
      logger.error('Error during database migration:', error);
      throw error;
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }


  async createUser(telegramId, username, firstName) {
    const sql = `INSERT OR IGNORE INTO users (telegram_id, username, first_name) 
                 VALUES (?, ?, ?)`;
    return await this.run(sql, [telegramId, username, firstName]);
  }

  async getUser(telegramId) {
    const sql = 'SELECT * FROM users WHERE telegram_id = ?';
    return await this.get(sql, [telegramId]);
  }



  async addTrackedToken(contractAddress, tokenData, addedByUserId, webhookId, collectionSlug = null, openSeaSubscriptionId = null, chainName = 'ethereum', chainId = 1) {
    const sql = `INSERT OR REPLACE INTO tracked_tokens
                 (contract_address, chain_name, chain_id, collection_slug, token_name, token_symbol, token_type, total_supply,
                  added_by_user_id, webhook_id, opensea_subscription_id, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    return await this.run(sql, [
      contractAddress,
      chainName,
      chainId,
      collectionSlug,
      tokenData.name,
      tokenData.symbol,
      tokenData.tokenType,
      tokenData.totalSupply,
      addedByUserId,
      webhookId,
      openSeaSubscriptionId
    ]);
  }

  async getTrackedToken(contractAddress, chainName = null) {
    if (chainName) {
      const sql = 'SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?) AND chain_name = ?';
      return await this.get(sql, [contractAddress, chainName]);
    } else {
      // Fallback for backwards compatibility - return first match
      const sql = 'SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER(?)';
      return await this.get(sql, [contractAddress]);
    }
  }

  async getTrackedTokenByCollectionSlug(collectionSlug) {
    const sql = 'SELECT * FROM tracked_tokens WHERE collection_slug = ? AND is_active = 1';
    return await this.get(sql, [collectionSlug]);
  }

  async getTokensForCollectionSlug(collectionSlug) {
    const sql = 'SELECT * FROM tracked_tokens WHERE collection_slug = ? AND is_active = 1';
    return await this.all(sql, [collectionSlug]);
  }

  async getAllTrackedTokens() {
    const sql = 'SELECT * FROM tracked_tokens WHERE is_active = 1 ORDER BY created_at DESC';
    return await this.all(sql);
  }

  async getUserTrackedTokens(userId, chatId, chainName = null) {
    let sql = `SELECT tt.*, us.notification_enabled
               FROM tracked_tokens tt
               JOIN user_subscriptions us ON tt.id = us.token_id
               WHERE us.user_id = ? AND us.chat_id = ? AND tt.is_active = 1 AND (us.notification_enabled = 1 OR us.notification_enabled IS NULL)`;

    const params = [userId, chatId];

    if (chainName) {
      sql += ` AND tt.chain_name = ?`;
      params.push(chainName);
    }

    sql += ` ORDER BY tt.created_at DESC`;
    return await this.all(sql, params);
  }

  async getUserTrackedTokensByChain(userId, chatId, chainName) {
    return await this.getUserTrackedTokens(userId, chatId, chainName);
  }

  // Debug method to see all user subscriptions
  async getAllUserSubscriptions(userId) {
    const sql = `SELECT tt.*, us.notification_enabled, us.created_at as subscription_date
                 FROM tracked_tokens tt
                 JOIN user_subscriptions us ON tt.id = us.token_id
                 WHERE us.user_id = ?
                 ORDER BY us.created_at DESC`;
    return await this.all(sql, [userId]);
  }


  async subscribeUserToToken(userId, tokenId, chatId) {
    const sql = `INSERT OR IGNORE INTO user_subscriptions (user_id, token_id, chat_id, notification_enabled)
                 VALUES (?, ?, ?, 1)`;
    return await this.run(sql, [userId, tokenId, chatId]);
  }

  async unsubscribeUserFromToken(userId, tokenId, chatId) {
    const sql = 'DELETE FROM user_subscriptions WHERE user_id = ? AND token_id = ? AND chat_id = ?';
    return await this.run(sql, [userId, tokenId, chatId]);
  }


  async createPendingPayment(userId, tokenId, expectedAmount, durationHours) {
    const expiresAt = new Date(Date.now() + (30 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO pending_payments 
                 (user_id, token_id, expected_amount, duration_hours, expires_at) 
                 VALUES (?, ?, ?, ?, ?)`;
    return await this.run(sql, [userId, tokenId, expectedAmount, durationHours, expiresAt]);
  }

  async getPendingPayment(userId, tokenId, amount) {
    const sql = `SELECT * FROM pending_payments 
                 WHERE user_id = ? AND token_id = ? AND expected_amount = ? 
                 AND is_matched = 0 AND expires_at > datetime('now')
                 ORDER BY created_at DESC LIMIT 1`;
    return await this.get(sql, [userId, tokenId, amount]);
  }

  async markPendingPaymentMatched(pendingPaymentId, txHash) {
    const sql = `UPDATE pending_payments 
                 SET is_matched = 1, matched_tx_hash = ?, matched_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`;
    return await this.run(sql, [txHash, pendingPaymentId]);
  }

  async cleanupExpiredPendingPayments() {
    const sql = `DELETE FROM pending_payments WHERE expires_at <= datetime('now')`;
    return await this.run(sql);
  }

  async getUserPendingPayments(userId) {
    const sql = `SELECT pp.*, tt.token_name, tt.contract_address 
                 FROM pending_payments pp
                 JOIN tracked_tokens tt ON pp.token_id = tt.id
                 WHERE pp.user_id = ? AND pp.is_matched = 0 AND pp.expires_at > datetime('now')
                 ORDER BY pp.created_at DESC`;
    return await this.all(sql, [userId]);
  }


  async addTrendingPayment(userId, tokenId, paymentAmount, transactionHash, durationHours, payerAddress = null) {
    const endTime = new Date(Date.now() + (durationHours * 60 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO trending_payments 
                 (user_id, token_id, payment_amount, transaction_hash, payer_address, trending_duration, end_time, is_validated, validation_timestamp) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`;
    return await this.run(sql, [userId, tokenId, paymentAmount, transactionHash, payerAddress, durationHours, endTime]);
  }

  async isTransactionProcessed(transactionHash) {
    const sql = 'SELECT id FROM processed_transactions WHERE transaction_hash = ?';
    const result = await this.get(sql, [transactionHash]);
    return !!result;
  }

  async markTransactionProcessed(transactionHash, contractAddress, payerAddress, amount, blockNumber, purpose = 'trending_payment') {
    const sql = `INSERT OR IGNORE INTO processed_transactions 
                 (transaction_hash, contract_address, payer_address, amount, block_number, purpose) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    return await this.run(sql, [transactionHash, contractAddress, payerAddress, amount, blockNumber, purpose]);
  }

  async validateTrendingPayment(trendingPaymentId, transactionHash) {
    const sql = `UPDATE trending_payments 
                 SET is_validated = 1, validation_timestamp = CURRENT_TIMESTAMP 
                 WHERE id = ? AND transaction_hash = ?`;
    return await this.run(sql, [trendingPaymentId, transactionHash]);
  }

  async getTrendingTokens() {
    const sql = `SELECT tt.*, tp.end_time as trending_end_time, tp.payment_amount
                 FROM tracked_tokens tt
                 JOIN trending_payments tp ON tt.id = tp.token_id
                 WHERE tp.is_active = 1 AND tp.end_time > datetime('now')
                 ORDER BY tp.payment_amount DESC, tp.start_time DESC`;
    return await this.all(sql);
  }

  async expireTrendingPayments() {
    const sql = `UPDATE trending_payments 
                 SET is_active = 0 
                 WHERE is_active = 1 AND end_time <= datetime('now')`;
    return await this.run(sql);
  }


  async logNFTActivity(activityData) {
    const sql = `INSERT INTO nft_activities 
                 (contract_address, token_id, activity_type, from_address, to_address, 
                  transaction_hash, block_number, price, marketplace) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return await this.run(sql, [
      activityData.contractAddress,
      activityData.tokenId,
      activityData.activityType,
      activityData.fromAddress,
      activityData.toAddress,
      activityData.transactionHash,
      activityData.blockNumber,
      activityData.price,
      activityData.marketplace
    ]);
  }


  async addChannel(telegramChatId, channelTitle, addedByUserId) {
    const sql = `INSERT OR IGNORE INTO channels 
                 (telegram_chat_id, channel_title, added_by_user_id) 
                 VALUES (?, ?, ?)`;
    return await this.run(sql, [telegramChatId, channelTitle, addedByUserId]);
  }

  async getActiveChannels() {
    const sql = 'SELECT * FROM channels WHERE is_active = 1';
    return await this.all(sql);
  }


  async logWebhook(webhookType, payload, processed = false, errorMessage = null) {
    const sql = `INSERT INTO webhook_logs (webhook_type, payload, processed, error_message) 
                 VALUES (?, ?, ?, ?)`;
    return await this.run(sql, [webhookType, JSON.stringify(payload), processed, errorMessage]);
  }

  // Image Fee Payment Methods
  async addImageFeePayment(userId, contractAddress, paymentAmount, transactionHash, payerAddress, durationDays = 30) {
    const endTime = new Date(Date.now() + (durationDays * 24 * 60 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO image_fee_payments
                 (user_id, contract_address, payment_amount, transaction_hash, payer_address, end_time, duration_days, is_validated, validation_timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`;
    return await this.run(sql, [userId, contractAddress, paymentAmount, transactionHash, payerAddress, endTime, durationDays]);
  }

  async isImageFeeActive(contractAddress) {
    const sql = `SELECT * FROM image_fee_payments 
                 WHERE LOWER(contract_address) = LOWER(?) 
                 AND is_active = 1 AND end_time > datetime('now')
                 ORDER BY created_at DESC LIMIT 1`;
    const result = await this.get(sql, [contractAddress]);
    return !!result;
  }

  async getImageFeePayment(contractAddress) {
    const sql = `SELECT * FROM image_fee_payments 
                 WHERE LOWER(contract_address) = LOWER(?) 
                 AND is_active = 1 AND end_time > datetime('now')
                 ORDER BY created_at DESC LIMIT 1`;
    return await this.get(sql, [contractAddress]);
  }

  async expireImageFeePayments() {
    const sql = `UPDATE image_fee_payments 
                 SET is_active = 0 
                 WHERE is_active = 1 AND end_time <= datetime('now')`;
    return await this.run(sql);
  }

  async addFooterAd(userId, contractAddress, tokenSymbol, customLink, paymentAmount, transactionHash, payerAddress, durationDays = 30, tickerSymbol = null) {
    const endTime = new Date(Date.now() + (durationDays * 24 * 60 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO footer_ads
                 (user_id, contract_address, token_symbol, ticker_symbol, custom_link, payment_amount, transaction_hash, payer_address, end_time, duration_days, is_validated, validation_timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`;
    return await this.run(sql, [userId, contractAddress, tokenSymbol, tickerSymbol || tokenSymbol, customLink, paymentAmount, transactionHash, payerAddress, endTime, durationDays]);
  }

  async getActiveFooterAds() {
    const sql = `SELECT COALESCE(ticker_symbol, token_symbol) as ticker_symbol, custom_link FROM footer_ads
                 WHERE is_active = 1 AND end_time > datetime('now')
                 ORDER BY created_at ASC
                 LIMIT 3`;
    return await this.all(sql);
  }

  async getFooterAd(contractAddress) {
    const sql = `SELECT * FROM footer_ads 
                 WHERE LOWER(contract_address) = LOWER(?) 
                 AND is_active = 1 AND end_time > datetime('now')
                 ORDER BY created_at DESC LIMIT 1`;
    return await this.get(sql, [contractAddress]);
  }

  async expireFooterAds() {
    const sql = `UPDATE footer_ads 
                 SET is_active = 0 
                 WHERE is_active = 1 AND end_time <= datetime('now')`;
    return await this.run(sql);
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('Error closing database:', err);
          } else {
            logger.info('Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;