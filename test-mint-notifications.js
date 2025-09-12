const { ethers } = require('ethers');
require('dotenv').config();

const Database = require('./src/database/db');
const SecureTrendingService = require('./src/services/secureTrendingService');
const WebhookHandlers = require('./src/webhooks/handlers');

async function testMintNotifications() {
    console.log('🎯 Testing Mint Notifications with Trending Integration');
    console.log('==================================================');
    
    let db = null;
    let secureTrending = null;
    let webhookHandlers = null;

    try {
        // Initialize database
        console.log('1️⃣ Initializing Database...');
        db = new Database();
        await db.initialize();
        console.log('   ✅ Database initialized');

        // Initialize secure trending service
        console.log('2️⃣ Initializing Services...');
        secureTrending = new SecureTrendingService(db);
        await secureTrending.initialize();
        
        // Initialize webhook handlers (simulated bot object)
        const mockBot = { telegram: { sendMessage: () => {} } };
        webhookHandlers = new WebhookHandlers(db, mockBot, null, secureTrending);
        console.log('   ✅ Services initialized');

        // Test contract address (MONGS Inspired)
        const testContract = process.env.MONGS_INSPIRED_CONTRACT_ADDRESS || '0x66e05E791153599835f6967803BB7414AC8a5Aee';
        console.log(`\n3️⃣ Testing Contract: ${testContract}`);

        // Test 1: Check trending status before payment
        console.log('\n4️⃣ Testing Trending Status (Before Payment)...');
        let isTrending = await webhookHandlers.isTokenTrending(testContract);
        console.log(`   📊 Is Trending (before): ${isTrending ? '✅ Yes' : '❌ No'}`);
        
        // Test 2: Simulate trending payment
        console.log('\n5️⃣ Simulating Trending Payment...');
        console.log('   📝 Note: In real scenario, user would:');
        console.log('     1. Use /buy_trending command');
        console.log('     2. Send ETH to SimplePaymentReceiver');
        console.log('     3. Use /validate <txhash> to activate trending');
        
        // For testing, let's manually add a trending payment to database
        try {
            // Check if token exists in tracked_tokens
            let token = await db.get('SELECT * FROM tracked_tokens WHERE contract_address = ?', [testContract]);
            let tokenId;
            
            if (!token) {
                console.log('   📝 Adding test token to tracked tokens...');
                const result = await db.addTrackedToken(
                    testContract,
                    'MONGS Inspired',
                    'MONGS',
                    0,
                    '0',
                    0,
                    'test.png'
                );
                tokenId = result.id;
                console.log(`   📝 Token added with ID: ${tokenId}`);
            } else {
                tokenId = token.id;
                console.log(`   📝 Token already exists with ID: ${tokenId}`);
            }

            // Add trending payment (simulate successful validation)
            const fee = ethers.parseEther('0.0625'); // 6h normal fee
            const mockTxHash = '0x' + Math.random().toString(16).substr(2, 62) + '12';
            
            const mockPayerAddress = '0x' + Math.random().toString(16).substr(2, 38) + '12';
            const trendingResult = await db.addTrendingPayment(
                'test_user_123',
                tokenId,
                fee.toString(),
                mockTxHash,
                6, // 6 hours
                mockPayerAddress
            );
            
            console.log(`   ✅ Trending payment added: ID ${trendingResult.id}`);
            console.log(`   💰 Fee: ${ethers.formatEther(fee)} ETH`);
            console.log(`   ⏰ Duration: 6 hours`);
            
        } catch (error) {
            console.log(`   ⚠️  Error adding trending payment: ${error.message}`);
        }

        // Test 3: Check trending status after payment
        console.log('\n6️⃣ Testing Trending Status (After Payment)...');
        isTrending = await webhookHandlers.isTokenTrending(testContract);
        console.log(`   📊 Is Trending (after): ${isTrending ? '✅ Yes' : '❌ No'}`);

        // Test 4: Test channel notification logic
        console.log('\n7️⃣ Testing Channel Notification Logic...');
        const channelNotification = await webhookHandlers.shouldNotifyChannelsForToken(testContract);
        console.log(`   📢 Should notify channels: ${channelNotification.notify ? '✅ Yes' : '❌ No'}`);
        console.log(`   📋 Reason: ${channelNotification.reason}`);
        console.log(`   📊 Is Trending: ${channelNotification.isTrending ? '✅ Yes' : '❌ No'}`);
        console.log(`   📺 Eligible channels: ${channelNotification.channels.length}`);

        // Test 5: Check active channels
        const channels = await db.all('SELECT * FROM channels WHERE is_active = 1');
        console.log(`\n8️⃣ Channel Configuration:`);
        console.log(`   📺 Total active channels: ${channels.length}`);
        channels.forEach(channel => {
            console.log(`   - Channel: ${channel.title || channel.telegram_chat_id}`);
            console.log(`     📊 Show trending: ${channel.show_trending === 1 ? '✅' : '❌'}`);
            console.log(`     📋 Show all activities: ${channel.show_all_activities === 1 ? '✅' : '❌'}`);
        });

        console.log('\n9️⃣ Testing Results Summary:');
        console.log('============================');
        console.log(`✅ Webhook handlers: Initialized with secure trending`);
        console.log(`${isTrending ? '✅' : '❌'} Token trending: ${isTrending ? 'Active' : 'Not active'}`);
        console.log(`${channelNotification.notify ? '✅' : '❌'} Channel notifications: ${channelNotification.notify ? 'Will be sent' : 'Will not be sent'}`);
        console.log(`📺 Active channels: ${channels.length}`);
        
        if (isTrending && channelNotification.notify) {
            console.log('\n🚀 READY FOR MINT TEST!');
            console.log('Now you can run: npm run mint');
            console.log('Expected result: Mint notification will be sent to channels');
        } else if (!isTrending) {
            console.log('\n⚠️  Token is not trending - notifications will not be sent');
            console.log('To fix: Make a trending payment via bot and use /validate');
        } else if (!channelNotification.notify) {
            console.log('\n⚠️  No eligible channels for notifications');
            console.log('To fix: Add bot to a channel and enable trending notifications');
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
        return false;
    } finally {
        if (db) {
            await db.close();
        }
    }
}

testMintNotifications();