const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("🚀 Deploying TrendingPayment contract to Sepolia...");


  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  console.log("📋 Deployment Details:");
  console.log(`   Network: ${network}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Deployer Balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);


  console.log("\n📦 Deploying contract...");
  const TrendingPayment = await hre.ethers.getContractFactory("TrendingPayment");
  const trendingPayment = await TrendingPayment.deploy();

  await trendingPayment.waitForDeployment();
  const contractAddress = await trendingPayment.getAddress();

  console.log("✅ TrendingPayment deployed successfully!");
  console.log(`   Contract Address: ${contractAddress}`);

  try {
    const baseFee = await trendingPayment.baseFee();
    const owner = await trendingPayment.owner();
    console.log(`   Base Fee: ${hre.ethers.formatEther(baseFee)} ETH`);
    console.log(`   Owner: ${owner}`);
  } catch (error) {
    console.log("⚠️  Could not verify contract deployment:", error.message);
  }


  try {
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }


    const addressLine = `TRENDING_CONTRACT_ADDRESS=${contractAddress}`;
    if (envContent.includes('TRENDING_CONTRACT_ADDRESS=')) {

      envContent = envContent.replace(/TRENDING_CONTRACT_ADDRESS=.*/, addressLine);
    } else {

      envContent += `\n${addressLine}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log("📝 Updated .env file with contract address");
  } catch (error) {
    console.log("⚠️  Could not update .env file:", error.message);
    console.log("Please manually add this line to your .env file:");
    console.log(`TRENDING_CONTRACT_ADDRESS=${contractAddress}`);
  }


  const deploymentInfo = {
    network: network,
    contractAddress: contractAddress,
    deployer: deployer.address,
    deploymentTime: new Date().toISOString(),
    blockNumber: trendingPayment.deploymentTransaction().blockNumber,
    transactionHash: trendingPayment.deploymentTransaction().hash,
  };

  const deploymentPath = path.join(__dirname, '..', 'deployments.json');
  let deployments = {};
  if (fs.existsSync(deploymentPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  }
  deployments[network] = deploymentInfo;
  fs.writeFileSync(deploymentPath, JSON.stringify(deployments, null, 2));

  console.log("\n🎉 Deployment completed successfully!");
  console.log(`📄 Transaction hash: ${trendingPayment.deploymentTransaction().hash}`);
  console.log("💡 Your NFT bot can now accept trending payments!");
  if (network === 'sepolia') {
    console.log(`🔍 View on Etherscan: https:
  }


  console.log("\n📋 Next Steps:");
  console.log("1. Restart your bot to load the new contract address");
  console.log("2. Test trending payments with some Sepolia testnet ETH");
  console.log("3. Verify the contract (optional): npx hardhat verify --network sepolia " + contractAddress);
}



main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});