require('dotenv').config();
const Database = require('./src/database/db');

async function simpleTest() {
    const db = new Database();
    await db.initialize();
    
    // Clean slate
    await db.run('DELETE FROM user_subscriptions WHERE user_id = 99');
    await db.run('INSERT OR IGNORE INTO users (id, telegram_id, username, is_active) VALUES (99, "999999999", "testuser", 1)');
    
    console.log('Before subscription:');
    const before = await db.all('SELECT * FROM user_subscriptions WHERE user_id = 99');
    console.log(before);
    
    console.log('\nCreating subscription...');
    await db.subscribeUserToToken(99, 8, 'private');
    
    console.log('\nAfter subscription:');
    const after = await db.all('SELECT * FROM user_subscriptions WHERE user_id = 99');
    console.log(after);
    
    console.log('\nTesting getUserTrackedTokens:');
    const tokens = await db.getUserTrackedTokens(99, 'private');
    console.log('Tokens found:', tokens.length);
    console.log(tokens);
    
    await db.close();
}

simpleTest().catch(console.error);
