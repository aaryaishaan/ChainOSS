import { ethers } from 'ethers';

// Import contract addresses - will be empty until deployment
import { CONTRACT_ADDRESSES as IMPORTED_ADDRESSES } from './contracts';

// Holesky testnet configuration
export const HOLESKY_CHAIN_ID = 17000;
export const HOLESKY_RPC_URL = 'https://ethereum-holesky.publicnode.com';

export const HOLESKY_NETWORK = {
  chainId: `0x${HOLESKY_CHAIN_ID.toString(16)}`,
  chainName: 'Holesky Testnet',
  nativeCurrency: {
    name: 'Holešky ETH',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: [HOLESKY_RPC_URL],
  blockExplorerUrls: ['https://holesky.etherscan.io/'],
};

// Use imported contract addresses
const CONTRACT_ADDRESSES = IMPORTED_ADDRESSES;

// Contract ABIs
const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function mint(address to, uint256 amount)',
  'function burn(uint256 amount)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

const REWARDS_ABI = [
  'function submitContribution(string memory title, string memory description, string memory projectUrl, string memory githubPR, uint8 category)',
  'function validateContribution(uint256 contributionId, bool approve)',
  'function claimReward(uint256 contributionId)',
  'function getContribution(uint256 contributionId) view returns (tuple(uint256 id, address contributor, string title, string description, string projectUrl, string githubPR, uint8 category, uint256 submissionTime, uint256 stakeAmount, uint256 approvalVotes, uint256 rejectionVotes, uint256 totalValidators, uint8 status, uint256 rewardAmount, bool claimed))',
  'function getUserContributions(address user) view returns (uint256[])',
  'function registerValidator()',
  'function validators(address) view returns (tuple(bool isActive, uint256 stakedAmount, uint256 validationsCount, uint256 accuracyScore, uint256 rewardsEarned, uint256 registrationTime))',
  'function claimValidatorRewards()',
  'function nextContributionId() view returns (uint256)',
  'function activeValidators(uint256) view returns (address)',
  'function getActiveValidatorsCount() view returns (uint256)',
  'event ContributionSubmitted(uint256 indexed contributionId, address indexed contributor, uint8 category, uint256 stakeAmount)',
  'event ValidationSubmitted(uint256 indexed contributionId, address indexed validator, bool approved)',
  'event ContributionFinalized(uint256 indexed contributionId, uint8 status, uint256 rewardAmount)',
  'event ValidatorRegistered(address indexed validator, uint256 stakedAmount)',
  'event RewardClaimed(uint256 indexed contributionId, address indexed contributor, uint256 amount)'
];

// Enums
export const ContributionCategory = {
  BugFix: 0,
  Feature: 1,
  Security: 2,
  Documentation: 3,
  Performance: 4,
  Research: 5,
};

export const ProposalType = {
  General: 0,
  RewardUpdate: 1,
  ParameterChange: 2,
  ContractUpgrade: 3,
};

class Web3Service {
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.Signer | null = null;

  async connectWallet(): Promise<string> {
    if (!window.ethereum) {
      throw new Error('MetaMask is not installed');
    }

    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }

      // Initialize provider and signer
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = await this.provider.getSigner();

      // Check if we're on the correct network
      const network = await this.provider.getNetwork();
      if (Number(network.chainId) !== HOLESKY_CHAIN_ID) {
        await this.switchToHolesky();
      }

      return accounts[0];
    } catch (error: any) {
      console.error('Failed to connect wallet:', error);
      throw new Error(`Failed to connect wallet: ${error.message}`);
    }
  }

  async switchToHolesky(): Promise<void> {
    if (!window.ethereum) {
      throw new Error('MetaMask is not installed');
    }

    try {
      // Try to switch to Holesky
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: HOLESKY_NETWORK.chainId }],
      });
    } catch (switchError: any) {
      // If the network doesn't exist, add it
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [HOLESKY_NETWORK],
        });
      } else {
        throw switchError;
      }
    }
  }

  async getBalance(address: string): Promise<string> {
    if (!this.provider) throw new Error('Provider not initialized');
    
    const balance = await this.provider.getBalance(address);
    return ethers.formatEther(balance);
  }

  async getTokenBalance(address: string): Promise<string> {
    if (!this.provider || !CONTRACT_ADDRESSES.TOKEN) {
      return '0';
    }

    try {
      const tokenContract = new ethers.Contract(
        CONTRACT_ADDRESSES.TOKEN,
        TOKEN_ABI,
        this.provider
      );

      const balance = await tokenContract.balanceOf(address);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('Failed to get token balance:', error);
      return '0';
    }
  }

  async submitContribution(
    title: string,
    description: string,
    projectUrl: string,
    githubPR: string,
    category: number
  ): Promise<ethers.TransactionResponse> {
    if (!this.signer || !CONTRACT_ADDRESSES.REWARDS) {
      throw new Error('Wallet not connected or Rewards contract not deployed');
    }

    try {
      const rewardsContract = new ethers.Contract(
        CONTRACT_ADDRESSES.REWARDS,
        REWARDS_ABI,
        this.signer
      );

      const tx = await rewardsContract.submitContribution(
        title,
        description,
        projectUrl,
        githubPR,
        category
      );
      return tx;
    } catch (error: any) {
      console.error('Failed to submit contribution:', error);
      throw new Error(`Failed to submit contribution: ${error.message || 'Unknown error'}`);
    }
  }

  async validateContribution(contributionId: number, approve: boolean): Promise<ethers.TransactionResponse> {
    if (!this.signer || !CONTRACT_ADDRESSES.REWARDS) {
      throw new Error('Wallet not connected or Rewards contract not deployed');
    }

    try {
      const rewardsContract = new ethers.Contract(
        CONTRACT_ADDRESSES.REWARDS,
        REWARDS_ABI,
        this.signer
      );

      const tx = await rewardsContract.validateContribution(contributionId, approve);
      return tx;
    } catch (error: any) {
      console.error('Failed to validate contribution:', error);
      throw new Error(`Failed to validate contribution: ${error.message || 'Unknown error'}`);
    }
  }

  async claimReward(contributionId: number): Promise<ethers.TransactionResponse> {
    if (!this.signer || !CONTRACT_ADDRESSES.REWARDS) {
      throw new Error('Wallet not connected or Rewards contract not deployed');
    }

    try {
      const rewardsContract = new ethers.Contract(
        CONTRACT_ADDRESSES.REWARDS,
        REWARDS_ABI,
        this.signer
      );

      const tx = await rewardsContract.claimReward(contributionId);
      return tx;
    } catch (error: any) {
      console.error('Failed to claim reward:', error);
      throw new Error(`Failed to claim reward: ${error.message || 'Unknown error'}`);
    }
  }

  async registerAsValidator(): Promise<ethers.TransactionResponse> {
    if (!this.signer || !CONTRACT_ADDRESSES.REWARDS) {
      throw new Error('Wallet not connected or Rewards contract not deployed');
    }

    try {
      const rewardsContract = new ethers.Contract(
        CONTRACT_ADDRESSES.REWARDS,
        REWARDS_ABI,
        this.signer
      );

      const tx = await rewardsContract.registerValidator();
      return tx;
    } catch (error: any) {
      console.error('Failed to register as validator:', error);
      throw new Error(`Failed to register as validator: ${error.message || 'Unknown error'}`);
    }
  }

  async approveTokenSpending(spender: string, amount: string): Promise<ethers.TransactionResponse> {
    if (!this.signer || !CONTRACT_ADDRESSES.TOKEN) {
      throw new Error('Wallet not connected or Token contract not deployed');
    }

    try {
      const tokenContract = new ethers.Contract(
        CONTRACT_ADDRESSES.TOKEN,
        TOKEN_ABI,
        this.signer
      );

      const amountWei = ethers.parseEther(amount);
      const tx = await tokenContract.approve(spender, amountWei);
      return tx;
    } catch (error: any) {
      console.error('Failed to approve token spending:', error);
      throw new Error(`Failed to approve tokens: ${error.message || 'Unknown error'}`);
    }
  }


  async getAllContributions(): Promise<any[]> {
    if (!this.provider || !CONTRACT_ADDRESSES.REWARDS) {
      console.log('Provider or Rewards contract not available');
      return [];
    }

    try {
      console.log('Creating Rewards contract instance...');
      const rewardsContract = new ethers.Contract(
        CONTRACT_ADDRESSES.REWARDS,
        REWARDS_ABI,
        this.provider
      );

      console.log('Fetching next contribution ID...');
      const nextContributionId = await rewardsContract.nextContributionId();
      console.log(`Next contribution ID: ${nextContributionId}`);
      
      const contributions = [];

      for (let i = 1; i < nextContributionId; i++) {
        try {
          console.log(`Fetching contribution ${i}...`);
          const contribution = await rewardsContract.getContribution(i);
          console.log(`Contribution ${i} data:`, {
            id: Number(contribution.id),
            title: contribution.title,
            status: Number(contribution.status),
            approvalVotes: Number(contribution.approvalVotes),
            rejectionVotes: Number(contribution.rejectionVotes)
          });
          
          contributions.push({
            id: Number(contribution.id),
            title: contribution.title,
            description: contribution.description,
            projectUrl: contribution.projectUrl,
            githubPR: contribution.githubPR,
            contributor: contribution.contributor,
            category: Number(contribution.category),
            submissionTime: new Date(Number(contribution.submissionTime) * 1000),
            approvalVotes: Number(contribution.approvalVotes),
            rejectionVotes: Number(contribution.rejectionVotes),
            totalValidators: Number(contribution.totalValidators),
            status: Number(contribution.status),
            rewardAmount: ethers.formatEther(contribution.rewardAmount),
            claimed: contribution.claimed
          });
        } catch (err) {
          console.warn(`Failed to fetch contribution ${i}:`, err);
        }
      }

      console.log(`Successfully fetched ${contributions.length} contributions`);
      return contributions;
    } catch (error) {
      console.error('Failed to fetch contributions:', error);
      return [];
    }
  }


  async getContractAddresses() {
    return CONTRACT_ADDRESSES;
  }

  async waitForTransaction(txHash: string): Promise<ethers.TransactionReceipt> {
    if (!this.provider) throw new Error('Provider not initialized');
    const receipt = await this.provider.waitForTransaction(txHash);
    if (!receipt) throw new Error('Transaction receipt not found');
    return receipt;
  }

  // Check if contracts are deployed
  isContractsDeployed(): boolean {
    return !!(CONTRACT_ADDRESSES.TOKEN && CONTRACT_ADDRESSES.REWARDS);
  }

  // Get contract instances (for advanced usage)
  getTokenContract() {
    if (!this.provider || !CONTRACT_ADDRESSES.TOKEN) return null;
    return new ethers.Contract(CONTRACT_ADDRESSES.TOKEN, TOKEN_ABI, this.provider);
  }



  getRewardsContract() {
    if (!this.provider || !CONTRACT_ADDRESSES.REWARDS) return null;
    return new ethers.Contract(CONTRACT_ADDRESSES.REWARDS, REWARDS_ABI, this.provider);
  }
}

export const web3Service = new Web3Service();

// Type declarations for window.ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}