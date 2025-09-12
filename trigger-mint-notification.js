require('dotenv').config();
const { ethers } = require('hardhat');

async function triggerMintNotification() {
    console.log('🎯 Triggering mint to generate bot notification...\n');
    
    try {
        const provider = new ethers.JsonRpcProvider(`https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        
        const contractAddress = process.env.MONGS_INSPIRED_CONTRACT_ADDRESS;
        console.log(`📄 Contract: ${contractAddress}`);
        console.log(`👤 Minter: ${wallet.address}`);
        
        const abi = [
            "function ownerMint(uint256 projectId, address to) external",
            "function getProjectInfo(uint256 projectId) view returns (string memory name, uint256 maxSupply, uint256 mintCost, uint256 currentSupply, bool isActive, string memory projectURI)",
            "function tokenURI(uint256 tokenId) view returns (string)"
        ];
        
        const contract = new ethers.Contract(contractAddress, abi, wallet);
        
        // Check project status
        const projectInfo = await contract.getProjectInfo(0);
        console.log(`📊 Current Supply: ${projectInfo[3]}/${projectInfo[1]}`);
        
        // Mint a new token
        console.log('\n🚀 Minting new token...');
        const mintTx = await contract.ownerMint(0, wallet.address);
        console.log(`📝 Transaction Hash: ${mintTx.hash}`);
        
        // Wait for confirmation
        console.log('⏳ Waiting for confirmation...');
        const receipt = await mintTx.wait();
        console.log('✅ Transaction confirmed!');
        
        // Extract token ID from logs
        const transferLog = receipt.logs.find(log => 
            log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
        );
        
        if (transferLog) {
            const tokenId = BigInt(transferLog.topics[3]);
            console.log(`🎨 Minted Token ID: ${tokenId}`);
            
            // Get token URI
            const tokenURI = await contract.tokenURI(tokenId);
            console.log(`🔗 Token URI: ${tokenURI}`);
            
            // Check if this triggers a webhook
            console.log('\n📡 This should trigger a webhook notification to the bot!');
            console.log('📱 Check your Telegram chat for the notification with:');
            console.log('   • Real MONGS metadata and traits');
            console.log('   • Downloaded MONGS image');
            console.log('   • Project details from MongsInspired contract');
            
        } else {
            console.log('⚠️  Could not extract token ID from transaction logs');
        }
        
        console.log('\n🎉 Mint completed successfully!');
        
    } catch (error) {
        console.error('❌ Mint failed:', error);
        process.exit(1);
    }
}

triggerMintNotification();