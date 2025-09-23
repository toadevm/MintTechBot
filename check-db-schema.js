#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function checkDatabaseSchema() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n🔍 CHECKING DATABASE SCHEMA\n');
    console.log('═'.repeat(60));

    // Check image_fee_payments table structure
    console.log('📋 IMAGE_FEE_PAYMENTS TABLE SCHEMA:');
    const imageTableInfo = await db.all("PRAGMA table_info(image_fee_payments)");
    imageTableInfo.forEach(column => {
      console.log(`   - ${column.name}: ${column.type} (${column.notnull ? 'NOT NULL' : 'NULL'})${column.pk ? ' PRIMARY KEY' : ''}`);
    });

    // Check tracked_tokens table structure
    console.log('\n📋 TRACKED_TOKENS TABLE SCHEMA:');
    const tokensTableInfo = await db.all("PRAGMA table_info(tracked_tokens)");
    tokensTableInfo.forEach(column => {
      console.log(`   - ${column.name}: ${column.type} (${column.notnull ? 'NOT NULL' : 'NULL'})${column.pk ? ' PRIMARY KEY' : ''}`);
    });

    // Check existing image payments
    console.log('\n📋 EXISTING IMAGE_FEE_PAYMENTS:');
    const imagePayments = await db.all('SELECT * FROM image_fee_payments');
    if (imagePayments.length > 0) {
      imagePayments.forEach((payment, i) => {
        console.log(`   Payment ${i + 1}:`);
        Object.keys(payment).forEach(key => {
          console.log(`     ${key}: ${payment[key]}`);
        });
        console.log('');
      });
    } else {
      console.log('   No existing image payments found');
    }

  } catch (error) {
    console.error('❌ Error checking database schema:', error.message);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

checkDatabaseSchema();