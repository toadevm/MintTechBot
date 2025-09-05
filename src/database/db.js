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
      // Users table
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

      // Tracked tokens table
      `CREATE TABLE IF NOT EXISTS tracked_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_address TEXT NOT NULL,
        token_name TEXT,
        token_symbol TEXT,
        token_type TEXT, -- ERC721 or ERC1155
        total_supply INTEGER,
        floor_price TEXT,
        added_by_user_id INTEGER,
        webhook_id TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (added_by_user_id) REFERENCES users (id),
        UNIQUE(contract_address)
      )`,

      // User token subscriptions (many-to-many relationship)
      `CREATE TABLE IF NOT EXISTS user_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        notification_enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id) ON DELETE CASCADE,
        UNIQUE(user_id, token_id)
      )`,

      // Trending payments table
      `CREATE TABLE IF NOT EXISTS trending_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        payment_amount TEXT NOT NULL, -- Amount in Wei
        transaction_hash TEXT UNIQUE NOT NULL,
        trending_duration INTEGER NOT NULL, -- Duration in hours
        start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_time DATETIME,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id)
      )`,

      // NFT activity log
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

      // Channels table for bot deployment
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

      // Webhook logs for debugging
      `CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        processed BOOLEAN DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    try {
      for (const table of tables) {
        await this.run(table);
      }
      
      // Create indexes for better performance
      await this.createIndexes();
      
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
      'CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_user_subscriptions_token_id ON user_subscriptions(token_id)',
      'CREATE INDEX IF NOT EXISTS idx_trending_payments_active ON trending_payments(is_active, end_time)',
      'CREATE INDEX IF NOT EXISTS idx_nft_activities_contract ON nft_activities(contract_address)',
      'CREATE INDEX IF NOT EXISTS idx_nft_activities_created_at ON nft_activities(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_channels_chat_id ON channels(telegram_chat_id)'
    ];

    for (const index of indexes) {
      await this.run(index);
    }
  }

  // Utility methods for database operations
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

  // User management methods
  async createUser(telegramId, username, firstName) {
    const sql = `INSERT OR IGNORE INTO users (telegram_id, username, first_name) 
                 VALUES (?, ?, ?)`;
    return await this.run(sql, [telegramId, username, firstName]);
  }

  async getUser(telegramId) {
    const sql = 'SELECT * FROM users WHERE telegram_id = ?';
    return await this.get(sql, [telegramId]);
  }

  async updateUserWallet(telegramId, walletAddress) {
    const sql = `UPDATE users SET wallet_address = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE telegram_id = ?`;
    return await this.run(sql, [walletAddress, telegramId]);
  }

  // Token management methods
  async addTrackedToken(contractAddress, tokenData, addedByUserId, webhookId) {
    const sql = `INSERT OR REPLACE INTO tracked_tokens 
                 (contract_address, token_name, token_symbol, token_type, total_supply, 
                  added_by_user_id, webhook_id, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    return await this.run(sql, [
      contractAddress, 
      tokenData.name, 
      tokenData.symbol, 
      tokenData.tokenType,
      tokenData.totalSupply,
      addedByUserId, 
      webhookId
    ]);
  }

  async getTrackedToken(contractAddress) {
    const sql = 'SELECT * FROM tracked_tokens WHERE contract_address = ?';
    return await this.get(sql, [contractAddress]);
  }

  async getAllTrackedTokens() {
    const sql = 'SELECT * FROM tracked_tokens WHERE is_active = 1 ORDER BY created_at DESC';
    return await this.all(sql);
  }

  async getUserTrackedTokens(userId) {
    const sql = `SELECT tt.*, us.notification_enabled 
                 FROM tracked_tokens tt
                 JOIN user_subscriptions us ON tt.id = us.token_id
                 WHERE us.user_id = ? AND tt.is_active = 1 AND us.notification_enabled = 1
                 ORDER BY tt.created_at DESC`;
    return await this.all(sql, [userId]);
  }

  // Subscription management
  async subscribeUserToToken(userId, tokenId) {
    const sql = `INSERT OR IGNORE INTO user_subscriptions (user_id, token_id) 
                 VALUES (?, ?)`;
    return await this.run(sql, [userId, tokenId]);
  }

  async unsubscribeUserFromToken(userId, tokenId) {
    const sql = 'DELETE FROM user_subscriptions WHERE user_id = ? AND token_id = ?';
    return await this.run(sql, [userId, tokenId]);
  }

  // Trending system methods
  async addTrendingPayment(userId, tokenId, paymentAmount, transactionHash, durationHours) {
    const endTime = new Date(Date.now() + (durationHours * 60 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO trending_payments 
                 (user_id, token_id, payment_amount, transaction_hash, trending_duration, end_time) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    return await this.run(sql, [userId, tokenId, paymentAmount, transactionHash, durationHours, endTime]);
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

  // Activity logging
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

  // Channel management
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

  // Webhook logging
  async logWebhook(webhookType, payload, processed = false, errorMessage = null) {
    const sql = `INSERT INTO webhook_logs (webhook_type, payload, processed, error_message) 
                 VALUES (?, ?, ?, ?)`;
    return await this.run(sql, [webhookType, JSON.stringify(payload), processed, errorMessage]);
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