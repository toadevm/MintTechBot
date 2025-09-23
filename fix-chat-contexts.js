require('dotenv').config();
const Database = require('./src/database/db');

async function fixChatContexts() {
    console.log('🔧 Fixing Chat Context Data');
    console.log('===========================');

    let db = null;

    try {
        db = new Database();
        await db.initialize();
        console.log('✅ Database connected');

        // First, let's see what we have in the database
        console.log('\n🔍 Analyzing current user_subscriptions data...');
        const allSubscriptions = await db.all('SELECT * FROM user_subscriptions');
        console.log(`📊 Total subscriptions found: ${allSubscriptions.length}`);

        if (allSubscriptions.length === 0) {
            console.log('✅ No subscriptions to fix - database is clean');
            return;
        }

        // Categorize the current chat_id values
        let privateCount = 0;
        let groupCount = 0;
        let unknownCount = 0;
        const userTelegramIds = new Set();

        // Get all users to understand their Telegram IDs
        const allUsers = await db.all('SELECT id, telegram_id FROM users');
        const userIdToTelegramId = new Map();
        allUsers.forEach(user => {
            userIdToTelegramId.set(user.id, user.telegram_id.toString());
            userTelegramIds.add(user.telegram_id.toString());
        });

        console.log('\n📋 Current subscription analysis:');
        allSubscriptions.forEach((sub, index) => {
            const userTelegramId = userIdToTelegramId.get(sub.user_id);
            console.log(`   ${index + 1}. User ID: ${sub.user_id} (Telegram: ${userTelegramId}), Token: ${sub.token_id}, Chat ID: "${sub.chat_id}"`);

            if (sub.chat_id === 'private') {
                privateCount++;
            } else if (sub.chat_id.startsWith('-')) {
                groupCount++;
            } else if (userTelegramIds.has(sub.chat_id)) {
                // This is likely a private chat stored as user's Telegram ID
                console.log(`      ⚠️  ISSUE: Chat ID "${sub.chat_id}" matches user Telegram ID - should be "private"`);
                unknownCount++;
            } else {
                unknownCount++;
            }
        });

        console.log(`\n📊 Context breakdown:`);
        console.log(`   ✅ Correctly stored as "private": ${privateCount}`);
        console.log(`   ✅ Group/Channel contexts: ${groupCount}`);
        console.log(`   ⚠️  Need fixing: ${unknownCount}`);

        if (unknownCount === 0) {
            console.log('\n🎉 All chat contexts are already correctly stored!');
            return;
        }

        // Fix the incorrect contexts
        console.log('\n🔧 Fixing incorrect chat contexts...');
        let fixedCount = 0;

        for (const subscription of allSubscriptions) {
            const userTelegramId = userIdToTelegramId.get(subscription.user_id);

            // If chat_id matches the user's Telegram ID, it should be "private"
            if (subscription.chat_id === userTelegramId) {
                console.log(`   Fixing subscription ${subscription.id}: "${subscription.chat_id}" → "private"`);

                await db.run(
                    'UPDATE user_subscriptions SET chat_id = ? WHERE id = ?',
                    ['private', subscription.id]
                );
                fixedCount++;
            }
        }

        console.log(`\n✅ Fixed ${fixedCount} subscription(s)`);

        // Verify the fixes
        console.log('\n🔍 Verifying fixes...');
        const updatedSubscriptions = await db.all('SELECT * FROM user_subscriptions');

        let newPrivateCount = 0;
        let newGroupCount = 0;
        let stillBrokenCount = 0;

        updatedSubscriptions.forEach(sub => {
            if (sub.chat_id === 'private') {
                newPrivateCount++;
            } else if (sub.chat_id.startsWith('-')) {
                newGroupCount++;
            } else {
                stillBrokenCount++;
            }
        });

        console.log(`📊 After fixes:`);
        console.log(`   ✅ Private contexts: ${newPrivateCount}`);
        console.log(`   ✅ Group/Channel contexts: ${newGroupCount}`);
        console.log(`   ❌ Still broken: ${stillBrokenCount}`);

        if (stillBrokenCount === 0) {
            console.log('\n🎉 All chat contexts fixed successfully!');
        } else {
            console.log('\n⚠️  Some contexts still need manual review');
        }

    } catch (error) {
        console.error('❌ Fix failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        if (db) {
            await db.close();
        }
    }
}

fixChatContexts();