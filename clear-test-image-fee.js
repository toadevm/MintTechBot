require('dotenv').config();
const Database = require('./src/database/db');

async function clearTestImageFee() {
    let db = null;

    try {
        // Initialize database
        db = new Database();
        await db.initialize();

        const testContract = '0x66e05e791153599835f6967803bb7414ac8a5aee';
        console.log('🧹 Clearing Test Image Fee Payment');
        console.log('==================================');
        
        // Show current payments
        const payments = await db.all(
            'SELECT * FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?)', 
            [testContract]
        );
        
        console.log(`Found ${payments.length} image fee payment(s) for contract`);
        
        if (payments.length > 0) {
            // Delete test payments
            await db.run(
                'DELETE FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?)', 
                [testContract]
            );
            
            console.log('✅ Test image fee payments cleared');
            console.log('📝 Next mint will show DEFAULT placeholder image');
        } else {
            console.log('❌ No image fee payments found to clear');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (db) {
            await db.close();
        }
    }
}

clearTestImageFee();