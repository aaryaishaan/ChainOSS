// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./Tokens.sol";


contract OSSRewardsV2 is Ownable, ReentrancyGuard, Pausable {
    IERC20 public immutable ossToken;
    
    // Platform revenue sources
    uint256 public constant PLATFORM_FEE = 500; // 5% platform fee
    uint256 public constant VALIDATOR_STAKE = 1000 * 10**18; // 1000 OSS to become validator(eligibility)
    uint256 public constant MIN_CONTRIBUTION_STAKE = 100 * 10**18; // 100 OSS to submit
    
    // Contribution validation requirements
    uint256 public constant MIN_VALIDATORS_REQUIRED = 3;
    uint256 public constant VALIDATION_PERIOD = 7 days;
    uint256 public constant APPROVAL_THRESHOLD = 60; // 60% approval needed
    
    // Revenue sharing
    uint256 public constant VALIDATOR_REWARD_SHARE = 20; // 20% of platform fees to validators
    uint256 public constant TREASURY_SHARE = 30; // 30% to treasury for sustainability
    uint256 public constant BURN_SHARE = 10; // 10% burned for deflation
    
    enum ContributionStatus { Pending, UnderReview, Approved, Rejected, Claimed }
    enum ContributionCategory { BugFix, Feature, Security, Documentation, Performance, Research }
    
    struct Contribution {
        uint256 id;
        address contributor;
        string title;
        string description;
        string projectUrl;
        string githubPR; // GitHub PR link for verification
        ContributionCategory category;
        uint256 submissionTime;
        uint256 stakeAmount; // Contributor's stake
        uint256 validationDeadline;
        uint256 approvalVotes;
        uint256 rejectionVotes;
        uint256 totalValidators;
        ContributionStatus status;
        uint256 rewardAmount;
        bool claimed;
        mapping(address => bool) hasValidated;
        mapping(address => bool) validatorVotes; // true = approve, false = reject
    }
    
    struct Validator {
        bool isActive;
        uint256 stakedAmount;
        uint256 validationsCount;
        uint256 accuracyScore; // Out of 100
        uint256 rewardsEarned;
        uint256 registrationTime;
    }
    
    // State variables
    mapping(uint256 => Contribution) public contributions;
    mapping(address => Validator) public validators;
    mapping(address => uint256[]) public userContributions;
    mapping(ContributionCategory => uint256) public categoryRewards;
    
    address[] public activeValidators;
    uint256 public nextContributionId = 1;
    uint256 public totalStaked;
    uint256 public platformTreasury;
    uint256 public validatorRewardPool;
    
    // Events
    event ContributionSubmitted(uint256 indexed contributionId, address indexed contributor, ContributionCategory category, uint256 stakeAmount);
    event ValidationSubmitted(uint256 indexed contributionId, address indexed validator, bool approved);
    event ContributionFinalized(uint256 indexed contributionId, ContributionStatus status, uint256 rewardAmount);
    event ValidatorRegistered(address indexed validator, uint256 stakedAmount);
    event ValidatorSlashed(address indexed validator, uint256 slashedAmount);
    event RewardClaimed(uint256 indexed contributionId, address indexed contributor, uint256 amount);
    event PlatformFeeCollected(uint256 amount);
    
    constructor(address _ossToken) Ownable(msg.sender) {
        ossToken = IERC20(_ossToken);
        
        // Initialize category rewards (in OSS tokens)
        categoryRewards[ContributionCategory.Security] = 1000 * 10**18; // 1000 tocken 
        categoryRewards[ContributionCategory.BugFix] = 500 * 10**18;    // 500 tocken
        categoryRewards[ContributionCategory.Feature] = 750 * 10**18;   // 750 token
        categoryRewards[ContributionCategory.Performance] = 600 * 10**18; // 600 tocken
        categoryRewards[ContributionCategory.Documentation] = 300 * 10**18; // 300 tocken
        categoryRewards[ContributionCategory.Research] = 800 * 10**18;  // 800 tocken
    }
    
    /**
     * @dev Register as a validator by staking OSS tokens
     */
    function registerValidator() external nonReentrant {
        require(!validators[msg.sender].isActive, "Already a validator");
        require(ossToken.transferFrom(msg.sender, address(this), VALIDATOR_STAKE), "Stake transfer failed");
        
        validators[msg.sender] = Validator({
            isActive: true,
            stakedAmount: VALIDATOR_STAKE,
            validationsCount: 0,
            accuracyScore: 100, // Start with perfect score
            rewardsEarned: 0,
            registrationTime: block.timestamp
        });
        
        activeValidators.push(msg.sender);
        totalStaked += VALIDATOR_STAKE;
        
        emit ValidatorRegistered(msg.sender, VALIDATOR_STAKE);
    }
    
    /**
     * @dev Submit a contribution with stake
     */
    function submitContribution(
        string memory _title,
        string memory _description,
        string memory _projectUrl,
        string memory _githubPR,
        ContributionCategory _category
    ) external nonReentrant whenNotPaused {
        require(bytes(_title).length > 0, "Title required");
        require(bytes(_githubPR).length > 0, "GitHub PR required");
        require(activeValidators.length >= MIN_VALIDATORS_REQUIRED, "Not enough validators");
        
        // Contributor must stake tokens
        require(ossToken.transferFrom(msg.sender, address(this), MIN_CONTRIBUTION_STAKE), "Stake transfer failed");
        
        uint256 contributionId = nextContributionId++;
        Contribution storage contribution = contributions[contributionId];
        
        contribution.id = contributionId;
        contribution.contributor = msg.sender;
        contribution.title = _title;
        contribution.description = _description;
        contribution.projectUrl = _projectUrl;
        contribution.githubPR = _githubPR;
        contribution.category = _category;
        contribution.submissionTime = block.timestamp;
        contribution.stakeAmount = MIN_CONTRIBUTION_STAKE;
        contribution.validationDeadline = block.timestamp + VALIDATION_PERIOD;
        contribution.status = ContributionStatus.UnderReview;
        
        userContributions[msg.sender].push(contributionId);
        totalStaked += MIN_CONTRIBUTION_STAKE;
        
        emit ContributionSubmitted(contributionId, msg.sender, _category, MIN_CONTRIBUTION_STAKE);
    }
    
    /**
     * @dev Validators vote on contributions
     */
    function validateContribution(uint256 _contributionId, bool _approve) external nonReentrant {
        require(validators[msg.sender].isActive, "Not an active validator");
        Contribution storage contribution = contributions[_contributionId];
        require(contribution.status == ContributionStatus.UnderReview, "Invalid status");
        require(block.timestamp <= contribution.validationDeadline, "Validation period ended");
        require(!contribution.hasValidated[msg.sender], "Already validated");
        
        contribution.hasValidated[msg.sender] = true;
        contribution.validatorVotes[msg.sender] = _approve;
        contribution.totalValidators++;
        
        if (_approve) {
            contribution.approvalVotes++;
        } else {
            contribution.rejectionVotes++;
        }
        
        validators[msg.sender].validationsCount++;
        
        emit ValidationSubmitted(_contributionId, msg.sender, _approve);
        
        // Check if we have enough validations
        if (contribution.totalValidators >= MIN_VALIDATORS_REQUIRED) {
            _finalizeContribution(_contributionId);
        }
    }
    
    /**
     * @dev Finalize contribution based on validation results
     */
    function _finalizeContribution(uint256 _contributionId) internal {
        Contribution storage contribution = contributions[_contributionId];
        uint256 approvalPercentage = (contribution.approvalVotes * 100) / contribution.totalValidators;
        
        if (approvalPercentage >= APPROVAL_THRESHOLD) {
            // Approved - calculate reward
            contribution.status = ContributionStatus.Approved;
            uint256 baseReward = categoryRewards[contribution.category];
            
            // Bonus based on approval percentage
            uint256 bonusMultiplier = approvalPercentage > 80 ? 120 : 100; // 20% bonus for >80% approval
            contribution.rewardAmount = (baseReward * bonusMultiplier) / 100;
            
            // Return stake to contributor
            totalStaked -= contribution.stakeAmount;
            
        } else {
            // Rejected - contributor loses stake
            contribution.status = ContributionStatus.Rejected;
            contribution.rewardAmount = 0;
            
            // Slash contributor's stake - distribute to validators and treasury
            uint256 slashedAmount = contribution.stakeAmount;
            totalStaked -= slashedAmount;
            
            // 50% to validators, 50% to treasury
            validatorRewardPool += slashedAmount / 2;
            platformTreasury += slashedAmount / 2;
        }
        
        // Reward validators for participation
        _distributeValidatorRewards(_contributionId);
        
        emit ContributionFinalized(_contributionId, contribution.status, contribution.rewardAmount);
    }
    
    /**
     * @dev Distribute rewards to validators
     */
    function _distributeValidatorRewards(uint256 _contributionId) internal {
        Contribution storage contribution = contributions[_contributionId];
        uint256 rewardPerValidator = 10 * 10**18; // 10 OSS per validation
        
        // Iterate through active validators who participated
        for (uint256 i = 0; i < activeValidators.length; i++) {
            address validator = activeValidators[i];
            if (contribution.hasValidated[validator]) {
                validators[validator].rewardsEarned += rewardPerValidator;
                validatorRewardPool -= rewardPerValidator;
            }
        }
    }
    
    /**
     * @dev Claim approved contribution reward
     */
    function claimReward(uint256 _contributionId) external nonReentrant {
        Contribution storage contribution = contributions[_contributionId];
        require(contribution.contributor == msg.sender, "Not your contribution");
        require(contribution.status == ContributionStatus.Approved, "Not approved");
        require(!contribution.claimed, "Already claimed");
        
        contribution.claimed = true;
        contribution.status = ContributionStatus.Claimed;
        
        // Transfer reward to contributor
        require(ossToken.transfer(msg.sender, contribution.rewardAmount), "Reward transfer failed");
        
        // Return original stake
        require(ossToken.transfer(msg.sender, contribution.stakeAmount), "Stake return failed");
        
        emit RewardClaimed(_contributionId, msg.sender, contribution.rewardAmount);
    }
    
    /**
     * @dev Validators claim their earned rewards
     */
    function claimValidatorRewards() external nonReentrant {
        require(validators[msg.sender].isActive, "Not an active validator");
        uint256 rewards = validators[msg.sender].rewardsEarned;
        require(rewards > 0, "No rewards to claim");
        
        validators[msg.sender].rewardsEarned = 0;
        require(ossToken.transfer(msg.sender, rewards), "Reward transfer failed");
    }
    
    /**
     * @dev Emergency finalize if validation period expired
     */
    function emergencyFinalize(uint256 _contributionId) external {
        Contribution storage contribution = contributions[_contributionId];
        require(contribution.status == ContributionStatus.UnderReview, "Invalid status");
        require(block.timestamp > contribution.validationDeadline, "Validation period not ended");
        
        if (contribution.totalValidators >= MIN_VALIDATORS_REQUIRED) {
            _finalizeContribution(_contributionId);
        } else {
            // Not enough validators - return stake, no reward
            contribution.status = ContributionStatus.Rejected;
            totalStaked -= contribution.stakeAmount;
            require(ossToken.transfer(contribution.contributor, contribution.stakeAmount), "Stake return failed");
        }
    }
    
    // View functions
    function getContribution(uint256 _contributionId) external view returns (
        uint256 id,
        address contributor,
        string memory title,
        string memory description,
        string memory projectUrl,
        string memory githubPR,
        ContributionCategory category,
        uint256 submissionTime,
        uint256 stakeAmount,
        uint256 approvalVotes,
        uint256 rejectionVotes,
        uint256 totalValidators,
        ContributionStatus status,
        uint256 rewardAmount,
        bool claimed
    ) {
        Contribution storage contribution = contributions[_contributionId];
        return (
            contribution.id,
            contribution.contributor,
            contribution.title,
            contribution.description,
            contribution.projectUrl,
            contribution.githubPR,
            contribution.category,
            contribution.submissionTime,
            contribution.stakeAmount,
            contribution.approvalVotes,
            contribution.rejectionVotes,
            contribution.totalValidators,
            contribution.status,
            contribution.rewardAmount,
            contribution.claimed
        );
    }
    
    function getUserContributions(address _user) external view returns (uint256[] memory) {
        return userContributions[_user];
    }
    
    function getActiveValidatorsCount() external view returns (uint256) {
        return activeValidators.length;
    }
    
    // Admin functions
    function updateCategoryReward(ContributionCategory _category, uint256 _newReward) external onlyOwner {
        categoryRewards[_category] = _newReward;
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    function withdrawTreasury(uint256 _amount) external onlyOwner {
        require(_amount <= platformTreasury, "Insufficient treasury");
        platformTreasury -= _amount;
        require(ossToken.transfer(owner(), _amount), "Transfer failed");
    }
} 