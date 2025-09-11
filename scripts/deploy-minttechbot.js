const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying MintTechBot contract...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const MintTechBot = await ethers.getContractFactory("MintTechBot");
  console.log("Deploying contract...");
  
  const mintTechBot = await MintTechBot.deploy();
  await mintTechBot.waitForDeployment();

  const contractAddress = await mintTechBot.getAddress();
  console.log("✅ MintTechBot deployed to:", contractAddress);

  console.log("\n📋 Contract Details:");
  console.log("Owner:", await mintTechBot.owner());
  console.log("Contract Balance:", ethers.formatEther(await mintTechBot.getContractBalance()), "ETH");

  console.log("\n💰 Fee Structure:");
  const [durations, normalFees, premiumFees] = await mintTechBot.getAllFees();
  for (let i = 0; i < durations.length; i++) {
    console.log(`${durations[i]}h: Normal ${ethers.formatEther(normalFees[i])} ETH | Premium ${ethers.formatEther(premiumFees[i])} ETH`);
  }

  console.log("\n🔧 Configuration:");
  console.log("Add this to your .env file:");
  console.log(`TRENDING_CONTRACT_ADDRESS=${contractAddress}`);

  console.log("\n⚡ Verification command:");
  console.log(`npx hardhat verify --network sepolia ${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });