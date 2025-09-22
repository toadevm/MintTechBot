#!/usr/bin/env node
require('dotenv').config();
const Database = require('./src/database/db');
const SecureTrendingService = require('./src/services/secureTrendingService');

async function checkImageFeeStatus(contractAddress) {
  let db, trendingService;

  try {
    // Initialize database
    db = new Database();
    await db.init();

    // Initialize trending service
    trendingService = new SecureTrendingService(db);
    await trendingService.initialize();

    console.log(`\n🔍 Checking image fee status for: ${contractAddress}\n`);

    // Get detailed status
    const status = await trendingService.getImageFeeStatus(contractAddress);

    if (status.hasActiveFee) {
      console.log('✅ ACTIVE IMAGE FEE FOUND');
      console.log('═'.repeat(50));
      console.log(`📋 Payment ID: ${status.paymentId}`);
      console.log(`💰 Amount Paid: ${status.amountEth} ETH`);
      console.log(`⏱️  Duration: ${status.duration} days`);
      console.log(`📅 Days Remaining: ${status.daysLeft}`);
      console.log(`🔗 Transaction: ${status.txHash}`);
      console.log(`👤 Payer: ${status.payer}`);
      console.log(`🕐 Start Time: ${status.startTime}`);
      console.log(`🏁 End Time: ${status.endTime}`);
      console.log(`\n${status.message}\n`);
    } else {
      console.log('❌ NO ACTIVE IMAGE FEE');
      console.log('═'.repeat(50));
      console.log(`📝 Status: ${status.message}`);
      if (status.error) {
        console.log(`⚠️  Error: ${status.error}`);
      }
      console.log('\n💡 To activate image fee, use the bot command: /buy_image_spot\n');
    }

    // Also check basic boolean status
    const isActive = await trendingService.isImageFeeActive(contractAddress);
    console.log(`🔧 Basic Status Check: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);

    // Show all payments for this contract (active and expired)
    const allPayments = await db.all(
      'SELECT * FROM image_fee_payments WHERE LOWER(contract_address) = LOWER(?) ORDER BY created_at DESC',
      [contractAddress]
    );

    if (allPayments.length > 0) {
      console.log(`\n📜 Payment History (${allPayments.length} total):`);
      console.log('═'.repeat(50));
      allPayments.forEach((payment, index) => {
        const isExpired = new Date(payment.end_time) < new Date();
        const timeLeft = isExpired ? 0 : Math.ceil((new Date(payment.end_time) - new Date()) / (1000 * 60 * 60 * 24));
        console.log(`${index + 1}. ${payment.is_active && !isExpired ? '✅' : '❌'} ID: ${payment.id}`);
        console.log(`   💰 ${require('ethers').formatEther(payment.amount)} ETH`);
        console.log(`   ⏱️  ${payment.duration_days} days | ${timeLeft} days left`);
        console.log(`   🔗 ${payment.transaction_hash}`);
        console.log(`   📅 ${payment.created_at} → ${payment.end_time}`);
      });
    }

  } catch (error) {
    console.error('❌ Error checking image fee status:', error.message);
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

// Get contract address from command line
const contractAddress = process.argv[2];

if (!contractAddress) {
  console.log('Usage: node check-image-fee-status.js <contract_address>');
  console.log('Example: node check-image-fee-status.js 0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf');
  process.exit(1);
}

checkImageFeeStatus(contractAddress);