const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

describe("TrendingPayment", function () {
  // We define a fixture to reuse the same setup in every test.
  async function deployTrendingPaymentFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    const TrendingPayment = await ethers.getContractFactory("TrendingPayment");
    const trendingPayment = await TrendingPayment.deploy();

    return { trendingPayment, owner, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { trendingPayment, owner } = await loadFixture(deployTrendingPaymentFixture);

      expect(await trendingPayment.owner()).to.equal(owner.address);
    });

    it("Should set the correct base fee", async function () {
      const { trendingPayment } = await loadFixture(deployTrendingPaymentFixture);

      expect(await trendingPayment.baseFee()).to.equal(ethers.parseEther("0.01"));
    });

    it("Should start with payment counter at 0", async function () {
      const { trendingPayment } = await loadFixture(deployTrendingPaymentFixture);

      expect(await trendingPayment.paymentCounter()).to.equal(0);
    });
  });

  describe("Fee Calculation", function () {
    it("Should calculate correct fee for 1 hour", async function () {
      const { trendingPayment } = await loadFixture(deployTrendingPaymentFixture);

      const fee = await trendingPayment.calculateFee(1);
      // Base fee (0.01 ETH) + 1 hour (0.001 ETH) = 0.011 ETH
      expect(fee).to.equal(ethers.parseEther("0.011"));
    });

    it("Should calculate correct fee for 24 hours", async function () {
      const { trendingPayment } = await loadFixture(deployTrendingPaymentFixture);

      const fee = await trendingPayment.calculateFee(24);
      // Base fee (0.01 ETH) + 24 hours (0.024 ETH) = 0.034 ETH
      expect(fee).to.equal(ethers.parseEther("0.034"));
    });

    it("Should calculate correct fee for 168 hours (1 week)", async function () {
      const { trendingPayment } = await loadFixture(deployTrendingPaymentFixture);

      const fee = await trendingPayment.calculateFee(168);
      // Base fee (0.01 ETH) + 168 hours (0.168 ETH) = 0.178 ETH
      expect(fee).to.equal(ethers.parseEther("0.178"));
    });
  });

  describe("Trending Payments", function () {
    it("Should accept valid trending payment", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 24; // 24 hours
      const requiredFee = await trendingPayment.calculateFee(duration);

      await expect(
        trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: requiredFee })
      ).to.emit(trendingPayment, "PaymentReceived")
        .withArgs(1, otherAccount.address, anyValue, requiredFee, duration);

      expect(await trendingPayment.paymentCounter()).to.equal(1);
    });

    it("Should reject payment with insufficient amount", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 24;
      const requiredFee = await trendingPayment.calculateFee(duration);
      const insufficientFee = requiredFee - ethers.parseEther("0.001"); // 0.001 ETH less

      await expect(
        trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: insufficientFee })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("Should reject payment with duration too short", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 0; // Invalid duration
      const requiredFee = ethers.parseEther("0.01");

      await expect(
        trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: requiredFee })
      ).to.be.revertedWith("Duration must be 1-168 hours");
    });

    it("Should reject payment with duration too long", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 169; // Too long (max is 168 hours)
      const requiredFee = ethers.parseEther("0.18");

      await expect(
        trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: requiredFee })
      ).to.be.revertedWith("Duration must be 1-168 hours");
    });

    it("Should reject payment with invalid token address", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const invalidTokenAddress = "0x123"; // Too short
      const duration = 24;
      const requiredFee = await trendingPayment.calculateFee(duration);

      await expect(
        trendingPayment.connect(otherAccount).payForTrending(invalidTokenAddress, duration, { value: requiredFee })
      ).to.be.revertedWith("Invalid token address format");
    });
  });

  describe("Payment Status", function () {
    it("Should correctly identify active payments", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 24;
      const requiredFee = await trendingPayment.calculateFee(duration);

      // Make a payment
      await trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: requiredFee });

      // Payment should be active
      expect(await trendingPayment.isPaymentActive(1)).to.be.true;
    });

    it("Should correctly identify expired payments", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 1; // 1 hour
      const requiredFee = await trendingPayment.calculateFee(duration);

      // Make a payment
      await trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: requiredFee });

      // Fast forward time by 2 hours
      await time.increase(2 * 60 * 60); // 2 hours in seconds

      // Payment should now be expired
      expect(await trendingPayment.isPaymentActive(1)).to.be.false;
    });

    it("Should return correct payment details", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 24;
      const requiredFee = await trendingPayment.calculateFee(duration);

      // Make a payment
      await trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: requiredFee });

      // Get payment details
      const [payer, amount, timestamp, returnedDuration, returnedTokenAddress, isActive, isExpired] = 
        await trendingPayment.getPayment(1);

      expect(payer).to.equal(otherAccount.address);
      expect(amount).to.equal(requiredFee);
      expect(returnedDuration).to.equal(duration);
      expect(returnedTokenAddress).to.equal(tokenAddress);
      expect(isActive).to.be.true;
      expect(isExpired).to.be.false;
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to withdraw funds", async function () {
      const { trendingPayment, owner, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const tokenAddress = "0x1234567890123456789012345678901234567890";
      const duration = 24;
      const requiredFee = await trendingPayment.calculateFee(duration);

      // Make a payment
      await trendingPayment.connect(otherAccount).payForTrending(tokenAddress, duration, { value: requiredFee });

      // Check contract balance
      expect(await trendingPayment.getContractBalance()).to.equal(requiredFee);

      // Owner withdraws
      await expect(trendingPayment.connect(owner).withdraw())
        .to.changeEtherBalance(owner, requiredFee);

      // Contract balance should be 0
      expect(await trendingPayment.getContractBalance()).to.equal(0);
    });

    it("Should prevent non-owner from withdrawing", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      await expect(
        trendingPayment.connect(otherAccount).withdraw()
      ).to.be.revertedWith("Not the contract owner");
    });

    it("Should allow owner to update base fee", async function () {
      const { trendingPayment, owner } = await loadFixture(deployTrendingPaymentFixture);

      const newBaseFee = ethers.parseEther("0.02"); // 0.02 ETH

      await trendingPayment.connect(owner).updateBaseFee(newBaseFee);
      expect(await trendingPayment.baseFee()).to.equal(newBaseFee);
    });

    it("Should prevent non-owner from updating base fee", async function () {
      const { trendingPayment, otherAccount } = await loadFixture(deployTrendingPaymentFixture);

      const newBaseFee = ethers.parseEther("0.02");

      await expect(
        trendingPayment.connect(otherAccount).updateBaseFee(newBaseFee)
      ).to.be.revertedWith("Not the contract owner");
    });
  });
});