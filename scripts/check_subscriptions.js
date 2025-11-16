const { Pool } = require('pg');
require('dotenv').config();

async function checkSubscriptions() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📊 Checking user_subscriptions for the premium token...\n');

    // Get subscriptions for the premium token
    const result = await pool.query(`
      SELECT
        us.id,
        us.user_id,
        us.chat_id,
        us.notification_enabled,
        tt.contract_address,
        tt.token_name,
        tt.token_symbol,
        u.telegram_id,
        u.username
      FROM user_subscriptions us
      JOIN tracked_tokens tt ON tt.id = us.token_id
      LEFT JOIN users u ON u.id = us.user_id
      WHERE LOWER(tt.contract_address) = LOWER('0x3b45542f6c97fe7f7aa3bb055c95e93b2c0437ed')
        AND us.notification_enabled = true
      ORDER BY us.id
    `);

    if (result.rows.length === 0) {
      console.log('❌ No active subscriptions found for this token.');
      return;
    }

    console.log(`✅ Found ${result.rows.length} active subscription(s):\n`);

    result.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. Subscription ID: ${row.id}`);
      console.log(`   User: ${row.username || 'Unknown'} (telegram_id: ${row.telegram_id})`);
      console.log(`   Chat ID: ${row.chat_id}`);
      console.log(`   Token: ${row.token_name || row.token_symbol}`);
      console.log(`   Contract: ${row.contract_address}`);
      console.log(`   Notifications: ${row.notification_enabled ? 'Enabled' : 'Disabled'}`);

      // Check if chat_id looks like a channel
      if (row.chat_id && row.chat_id.toString().startsWith('-100')) {
        console.log(`   ⚠️  WARNING: This looks like a channel/group ID, not a private chat!`);
      }
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error checking subscriptions:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

checkSubscriptions().catch(console.error);
