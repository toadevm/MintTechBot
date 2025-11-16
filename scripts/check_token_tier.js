const { Pool } = require('pg');
require('dotenv').config();

async function checkTokenTier() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📊 Checking trending tokens and their tiers...\n');

    // Query active trending payments with token info
    const result = await pool.query(`
      SELECT
        tt.contract_address,
        tt.token_symbol,
        tt.token_name,
        tp.tier,
        tp.is_active,
        tp.start_time,
        tp.end_time,
        tp.payment_amount,
        (tp.end_time > NOW()) as is_valid
      FROM trending_payments tp
      JOIN tracked_tokens tt ON tt.id = tp.token_id
      WHERE tp.is_active = true
      ORDER BY tp.created_at DESC
    `);

    if (result.rows.length === 0) {
      console.log('❌ No active trending payments found.');
      return;
    }

    console.log(`✅ Found ${result.rows.length} active trending payment(s):\n`);

    result.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. ${row.token_name || row.token_symbol || 'Unknown'}`);
      console.log(`   Contract: ${row.contract_address}`);
      console.log(`   Tier: ${row.tier}`);
      console.log(`   Active: ${row.is_active}`);
      console.log(`   Still Valid: ${row.is_valid}`);
      console.log(`   Start: ${row.start_time}`);
      console.log(`   End: ${row.end_time}`);
      console.log(`   Amount: ${row.payment_amount} ETH`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error checking token tiers:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

checkTokenTier().catch(console.error);
