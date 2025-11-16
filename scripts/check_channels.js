const { Pool } = require('pg');
require('dotenv').config();

async function checkChannels() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📊 Checking channels table for tier configuration...\n');

    // Query active channels with their tier settings
    const result = await pool.query(`
      SELECT
        telegram_chat_id,
        channel_title,
        trending_tier,
        is_active,
        show_trending,
        show_all_activities,
        created_at
      FROM channels
      WHERE is_active = true
        AND trending_tier != 'none'
      ORDER BY telegram_chat_id, trending_tier
    `);

    if (result.rows.length === 0) {
      console.log('❌ No active channels with trending enabled found.');
      return;
    }

    console.log(`✅ Found ${result.rows.length} active channel(s) with trending enabled:\n`);

    // Group by telegram_chat_id to detect duplicates
    const channelMap = new Map();
    result.rows.forEach(row => {
      if (!channelMap.has(row.telegram_chat_id)) {
        channelMap.set(row.telegram_chat_id, []);
      }
      channelMap.get(row.telegram_chat_id).push(row);
    });

    // Display results
    channelMap.forEach((records, chatId) => {
      console.log(`📢 Channel ID: ${chatId}`);
      records.forEach((record, idx) => {
        console.log(`   ${idx + 1}. Title: ${record.channel_title}`);
        console.log(`      Tier: ${record.trending_tier}`);
        console.log(`      Show Trending: ${record.show_trending}`);
        console.log(`      Show All Activities: ${record.show_all_activities}`);
        console.log(`      Created: ${record.created_at}`);
        console.log('');
      });

      if (records.length > 1) {
        console.log(`   ⚠️  WARNING: ${records.length} duplicate records for this channel!`);
        console.log(`   Tiers: ${records.map(r => r.trending_tier).join(', ')}\n`);
      }
    });

    // Summary
    console.log('\n📊 SUMMARY:');
    console.log(`   Total active trending channels: ${result.rows.length}`);
    console.log(`   Unique channels: ${channelMap.size}`);

    const tierCounts = result.rows.reduce((acc, c) => {
      acc[c.trending_tier] = (acc[c.trending_tier] || 0) + 1;
      return acc;
    }, {});
    console.log(`   Tier distribution: ${JSON.stringify(tierCounts)}`);

    if (result.rows.length > channelMap.size) {
      console.log(`\n   ⚠️  DUPLICATES DETECTED: ${result.rows.length - channelMap.size} duplicate record(s)`);
    }

  } catch (error) {
    console.error('❌ Error checking channels:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

checkChannels().catch(console.error);
