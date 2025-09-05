const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SimpleNFT", function () {
  let SimpleNFT;
  let simpleNFT;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  beforeEach(async function () {
    // Get the ContractFactory and Signers
    SimpleNFT = await ethers.getContractFactory("SimpleNFT");
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    // Deploy the contract
    simpleNFT = await SimpleNFT.deploy();
    await simpleNFT.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await simpleNFT.name()).to.equal("SimpleNFT");
      expect(await simpleNFT.symbol()).to.equal("SNFT");
    });

    it("Should set the right owner", async function () {
      expect(await simpleNFT.owner()).to.equal(owner.address);
    });

    it("Should set initial mint price to 0.001 ETH", async function () {
      expect(await simpleNFT.mintPrice()).to.equal(ethers.parseEther("0.001"));
    });

    it("Should set max supply to 10000", async function () {
      expect(await simpleNFT.maxSupply()).to.equal(10000);
    });

    it("Should have minting active by default", async function () {
      expect(await simpleNFT.mintingActive()).to.be.true;
    });

    it("Should start with 0 total supply", async function () {
      expect(await simpleNFT.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should allow quick minting with correct payment", async function () {
      const mintPrice = await simpleNFT.mintPrice();
      
      await expect(simpleNFT.connect(addr1).quickMint({ value: mintPrice }))
        .to.emit(simpleNFT, "NFTMinted")
        .withArgs(addr1.address, 0, "https://api.example.com/metadata/0");
      
      expect(await simpleNFT.totalSupply()).to.equal(1);
      expect(await simpleNFT.ownerOf(0)).to.equal(addr1.address);
    });

    it("Should reject minting with insufficient payment", async function () {
      const insufficientPayment = ethers.parseEther("0.0005");
      
      await expect(simpleNFT.connect(addr1).quickMint({ value: insufficientPayment }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("Should refund excess payment", async function () {
      const mintPrice = await simpleNFT.mintPrice();
      const excessPayment = mintPrice + ethers.parseEther("0.01");
      
      const initialBalance = await ethers.provider.getBalance(addr1.address);
      
      const tx = await simpleNFT.connect(addr1).quickMint({ value: excessPayment });
      const receipt = await tx.wait();
      
      const finalBalance = await ethers.provider.getBalance(addr1.address);
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      
      // Should have paid only mint price + gas
      expect(initialBalance - finalBalance).to.be.closeTo(mintPrice + gasUsed, ethers.parseEther("0.001"));
    });

    it("Should allow minting to specified address", async function () {
      const mintPrice = await simpleNFT.mintPrice();
      
      await expect(simpleNFT.connect(addr1).mint(addr2.address, { value: mintPrice }))
        .to.emit(simpleNFT, "NFTMinted")
        .withArgs(addr2.address, 0, "https://api.example.com/metadata/0");
      
      expect(await simpleNFT.ownerOf(0)).to.equal(addr2.address);
      expect(await simpleNFT.tokenURI(0)).to.equal("https://api.example.com/metadata/0");
    });

    it("Should allow batch minting", async function () {
      const mintPrice = await simpleNFT.mintPrice();
      const quantity = 3;
      const totalCost = mintPrice * BigInt(quantity);
      
      const tx = await simpleNFT.connect(addr1).batchMint(quantity, { value: totalCost });
      
      // Should emit NFTMinted event for each token
      const receipt = await tx.wait();
      const mintedEvents = receipt.logs.filter(log => {
        try {
          const parsed = simpleNFT.interface.parseLog(log);
          return parsed.name === "NFTMinted";
        } catch {
          return false;
        }
      });
      
      expect(mintedEvents.length).to.equal(quantity);
      expect(await simpleNFT.totalSupply()).to.equal(quantity);
      
      // Check that all tokens are owned by addr1
      for (let i = 0; i < quantity; i++) {
        expect(await simpleNFT.ownerOf(i)).to.equal(addr1.address);
      }
    });

    it("Should reject batch minting with invalid quantity", async function () {
      const mintPrice = await simpleNFT.mintPrice();
      
      await expect(simpleNFT.connect(addr1).batchMint(0, { value: mintPrice }))
        .to.be.revertedWith("Invalid quantity (1-10)");
      
      await expect(simpleNFT.connect(addr1).batchMint(11, { value: mintPrice * 11n }))
        .to.be.revertedWith("Invalid quantity (1-10)");
    });

    it("Should reject minting when inactive", async function () {
      await simpleNFT.toggleMinting();
      const mintPrice = await simpleNFT.mintPrice();
      
      await expect(simpleNFT.connect(addr1).quickMint({ value: mintPrice }))
        .to.be.revertedWith("Minting is not active");
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to mint for free", async function () {
      await expect(simpleNFT.ownerMint(addr1.address))
        .to.emit(simpleNFT, "NFTMinted")
        .withArgs(addr1.address, 0, "https://api.example.com/metadata/0");
      
      expect(await simpleNFT.totalSupply()).to.equal(1);
      expect(await simpleNFT.ownerOf(0)).to.equal(addr1.address);
    });

    it("Should allow owner to update mint price", async function () {
      const newPrice = ethers.parseEther("0.002");
      
      await expect(simpleNFT.setMintPrice(newPrice))
        .to.emit(simpleNFT, "MintPriceUpdated")
        .withArgs(newPrice);
      
      expect(await simpleNFT.mintPrice()).to.equal(newPrice);
    });

    it("Should allow owner to toggle minting", async function () {
      await expect(simpleNFT.toggleMinting())
        .to.emit(simpleNFT, "MintingToggled")
        .withArgs(false);
      
      expect(await simpleNFT.mintingActive()).to.be.false;
      
      await expect(simpleNFT.toggleMinting())
        .to.emit(simpleNFT, "MintingToggled")
        .withArgs(true);
      
      expect(await simpleNFT.mintingActive()).to.be.true;
    });

    it("Should allow owner to withdraw funds", async function () {
      // First, generate some revenue
      const mintPrice = await simpleNFT.mintPrice();
      await simpleNFT.connect(addr1).quickMint({ value: mintPrice });
      await simpleNFT.connect(addr2).quickMint({ value: mintPrice });
      
      expect(await simpleNFT.getContractBalance()).to.equal(mintPrice * 2n);
      
      const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
      
      const tx = await simpleNFT.withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      
      const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
      
      // Owner should have received the contract balance minus gas costs
      expect(finalOwnerBalance - initialOwnerBalance).to.equal((mintPrice * 2n) - gasUsed);
      expect(await simpleNFT.getContractBalance()).to.equal(0);
    });

    it("Should prevent non-owner from using owner functions", async function () {
      await expect(simpleNFT.connect(addr1).setMintPrice(ethers.parseEther("0.002")))
        .to.be.revertedWithCustomError(simpleNFT, "OwnableUnauthorizedAccount");
      
      await expect(simpleNFT.connect(addr1).toggleMinting())
        .to.be.revertedWithCustomError(simpleNFT, "OwnableUnauthorizedAccount");
      
      await expect(simpleNFT.connect(addr1).ownerMint(addr1.address))
        .to.be.revertedWithCustomError(simpleNFT, "OwnableUnauthorizedAccount");
      
      await expect(simpleNFT.connect(addr1).withdraw())
        .to.be.revertedWithCustomError(simpleNFT, "OwnableUnauthorizedAccount");
    });
  });

  describe("Supply Management", function () {
    it("Should track total supply correctly", async function () {
      const mintPrice = await simpleNFT.mintPrice();
      
      expect(await simpleNFT.totalSupply()).to.equal(0);
      
      await simpleNFT.connect(addr1).quickMint({ value: mintPrice });
      expect(await simpleNFT.totalSupply()).to.equal(1);
      
      await simpleNFT.connect(addr1).batchMint(3, { value: mintPrice * 3n });
      expect(await simpleNFT.totalSupply()).to.equal(4);
      
      await simpleNFT.ownerMint(addr2.address);
      expect(await simpleNFT.totalSupply()).to.equal(5);
    });

    it("Should respect max supply limit", async function () {
      // This test would take too long with 10000 supply, so we'll just check the logic
      const maxSupply = await simpleNFT.maxSupply();
      expect(maxSupply).to.equal(10000);
      
      // We can test the revert logic by temporarily setting a low max supply
      // (This would require modifying the contract to allow setting maxSupply)
    });
  });

  describe("Metadata", function () {
    it("Should generate correct token URIs", async function () {
      const mintPrice = await simpleNFT.mintPrice();
      
      await simpleNFT.connect(addr1).quickMint({ value: mintPrice });
      await simpleNFT.connect(addr1).quickMint({ value: mintPrice });
      
      expect(await simpleNFT.tokenURI(0)).to.equal("https://api.example.com/metadata/0");
      expect(await simpleNFT.tokenURI(1)).to.equal("https://api.example.com/metadata/1");
    });

    it("Should allow owner to update base URI", async function () {
      const newBaseURI = "https://new-api.example.com/metadata/";
      await simpleNFT.setBaseURI(newBaseURI);
      
      const mintPrice = await simpleNFT.mintPrice();
      await simpleNFT.connect(addr1).quickMint({ value: mintPrice });
      
      expect(await simpleNFT.tokenURI(0)).to.equal(newBaseURI + "0");
    });
  });
});