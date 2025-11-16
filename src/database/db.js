const { Pool } = require('pg');
const logger = require('../services/logger');

class Database {
  constructor() {
    this.pool = null;
    this.dbUrl = process.env.DATABASE_URL;
  }

  async initialize(maxRetries = 3, retryDelayMs = 5000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.dbUrl) {
          throw new Error('DATABASE_URL not found in environment variables');
        }

        const dbHost = this.dbUrl.split('@')[1]?.split('?')[0] || 'database';

        if (attempt > 1) {
          logger.info(`Retry attempt ${attempt}/${maxRetries} for PostgreSQL connection...`);
        } else {
          logger.info(`Attempting PostgreSQL connection to: ${dbHost}`);
        }

        // Create PostgreSQL connection pool with Neon-specific settings
        this.pool = new Pool({
          connectionString: this.dbUrl,
          ssl: {
            rejectUnauthorized: false
          },
          max: 10, // Maximum number of clients in pool (reduced for Neon)
          idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
          connectionTimeoutMillis: 60000, // Increased timeout for Neon (60 seconds)
          query_timeout: 60000, // Query timeout
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
          statement_timeout: 60000 // Statement timeout
        });

        // Test connection with timeout
        const connectionPromise = (async () => {
          const client = await this.pool.connect();
          try {
            await client.query('SELECT NOW()');
            return client;
          } finally {
            client.release();
          }
        })();

        // Race between connection and timeout
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), 60000);
        });

        await Promise.race([connectionPromise, timeoutPromise]);

        logger.info(`✅ Connected to PostgreSQL database: ${this.dbUrl.split('@')[1]?.split('/')[0] || 'database'}`);

        await this.createTables();
        return true;

      } catch (error) {
        lastError = error;

        // Close any partially created pool
        if (this.pool) {
          try {
            await this.pool.end();
            this.pool = null;
          } catch (closeError) {
            // Ignore errors when closing failed connection
          }
        }

        if (attempt < maxRetries) {
          logger.warn(`Connection attempt ${attempt} failed: ${error.message}`);
          logger.info(`Waiting ${retryDelayMs}ms before retry...`);

          // Special handling for VPN-related errors
          if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.message.includes('timeout')) {
            logger.warn('⚠️  Network error detected. If using VPN, ensure split tunneling is configured.');
            logger.warn('⚠️  Run: sudo ./setup-vpn-split-tunnel.sh');
          }

          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        } else {
          logger.error(`Failed to connect to PostgreSQL database after ${maxRetries} attempts:`, error);

          // Provide helpful error message
          if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
            logger.error('');
            logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.error('💡 VPN TROUBLESHOOTING:');
            logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.error('If you are using a VPN (ProtonVPN, etc):');
            logger.error('');
            logger.error('1. Configure split tunneling to exclude Neon database:');
            logger.error('   sudo ./setup-vpn-split-tunnel.sh');
            logger.error('');
            logger.error('2. Or manually add routes (without VPN connected):');
            logger.error('   sudo ip route add 63.178.215.242 via 192.168.1.1');
            logger.error('   sudo ip route add 3.69.34.233 via 192.168.1.1');
            logger.error('   sudo ip route add 63.179.28.86 via 192.168.1.1');
            logger.error('');
            logger.error('3. Then reconnect VPN and test:');
            logger.error('   node test-db-connection.js');
            logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.error('');
          }

          throw lastError;
        }
      }
    }

    throw lastError;
  }

  async createTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        wallet_address VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      )`,

      `CREATE TABLE IF NOT EXISTS tracked_tokens (
        id SERIAL PRIMARY KEY,
        contract_address VARCHAR(255) NOT NULL,
        chain_name VARCHAR(255) NOT NULL DEFAULT 'ethereum',
        chain_id INTEGER NOT NULL DEFAULT 1,
        collection_slug VARCHAR(255),
        token_name VARCHAR(255),
        token_symbol VARCHAR(255),
        token_type VARCHAR(255),
        total_supply BIGINT,
        floor_price VARCHAR(255),
        added_by_user_id INTEGER,
        webhook_id VARCHAR(255),
        opensea_subscription_id VARCHAR(255),
        helius_webhook_id VARCHAR(255),
        marketplace VARCHAR(50) DEFAULT 'opensea',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        FOREIGN KEY (added_by_user_id) REFERENCES users (id),
        UNIQUE(contract_address, chain_name)
      )`,

      `CREATE TABLE IF NOT EXISTS user_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        chat_id VARCHAR(255) NOT NULL,
        notification_enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id) ON DELETE CASCADE,
        UNIQUE(user_id, token_id, chat_id)
      )`,

      `CREATE TABLE IF NOT EXISTS pending_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        expected_amount VARCHAR(255) NOT NULL,
        duration_hours INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        is_matched BOOLEAN DEFAULT false,
        matched_tx_hash VARCHAR(255),
        matched_at TIMESTAMP WITH TIME ZONE,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id)
      )`,

      `CREATE TABLE IF NOT EXISTS trending_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_id INTEGER NOT NULL,
        payment_amount VARCHAR(255) NOT NULL,
        transaction_hash VARCHAR(255) UNIQUE NOT NULL,
        payer_address VARCHAR(255) NOT NULL,
        trending_duration INTEGER NOT NULL,
        tier VARCHAR(50) DEFAULT 'normal',
        group_link TEXT,
        group_username VARCHAR(255),
        start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        is_active BOOLEAN DEFAULT true,
        is_validated BOOLEAN DEFAULT false,
        validation_timestamp TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (token_id) REFERENCES tracked_tokens (id),
        CHECK (tier IN ('normal', 'premium'))
      )`,

      `CREATE TABLE IF NOT EXISTS processed_transactions (
        id SERIAL PRIMARY KEY,
        transaction_hash VARCHAR(255) UNIQUE NOT NULL,
        contract_address VARCHAR(255) NOT NULL,
        payer_address VARCHAR(255) NOT NULL,
        amount VARCHAR(255) NOT NULL,
        block_number BIGINT,
        processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        purpose VARCHAR(255)
      )`,

      `CREATE TABLE IF NOT EXISTS nft_activities (
        id SERIAL PRIMARY KEY,
        contract_address VARCHAR(255) NOT NULL,
        token_id VARCHAR(255),
        activity_type VARCHAR(255) NOT NULL,
        from_address VARCHAR(255),
        to_address VARCHAR(255),
        transaction_hash VARCHAR(255),
        block_number BIGINT,
        price VARCHAR(255),
        marketplace VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS bitcoin_ordinals_activities (
        id SERIAL PRIMARY KEY,
        activity_id VARCHAR(255) UNIQUE NOT NULL,
        collection_symbol VARCHAR(255) NOT NULL,
        inscription_id VARCHAR(255),
        activity_type VARCHAR(255) NOT NULL,
        from_address VARCHAR(255),
        to_address VARCHAR(255),
        price DECIMAL,
        marketplace VARCHAR(50) DEFAULT 'magiceden',
        activity_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        notified BOOLEAN DEFAULT false,
        UNIQUE(activity_id, collection_symbol)
      )`,

      `CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        telegram_chat_id VARCHAR(255) UNIQUE NOT NULL,
        channel_title VARCHAR(255),
        added_by_user_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        show_trending BOOLEAN DEFAULT true,
        show_all_activities BOOLEAN DEFAULT false,
        trending_tier VARCHAR(50) DEFAULT 'normal',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        FOREIGN KEY (added_by_user_id) REFERENCES users (id),
        CHECK (trending_tier IN ('none', 'normal', 'premium', 'both'))
      )`,

      `CREATE TABLE IF NOT EXISTS group_contexts (
        id SERIAL PRIMARY KEY,
        group_chat_id VARCHAR(255) UNIQUE NOT NULL,
        group_title VARCHAR(255),
        setup_token VARCHAR(255) UNIQUE NOT NULL,
        created_by_user_id INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS webhook_logs (
        id SERIAL PRIMARY KEY,
        webhook_type VARCHAR(255) NOT NULL,
        payload TEXT NOT NULL,
        processed BOOLEAN DEFAULT false,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS image_fee_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        contract_address VARCHAR(255) NOT NULL,
        payment_amount VARCHAR(255) NOT NULL,
        transaction_hash VARCHAR(255) UNIQUE NOT NULL,
        payer_address VARCHAR(255) NOT NULL,
        start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        is_active BOOLEAN DEFAULT true,
        is_validated BOOLEAN DEFAULT false,
        validation_timestamp TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        duration_days INTEGER DEFAULT 30,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS footer_ads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        contract_address VARCHAR(255) NOT NULL,
        token_symbol VARCHAR(255) NOT NULL,
        ticker_symbol VARCHAR(255),
        custom_link VARCHAR(1000) NOT NULL,
        payment_amount VARCHAR(255) NOT NULL,
        transaction_hash VARCHAR(255) UNIQUE NOT NULL,
        payer_address VARCHAR(255) NOT NULL,
        start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        is_active BOOLEAN DEFAULT true,
        is_validated BOOLEAN DEFAULT false,
        validation_timestamp TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        duration_days INTEGER DEFAULT 30,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS bot_groups (
        id SERIAL PRIMARY KEY,
        group_chat_id VARCHAR(255) UNIQUE NOT NULL,
        group_title VARCHAR(255),
        group_type VARCHAR(50) NOT NULL DEFAULT 'group',
        bot_status VARCHAR(50) NOT NULL DEFAULT 'member',
        is_setup BOOLEAN DEFAULT false,
        first_added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`
    ];

    try {
      for (const table of tables) {
        await this.query(table);
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
      'CREATE INDEX IF NOT EXISTS idx_bitcoin_activities_activity_id ON bitcoin_ordinals_activities(activity_id)',
      'CREATE INDEX IF NOT EXISTS idx_bitcoin_activities_collection ON bitcoin_ordinals_activities(collection_symbol)',
      'CREATE INDEX IF NOT EXISTS idx_bitcoin_activities_timestamp ON bitcoin_ordinals_activities(activity_timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_channels_chat_id ON channels(telegram_chat_id)',
      'CREATE INDEX IF NOT EXISTS idx_image_fee_payments_active ON image_fee_payments(contract_address, is_active, end_time)',
      'CREATE INDEX IF NOT EXISTS idx_image_fee_payments_tx_hash ON image_fee_payments(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_footer_ads_active ON footer_ads(is_active, end_time)',
      'CREATE INDEX IF NOT EXISTS idx_footer_ads_tx_hash ON footer_ads(transaction_hash)',
      'CREATE INDEX IF NOT EXISTS idx_bot_groups_chat_id ON bot_groups(group_chat_id)',
      'CREATE INDEX IF NOT EXISTS idx_bot_groups_status ON bot_groups(bot_status, last_seen_at)',
      'CREATE INDEX IF NOT EXISTS idx_bot_groups_setup ON bot_groups(is_setup)'
    ];

    for (const index of indexes) {
      try {
        await this.query(index);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.warn('Failed to create index:', error.message);
        }
      }
    }
  }

  async migrateDatabase() {
    try {
      // PostgreSQL doesn't need the same migrations as SQLite since we're creating fresh schema
      // This method is kept for future migrations

      // Migration: Add last_activity_check column for Bitcoin Ordinals polling
      try {
        await this.query(`
          ALTER TABLE tracked_tokens
          ADD COLUMN IF NOT EXISTS last_activity_check TIMESTAMP WITH TIME ZONE
        `);
        logger.info('✅ Migration: Added last_activity_check column to tracked_tokens');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.warn('Migration warning for last_activity_check column:', error.message);
        }
      }

      // Migration: Fix chain_name for existing Bitcoin tokens
      try {
        const result = await this.query(`
          UPDATE tracked_tokens
          SET chain_name = 'bitcoin'
          WHERE marketplace = 'magiceden'
          AND (chain_name IS NULL OR chain_name = '' OR chain_name = 'ethereum')
          AND (contract_address NOT LIKE '0x%')
        `);
        if (result.rowCount > 0) {
          logger.info(`✅ Migration: Updated chain_name to 'bitcoin' for ${result.rowCount} Bitcoin Ordinals tokens`);
        }
      } catch (error) {
        logger.warn('Migration warning for Bitcoin chain_name fix:', error.message);
      }

      // Migration: Add tier column to trending_payments
      try {
        await this.query(`
          ALTER TABLE trending_payments
          ADD COLUMN IF NOT EXISTS tier VARCHAR(50) DEFAULT 'normal'
        `);
        logger.info('✅ Migration: Added tier column to trending_payments');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.warn('Migration warning for trending_payments tier column:', error.message);
        }
      }

      // Migration: Add trending_tier column to channels
      try {
        await this.query(`
          ALTER TABLE channels
          ADD COLUMN IF NOT EXISTS trending_tier VARCHAR(50) DEFAULT 'normal'
        `);
        logger.info('✅ Migration: Added trending_tier column to channels');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.warn('Migration warning for channels trending_tier column:', error.message);
        }
      }

      // Migration: Create index for tier queries
      try {
        await this.query(`
          CREATE INDEX IF NOT EXISTS idx_trending_payments_tier
          ON trending_payments(tier, is_active, end_time)
        `);
        logger.info('✅ Migration: Created index for trending_payments tier queries');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.warn('Migration warning for tier index:', error.message);
        }
      }

      // Migration: Update channels trending_tier constraint to include 'none'
      try {
        // Drop old constraint if exists
        await this.query(`
          ALTER TABLE channels
          DROP CONSTRAINT IF EXISTS channels_trending_tier_check
        `);
        // Add new constraint with 'none' included
        await this.query(`
          ALTER TABLE channels
          ADD CONSTRAINT channels_trending_tier_check
          CHECK (trending_tier IN ('none', 'normal', 'premium', 'both'))
        `);
        logger.info('✅ Migration: Updated channels trending_tier constraint to include none');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.warn('Migration warning for channels tier constraint:', error.message);
        }
      }

      // Migration: Add group link columns to trending_payments
      try {
        await this.query(`
          ALTER TABLE trending_payments
          ADD COLUMN IF NOT EXISTS group_link TEXT,
          ADD COLUMN IF NOT EXISTS group_username VARCHAR(255)
        `);
        logger.info('✅ Migration: Added group link columns to trending_payments');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          logger.warn('Migration warning for group link columns:', error.message);
        }
      }

      // Migration: Set 'none' tier channels to 'normal' to enable broadcasts
      try {
        const result = await this.query(`
          UPDATE channels
          SET trending_tier = 'normal'
          WHERE trending_tier = 'none'
        `);
        if (result.rowCount > 0) {
          logger.info(`✅ Migration: Set ${result.rowCount} channels from 'none' to 'normal' tier to enable trending broadcasts`);
        }
      } catch (error) {
        logger.warn('Migration warning for channel tier restore:', error.message);
      }

      // Migration: Convert 'both' tier to 'normal' to prevent duplicate broadcasts
      try {
        const result = await this.query(`
          UPDATE channels
          SET trending_tier = 'normal'
          WHERE trending_tier = 'both'
        `);
        if (result.rowCount > 0) {
          logger.info(`✅ Migration: Converted ${result.rowCount} channels from 'both' to 'normal' tier to prevent duplicate broadcasts`);
        }
      } catch (error) {
        logger.warn('Migration warning for both tier conversion:', error.message);
      }

      logger.info('Database migration completed');
    } catch (error) {
      logger.error('Error during database migration:', error);
      throw error;
    }
  }

  async query(text, params = []) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  async run(sql, params = []) {
    const result = await this.query(sql, params);
    return { id: result.rows[0]?.id, changes: result.rowCount };
  }

  async get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0];
  }

  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async createUser(telegramId, username, firstName) {
    const sql = `INSERT INTO users (telegram_id, username, first_name)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (telegram_id) DO UPDATE SET
                   username = EXCLUDED.username,
                   first_name = EXCLUDED.first_name,
                   updated_at = NOW()
                 RETURNING id`;
    const result = await this.query(sql, [telegramId, username, firstName]);
    return { id: result.rows[0]?.id || null };
  }

  async getUser(telegramId) {
    const sql = 'SELECT * FROM users WHERE telegram_id = $1';
    return await this.get(sql, [telegramId]);
  }

  async addTrackedToken(contractAddress, tokenData, addedByUserId, webhookId, collectionSlug = null, openSeaSubscriptionId = null, chainName = 'ethereum', chainId = 1, heliusWebhookId = null, marketplace = 'opensea') {
    const sql = `INSERT INTO tracked_tokens
                 (contract_address, chain_name, chain_id, collection_slug, token_name, token_symbol, token_type, total_supply,
                  added_by_user_id, webhook_id, opensea_subscription_id, helius_webhook_id, marketplace, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
                 ON CONFLICT (contract_address, chain_name)
                 DO UPDATE SET
                   collection_slug = EXCLUDED.collection_slug,
                   token_name = EXCLUDED.token_name,
                   token_symbol = EXCLUDED.token_symbol,
                   token_type = EXCLUDED.token_type,
                   total_supply = EXCLUDED.total_supply,
                   webhook_id = EXCLUDED.webhook_id,
                   opensea_subscription_id = EXCLUDED.opensea_subscription_id,
                   helius_webhook_id = EXCLUDED.helius_webhook_id,
                   marketplace = EXCLUDED.marketplace,
                   updated_at = NOW()
                 RETURNING id`;
    const result = await this.query(sql, [
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
      openSeaSubscriptionId,
      heliusWebhookId,
      marketplace
    ]);
    return { id: result.rows[0]?.id };
  }

  async getTrackedToken(contractAddress, chainName = null) {
    if (chainName) {
      const sql = 'SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER($1) AND chain_name = $2';
      return await this.get(sql, [contractAddress, chainName]);
    } else {
      const sql = 'SELECT * FROM tracked_tokens WHERE LOWER(contract_address) = LOWER($1)';
      return await this.get(sql, [contractAddress]);
    }
  }

  async getTrackedTokenByCollectionSlug(collectionSlug) {
    const sql = 'SELECT * FROM tracked_tokens WHERE collection_slug = $1 AND is_active = true';
    return await this.get(sql, [collectionSlug]);
  }

  async getTokensForCollectionSlug(collectionSlug) {
    // Return tokens that are either active OR have premium features
    const sql = `
      SELECT DISTINCT tt.*
      FROM tracked_tokens tt
      WHERE tt.collection_slug = $1
      AND (
        tt.is_active = true
        OR EXISTS (
          SELECT 1 FROM trending_payments tp
          WHERE tp.token_id = tt.id AND tp.is_active = true AND tp.end_time > NOW()
        )
        OR EXISTS (
          SELECT 1 FROM image_fee_payments ifp
          WHERE LOWER(ifp.contract_address) = LOWER(tt.contract_address)
          AND ifp.is_active = true AND ifp.end_time > NOW()
        )
        OR EXISTS (
          SELECT 1 FROM footer_ads fa
          WHERE LOWER(fa.contract_address) = LOWER(tt.contract_address)
          AND fa.is_active = true AND fa.end_time > NOW()
        )
      )
    `;
    return await this.all(sql, [collectionSlug]);
  }

  async getAllTrackedTokens() {
    const sql = 'SELECT * FROM tracked_tokens WHERE is_active = true ORDER BY created_at DESC';
    return await this.all(sql);
  }

  async getUserTrackedTokens(userId, chatId, chainName = null) {
    let sql = `SELECT tt.*, us.notification_enabled
               FROM tracked_tokens tt
               JOIN user_subscriptions us ON tt.id = us.token_id
               WHERE us.user_id = $1 AND us.chat_id = $2 AND tt.is_active = true AND (us.notification_enabled = true OR us.notification_enabled IS NULL)`;

    const params = [userId, chatId];

    if (chainName) {
      sql += ` AND tt.chain_name = $3`;
      params.push(chainName);
    }

    sql += ` ORDER BY tt.created_at DESC`;
    return await this.all(sql, params);
  }

  async getGroupTrackedTokens(chatId, chainName = null) {
    let sql = `SELECT DISTINCT ON (tt.id) tt.*, true as notification_enabled
               FROM tracked_tokens tt
               JOIN user_subscriptions us ON tt.id = us.token_id
               WHERE us.chat_id = $1 AND tt.is_active = true`;

    const params = [chatId];

    if (chainName) {
      sql += ` AND tt.chain_name = $2`;
      params.push(chainName);
    }

    sql += ` ORDER BY tt.id, tt.created_at DESC`;
    return await this.all(sql, params);
  }

  async getUserTrackedTokensByChain(userId, chatId, chainName) {
    return await this.getUserTrackedTokens(userId, chatId, chainName);
  }

  async getAllUserSubscriptions(userId) {
    const sql = `SELECT tt.*, us.notification_enabled, us.created_at as subscription_date
                 FROM tracked_tokens tt
                 JOIN user_subscriptions us ON tt.id = us.token_id
                 WHERE us.user_id = $1
                 ORDER BY us.created_at DESC`;
    return await this.all(sql, [userId]);
  }

  /**
   * Get user's tracked tokens across ALL contexts with context info
   * Used for DM view to show all tokens (private + all groups)
   */
  async getUserTrackedTokensWithContext(userId) {
    const sql = `SELECT tt.*, us.notification_enabled, us.chat_id
                 FROM tracked_tokens tt
                 JOIN user_subscriptions us ON tt.id = us.token_id
                 WHERE us.user_id = $1 AND tt.is_active = true
                 ORDER BY us.chat_id, tt.created_at DESC`;
    return await this.all(sql, [userId]);
  }

  /**
   * Get unique group contexts where user has tracked tokens
   * Returns distinct chat_ids (excluding user's private chat)
   * Used for context selection menu
   */
  async getUserGroupContexts(userId, userTelegramId) {
    const sql = `SELECT DISTINCT us.chat_id
                 FROM user_subscriptions us
                 WHERE us.user_id = $1 AND us.chat_id != $2
                 ORDER BY us.chat_id`;
    return await this.all(sql, [userId, userTelegramId]);
  }

  async subscribeUserToToken(userId, tokenId, chatId) {
    const sql = `INSERT INTO user_subscriptions (user_id, token_id, chat_id, notification_enabled)
                 VALUES ($1, $2, $3, true)
                 ON CONFLICT (user_id, token_id, chat_id) DO NOTHING
                 RETURNING id`;
    const result = await this.query(sql, [userId, tokenId, chatId]);
    return { id: result.rows[0]?.id };
  }

  async unsubscribeUserFromToken(userId, tokenId, chatId) {
    const sql = 'DELETE FROM user_subscriptions WHERE user_id = $1 AND token_id = $2 AND chat_id = $3';
    const result = await this.query(sql, [userId, tokenId, chatId]);
    return { changes: result.rowCount };
  }

  async unsubscribeUserFromAllChats(userId, tokenId) {
    const sql = 'DELETE FROM user_subscriptions WHERE user_id = $1 AND token_id = $2';
    const result = await this.query(sql, [userId, tokenId]);
    return { changes: result.rowCount };
  }

  // Database consistency checks
  async checkDatabaseConsistency() {
    const issues = [];
    const logger = require('../services/logger');

    try {
      logger.info('🔍 Starting database consistency check...');

      // 1. Check for orphaned user subscriptions (pointing to non-existent tokens)
      const orphanedSubscriptions = await this.query(`
        SELECT us.id, us.user_id, us.token_id, us.chat_id, u.telegram_id
        FROM user_subscriptions us
        JOIN users u ON us.user_id = u.id
        LEFT JOIN tracked_tokens tt ON us.token_id = tt.id
        WHERE tt.id IS NULL
      `);

      if (orphanedSubscriptions.rows.length > 0) {
        issues.push({
          type: 'orphaned_subscriptions',
          count: orphanedSubscriptions.rows.length,
          description: 'User subscriptions pointing to non-existent tokens',
          records: orphanedSubscriptions.rows
        });
      }

      // 2. Check for orphaned tokens (inactive tokens without premium features that should be deleted)
      const orphanedTokens = await this.query(`
        SELECT tt.id, tt.contract_address, tt.token_name, tt.is_active,
               (SELECT COUNT(*) FROM user_subscriptions us WHERE us.token_id = tt.id) as subscription_count,
               (
                 SELECT COUNT(*)
                 FROM trending_payments tp
                 WHERE tp.token_id = tt.id AND tp.is_active = true AND tp.end_time > NOW()
               ) +
               (
                 SELECT COUNT(*)
                 FROM image_fee_payments ifp
                 WHERE LOWER(ifp.contract_address) = LOWER(tt.contract_address)
                 AND ifp.is_active = true AND ifp.end_time > NOW()
               ) +
               (
                 SELECT COUNT(*)
                 FROM footer_ads fa
                 WHERE LOWER(fa.contract_address) = LOWER(tt.contract_address)
                 AND fa.is_active = true AND fa.end_time > NOW()
               ) as premium_count
        FROM tracked_tokens tt
        WHERE tt.is_active = false AND (
          SELECT COUNT(*)
          FROM trending_payments tp
          WHERE tp.token_id = tt.id AND tp.is_active = true AND tp.end_time > NOW()
        ) = 0 AND (
          SELECT COUNT(*)
          FROM image_fee_payments ifp
          WHERE LOWER(ifp.contract_address) = LOWER(tt.contract_address)
          AND ifp.is_active = true AND ifp.end_time > NOW()
        ) = 0 AND (
          SELECT COUNT(*)
          FROM footer_ads fa
          WHERE LOWER(fa.contract_address) = LOWER(tt.contract_address)
          AND fa.is_active = true AND fa.end_time > NOW()
        ) = 0
      `);

      if (orphanedTokens.rows.length > 0) {
        issues.push({
          type: 'orphaned_tokens',
          count: orphanedTokens.rows.length,
          description: 'Inactive tokens without premium features that should be deleted',
          records: orphanedTokens.rows
        });
      }

      // 3. Check for inconsistent token states (active tokens with no subscriptions and no premium features)
      const inconsistentTokens = await this.query(`
        SELECT tt.id, tt.contract_address, tt.token_name, tt.is_active,
               (SELECT COUNT(*) FROM user_subscriptions us WHERE us.token_id = tt.id) as subscription_count,
               (
                 SELECT COUNT(*)
                 FROM trending_payments tp
                 WHERE tp.token_id = tt.id AND tp.is_active = true AND tp.end_time > NOW()
               ) +
               (
                 SELECT COUNT(*)
                 FROM image_fee_payments ifp
                 WHERE LOWER(ifp.contract_address) = LOWER(tt.contract_address)
                 AND ifp.is_active = true AND ifp.end_time > NOW()
               ) +
               (
                 SELECT COUNT(*)
                 FROM footer_ads fa
                 WHERE LOWER(fa.contract_address) = LOWER(tt.contract_address)
                 AND fa.is_active = true AND fa.end_time > NOW()
               ) as premium_count
        FROM tracked_tokens tt
        WHERE tt.is_active = true AND (
          SELECT COUNT(*) FROM user_subscriptions us WHERE us.token_id = tt.id
        ) = 0 AND (
          SELECT COUNT(*)
          FROM trending_payments tp
          WHERE tp.token_id = tt.id AND tp.is_active = true AND tp.end_time > NOW()
        ) = 0 AND (
          SELECT COUNT(*)
          FROM image_fee_payments ifp
          WHERE LOWER(ifp.contract_address) = LOWER(tt.contract_address)
          AND ifp.is_active = true AND ifp.end_time > NOW()
        ) = 0 AND (
          SELECT COUNT(*)
          FROM footer_ads fa
          WHERE LOWER(fa.contract_address) = LOWER(tt.contract_address)
          AND fa.is_active = true AND fa.end_time > NOW()
        ) = 0
      `);

      if (inconsistentTokens.rows.length > 0) {
        issues.push({
          type: 'inconsistent_active_tokens',
          count: inconsistentTokens.rows.length,
          description: 'Active tokens with no subscriptions and no premium features',
          records: inconsistentTokens.rows
        });
      }

      // 4. Check for duplicate tokens (same contract address on same chain)
      const duplicateTokens = await this.query(`
        SELECT LOWER(contract_address) as contract_address, chain_name, COUNT(*) as count
        FROM tracked_tokens
        GROUP BY LOWER(contract_address), chain_name
        HAVING COUNT(*) > 1
      `);

      if (duplicateTokens.rows.length > 0) {
        issues.push({
          type: 'duplicate_tokens',
          count: duplicateTokens.rows.length,
          description: 'Duplicate tokens with same contract address on same chain',
          records: duplicateTokens.rows
        });
      }

      logger.info(`✅ Database consistency check completed. Found ${issues.length} issue types.`);
      return {
        isConsistent: issues.length === 0,
        totalIssues: issues.length,
        issues: issues
      };

    } catch (error) {
      logger.error('❌ Error during database consistency check:', error);
      return {
        isConsistent: false,
        error: error.message,
        issues: []
      };
    }
  }

  async fixOrphanedSubscriptions() {
    const logger = require('../services/logger');
    try {
      const result = await this.query(`
        DELETE FROM user_subscriptions
        WHERE token_id NOT IN (SELECT id FROM tracked_tokens)
      `);
      logger.info(`🔧 Fixed ${result.rowCount} orphaned subscriptions`);
      return { fixed: result.rowCount };
    } catch (error) {
      logger.error('❌ Error fixing orphaned subscriptions:', error);
      throw error;
    }
  }

  async fixOrphanedTokens() {
    const logger = require('../services/logger');
    try {
      const result = await this.query(`
        DELETE FROM tracked_tokens
        WHERE is_active = false AND id NOT IN (
          SELECT DISTINCT tp.token_id
          FROM trending_payments tp
          WHERE tp.is_active = true AND tp.end_time > NOW()
        ) AND contract_address NOT IN (
          SELECT DISTINCT contract_address
          FROM image_fee_payments
          WHERE is_active = true AND end_time > NOW()
        ) AND contract_address NOT IN (
          SELECT DISTINCT contract_address
          FROM footer_ads
          WHERE is_active = true AND end_time > NOW()
        )
      `);
      logger.info(`🔧 Fixed ${result.rowCount} orphaned tokens`);
      return { fixed: result.rowCount };
    } catch (error) {
      logger.error('❌ Error fixing orphaned tokens:', error);
      throw error;
    }
  }

  async hasAnyActiveSubscriptions(tokenId) {
    const sql = `SELECT COUNT(*) as count
                 FROM user_subscriptions us
                 JOIN users u ON us.user_id = u.id
                 WHERE us.token_id = $1 AND u.is_active = true`;
    const result = await this.get(sql, [tokenId]);
    return result && result.count > 0;
  }

  // Generic helper for checking active features by contract address
  async _hasActiveFeature(tableName, contractAddress, useJoin = false) {
    let sql;
    if (useJoin) {
      // For tables that need to join with tracked_tokens (e.g., trending_payments)
      sql = `
        SELECT COUNT(*) as count
        FROM ${tableName} feature
        JOIN tracked_tokens tt ON feature.token_id = tt.id
        WHERE LOWER(tt.contract_address) = LOWER($1)
        AND feature.is_active = true AND feature.end_time > NOW()
      `;
    } else {
      // For tables that have contract_address directly
      sql = `
        SELECT COUNT(*) as count
        FROM ${tableName}
        WHERE LOWER(contract_address) = LOWER($1)
        AND is_active = true AND end_time > NOW()
      `;
    }
    const result = await this.get(sql, [contractAddress]);
    return result && result.count > 0;
  }

  async hasActivePremiumFeatures(contractAddress) {
    // Check all premium features in parallel for efficiency
    const [hasTrending, hasImage, hasFooter] = await Promise.all([
      this._hasActiveFeature('trending_payments', contractAddress, true),
      this._hasActiveFeature('image_fee_payments', contractAddress, false),
      this._hasActiveFeature('footer_ads', contractAddress, false)
    ]);

    return hasTrending || hasImage || hasFooter;
  }

  async createPendingPayment(userId, tokenId, expectedAmount, durationHours, chain = 'ethereum') {
    const expiresAt = new Date(Date.now() + (30 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO pending_payments
                 (user_id, token_id, expected_amount, duration_hours, expires_at, chain_name)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`;
    const result = await this.query(sql, [userId, tokenId, expectedAmount, durationHours, expiresAt, chain]);
    return { id: result.rows[0]?.id };
  }

  async getPendingPayment(userId, tokenId, amount) {
    const sql = `SELECT * FROM pending_payments
                 WHERE user_id = $1 AND token_id = $2 AND expected_amount = $3
                 AND is_matched = false AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`;
    return await this.get(sql, [userId, tokenId, amount]);
  }

  async markPendingPaymentMatched(pendingPaymentId, txHash) {
    const sql = `UPDATE pending_payments
                 SET is_matched = true, matched_tx_hash = $1, matched_at = NOW()
                 WHERE id = $2`;
    const result = await this.query(sql, [txHash, pendingPaymentId]);
    return { changes: result.rowCount };
  }

  async cleanupExpiredPendingPayments() {
    const sql = `DELETE FROM pending_payments WHERE expires_at <= NOW()`;
    const result = await this.query(sql);
    return { changes: result.rowCount };
  }

  async getUserPendingPayments(userId) {
    const sql = `SELECT pp.*, tt.token_name, tt.contract_address
                 FROM pending_payments pp
                 JOIN tracked_tokens tt ON pp.token_id = tt.id
                 WHERE pp.user_id = $1 AND pp.is_matched = false AND pp.expires_at > NOW()
                 ORDER BY pp.created_at DESC`;
    return await this.all(sql, [userId]);
  }

  async addTrendingPayment(userId, tokenId, paymentAmount, transactionHash, durationHours, payerAddress = null, tier = 'normal', groupLink = null, groupUsername = null) {
    const endTime = new Date(Date.now() + (durationHours * 60 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO trending_payments
                 (user_id, token_id, payment_amount, transaction_hash, payer_address, trending_duration, tier, group_link, group_username, end_time, is_validated, validation_timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW())
                 RETURNING id`;
    const result = await this.query(sql, [userId, tokenId, paymentAmount, transactionHash, payerAddress, durationHours, tier, groupLink, groupUsername, endTime]);
    return { id: result.rows[0]?.id };
  }

  async isTransactionProcessed(transactionHash) {
    const sql = 'SELECT id FROM processed_transactions WHERE transaction_hash = $1';
    const result = await this.get(sql, [transactionHash]);
    return !!result;
  }

  async markTransactionProcessed(transactionHash, contractAddress, payerAddress, amount, blockNumber, purpose = 'trending_payment') {
    const sql = `INSERT INTO processed_transactions
                 (transaction_hash, contract_address, payer_address, amount, block_number, purpose)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (transaction_hash) DO NOTHING
                 RETURNING id`;
    const result = await this.query(sql, [transactionHash, contractAddress, payerAddress, amount, blockNumber, purpose]);
    return { id: result.rows[0]?.id };
  }

  async validateTrendingPayment(trendingPaymentId, transactionHash) {
    const sql = `UPDATE trending_payments
                 SET is_validated = true, validation_timestamp = NOW()
                 WHERE id = $1 AND transaction_hash = $2`;
    const result = await this.query(sql, [trendingPaymentId, transactionHash]);
    return { changes: result.rowCount };
  }

  async getTrendingTokens() {
    const sql = `SELECT tt.*, tp.end_time as trending_end_time, tp.payment_amount
                 FROM tracked_tokens tt
                 JOIN trending_payments tp ON tt.id = tp.token_id
                 WHERE tp.is_active = true AND tp.end_time > NOW()
                 ORDER BY tp.payment_amount DESC, tp.start_time DESC`;
    return await this.all(sql);
  }

  async getTrendingTokensByTier(tier = null) {
    let sql = `SELECT tt.*, tp.end_time as trending_end_time, tp.payment_amount, tp.tier
               FROM tracked_tokens tt
               JOIN trending_payments tp ON tt.id = tp.token_id
               WHERE tp.is_active = true AND tp.end_time > NOW()`;

    const params = [];
    if (tier && tier !== 'both') {
      sql += ` AND tp.tier = $1`;
      params.push(tier);
    }

    sql += ` ORDER BY tp.payment_amount DESC, tp.start_time DESC`;
    return await this.all(sql, params);
  }

  async getTokenTrendingTier(contractAddress) {
    const sql = `SELECT tp.tier, tp.end_time
                 FROM trending_payments tp
                 JOIN tracked_tokens tt ON tt.id = tp.token_id
                 WHERE LOWER(tt.contract_address) = LOWER($1)
                 AND tp.is_active = true AND tp.end_time > NOW()
                 ORDER BY tp.created_at DESC LIMIT 1`;
    return await this.get(sql, [contractAddress]);
  }

  async getTrendingPaymentForToken(contractAddress) {
    const sql = `SELECT tp.*, tt.token_symbol
                 FROM trending_payments tp
                 JOIN tracked_tokens tt ON tt.id = tp.token_id
                 WHERE LOWER(tt.contract_address) = LOWER($1)
                 AND tp.is_active = true AND tp.end_time > NOW()
                 ORDER BY tp.created_at DESC LIMIT 1`;
    return await this.get(sql, [contractAddress]);
  }

  // Generic helper method for expiring premium features
  async _expireFeature(tableName) {
    const sql = `UPDATE ${tableName}
                 SET is_active = false
                 WHERE is_active = true AND end_time <= NOW()`;
    const result = await this.query(sql);
    return { changes: result.rowCount };
  }

  async expireTrendingPayments() {
    return await this._expireFeature('trending_payments');
  }

  async logNFTActivity(activityData) {
    const sql = `INSERT INTO nft_activities
                 (contract_address, token_id, activity_type, from_address, to_address,
                  transaction_hash, block_number, price, marketplace)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id`;
    const result = await this.query(sql, [
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
    return { id: result.rows[0]?.id };
  }

  async addChannel(telegramChatId, channelTitle, addedByUserId) {
    const sql = `INSERT INTO channels
                 (telegram_chat_id, channel_title, added_by_user_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (telegram_chat_id) DO NOTHING
                 RETURNING id`;
    const result = await this.query(sql, [telegramChatId, channelTitle, addedByUserId]);
    return { id: result.rows[0]?.id };
  }

  async getActiveChannels() {
    const sql = 'SELECT * FROM channels WHERE is_active = true';
    return await this.all(sql);
  }

  async getChannelsByUser(userId) {
    const sql = `SELECT * FROM channels
                 WHERE added_by_user_id = $1 AND is_active = true
                 ORDER BY created_at DESC`;
    return await this.all(sql, [userId]);
  }

  async logWebhook(webhookType, payload, processed = false, errorMessage = null) {
    const sql = `INSERT INTO webhook_logs (webhook_type, payload, processed, error_message)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`;
    const result = await this.query(sql, [webhookType, JSON.stringify(payload), processed, errorMessage]);
    return { id: result.rows[0]?.id };
  }

  async addImageFeePayment(userId, contractAddress, paymentAmount, transactionHash, payerAddress, durationDays = 30) {
    const endTime = new Date(Date.now() + (durationDays * 24 * 60 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO image_fee_payments
                 (user_id, contract_address, payment_amount, transaction_hash, payer_address, end_time, duration_days, is_validated, validation_timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
                 RETURNING id`;
    const result = await this.query(sql, [userId, contractAddress, paymentAmount, transactionHash, payerAddress, endTime, durationDays]);
    return { id: result.rows[0]?.id };
  }

  // Generic helper for retrieving active feature by contract address
  async _getActiveFeature(tableName, contractAddress) {
    const sql = `SELECT * FROM ${tableName}
                 WHERE LOWER(contract_address) = LOWER($1)
                 AND is_active = true AND end_time > NOW()
                 ORDER BY created_at DESC LIMIT 1`;
    return await this.get(sql, [contractAddress]);
  }

  async isImageFeeActive(contractAddress) {
    const result = await this._getActiveFeature('image_fee_payments', contractAddress);
    return !!result;
  }

  async getImageFeePayment(contractAddress) {
    return await this._getActiveFeature('image_fee_payments', contractAddress);
  }

  async expireImageFeePayments() {
    return await this._expireFeature('image_fee_payments');
  }

  async addFooterAd(userId, contractAddress, tokenSymbol, customLink, paymentAmount, transactionHash, payerAddress, durationDays = 30, tickerSymbol = null) {
    const endTime = new Date(Date.now() + (durationDays * 24 * 60 * 60 * 1000)).toISOString();
    const sql = `INSERT INTO footer_ads
                 (user_id, contract_address, token_symbol, ticker_symbol, custom_link, payment_amount, transaction_hash, payer_address, end_time, duration_days, is_validated, validation_timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW())
                 RETURNING id`;
    const result = await this.query(sql, [userId, contractAddress, tokenSymbol, tickerSymbol || tokenSymbol, customLink, paymentAmount, transactionHash, payerAddress, endTime, durationDays]);
    return { id: result.rows[0]?.id };
  }

  async getActiveFooterAds() {
    const sql = `SELECT COALESCE(ticker_symbol, token_symbol) as ticker_symbol, custom_link FROM footer_ads
                 WHERE is_active = true AND end_time > NOW()
                 ORDER BY created_at ASC
                 LIMIT 3`;
    return await this.all(sql);
  }

  async getFooterAd(contractAddress) {
    return await this._getActiveFeature('footer_ads', contractAddress);
  }

  async getUserFooterAds(userId) {
    const sql = `SELECT * FROM footer_ads
                 WHERE user_id = $1
                 AND is_active = true AND end_time > NOW()
                 ORDER BY created_at DESC`;
    return await this.all(sql, [userId]);
  }

  async expireFooterAds() {
    return await this._expireFeature('footer_ads');
  }

  async cleanupOrphanedTokens() {
    try {
      logger.info('🧹 Starting cleanup of orphaned inactive tokens...');

      // Find inactive tokens without premium features or active subscriptions
      const orphanedTokens = await this.all(`
        SELECT tt.id, tt.contract_address, tt.token_name, tt.collection_slug
        FROM tracked_tokens tt
        WHERE tt.is_active = false
          AND NOT EXISTS (
            SELECT 1 FROM user_subscriptions us
            JOIN users u ON us.user_id = u.id
            WHERE us.token_id = tt.id AND u.is_active = true
          )
          AND NOT EXISTS (
            SELECT 1 FROM trending_payments tp
            WHERE tp.token_id = tt.id
              AND tp.is_active = true AND tp.end_time > NOW()
          )
          AND NOT EXISTS (
            SELECT 1 FROM footer_ads fa
            WHERE LOWER(fa.contract_address) = LOWER(tt.contract_address)
              AND fa.is_active = true AND fa.end_time > NOW()
          )
      `);

      logger.info(`Found ${orphanedTokens.length} orphaned inactive tokens to cleanup`);

      if (orphanedTokens.length === 0) {
        logger.info('✅ No orphaned tokens found - database is clean');
        return { cleaned: 0, tokens: [] };
      }

      // Delete orphaned tokens
      const cleanedTokens = [];
      for (const token of orphanedTokens) {
        logger.info(`🗑️ Deleting orphaned token: ${token.contract_address} (${token.token_name})`);

        // Delete any remaining subscriptions (should be none, but cleanup)
        await this.run('DELETE FROM user_subscriptions WHERE token_id = $1', [token.id]);

        // Delete the token record
        await this.run('DELETE FROM tracked_tokens WHERE id = $1', [token.id]);

        cleanedTokens.push({
          contract_address: token.contract_address,
          token_name: token.token_name,
          collection_slug: token.collection_slug
        });
      }

      logger.info(`✅ Cleaned up ${cleanedTokens.length} orphaned tokens`);
      return { cleaned: cleanedTokens.length, tokens: cleanedTokens };

    } catch (error) {
      logger.error('❌ Error during orphaned token cleanup:', error);
      throw error;
    }
  }

  // ============================================================================
  // GROUP CONTEXT MANAGEMENT
  // ============================================================================

  /**
   * Create or update group context for deep link setup
   * @param {string} groupChatId - Group chat ID
   * @param {string} groupTitle - Group title/name
   * @param {string} setupToken - Unique setup token for deep link
   * @param {number} createdByUserId - User ID who created the setup
   * @returns {Object} Created group context record
   */
  async createGroupContext(groupChatId, groupTitle, setupToken, createdByUserId) {
    const sql = `INSERT INTO group_contexts
      (group_chat_id, group_title, setup_token, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (group_chat_id) DO UPDATE SET
        setup_token = EXCLUDED.setup_token,
        group_title = EXCLUDED.group_title,
        created_at = NOW()
      RETURNING id`;
    const result = await this.query(sql, [groupChatId, groupTitle, setupToken, createdByUserId]);
    return result.rows[0];
  }

  /**
   * Get group context by setup token
   * @param {string} setupToken - Setup token from deep link
   * @returns {Object|null} Group context or null
   */
  async getGroupContextByToken(setupToken) {
    const sql = `SELECT * FROM group_contexts WHERE setup_token = $1`;
    const result = await this.query(sql, [setupToken]);
    return result.rows[0] || null;
  }

  /**
   * Get all available group contexts where the bot has been set up
   * Returns all groups from group_contexts table
   */
  async getAllAvailableGroupContexts() {
    const sql = `SELECT group_chat_id, group_title FROM group_contexts ORDER BY group_title`;
    return await this.all(sql);
  }

  /**
   * Upsert a bot group (insert or update)
   * Tracks all groups where the bot is a member
   */
  async upsertBotGroup(groupChatId, groupTitle, botStatus, groupType = 'group') {
    const sql = `
      INSERT INTO bot_groups (group_chat_id, group_title, group_type, bot_status, first_added_at, last_seen_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
      ON CONFLICT (group_chat_id)
      DO UPDATE SET
        group_title = EXCLUDED.group_title,
        bot_status = EXCLUDED.bot_status,
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `;
    return await this.get(sql, [groupChatId, groupTitle, groupType, botStatus]);
  }

  /**
   * Update last_seen timestamp for a group (called on any bot activity in group)
   */
  async touchBotGroup(groupChatId, groupTitle = null) {
    const sql = groupTitle
      ? `UPDATE bot_groups SET last_seen_at = NOW(), group_title = $2, updated_at = NOW() WHERE group_chat_id = $1 RETURNING *`
      : `UPDATE bot_groups SET last_seen_at = NOW(), updated_at = NOW() WHERE group_chat_id = $1 RETURNING *`;

    const params = groupTitle ? [groupChatId, groupTitle] : [groupChatId];
    return await this.get(sql, params);
  }

  /**
   * Mark a group as "set up" (when /startminty is run or token is added)
   */
  async markGroupAsSetup(groupChatId) {
    const sql = `UPDATE bot_groups SET is_setup = true, updated_at = NOW() WHERE group_chat_id = $1 RETURNING *`;
    return await this.get(sql, [groupChatId]);
  }

  /**
   * Get all groups where bot is member/admin (not removed)
   * Combines bot_groups and group_contexts for comprehensive list
   */
  async getAvailableBotGroups() {
    const sql = `
      SELECT
        COALESCE(bg.group_chat_id, gc.group_chat_id) as group_chat_id,
        COALESCE(bg.group_title, gc.group_title) as group_title,
        COALESCE(bg.is_setup, false) as is_setup,
        bg.group_type,
        bg.bot_status,
        bg.last_seen_at,
        gc.setup_token
      FROM bot_groups bg
      FULL OUTER JOIN group_contexts gc ON bg.group_chat_id = gc.group_chat_id
      WHERE (bg.bot_status IN ('member', 'administrator') OR bg.bot_status IS NULL)
        AND (bg.group_type IS NULL OR bg.group_type IN ('group', 'supergroup'))
      ORDER BY bg.last_seen_at DESC NULLS LAST, COALESCE(bg.group_title, gc.group_title) ASC
    `;
    return await this.all(sql);
  }

  // ============================================================================
  // CONTEXT-AWARE TOKEN QUERIES
  // ============================================================================

  async close() {
    try {
      if (this.pool) {
        await this.pool.end();
        logger.info('PostgreSQL connection pool closed');
      }
    } catch (error) {
      logger.error('Error closing PostgreSQL pool:', error);
    }
  }
}

module.exports = Database;