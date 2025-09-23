#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function checkAllUsers() {
  let db;

  try {
    db = new Database();
    await db.initialize();

    console.log('\n📋 ALL USERS IN DATABASE\n');
    const users = await db.all('SELECT * FROM users');
    console.log(`Found ${users.length} users:`);
    users.forEach(user => {
      console.log(`   - ID: ${user.id}, Telegram ID: ${user.telegram_id}, Username: ${user.username || 'None'}`);
    });

    console.log('\n📋 ALL TRACKED TOKENS\n');
    const tokens = await db.all('SELECT * FROM tracked_tokens');
    console.log(`Found ${tokens.length} tokens:`);
    tokens.forEach(token => {
      console.log(`   - ID: ${token.id}, Name: ${token.token_name}, Contract: ${token.contract_address}, Active: ${token.is_active}`);
    });

    console.log('\n📋 ALL SUBSCRIPTIONS\n');
    const subscriptions = await db.all('SELECT * FROM user_subscriptions');
    console.log(`Found ${subscriptions.length} subscriptions:`);
    subscriptions.forEach(sub => {
      console.log(`   - Sub ID: ${sub.id}, User: ${sub.user_id}, Token: ${sub.token_id}, Chat: ${sub.chat_id}, Notifications: ${sub.notification_enabled}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

checkAllUsers();