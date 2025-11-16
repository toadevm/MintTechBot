const { Pool } = require('pg');
require('dotenv').config();

async function cleanupChannelSubscriptions() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🧹 Cleaning up channel subscriptions from user_subscriptions table...\n');

    // First, show what will be deleted
    const toDelete = await pool.query(`
      SELECT us.id, us.chat_id, us.user_id, tt.token_name, tt.contract_address, c.channel_title
      FROM user_subscriptions us
      JOIN tracked_tokens tt ON tt.id = us.token_id
      LEFT JOIN channels c ON c.telegram_chat_id = us.chat_id
      WHERE us.chat_id IN (SELECT telegram_chat_id FROM channels)
      ORDER BY us.id
    `);

    if (toDelete.rows.length === 0) {
      console.log('✅ No channel subscriptions found in user_subscriptions table. Database is clean!');
      return;
    }

    console.log(`⚠️  Found ${toDelete.rows.length} channel subscription(s) to remove:\n`);

    toDelete.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. Subscription ID: ${row.id}`);
      console.log(`   Channel: ${row.channel_title || 'Unknown'}`);
      console.log(`   Chat ID: ${row.chat_id}`);
      console.log(`   Token: ${row.token_name}`);
      console.log(`   Contract: ${row.contract_address}`);
      console.log('');
    });

    // Delete channel subscriptions
    const deleteResult = await pool.query(`
      DELETE FROM user_subscriptions
      WHERE chat_id IN (SELECT telegram_chat_id FROM channels)
      RETURNING id
    `);

    console.log(`✅ Successfully removed ${deleteResult.rowCount} channel subscription(s) from user_subscriptions table.`);
    console.log('\n📌 Note: Channels will now ONLY receive notifications via the channels table with tier filtering.');
    console.log('   - Normal channels → Normal tier tokens only');
    console.log('   - Premium channels → Premium tier tokens only');

  } catch (error) {
    console.error('❌ Error cleaning up channel subscriptions:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

cleanupChannelSubscriptions().catch(console.error);
