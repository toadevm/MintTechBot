const { ethers } = require("hardhat");

async function main() {
    console.log("Deploying MongsInspiredNFT contract...");

    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

    const MongsInspiredNFT = await ethers.getContractFactory("MongsInspiredNFT");
    
    const mongsNFT = await MongsInspiredNFT.deploy("MONGS Inspired", "MINGSNFT");
    await mongsNFT.waitForDeployment();

    const contractAddress = await mongsNFT.getAddress();
    console.log("MongsInspiredNFT deployed to:", contractAddress);

    console.log("\nContract details:");
    console.log("- Name:", await mongsNFT.name());
    console.log("- Symbol:", await mongsNFT.symbol());
    console.log("- Owner:", await mongsNFT.owner());
    console.log("- PROJECT_SCALE:", await mongsNFT.PROJECT_SCALE());

    console.log("\nSetting up initial project with MONGS token URI...");
    
    const tx = await mongsNFT.createProject(
        "MONGS Inspired Collection",
        10000,
        ethers.parseEther("0.01"),
        "https://mongs.io/nft/"
    );
    await tx.wait();
    
    console.log("✅ Initial project created successfully!");
    
    const projectInfo = await mongsNFT.getProjectInfo(0);
    console.log("\nProject 0 details:");
    console.log("- Name:", projectInfo[0]);
    console.log("- Max Supply:", projectInfo[1].toString());
    console.log("- Mint Cost:", ethers.formatEther(projectInfo[2]), "ETH");
    console.log("- Current Supply:", projectInfo[3].toString());
    console.log("- Is Active:", projectInfo[4]);
    console.log("- Project URI:", projectInfo[5]);

    console.log("\n🎯 Deployment Summary:");
    console.log("Contract Address:", contractAddress);
    console.log("Network: Sepolia");
    console.log("Token URI matches MONGS pattern for token ID compatibility");
    console.log("\nNext steps:");
    console.log("1. Verify contract on Etherscan");
    console.log("2. Update bot configuration with new contract address");
    console.log("3. Test minting functionality");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });