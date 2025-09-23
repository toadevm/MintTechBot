require('dotenv').config();
const Database = require('./src/database/db');

async function clearDatabase() {
    console.log('🗑️ Clearing Database');
    console.log('==================');

    let db = null;

    try {
        db = new Database();
        await db.initialize();
        console.log('✅ Database connected');

        // Clear all user-related data
        console.log('\n🧹 Clearing user data...');
        await db.run('DELETE FROM user_subscriptions');
        console.log('   ✅ Cleared user_subscriptions table');

        await db.run('DELETE FROM users');
        console.log('   ✅ Cleared users table');

        // Clear channel data
        console.log('\n🧹 Clearing channel data...');
        await db.run('DELETE FROM channels');
        console.log('   ✅ Cleared channels table');

        // Clear token tracking data but keep the tokens themselves (if table exists)
        console.log('\n🧹 Clearing tracking data...');
        try {
            await db.run('DELETE FROM token_activities');
            console.log('   ✅ Cleared token_activities table');
        } catch (error) {
            console.log('   ⚠️ token_activities table not found (skipping)');
        }

        // Optional: Also clear tokens if you want to start completely fresh
        // await db.run('DELETE FROM tokens');
        // console.log('   ✅ Cleared tokens table');

        // Reset auto-increment counters
        console.log('\n🔄 Resetting counters...');
        await db.run('DELETE FROM sqlite_sequence WHERE name IN ("users", "user_subscriptions", "channels", "token_activities")');
        console.log('   ✅ Reset auto-increment counters');

        console.log('\n🎉 Database cleared successfully!');
        console.log('📊 Fresh start - all user and channel data removed');

    } catch (error) {
        console.error('❌ Clear failed:', error.message);
    } finally {
        if (db) {
            await db.close();
        }
    }
}

clearDatabase();