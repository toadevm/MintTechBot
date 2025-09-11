#!/usr/bin/env node

require('dotenv').config({ quiet: true });
const { ethers } = require('ethers');
const logger = require('./src/services/logger');

async function mintTestNFT() {
  try {
    logger.info('🎨 Starting NFT minting test...');


    const nftAddress = process.env.SAMPLE_NFT_CONTRACT_ADDRESS;
    const privateKey = process.env.PRIVATE_KEY;

    if (!nftAddress || !privateKey) {
      throw new Error('Missing SAMPLE_NFT_CONTRACT_ADDRESS or PRIVATE_KEY in .env file');
    }


    const provider = new ethers.JsonRpcProvider(
      `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    );
    const wallet = new ethers.Wallet(privateKey, provider);

    const simpleNFTABI = [
      "function quickMint() external payable",
      "function mint(address to) external payable", 
      "function batchMint(uint256 quantity) external payable",
      "function mintPrice() external view returns (uint256)",
      "function totalSupply() external view returns (uint256)",
      "function balanceOf(address owner) external view returns (uint256)",
      "function ownerOf(uint256 tokenId) external view returns (address)",
      "function tokenURI(uint256 tokenId) external view returns (string)",
      "event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI)"
    ];

    const contract = new ethers.Contract(nftAddress, simpleNFTABI, wallet);


    const mintPrice = await contract.mintPrice();
    const initialSupply = await contract.totalSupply();
    const walletBalance = await provider.getBalance(wallet.address);

    logger.info(`📋 Minting Details:`);
    logger.info(`   Contract: ${nftAddress}`);
    logger.info(`   Minter: ${wallet.address}`);
    logger.info(`   Wallet Balance: ${ethers.formatEther(walletBalance)} ETH`);
    logger.info(`   Mint Price: ${ethers.formatEther(mintPrice)} ETH`);
    logger.info(`   Current Supply: ${initialSupply}`);

    if (walletBalance < mintPrice) {
      throw new Error(`Insufficient balance: Need ${ethers.formatEther(mintPrice)} ETH, have ${ethers.formatEther(walletBalance)} ETH`);
    }


    const args = process.argv.slice(2);
    let mintType = 'quick';
    let quantity = 1;

    if (args.length > 0) {
      if (args[0] === 'batch' && args[1]) {
        mintType = 'batch';
        quantity = parseInt(args[1]);
        if (quantity < 1 || quantity > 10) {
          throw new Error('Batch quantity must be between 1 and 10');
        }
      } else if (args[0] === 'to' && args[1]) {
        mintType = 'to';

      }
    }

    let tx;
    const totalCost = mintPrice * BigInt(quantity);

    logger.info(`\n🎨 Minting ${quantity} NFT${quantity > 1 ? 's' : ''}...`);
    logger.info(`   Total Cost: ${ethers.formatEther(totalCost)} ETH`);


    if (mintType === 'batch' && quantity > 1) {
      tx = await contract.batchMint(quantity, { 
        value: totalCost,
        gasLimit: 300000
      });
      logger.info(`📤 Batch mint transaction sent: ${tx.hash}`);
    } else if (mintType === 'to' && args[1]) {
      tx = await contract.mint(args[1], { 
        value: mintPrice,
        gasLimit: 200000
      });
      logger.info(`📤 Mint to ${args[1]} transaction sent: ${tx.hash}`);
    } else {
      tx = await contract.quickMint({ 
        value: mintPrice,
        gasLimit: 200000
      });
      logger.info(`📤 Quick mint transaction sent: ${tx.hash}`);
    }
    logger.info(`⏳ Waiting for confirmation...`);
    const receipt = await tx.wait();
    logger.info(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
    logger.info(`💰 Gas used: ${receipt.gasUsed.toString()}`);


    const newSupply = await contract.totalSupply();
    const newBalance = await contract.balanceOf(wallet.address);

    logger.info(`\n📊 Updated State:`);
    logger.info(`   Total Supply: ${newSupply} (was ${initialSupply})`);
    logger.info(`   Your NFTs: ${newBalance}`);


    if (newBalance > 0) {
      try {
        const lastTokenId = newSupply - 1n;
        const tokenOwner = await contract.ownerOf(lastTokenId);
        const tokenURI = await contract.tokenURI(lastTokenId);
        logger.info(`\n🎉 Latest NFT Minted:`);
        logger.info(`   Token ID: ${lastTokenId}`);
        logger.info(`   Owner: ${tokenOwner}`);
        logger.info(`   Metadata: ${tokenURI}`);
        logger.info(`   View on Etherscan: https://sepolia.etherscan.io/token/${nftAddress}?a=${newTokenId}`);
      } catch (error) {
        logger.warn(`Could not get token details: ${error.message}`);
      }
    }

    logger.info(`\n🎯 Minting completed successfully!`);
    logger.info(`🤖 Check your Telegram bot for webhook notifications!`);
  } catch (error) {
    logger.error('❌ Minting failed:', error.message);
    process.exit(1);
  }
}


if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🎨 SimpleNFT Minting Script

Usage:
  node mint-test.js                    # Quick mint 1 NFT to yourself
  node mint-test.js batch 3            # Batch mint 3 NFTs to yourself  
  node mint-test.js to 0x123...        # Mint 1 NFT to specific address

Examples:
  node mint-test.js                    # Mint 1 NFT (0.001 ETH)
  node mint-test.js batch 5            # Mint 5 NFTs (0.005 ETH)
  node mint-test.js to 0xabc123...     # Mint to friend's address

Contract: ${process.env.SAMPLE_NFT_CONTRACT_ADDRESS || 'Not configured'}
  `);
  process.exit(0);
}


mintTestNFT();