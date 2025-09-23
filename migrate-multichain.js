require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const logger = require('./src/services/logger');

async function migrateToMultichain() {
  const dbPath = process.env.DATABASE_PATH || './database.sqlite';

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        reject(err);
        return;
      }

      console.log('🔄 Starting multichain migration...');

      try {
        // Add chain support to tracked_tokens
        await runQuery(db, `
          ALTER TABLE tracked_tokens
          ADD COLUMN blockchain_network TEXT DEFAULT 'ethereum'
        `);
        console.log('✅ Added blockchain_network column');

        await runQuery(db, `
          ALTER TABLE tracked_tokens
          ADD COLUMN chain_id INTEGER DEFAULT 1
        `);
        console.log('✅ Added chain_id column');

        // Create user chain preferences table
        await runQuery(db, `
          CREATE TABLE IF NOT EXISTS user_chain_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            selected_chain TEXT DEFAULT 'ethereum',
            selected_chain_id INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id)
          )
        `);
        console.log('✅ Created user_chain_preferences table');

        // Create chain configurations table
        await runQuery(db, `
          CREATE TABLE IF NOT EXISTS chain_configurations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chain_name TEXT UNIQUE NOT NULL,
            chain_id INTEGER UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            currency_symbol TEXT NOT NULL,
            is_testnet BOOLEAN DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            alchemy_network TEXT,
            opensea_supported BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Created chain_configurations table');

        // Insert default chain configurations
        const chainConfigs = [
          { name: 'ethereum', id: 1, display: 'Ethereum', symbol: 'ETH', testnet: 0, alchemy: 'eth-mainnet' },
          { name: 'polygon', id: 137, display: 'Polygon', symbol: 'MATIC', testnet: 0, alchemy: 'polygon-mainnet' },
          { name: 'arbitrum', id: 42161, display: 'Arbitrum', symbol: 'ETH', testnet: 0, alchemy: 'arb-mainnet' },
          { name: 'optimism', id: 10, display: 'Optimism', symbol: 'ETH', testnet: 0, alchemy: 'opt-mainnet' },
          { name: 'base', id: 8453, display: 'Base', symbol: 'ETH', testnet: 0, alchemy: 'base-mainnet' },
          { name: 'sepolia', id: 11155111, display: 'Sepolia (Testnet)', symbol: 'ETH', testnet: 1, alchemy: 'eth-sepolia' }
        ];

        for (const config of chainConfigs) {
          await runQuery(db, `
            INSERT OR IGNORE INTO chain_configurations
            (chain_name, chain_id, display_name, currency_symbol, is_testnet, alchemy_network)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [config.name, config.id, config.display, config.symbol, config.testnet, config.alchemy]);
        }
        console.log(`✅ Inserted ${chainConfigs.length} chain configurations`);

        // Create new indexes for multichain support
        await runQuery(db, `
          CREATE INDEX IF NOT EXISTS idx_tracked_tokens_chain
          ON tracked_tokens(blockchain_network, chain_id)
        `);

        await runQuery(db, `
          CREATE INDEX IF NOT EXISTS idx_user_chain_prefs_user
          ON user_chain_preferences(user_id)
        `);

        await runQuery(db, `
          CREATE INDEX IF NOT EXISTS idx_chain_configs_active
          ON chain_configurations(is_active, is_testnet)
        `);

        console.log('✅ Created multichain indexes');

        // Drop and recreate the unique constraint for tracked_tokens to include chain
        console.log('⚠️ Note: Unique constraint for tracked_tokens will be updated on next app start');

        console.log('🌐 Multichain migration completed successfully!');

        db.close();
        resolve();
      } catch (error) {
        if (error.message.includes('duplicate column name')) {
          console.log('⚠️ Columns already exist, migration not needed');
          db.close();
          resolve();
        } else {
          console.error('❌ Migration error:', error.message);
          db.close();
          reject(error);
        }
      }
    });
  });
}

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateToMultichain()
    .then(() => {
      console.log('Multichain migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Multichain migration failed:', error);
      process.exit(1);
    });
}

module.exports = migrateToMultichain;