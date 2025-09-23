require('dotenv').config();
const Database = require('./src/database/db');
const CollectionResolver = require('./src/services/collectionResolver');

async function fixAllCollections() {
  console.log('🔧 Starting comprehensive collection slug resolution for ALL tracked tokens...\n');

  const db = new Database();
  await db.initialize();

  const resolver = new CollectionResolver();
  resolver.initializeKnownCollections();

  try {
    // Get all active tokens without collection slugs
    const tokensWithoutSlugs = await db.all(`
      SELECT id, contract_address, token_name, blockchain_network
      FROM tracked_tokens
      WHERE (collection_slug IS NULL OR collection_slug = '')
      AND is_active = 1
      ORDER BY id
    `);

    console.log(`📊 Found ${tokensWithoutSlugs.length} tokens without collection slugs:`);
    tokensWithoutSlugs.forEach(token => {
      const chain = token.blockchain_network || 'ethereum';
      console.log(`  - ${token.token_name} (${token.contract_address}) on ${chain}`);
    });

    if (tokensWithoutSlugs.length === 0) {
      console.log('✅ All tokens already have collection slugs!');
      await db.close();
      return;
    }

    console.log('\n🔍 Resolving collection slugs...\n');

    const results = {
      resolved: [],
      failed: [],
      total: tokensWithoutSlugs.length
    };

    // Process each token
    for (const token of tokensWithoutSlugs) {
      const chain = token.blockchain_network || 'ethereum';

      console.log(`🔍 Processing: ${token.token_name} (${token.contract_address})`);

      try {
        // Try to resolve collection slug
        const collectionSlug = await resolver.resolveCollectionSlug(token.contract_address, chain);

        if (collectionSlug) {
          // Update database with resolved slug
          const updateResult = await db.run(`
            UPDATE tracked_tokens
            SET collection_slug = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [collectionSlug, token.id]);

          if (updateResult.changes > 0) {
            console.log(`  ✅ Resolved: ${collectionSlug}`);
            results.resolved.push({
              id: token.id,
              name: token.token_name,
              contract: token.contract_address,
              chain,
              slug: collectionSlug
            });
          } else {
            console.log(`  ❌ Database update failed`);
            results.failed.push({
              id: token.id,
              name: token.token_name,
              contract: token.contract_address,
              error: 'Database update failed'
            });
          }
        } else {
          console.log(`  ⚠️ Could not resolve collection slug`);
          results.failed.push({
            id: token.id,
            name: token.token_name,
            contract: token.contract_address,
            error: 'Collection slug not found'
          });
        }

        // Rate limiting - wait between API calls
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        results.failed.push({
          id: token.id,
          name: token.token_name,
          contract: token.contract_address,
          error: error.message
        });
      }
    }

    // Summary
    console.log('\n📊 Resolution Summary:');
    console.log(`  Total tokens processed: ${results.total}`);
    console.log(`  Successfully resolved: ${results.resolved.length}`);
    console.log(`  Failed to resolve: ${results.failed.length}`);

    if (results.resolved.length > 0) {
      console.log('\n✅ Successfully resolved collections:');
      results.resolved.forEach(item => {
        console.log(`  - ${item.name}: ${item.slug}`);
      });
    }

    if (results.failed.length > 0) {
      console.log('\n❌ Failed to resolve:');
      results.failed.forEach(item => {
        console.log(`  - ${item.name}: ${item.error}`);
      });
    }

    // Get updated stats
    const totalWithSlugs = await db.get(`
      SELECT COUNT(*) as count
      FROM tracked_tokens
      WHERE collection_slug IS NOT NULL
      AND collection_slug != ''
      AND is_active = 1
    `);

    const totalActive = await db.get(`
      SELECT COUNT(*) as count
      FROM tracked_tokens
      WHERE is_active = 1
    `);

    console.log(`\n📈 Updated Statistics:`);
    console.log(`  Active tokens with collection slugs: ${totalWithSlugs.count}/${totalActive.count}`);
    console.log(`  OpenSea tracking coverage: ${Math.round((totalWithSlugs.count / totalActive.count) * 100)}%`);

    // Recommend next steps
    console.log('\n🚀 Next Steps:');
    console.log('  1. Run the OpenSea subscription setup script');
    console.log('  2. Test notifications for resolved collections');
    console.log('  3. Restart the bot to activate new subscriptions');

  } catch (error) {
    console.error('❌ Error during collection resolution:', error);
  } finally {
    await db.close();
  }
}

// Additional utility functions
async function listTokensWithoutSlugs() {
  const db = new Database();
  await db.initialize();

  const tokens = await db.all(`
    SELECT id, contract_address, token_name, blockchain_network, created_at
    FROM tracked_tokens
    WHERE (collection_slug IS NULL OR collection_slug = '')
    AND is_active = 1
    ORDER BY created_at DESC
  `);

  console.log(`\n📋 Tokens without collection slugs (${tokens.length}):`);
  tokens.forEach(token => {
    const chain = token.blockchain_network || 'ethereum';
    console.log(`  ${token.id}: ${token.token_name} (${token.contract_address}) - ${chain}`);
  });

  await db.close();
  return tokens;
}

async function showCollectionStats() {
  const db = new Database();
  await db.initialize();

  const stats = await db.all(`
    SELECT
      COALESCE(blockchain_network, 'ethereum') as chain,
      COUNT(*) as total_tokens,
      COUNT(collection_slug) as with_slugs,
      ROUND(COUNT(collection_slug) * 100.0 / COUNT(*), 1) as coverage_percent
    FROM tracked_tokens
    WHERE is_active = 1
    GROUP BY blockchain_network
    ORDER BY total_tokens DESC
  `);

  console.log('\n📊 Collection Slug Coverage by Chain:');
  stats.forEach(stat => {
    console.log(`  ${stat.chain}: ${stat.with_slugs}/${stat.total_tokens} (${stat.coverage_percent}%)`);
  });

  await db.close();
}

// Command line interface
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case 'list':
      listTokensWithoutSlugs();
      break;
    case 'stats':
      showCollectionStats();
      break;
    case 'fix':
    default:
      fixAllCollections();
      break;
  }
}

module.exports = { fixAllCollections, listTokensWithoutSlugs, showCollectionStats };