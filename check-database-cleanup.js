#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');

async function checkDatabaseForCleanup() {
  let db;

  try {
    // Initialize database
    db = new Database();
    await db.initialize();

    console.log('\n🔍 DATABASE CLEANUP ANALYSIS\n');
    console.log('═'.repeat(60));

    // Check tracked_tokens table
    const allTokens = await db.all('SELECT * FROM tracked_tokens ORDER BY id');
    console.log(`\n📋 TRACKED TOKENS (${allTokens.length} total):`);
    console.log('═'.repeat(40));

    const realMongContract = '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf';
    const problemContract = '0x1f8731e2BFcF95c114523D74a40E7bB4E1a16282';

    allTokens.forEach(token => {
      const isRealMong = token.contract_address.toLowerCase() === realMongContract.toLowerCase();
      const isProblemContract = token.contract_address.toLowerCase() === problemContract.toLowerCase();

      console.log(`${isRealMong ? '✅ KEEP' : isProblemContract ? '❌ PROBLEM' : '🔍 CHECK'} ID: ${token.id}`);
      console.log(`   📍 Address: ${token.contract_address}`);
      console.log(`   🏷️  Name: ${token.token_name || 'N/A'}`);
      console.log(`   💰 Symbol: ${token.token_symbol || 'N/A'}`);
      console.log(`   👤 Added by: ${token.added_by_user_id}`);
      console.log(`   📅 Created: ${token.created_at}`);
      console.log('');
    });

    // Check user_subscriptions table
    const allSubscriptions = await db.all('SELECT * FROM user_subscriptions ORDER BY id');
    console.log(`\n📬 USER SUBSCRIPTIONS (${allSubscriptions.length} total):`);
    console.log('═'.repeat(40));

    for (const sub of allSubscriptions) {
      const token = await db.get('SELECT contract_address, token_name FROM tracked_tokens WHERE id = ?', [sub.token_id]);
      const isRealMong = token && token.contract_address.toLowerCase() === realMongContract.toLowerCase();

      console.log(`${isRealMong ? '✅ KEEP' : '🔍 CHECK'} Sub ID: ${sub.id}`);
      console.log(`   👤 User: ${sub.user_id}`);
      console.log(`   🪙 Token: ${sub.token_id} (${token ? token.contract_address : 'NOT FOUND'})`);
      console.log(`   💬 Chat: ${sub.chat_id}`);
      console.log(`   📅 Created: ${sub.created_at}`);
      console.log('');
    }

    // Check image_fee_payments table
    const allImageFees = await db.all('SELECT * FROM image_fee_payments ORDER BY id');
    console.log(`\n🖼️  IMAGE FEE PAYMENTS (${allImageFees.length} total):`);
    console.log('═'.repeat(40));

    allImageFees.forEach(payment => {
      const isRealMong = payment.contract_address.toLowerCase() === realMongContract.toLowerCase();
      const isProblemContract = payment.contract_address.toLowerCase() === problemContract.toLowerCase();

      console.log(`${isRealMong ? '✅ KEEP' : isProblemContract ? '❌ PROBLEM' : '🔍 CHECK'} Payment ID: ${payment.id}`);
      console.log(`   📍 Address: ${payment.contract_address}`);
      console.log(`   💰 Amount: ${require('ethers').formatEther(payment.payment_amount)} ETH`);
      console.log(`   🔗 TX: ${payment.transaction_hash}`);
      console.log(`   ⏱️  Duration: ${payment.duration_days} days`);
      console.log(`   🟢 Active: ${payment.is_active ? 'YES' : 'NO'}`);
      console.log(`   📅 End: ${payment.end_time}`);
      console.log('');
    });

    // Check processed_transactions table
    const allProcessedTx = await db.all('SELECT * FROM processed_transactions ORDER BY id');
    console.log(`\n🔗 PROCESSED TRANSACTIONS (${allProcessedTx.length} total):`);
    console.log('═'.repeat(40));

    allProcessedTx.forEach(tx => {
      const isRealMong = tx.contract_address.toLowerCase() === realMongContract.toLowerCase();
      const isProblemContract = tx.contract_address.toLowerCase() === problemContract.toLowerCase();

      console.log(`${isRealMong ? '✅ KEEP' : isProblemContract ? '❌ PROBLEM' : '🔍 CHECK'} TX ID: ${tx.id}`);
      console.log(`   📍 Contract: ${tx.contract_address}`);
      console.log(`   🔗 Hash: ${tx.transaction_hash}`);
      console.log(`   💰 Amount: ${require('ethers').formatEther(tx.amount)} ETH`);
      console.log(`   🎯 Purpose: ${tx.purpose}`);
      console.log(`   📅 Processed: ${tx.processed_at}`);
      console.log('');
    });

    // Summary
    console.log('\n📊 CLEANUP SUMMARY:');
    console.log('═'.repeat(40));
    console.log(`✅ Real MONG contract found: ${allTokens.some(t => t.contract_address.toLowerCase() === realMongContract.toLowerCase())}`);
    console.log(`❌ Problem contract found: ${allTokens.some(t => t.contract_address.toLowerCase() === problemContract.toLowerCase())}`);
    console.log(`🔍 Items to potentially clean up: ${allTokens.length + allSubscriptions.length + allImageFees.length + allProcessedTx.length - (allTokens.filter(t => t.contract_address.toLowerCase() === realMongContract.toLowerCase()).length + allSubscriptions.filter(s => allTokens.find(t => t.id === s.token_id && t.contract_address.toLowerCase() === realMongContract.toLowerCase())).length + allImageFees.filter(p => p.contract_address.toLowerCase() === realMongContract.toLowerCase()).length + allProcessedTx.filter(tx => tx.contract_address.toLowerCase() === realMongContract.toLowerCase()).length)}`);

  } catch (error) {
    console.error('❌ Error checking database:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

checkDatabaseForCleanup();