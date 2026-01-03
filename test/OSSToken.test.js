const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OSSToken", function () {
  let ossToken;
  let owner, minter, user1, user2;

  beforeEach(async function () {
    [owner, minter, user1, user2] = await ethers.getSigners();

    const OSSToken = await ethers.getContractFactory("OSSToken");
    ossToken = await OSSToken.deploy();
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await ossToken.name()).to.equal("Open Source Rewards");
      expect(await ossToken.symbol()).to.equal("OSS");
    });

    it("Should mint initial supply to deployer", async function () {
      const initialSupply = ethers.parseEther("10000000");
      expect(await ossToken.balanceOf(owner.address)).to.equal(initialSupply);
    });

    it("Should set the right decimals", async function () {
      expect(await ossToken.decimals()).to.equal(18);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to add minters", async function () {
      await ossToken.addMinter(minter.address);
      expect(await ossToken.minters(minter.address)).to.be.true;
    });

    it("Should allow minters to mint tokens", async function () {
      await ossToken.addMinter(minter.address);
      const mintAmount = ethers.parseEther("1000");
      
      await ossToken.connect(minter).mint(user1.address, mintAmount);
      expect(await ossToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should not allow non-minters to mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(
        ossToken.connect(user1).mint(user2.address, mintAmount)
      ).to.be.revertedWith("Not authorized to mint");
    });

    it("Should not allow minting beyond max supply", async function () {
      await ossToken.addMinter(minter.address);
      const maxSupply = ethers.parseEther("100000000");
      const currentSupply = await ossToken.totalSupply();
      const excessAmount = maxSupply - currentSupply + ethers.parseEther("1");
      
      await expect(
        ossToken.connect(minter).mint(user1.address, excessAmount)
      ).to.be.revertedWith("Would exceed max supply");
    });
  });

  describe("Burning", function () {
    it("Should allow users to burn their tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      const initialBalance = await ossToken.balanceOf(owner.address);
      
      await ossToken.burn(burnAmount);
      expect(await ossToken.balanceOf(owner.address)).to.equal(initialBalance - burnAmount);
    });
  });

  describe("Pausing", function () {
    it("Should allow owner to pause and unpause", async function () {
      await ossToken.pause();
      expect(await ossToken.paused()).to.be.true;
      
      await ossToken.unpause();
      expect(await ossToken.paused()).to.be.false;
    });

    it("Should prevent transfers when paused", async function () {
      await ossToken.pause();
      
      await expect(
        ossToken.transfer(user1.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });
  });
}); 