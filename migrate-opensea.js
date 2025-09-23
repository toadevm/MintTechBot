require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const logger = require('./src/services/logger');

async function migrateDatabase() {
  const dbPath = process.env.DATABASE_PATH || './database.sqlite';

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, async (err) => {
      if (err) {
        reject(err);
        return;
      }

      console.log('🔄 Starting OpenSea migration...');

      try {
        // Add collection_slug and opensea_subscription_id columns to tracked_tokens
        await runQuery(db, `
          ALTER TABLE tracked_tokens
          ADD COLUMN collection_slug TEXT
        `);
        console.log('✅ Added collection_slug column');

        await runQuery(db, `
          ALTER TABLE tracked_tokens
          ADD COLUMN opensea_subscription_id TEXT
        `);
        console.log('✅ Added opensea_subscription_id column');

        // Create the new index
        await runQuery(db, `
          CREATE INDEX IF NOT EXISTS idx_tracked_tokens_collection_slug
          ON tracked_tokens(collection_slug)
        `);
        console.log('✅ Created collection_slug index');

        console.log('🌊 OpenSea migration completed successfully!');

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

function runQuery(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function(err) {
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
  migrateDatabase()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = migrateDatabase;