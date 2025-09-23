require('dotenv').config();
const Database = require('./src/database/db');

async function cleanupTestData() {
    console.log('🧹 Cleaning up test data from database...');
    
    let db = null;
    
    try {
        // Initialize database
        console.log('1️⃣ Connecting to database...');
        db = new Database();
        await db.initialize();
        console.log('   ✅ Database connected');

        // Clean footer ads test data
        console.log('2️⃣ Cleaning footer ads test data...');
        const footerAdsResult = await db.run('DELETE FROM footer_ads');
        console.log(`   ✅ Removed ${footerAdsResult.changes || 0} footer ads records`);

        // Clean pending payments test data  
        console.log('3️⃣ Cleaning pending payments test data...');
        const paymentsResult = await db.run('DELETE FROM pending_payments');
        console.log(`   ✅ Removed ${paymentsResult.changes || 0} pending payments records`);

        // Verify cleanup
        console.log('4️⃣ Verifying cleanup...');
        const footerCount = await db.get('SELECT COUNT(*) as count FROM footer_ads');
        const paymentsCount = await db.get('SELECT COUNT(*) as count FROM pending_payments');
        
        console.log(`   📊 Footer ads remaining: ${footerCount.count}`);
        console.log(`   📊 Pending payments remaining: ${paymentsCount.count}`);

        if (footerCount.count === 0 && paymentsCount.count === 0) {
            console.log('\n🎉 Database cleanup completed successfully!');
            console.log('✅ All test data removed');
            console.log('✅ Footer will now show "Buy Ad spot" instead of test ads');
        } else {
            console.log('\n⚠️ Some data may still remain in the database');
        }

    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        if (db) {
            await db.close();
            console.log('📝 Database connection closed');
        }
    }
}

cleanupTestData();