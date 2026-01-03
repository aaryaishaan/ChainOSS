const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("RewardsToken", function () {
  let rewardsToken;
  let owner, admin, distributor, user1, user2, user3;

  // Deploy fixture for efficiency
  async function deployRewardsTokenFixture() {
    const [owner, admin, distributor, user1, user2, user3] = await ethers.getSigners();
    
    const RewardsToken = await ethers.getContractFactory("RewardsToken");
    const rewardsToken = await RewardsToken.deploy();
    
    return { rewardsToken, owner, admin, distributor, user1, user2, user3 };
  }

  beforeEach(async function () {
    ({ rewardsToken, owner, admin, distributor, user1, user2, user3 } = 
      await loadFixture(deployRewardsTokenFixture));
  });

  describe("Deployment", function () {
    it("Should set the correct token metadata", async function () {
      expect(await rewardsToken.name()).to.equal("Community Rewards Token");
      expect(await rewardsToken.symbol()).to.equal("CRT");
      expect(await rewardsToken.decimals()).to.equal(18);
    });

    it("Should mint initial supply to owner", async function () {
      const initialSupply = ethers.parseEther("50000000"); // 50M tokens
      expect(await rewardsToken.balanceOf(owner.address)).to.equal(initialSupply);
      expect(await rewardsToken.totalSupply()).to.equal(initialSupply);
    });

    it("Should set owner as default admin", async function () {
      expect(await rewardsToken.hasRole(await rewardsToken.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
    });

    it("Should initialize with correct max supply", async function () {
      const maxSupply = ethers.parseEther("1000000000"); // 1B tokens
      expect(await rewardsToken.maxSupply()).to.equal(maxSupply);
    });
  });

  describe("Role Management", function () {
    it("Should allow admin to grant distributor role", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
      expect(await rewardsToken.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.true;
    });

    it("Should allow admin to revoke distributor role", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
      await rewardsToken.revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      
      expect(await rewardsToken.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.false;
    });

    it("Should not allow non-admin to grant roles", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      
      await expect(
        rewardsToken.connect(user1).grantRole(DISTRIBUTOR_ROLE, user2.address)
      ).to.be.reverted;
    });

    it("Should allow role renunciation", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
      await rewardsToken.connect(distributor).renounceRole(DISTRIBUTOR_ROLE, distributor.address);
      
      expect(await rewardsToken.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.false;
    });
  });

  describe("Minting", function () {
    beforeEach(async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
    });

    it("Should allow distributors to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await rewardsToken.connect(distributor).mint(user1.address, mintAmount);
      expect(await rewardsToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should update total supply after minting", async function () {
      const mintAmount = ethers.parseEther("5000");
      const initialSupply = await rewardsToken.totalSupply();
      
      await rewardsToken.connect(distributor).mint(user1.address, mintAmount);
      expect(await rewardsToken.totalSupply()).to.equal(initialSupply + mintAmount);
    });

    it("Should not allow minting to zero address", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(
        rewardsToken.connect(distributor).mint(ethers.ZeroAddress, mintAmount)
      ).to.be.revertedWith("ERC20: mint to the zero address");
    });

    it("Should not allow minting beyond max supply", async function () {
      const maxSupply = await rewardsToken.maxSupply();
      const currentSupply = await rewardsToken.totalSupply();
      const excessAmount = maxSupply - currentSupply + ethers.parseEther("1");
      
      await expect(
        rewardsToken.connect(distributor).mint(user1.address, excessAmount)
      ).to.be.revertedWith("Exceeds maximum supply");
    });

    it("Should not allow non-distributors to mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(
        rewardsToken.connect(user1).mint(user2.address, mintAmount)
      ).to.be.reverted;
    });

    it("Should emit Transfer event on mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(rewardsToken.connect(distributor).mint(user1.address, mintAmount))
        .to.emit(rewardsToken, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, mintAmount);
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      // Transfer some tokens to user1 for burning tests
      await rewardsToken.transfer(user1.address, ethers.parseEther("10000"));
    });

    it("Should allow token holders to burn their tokens", async function () {
      const burnAmount = ethers.parseEther("500");
      const initialBalance = await rewardsToken.balanceOf(user1.address);
      const initialSupply = await rewardsToken.totalSupply();
      
      await rewardsToken.connect(user1).burn(burnAmount);
      
      expect(await rewardsToken.balanceOf(user1.address)).to.equal(initialBalance - burnAmount);
      expect(await rewardsToken.totalSupply()).to.equal(initialSupply - burnAmount);
    });

    it("Should allow burning tokens from allowance", async function () {
      const burnAmount = ethers.parseEther("300");
      
      await rewardsToken.connect(user1).approve(user2.address, burnAmount);
      await rewardsToken.connect(user2).burnFrom(user1.address, burnAmount);
      
      expect(await rewardsToken.balanceOf(user1.address)).to.equal(ethers.parseEther("9700"));
    });

    it("Should not allow burning more than balance", async function () {
      const balance = await rewardsToken.balanceOf(user1.address);
      const excessAmount = balance + ethers.parseEther("1");
      
      await expect(
        rewardsToken.connect(user1).burn(excessAmount)
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });

    it("Should emit Transfer event on burn", async function () {
      const burnAmount = ethers.parseEther("500");
      
      await expect(rewardsToken.connect(user1).burn(burnAmount))
        .to.emit(rewardsToken, "Transfer")
        .withArgs(user1.address, ethers.ZeroAddress, burnAmount);
    });
  });

  describe("Pausing", function () {
    it("Should allow admin to pause the contract", async function () {
      await rewardsToken.pause();
      expect(await rewardsToken.paused()).to.be.true;
    });

    it("Should allow admin to unpause the contract", async function () {
      await rewardsToken.pause();
      await rewardsToken.unpause();
      expect(await rewardsToken.paused()).to.be.false;
    });

    it("Should not allow non-admin to pause", async function () {
      await expect(
        rewardsToken.connect(user1).pause()
      ).to.be.reverted;
    });

    it("Should prevent transfers when paused", async function () {
      await rewardsToken.pause();
      
      await expect(
        rewardsToken.transfer(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should prevent minting when paused", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
      
      await rewardsToken.pause();
      
      await expect(
        rewardsToken.connect(distributor).mint(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should prevent burning when paused", async function () {
      await rewardsToken.transfer(user1.address, ethers.parseEther("1000"));
      await rewardsToken.pause();
      
      await expect(
        rewardsToken.connect(user1).burn(ethers.parseEther("100"))
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should emit Paused and Unpaused events", async function () {
      await expect(rewardsToken.pause())
        .to.emit(rewardsToken, "Paused")
        .withArgs(owner.address);
      
      await expect(rewardsToken.unpause())
        .to.emit(rewardsToken, "Unpaused")
        .withArgs(owner.address);
    });
  });

  describe("Standard ERC20 Functionality", function () {
    beforeEach(async function () {
      await rewardsToken.transfer(user1.address, ethers.parseEther("5000"));
      await rewardsToken.transfer(user2.address, ethers.parseEther("3000"));
    });

    it("Should transfer tokens between accounts", async function () {
      const transferAmount = ethers.parseEther("1000");
      
      await rewardsToken.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await rewardsToken.balanceOf(user1.address)).to.equal(ethers.parseEther("4000"));
      expect(await rewardsToken.balanceOf(user2.address)).to.equal(ethers.parseEther("4000"));
    });

    it("Should handle approvals correctly", async function () {
      const approveAmount = ethers.parseEther("2000");
      
      await rewardsToken.connect(user1).approve(user2.address, approveAmount);
      expect(await rewardsToken.allowance(user1.address, user2.address)).to.equal(approveAmount);
    });

    it("Should handle transferFrom correctly", async function () {
      const approveAmount = ethers.parseEther("2000");
      const transferAmount = ethers.parseEther("1500");
      
      await rewardsToken.connect(user1).approve(user2.address, approveAmount);
      await rewardsToken.connect(user2).transferFrom(user1.address, user3.address, transferAmount);
      
      expect(await rewardsToken.balanceOf(user3.address)).to.equal(transferAmount);
      expect(await rewardsToken.allowance(user1.address, user2.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should not allow transfer of more than balance", async function () {
      const balance = await rewardsToken.balanceOf(user1.address);
      const excessAmount = balance + ethers.parseEther("1");
      
      await expect(
        rewardsToken.connect(user1).transfer(user2.address, excessAmount)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("Should not allow transferFrom more than allowance", async function () {
      const approveAmount = ethers.parseEther("1000");
      const transferAmount = ethers.parseEther("1500");
      
      await rewardsToken.connect(user1).approve(user2.address, approveAmount);
      
      await expect(
        rewardsToken.connect(user2).transferFrom(user1.address, user3.address, transferAmount)
      ).to.be.revertedWith("ERC20: insufficient allowance");
    });
  });

  describe("Batch Operations", function () {
    beforeEach(async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
    });

    it("Should allow batch minting to multiple recipients", async function () {
      const recipients = [user1.address, user2.address, user3.address];
      const amounts = [
        ethers.parseEther("1000"),
        ethers.parseEther("1500"),
        ethers.parseEther("2000")
      ];
      
      await rewardsToken.connect(distributor).batchMint(recipients, amounts);
      
      expect(await rewardsToken.balanceOf(user1.address)).to.equal(amounts[0]);
      expect(await rewardsToken.balanceOf(user2.address)).to.equal(amounts[1]);
      expect(await rewardsToken.balanceOf(user3.address)).to.equal(amounts[2]);
    });

    it("Should revert batch mint if arrays length mismatch", async function () {
      const recipients = [user1.address, user2.address];
      const amounts = [ethers.parseEther("1000")]; // Mismatched length
      
      await expect(
        rewardsToken.connect(distributor).batchMint(recipients, amounts)
      ).to.be.revertedWith("Arrays length mismatch");
    });

    it("Should revert batch mint if would exceed max supply", async function () {
      const maxSupply = await rewardsToken.maxSupply();
      const currentSupply = await rewardsToken.totalSupply();
      const availableSupply = maxSupply - currentSupply;
      
      const recipients = [user1.address];
      const amounts = [availableSupply + ethers.parseEther("1")];
      
      await expect(
        rewardsToken.connect(distributor).batchMint(recipients, amounts)
      ).to.be.revertedWith("Exceeds maximum supply");
    });
  });

  describe("Supply Management", function () {
    it("Should track total supply correctly after multiple operations", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
      
      const initialSupply = await rewardsToken.totalSupply();
      const mintAmount = ethers.parseEther("5000");
      const burnAmount = ethers.parseEther("2000");
      
      // Mint tokens
      await rewardsToken.connect(distributor).mint(user1.address, mintAmount);
      expect(await rewardsToken.totalSupply()).to.equal(initialSupply + mintAmount);
      
      // Burn tokens
      await rewardsToken.connect(user1).burn(burnAmount);
      expect(await rewardsToken.totalSupply()).to.equal(initialSupply + mintAmount - burnAmount);
    });

    it("Should not allow setting max supply below current supply", async function () {
      const currentSupply = await rewardsToken.totalSupply();
      const newMaxSupply = currentSupply - ethers.parseEther("1");
      
      await expect(
        rewardsToken.setMaxSupply(newMaxSupply)
      ).to.be.revertedWith("Max supply cannot be less than current supply");
    });

    it("Should allow admin to update max supply", async function () {
      const newMaxSupply = ethers.parseEther("2000000000"); // 2B tokens
      
      await rewardsToken.setMaxSupply(newMaxSupply);
      expect(await rewardsToken.maxSupply()).to.equal(newMaxSupply);
    });
  });

  describe("Events", function () {
    it("Should emit RoleGranted event", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      
      await expect(rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address))
        .to.emit(rewardsToken, "RoleGranted")
        .withArgs(DISTRIBUTOR_ROLE, distributor.address, owner.address);
    });

    it("Should emit Transfer events for standard operations", async function () {
      const amount = ethers.parseEther("1000");
      
      await expect(rewardsToken.transfer(user1.address, amount))
        .to.emit(rewardsToken, "Transfer")
        .withArgs(owner.address, user1.address, amount);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero amount transfers", async function () {
      await expect(rewardsToken.transfer(user1.address, 0))
        .to.not.be.reverted;
      
      expect(await rewardsToken.balanceOf(user1.address)).to.equal(0);
    });

    it("Should handle self-transfers", async function () {
      const amount = ethers.parseEther("1000");
      const initialBalance = await rewardsToken.balanceOf(owner.address);
      
      await rewardsToken.transfer(owner.address, amount);
      expect(await rewardsToken.balanceOf(owner.address)).to.equal(initialBalance);
    });

    it("Should maintain precision with large numbers", async function () {
      const DISTRIBUTOR_ROLE = await rewardsToken.DISTRIBUTOR_ROLE();
      await rewardsToken.grantRole(DISTRIBUTOR_ROLE, distributor.address);
      
      const largeAmount = ethers.parseEther("999999999.999999999999999999");
      
      await rewardsToken.connect(distributor).mint(user1.address, largeAmount);
      expect(await rewardsToken.balanceOf(user1.address)).to.equal(largeAmount);
    });
  });
});