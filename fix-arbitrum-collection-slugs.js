require('dotenv').config();
const Database = require('./src/database/db.js');
const CollectionResolver = require('./src/services/collectionResolver.js');
const OpenSeaService = require('./src/blockchain/opensea.js');

async function fixArbitrumCollectionSlugs() {
  console.log('=== FIXING ARBITRUM COLLECTION SLUGS ===');
  console.log('This will resolve collection slugs for existing Arbitrum tokens');
  console.log('');

  try {
    // Initialize services
    const db = new Database();
    await db.initialize();
    console.log('✅ Database connected');

    const collectionResolver = new CollectionResolver();
    const openSea = new OpenSeaService();
    console.log('✅ Services initialized');

    // Find all Arbitrum tokens with null collection_slug
    const sql = `SELECT * FROM tracked_tokens WHERE chain_name = 'arbitrum' AND (collection_slug IS NULL OR collection_slug = '') AND is_active = 1`;
    const arbitrumTokens = await db.all(sql);

    console.log(`Found ${arbitrumTokens.length} Arbitrum tokens without collection slugs`);

    if (arbitrumTokens.length === 0) {
      console.log('✅ No Arbitrum tokens need fixing');
      return;
    }

    // Process each token
    let fixedCount = 0;
    const newCollections = new Set();

    for (const token of arbitrumTokens) {
      console.log(`\n📍 Processing: ${token.contract_address} (${token.token_name || 'Unknown'})`);

      try {
        // Resolve collection slug for Arbitrum
        const collectionSlug = await collectionResolver.resolveCollectionSlug(token.contract_address, 'arbitrum');

        if (collectionSlug) {
          console.log(`   ✅ Resolved collection slug: ${collectionSlug}`);

          // Update database
          const updateSql = `UPDATE tracked_tokens SET collection_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
          await db.run(updateSql, [collectionSlug, token.id]);

          fixedCount++;
          newCollections.add(collectionSlug);
          console.log(`   📝 Updated database with collection slug`);
        } else {
          console.log(`   ⚠️ Could not resolve collection slug`);
        }
      } catch (error) {
        console.log(`   ❌ Error processing token: ${error.message}`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Fixed ${fixedCount}/${arbitrumTokens.length} Arbitrum tokens`);
    console.log(`New collections discovered: ${newCollections.size}`);

    if (newCollections.size > 0) {
      console.log('\nNew collections that will get OpenSea subscriptions:');
      Array.from(newCollections).forEach(slug => {
        console.log(`  - ${slug}`);
      });

      console.log('\n⚠️ RESTART THE BOT to set up OpenSea subscriptions for these collections!');
    }

    console.log('\n✅ Migration completed successfully');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
fixArbitrumCollectionSlugs();