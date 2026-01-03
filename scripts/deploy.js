const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting deployment to", network.name);
  
  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy OSS Token
  console.log("\n📦 Deploying OSS Token...");
  const OSSToken = await ethers.getContractFactory("OSSToken");
  const ossToken = await OSSToken.deploy();
  await ossToken.waitForDeployment();
  const ossTokenAddress = await ossToken.getAddress();
  console.log("✅ OSS Token deployed to:", ossTokenAddress);

  // Deploy OSS Rewards
  console.log("\n📦 Deploying OSS Rewards...");
  const OSSRewards = await ethers.getContractFactory("OSSRewards");
  const ossRewards = await OSSRewards.deploy(ossTokenAddress);
  await ossRewards.waitForDeployment();
  const ossRewardsAddress = await ossRewards.getAddress();
  console.log("✅ OSS Rewards deployed to:", ossRewardsAddress);

  // Deploy DAO
  console.log("\n📦 Deploying DAO...");
  const OSSDAO = await ethers.getContractFactory("OSSDAO");
  const ossDAO = await OSSDAO.deploy(ossTokenAddress);
  await ossDAO.waitForDeployment();
  const ossDAOAddress = await ossDAO.getAddress();
  console.log("✅ DAO deployed to:", ossDAOAddress);

  // Setup permissions
  console.log("\n🔧 Setting up permissions...");
  
  // Add OSS Rewards as a minter for the token
  const addMinterTx = await ossToken.addMinter(ossRewardsAddress);
  await addMinterTx.wait();
  console.log("✅ Added OSS Rewards as token minter");

  // Transfer some tokens to the DAO for governance
  const transferAmount = ethers.parseEther("1000000"); // 1M tokens
  const transferTx = await ossToken.transfer(ossDAOAddress, transferAmount);
  await transferTx.wait();
  console.log("✅ Transferred 1M tokens to DAO treasury");

  // Create deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      OSSToken: {
        address: ossTokenAddress,
        name: "Open Source Rewards",
        symbol: "OSS"
      },
      OSSRewards: {
        address: ossRewardsAddress
      },
      OSSDAO: {
        address: ossDAOAddress
      }
    },
    transactions: {
      addMinter: addMinterTx.hash,
      transferToDAO: transferTx.hash
    }
  };

  // Save deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const deploymentFile = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log("📄 Deployment info saved to:", deploymentFile);

  // Update frontend config
  const frontendConfigPath = path.join(__dirname, "..", "src", "utils", "contracts.js");
  const frontendConfig = `// Auto-generated contract addresses - DO NOT EDIT MANUALLY
// This file is updated by the deployment script

export const CONTRACT_ADDRESSES = {
  TOKEN: "${ossTokenAddress}",
  REWARDS: "${ossRewardsAddress}",
  DAO: "${ossDAOAddress}",
};

export const DEPLOYMENT_INFO = {
  network: "${network.name}",
  chainId: ${network.config.chainId},
  deployedAt: "${deploymentInfo.timestamp}",
  deployer: "${deployer.address}",
  gasUsed: {
    token: 0, // Will be updated with actual gas usage
    rewards: 0,
    dao: 0,
  },
};
`;

  fs.writeFileSync(frontendConfigPath, frontendConfig);
  console.log("🎨 Frontend config updated:", frontendConfigPath);

  console.log("\n🎉 Deployment completed successfully!");
  console.log("\n📋 Summary:");
  console.log("═══════════════════════════════════");
  console.log("🪙 OSS Token:", ossTokenAddress);
  console.log("🎁 OSS Rewards:", ossRewardsAddress);
  console.log("🏛️  DAO:", ossDAOAddress);
  console.log("═══════════════════════════════════");
  
  if (network.name === "holesky") {
    console.log("\n🔍 Verify contracts on Etherscan:");
    console.log(`npx hardhat verify --network holesky ${ossTokenAddress}`);
    console.log(`npx hardhat verify --network holesky ${ossRewardsAddress} ${ossTokenAddress}`);
    console.log(`npx hardhat verify --network holesky ${ossDAOAddress} ${ossTokenAddress}`);
  }

  console.log("\n💡 Next steps:");
  console.log("1. Update your frontend to use the new contract addresses");
  console.log("2. Test the contracts on the network");
  console.log("3. Add initial contributions and proposals");
  console.log("4. Distribute initial tokens to early contributors");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }); 