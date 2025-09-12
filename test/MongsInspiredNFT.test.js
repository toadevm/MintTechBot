const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MongsInspiredNFT", function () {
    let mongsNFT;
    let owner;
    let addr1, addr2, addr3;
    const PROJECT_SCALE = 1000000;

    beforeEach(async function () {
        [owner, addr1, addr2, addr3] = await ethers.getSigners();
        
        const MongsInspiredNFT = await ethers.getContractFactory("MongsInspiredNFT");
        mongsNFT = await MongsInspiredNFT.deploy("MONGS Inspired", "MINGSNFT");
        await mongsNFT.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await mongsNFT.owner()).to.equal(owner.address);
        });

        it("Should set the correct name and symbol", async function () {
            expect(await mongsNFT.name()).to.equal("MONGS Inspired");
            expect(await mongsNFT.symbol()).to.equal("MINGSNFT");
        });

        it("Should have correct PROJECT_SCALE constant", async function () {
            expect(await mongsNFT.PROJECT_SCALE()).to.equal(PROJECT_SCALE);
        });

        it("Should start with project ID 0", async function () {
            expect(await mongsNFT.getCurrentProjectId()).to.equal(0);
        });
    });

    describe("Project Management", function () {
        it("Should allow owner to create a project", async function () {
            await expect(mongsNFT.createProject(
                "Test Project",
                100,
                ethers.parseEther("0.1"),
                "https://test.com/"
            )).to.emit(mongsNFT, "ProjectCreated")
              .withArgs(0, "Test Project", 100, ethers.parseEther("0.1"));

            const projectInfo = await mongsNFT.getProjectInfo(0);
            expect(projectInfo[0]).to.equal("Test Project");
            expect(projectInfo[1]).to.equal(100);
            expect(projectInfo[2]).to.equal(ethers.parseEther("0.1"));
            expect(projectInfo[3]).to.equal(0);
            expect(projectInfo[4]).to.equal(true);
            expect(projectInfo[5]).to.equal("https://test.com/");
        });

        it("Should increment project ID after creation", async function () {
            await mongsNFT.createProject("Project 1", 100, ethers.parseEther("0.1"), "");
            expect(await mongsNFT.getCurrentProjectId()).to.equal(1);
            
            await mongsNFT.createProject("Project 2", 200, ethers.parseEther("0.2"), "");
            expect(await mongsNFT.getCurrentProjectId()).to.equal(2);
        });

        it("Should not allow non-owner to create project", async function () {
            await expect(mongsNFT.connect(addr1).createProject(
                "Test Project",
                100,
                ethers.parseEther("0.1"),
                ""
            )).to.be.revertedWithCustomError(mongsNFT, "OwnableUnauthorizedAccount");
        });

        it("Should not allow empty project name", async function () {
            await expect(mongsNFT.createProject(
                "",
                100,
                ethers.parseEther("0.1"),
                ""
            )).to.be.revertedWith("Project name cannot be empty");
        });

        it("Should not allow zero max supply", async function () {
            await expect(mongsNFT.createProject(
                "Test Project",
                0,
                ethers.parseEther("0.1"),
                ""
            )).to.be.revertedWith("Max supply must be greater than 0");
        });

        it("Should allow owner to toggle project status", async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
            
            await expect(mongsNFT.toggleProject(0))
                .to.emit(mongsNFT, "ProjectToggled")
                .withArgs(0, false);
            
            const projectInfo = await mongsNFT.getProjectInfo(0);
            expect(projectInfo[4]).to.equal(false);
            
            await mongsNFT.toggleProject(0);
            const projectInfoAfter = await mongsNFT.getProjectInfo(0);
            expect(projectInfoAfter[4]).to.equal(true);
        });

        it("Should not allow toggling non-existent project", async function () {
            await expect(mongsNFT.toggleProject(0))
                .to.be.revertedWith("Project does not exist");
        });

        it("Should allow owner to set project URI", async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
            
            await expect(mongsNFT.setProjectURI(0, "https://newuri.com/"))
                .to.emit(mongsNFT, "ProjectURIUpdated")
                .withArgs(0, "https://newuri.com/");
            
            const projectInfo = await mongsNFT.getProjectInfo(0);
            expect(projectInfo[5]).to.equal("https://newuri.com/");
        });
    });

    describe("Token ID Architecture", function () {
        it("Should construct token IDs correctly using PROJECT_SCALE", async function () {
            const projectId = 5;
            const mintNumber = 123;
            const expectedTokenId = (projectId * PROJECT_SCALE) + mintNumber;
            
            const tokenId = await mongsNFT.constructTokenId(projectId, mintNumber);
            expect(tokenId).to.equal(expectedTokenId);
        });

        it("Should deconstruct token IDs correctly", async function () {
            const projectId = 7;
            const mintNumber = 456;
            const tokenId = (projectId * PROJECT_SCALE) + mintNumber;
            
            const [deconstructedProjectId, deconstructedMintNumber] = await mongsNFT.deconstructTokenId(tokenId);
            expect(deconstructedProjectId).to.equal(projectId);
            expect(deconstructedMintNumber).to.equal(mintNumber);
        });

        it("Should handle edge cases in token ID construction", async function () {
            const tokenId1 = await mongsNFT.constructTokenId(0, 1);
            expect(tokenId1).to.equal(1);
            
            const tokenId2 = await mongsNFT.constructTokenId(1, 0);
            expect(tokenId2).to.equal(PROJECT_SCALE);
            
            const tokenId3 = await mongsNFT.constructTokenId(999, 999999);
            expect(tokenId3).to.equal((999 * PROJECT_SCALE) + 999999);
        });
    });

    describe("Minting", function () {
        beforeEach(async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
        });

        it("Should allow minting with correct payment", async function () {
            const tokenId = (0 * PROJECT_SCALE) + 1;
            
            await expect(mongsNFT.connect(addr1).mintNFT(0, addr1.address, {
                value: ethers.parseEther("0.1")
            })).to.emit(mongsNFT, "TokenMinted")
              .withArgs(tokenId, 0, 1, addr1.address);
            
            expect(await mongsNFT.ownerOf(tokenId)).to.equal(addr1.address);
            expect(await mongsNFT.getTokenProject(tokenId)).to.equal(0);
            expect(await mongsNFT.getTokenMintNumber(tokenId)).to.equal(1);
            
            const projectInfo = await mongsNFT.getProjectInfo(0);
            expect(projectInfo[3]).to.equal(1);
        });

        it("Should allow owner to mint without payment", async function () {
            const tokenId = (0 * PROJECT_SCALE) + 1;
            
            await expect(mongsNFT.ownerMint(0, addr1.address))
                .to.emit(mongsNFT, "TokenMinted")
                .withArgs(tokenId, 0, 1, addr1.address);
            
            expect(await mongsNFT.ownerOf(tokenId)).to.equal(addr1.address);
        });

        it("Should increment mint numbers correctly", async function () {
            await mongsNFT.connect(addr1).mintNFT(0, addr1.address, { value: ethers.parseEther("0.1") });
            await mongsNFT.connect(addr2).mintNFT(0, addr2.address, { value: ethers.parseEther("0.1") });
            
            const token1 = (0 * PROJECT_SCALE) + 1;
            const token2 = (0 * PROJECT_SCALE) + 2;
            
            expect(await mongsNFT.getTokenMintNumber(token1)).to.equal(1);
            expect(await mongsNFT.getTokenMintNumber(token2)).to.equal(2);
        });

        it("Should not allow minting inactive project", async function () {
            await mongsNFT.toggleProject(0);
            
            await expect(mongsNFT.connect(addr1).mintNFT(0, addr1.address, {
                value: ethers.parseEther("0.1")
            })).to.be.revertedWith("Project is not active");
        });

        it("Should not allow minting non-existent project", async function () {
            await expect(mongsNFT.connect(addr1).mintNFT(1, addr1.address, {
                value: ethers.parseEther("0.1")
            })).to.be.revertedWith("Project does not exist");
        });

        it("Should not allow minting with insufficient payment", async function () {
            await expect(mongsNFT.connect(addr1).mintNFT(0, addr1.address, {
                value: ethers.parseEther("0.05")
            })).to.be.revertedWith("Insufficient payment");
        });

        it("Should refund excess payment", async function () {
            const balanceBefore = await ethers.provider.getBalance(addr1.address);
            
            const tx = await mongsNFT.connect(addr1).mintNFT(0, addr1.address, {
                value: ethers.parseEther("0.2")
            });
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * tx.gasPrice;
            
            const balanceAfter = await ethers.provider.getBalance(addr1.address);
            const expectedBalance = balanceBefore - ethers.parseEther("0.1") - gasUsed;
            
            expect(balanceAfter).to.be.closeTo(expectedBalance, ethers.parseEther("0.001"));
        });

        it("Should not allow minting when project is sold out", async function () {
            await mongsNFT.createProject("Small Project", 1, ethers.parseEther("0.1"), "");
            
            await mongsNFT.connect(addr1).mintNFT(1, addr1.address, { value: ethers.parseEther("0.1") });
            
            await expect(mongsNFT.connect(addr2).mintNFT(1, addr2.address, {
                value: ethers.parseEther("0.1")
            })).to.be.revertedWith("Project sold out");
        });
    });

    describe("Token URI", function () {
        beforeEach(async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "https://project.com/");
            await mongsNFT.connect(addr1).mintNFT(0, addr1.address, { value: ethers.parseEther("0.1") });
        });

        it("Should return project URI when set", async function () {
            const tokenId = (0 * PROJECT_SCALE) + 1;
            const uri = await mongsNFT.tokenURI(tokenId);
            expect(uri).to.equal("https://project.com/" + tokenId.toString());
        });

        it("Should return base URI when project URI is empty", async function () {
            await mongsNFT.createProject("Base Project", 100, ethers.parseEther("0.1"), "");
            await mongsNFT.connect(addr1).mintNFT(1, addr1.address, { value: ethers.parseEther("0.1") });
            
            const tokenId = (1 * PROJECT_SCALE) + 1;
            const uri = await mongsNFT.tokenURI(tokenId);
            expect(uri).to.equal("https://mongs.io/nft/" + tokenId.toString());
        });

        it("Should allow owner to set base URI", async function () {
            await mongsNFT.setBaseURI("https://newbase.com/");
            
            await mongsNFT.createProject("Base Project", 100, ethers.parseEther("0.1"), "");
            await mongsNFT.connect(addr1).mintNFT(1, addr1.address, { value: ethers.parseEther("0.1") });
            
            const tokenId = (1 * PROJECT_SCALE) + 1;
            const uri = await mongsNFT.tokenURI(tokenId);
            expect(uri).to.equal("https://newbase.com/" + tokenId.toString());
        });

        it("Should revert for non-existent token", async function () {
            await expect(mongsNFT.tokenURI(999999))
                .to.be.revertedWith("ERC721: invalid token ID");
        });
    });

    describe("Token Information Queries", function () {
        beforeEach(async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
            await mongsNFT.connect(addr1).mintNFT(0, addr1.address, { value: ethers.parseEther("0.1") });
        });

        it("Should return correct token project", async function () {
            const tokenId = (0 * PROJECT_SCALE) + 1;
            expect(await mongsNFT.getTokenProject(tokenId)).to.equal(0);
        });

        it("Should return correct token mint number", async function () {
            const tokenId = (0 * PROJECT_SCALE) + 1;
            expect(await mongsNFT.getTokenMintNumber(tokenId)).to.equal(1);
        });

        it("Should revert for non-existent token queries", async function () {
            await expect(mongsNFT.getTokenProject(999999))
                .to.be.revertedWith("ERC721: invalid token ID");
                
            await expect(mongsNFT.getTokenMintNumber(999999))
                .to.be.revertedWith("ERC721: invalid token ID");
        });
    });

    describe("Project Existence", function () {
        it("Should return false for non-existent project", async function () {
            expect(await mongsNFT.projectExists(0)).to.be.false;
            expect(await mongsNFT.projectExists(999)).to.be.false;
        });

        it("Should return true for existing project", async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
            expect(await mongsNFT.projectExists(0)).to.be.true;
        });
    });

    describe("Withdrawal", function () {
        beforeEach(async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
        });

        it("Should allow owner to withdraw funds", async function () {
            await mongsNFT.connect(addr1).mintNFT(0, addr1.address, { value: ethers.parseEther("0.1") });
            await mongsNFT.connect(addr2).mintNFT(0, addr2.address, { value: ethers.parseEther("0.1") });
            
            const contractBalance = await ethers.provider.getBalance(await mongsNFT.getAddress());
            expect(contractBalance).to.equal(ethers.parseEther("0.2"));
            
            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
            await mongsNFT.withdraw();
            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
            
            expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
        });

        it("Should not allow non-owner to withdraw", async function () {
            await expect(mongsNFT.connect(addr1).withdraw())
                .to.be.revertedWithCustomError(mongsNFT, "OwnableUnauthorizedAccount");
        });

        it("Should revert when no funds to withdraw", async function () {
            await expect(mongsNFT.withdraw())
                .to.be.revertedWith("No funds to withdraw");
        });
    });

    describe("Access Control", function () {
        it("Should not allow non-owner to set base URI", async function () {
            await expect(mongsNFT.connect(addr1).setBaseURI("https://hack.com/"))
                .to.be.revertedWithCustomError(mongsNFT, "OwnableUnauthorizedAccount");
        });

        it("Should not allow non-owner to set project URI", async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
            await expect(mongsNFT.connect(addr1).setProjectURI(0, "https://hack.com/"))
                .to.be.revertedWithCustomError(mongsNFT, "OwnableUnauthorizedAccount");
        });

        it("Should not allow non-owner to owner mint", async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
            await expect(mongsNFT.connect(addr1).ownerMint(0, addr1.address))
                .to.be.revertedWithCustomError(mongsNFT, "OwnableUnauthorizedAccount");
        });
    });

    describe("Maximum Projects", function () {
        it("Should enforce maximum project limit", async function () {
            for (let i = 0; i < 999; i++) {
                await mongsNFT.createProject(`Project ${i}`, 10, 0, "");
            }
            
            await expect(mongsNFT.createProject("Over Limit", 10, 0, ""))
                .to.be.revertedWith("Maximum projects reached");
        }).timeout(60000);
    });

    describe("ERC721 Compliance", function () {
        beforeEach(async function () {
            await mongsNFT.createProject("Test Project", 100, ethers.parseEther("0.1"), "");
            await mongsNFT.connect(addr1).mintNFT(0, addr1.address, { value: ethers.parseEther("0.1") });
        });

        it("Should support standard ERC721 functions", async function () {
            const tokenId = (0 * PROJECT_SCALE) + 1;
            
            expect(await mongsNFT.balanceOf(addr1.address)).to.equal(1);
            expect(await mongsNFT.ownerOf(tokenId)).to.equal(addr1.address);
            
            await mongsNFT.connect(addr1).approve(addr2.address, tokenId);
            expect(await mongsNFT.getApproved(tokenId)).to.equal(addr2.address);
            
            await mongsNFT.connect(addr2).transferFrom(addr1.address, addr3.address, tokenId);
            expect(await mongsNFT.ownerOf(tokenId)).to.equal(addr3.address);
        });
    });
});