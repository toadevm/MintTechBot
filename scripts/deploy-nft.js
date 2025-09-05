const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("🎨 Deploying SimpleNFT contract to Sepolia...");

  // Get network information
  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("📋 Deployment Details:");
  console.log(`   Network: ${network}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Deployer Balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);

  // Deploy the SimpleNFT contract
  console.log("\n🎨 Deploying SimpleNFT contract...");
  const SimpleNFT = await hre.ethers.getContractFactory("SimpleNFT");
  const simpleNFT = await SimpleNFT.deploy();

  await simpleNFT.waitForDeployment();
  const contractAddress = await simpleNFT.getAddress();

  console.log("✅ SimpleNFT deployed successfully!");
  console.log(`   Contract Address: ${contractAddress}`);
  
  // Verify deployment by calling view functions
  try {
    const name = await simpleNFT.name();
    const symbol = await simpleNFT.symbol();
    const mintPrice = await simpleNFT.mintPrice();
    const maxSupply = await simpleNFT.maxSupply();
    const totalSupply = await simpleNFT.totalSupply();
    const mintingActive = await simpleNFT.mintingActive();
    
    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Mint Price: ${hre.ethers.formatEther(mintPrice)} ETH`);
    console.log(`   Max Supply: ${maxSupply}`);
    console.log(`   Current Supply: ${totalSupply}`);
    console.log(`   Minting Active: ${mintingActive}`);
  } catch (error) {
    console.log("⚠️  Could not verify contract deployment:", error.message);
  }

  // Update .env file with the deployed NFT contract address
  try {
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Update or add SAMPLE_NFT_CONTRACT_ADDRESS
    const addressLine = `SAMPLE_NFT_CONTRACT_ADDRESS=${contractAddress}`;
    
    if (envContent.includes('SAMPLE_NFT_CONTRACT_ADDRESS=')) {
      // Replace existing line
      envContent = envContent.replace(/SAMPLE_NFT_CONTRACT_ADDRESS=.*/, addressLine);
    } else {
      // Add new line
      envContent += `\n${addressLine}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log("📝 Updated .env file with NFT contract address");
    
  } catch (error) {
    console.log("⚠️  Could not update .env file:", error.message);
    console.log("Please manually add this line to your .env file:");
    console.log(`SAMPLE_NFT_CONTRACT_ADDRESS=${contractAddress}`);
  }

  // Save deployment info
  const deploymentInfo = {
    network: network,
    contractAddress: contractAddress,
    deployer: deployer.address,
    deploymentTime: new Date().toISOString(),
    blockNumber: simpleNFT.deploymentTransaction().blockNumber,
    transactionHash: simpleNFT.deploymentTransaction().hash,
    mintPrice: hre.ethers.formatEther(await simpleNFT.mintPrice()),
    maxSupply: (await simpleNFT.maxSupply()).toString()
  };

  const deploymentPath = path.join(__dirname, '..', 'nft-deployments.json');
  let deployments = {};
  
  if (fs.existsSync(deploymentPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  }
  
  deployments[network] = deploymentInfo;
  fs.writeFileSync(deploymentPath, JSON.stringify(deployments, null, 2));

  console.log("\n🎉 SimpleNFT deployment completed successfully!");
  console.log(`📄 Transaction hash: ${simpleNFT.deploymentTransaction().hash}`);
  console.log("💡 Your bot can now monitor this NFT contract for minting activity!");
  
  if (network === 'sepolia') {
    console.log(`🔍 View on Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);
  }

  // Instructions for testing
  console.log("\n📋 Testing Instructions:");
  console.log("1. Add this contract to your bot's tracking system");
  console.log("2. Try minting some NFTs with the following methods:");
  console.log(`   - quickMint(): Send ${hre.ethers.formatEther(await simpleNFT.mintPrice())} ETH`);
  console.log(`   - batchMint(3): Send ${hre.ethers.formatEther((await simpleNFT.mintPrice()) * 3n)} ETH for 3 NFTs`);
  console.log("3. Watch for mint notifications in your bot!");
  console.log(`4. Verify contract (optional): npx hardhat verify --network sepolia ${contractAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error("❌ SimpleNFT deployment failed:", error);
  process.exitCode = 1;
});