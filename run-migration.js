#!/usr/bin/env node

/**
 * Database Migration Runner
 *
 * Runs SQL migrations against the PostgreSQL database
 *
 * Usage:
 *   node run-migration.js [migration-file]
 *   node run-migration.js migrations/001-add-helius-support.sql
 *   node run-migration.js --all  (runs all migrations)
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

function success(message) {
  log(colors.green, '✅', message);
}

function error(message) {
  log(colors.red, '❌', message);
}

function info(message) {
  log(colors.cyan, 'ℹ️ ', message);
}

function header(message) {
  console.log(`\n${colors.bold}${colors.cyan}${message}${colors.reset}`);
  console.log('═'.repeat(message.length));
}

async function runMigration(pool, migrationFile) {
  try {
    const migrationPath = path.resolve(process.cwd(), migrationFile);

    if (!fs.existsSync(migrationPath)) {
      error(`Migration file not found: ${migrationPath}`);
      return false;
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');
    const migrationName = path.basename(migrationFile);

    info(`Running migration: ${migrationName}`);
    console.log();

    // Split SQL by semicolons to execute statements separately
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip comments
      if (statement.startsWith('--')) continue;

      // Show what we're executing
      const preview = statement.substring(0, 60).replace(/\s+/g, ' ');
      info(`[${i + 1}/${statements.length}] ${preview}${statement.length > 60 ? '...' : ''}`);

      try {
        await pool.query(statement);
        success(`Executed successfully`);
      } catch (err) {
        // If error contains "already exists" or "does not exist", it's often safe to continue
        if (err.message.includes('already exists') || err.message.includes('does not exist')) {
          log(colors.yellow, '⚠️ ', `Skipped: ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    console.log();
    success(`Migration completed: ${migrationName}`);
    return true;

  } catch (err) {
    console.log();
    error(`Migration failed: ${err.message}`);
    console.error(err.stack);
    return false;
  }
}

async function getAllMigrations() {
  const migrationsDir = path.join(process.cwd(), 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => path.join('migrations', file));
}

async function main() {
  header('🔄 Database Migration Runner');
  console.log();

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    error('DATABASE_URL not found in environment');
    error('Make sure .env file exists and contains DATABASE_URL');
    process.exit(1);
  }

  const dbHost = process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown';
  info(`Database: ${dbHost}`);
  console.log();

  // Parse arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    error('No migration specified');
    console.log();
    console.log('Usage:');
    console.log('  node run-migration.js migrations/001-add-helius-support.sql');
    console.log('  node run-migration.js --all');
    process.exit(1);
  }

  // Create connection pool
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    max: 1,
    connectionTimeoutMillis: 30000
  });

  try {
    // Test connection
    info('Connecting to database...');
    const client = await pool.connect();
    client.release();
    success('Connected');
    console.log();

    // Determine which migrations to run
    let migrationsToRun = [];

    if (args[0] === '--all') {
      migrationsToRun = await getAllMigrations();
      if (migrationsToRun.length === 0) {
        info('No migrations found in migrations/ directory');
        process.exit(0);
      }
      info(`Found ${migrationsToRun.length} migration(s) to run`);
      console.log();
    } else {
      migrationsToRun = args;
    }

    // Run migrations
    let successCount = 0;
    let failCount = 0;

    for (const migration of migrationsToRun) {
      const result = await runMigration(pool, migration);
      if (result) {
        successCount++;
      } else {
        failCount++;
      }
    }

    // Summary
    console.log();
    header('📊 Migration Summary');
    console.log();
    success(`Successful: ${successCount}`);
    if (failCount > 0) {
      error(`Failed: ${failCount}`);
    }
    console.log();

    if (failCount > 0) {
      process.exit(1);
    }

  } catch (err) {
    console.log();
    error(`Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
