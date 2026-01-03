// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./Tokens.sol";

/**
 * @title OSSDAO
 * @dev DAO contract for governance of the OSS rewards platform
 */
contract OSSDAO is ReentrancyGuard, Ownable, Pausable {
    OSSToken public immutable ossToken;
    
    enum ProposalStatus { Active, Passed, Failed, Executed, Cancelled }
    enum ProposalType { General, RewardUpdate, ParameterChange, ContractUpgrade }
    
    struct Proposal {
        uint256 id;
        string title;
        string description;
        address proposer;
        ProposalType proposalType;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 totalVotingPower;
        ProposalStatus status;
        bytes executionData;
        address targetContract;
        bool executed;
    }
    
    struct Vote {
        bool hasVoted;
        bool support;
        uint256 votingPower;
    }
    
    uint256 public nextProposalId = 1;
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant MIN_PROPOSAL_THRESHOLD = 1000 * 10**18; // 1000 OSS tokens
    uint256 public constant QUORUM_THRESHOLD = 10; // 10% of total supply
    uint256 public constant APPROVAL_THRESHOLD = 51; // 51% approval required
    
    // All proposals
    mapping(uint256 => Proposal) public proposals;
    
    // Voting tracking: proposalId => voter => Vote
    mapping(uint256 => mapping(address => Vote)) public votes;
    
    // Proposal history for users
    mapping(address => uint256[]) public userProposals;
    
    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string title,
        ProposalType proposalType
    );
    
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 votingPower
    );
    
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    
    constructor(address _ossToken) Ownable(msg.sender) {
        ossToken = OSSToken(_ossToken);
    }
    
    /**
     * @dev Create a new governance proposal
     */
    function createProposal(
        string memory title,
        string memory description,
        ProposalType proposalType,
        bytes memory executionData,
        address targetContract
    ) external whenNotPaused {
        require(bytes(title).length > 0, "Title cannot be empty");
        require(bytes(description).length > 0, "Description cannot be empty");
        require(
            ossToken.balanceOf(msg.sender) >= MIN_PROPOSAL_THRESHOLD,
            "Insufficient tokens to create proposal"
        );
        
        uint256 proposalId = nextProposalId++;
        uint256 endTime = block.timestamp + VOTING_PERIOD;
        
        proposals[proposalId] = Proposal({
            id: proposalId,
            title: title,
            description: description,
            proposer: msg.sender,
            proposalType: proposalType,
            startTime: block.timestamp,
            endTime: endTime,
            forVotes: 0,
            againstVotes: 0,
            totalVotingPower: 0,
            status: ProposalStatus.Active,
            executionData: executionData,
            targetContract: targetContract,
            executed: false
        });
        
        userProposals[msg.sender].push(proposalId);
        
        emit ProposalCreated(proposalId, msg.sender, title, proposalType);
    }
    
    /**
     * @dev Vote on a proposal
     */
    function vote(uint256 proposalId, bool support) external whenNotPaused {
        require(proposalId < nextProposalId, "Proposal does not exist");
        require(proposals[proposalId].status == ProposalStatus.Active, "Proposal not active");
        require(block.timestamp <= proposals[proposalId].endTime, "Voting period ended");
        require(!votes[proposalId][msg.sender].hasVoted, "Already voted");
        
        uint256 votingPower = ossToken.balanceOf(msg.sender);
        require(votingPower > 0, "No voting power");
        
        votes[proposalId][msg.sender] = Vote({
            hasVoted: true,
            support: support,
            votingPower: votingPower
        });
        
        if (support) {
            proposals[proposalId].forVotes += votingPower;
        } else {
            proposals[proposalId].againstVotes += votingPower;
        }
        
        proposals[proposalId].totalVotingPower += votingPower;
        
        emit VoteCast(proposalId, msg.sender, support, votingPower);
    }
    
    /**
     * @dev Finalize a proposal after voting period
     */
    function finalizeProposal(uint256 proposalId) external {
        require(proposalId < nextProposalId, "Proposal does not exist");
        require(proposals[proposalId].status == ProposalStatus.Active, "Proposal not active");
        require(block.timestamp > proposals[proposalId].endTime, "Voting period still active");
        
        Proposal storage proposal = proposals[proposalId];
        uint256 totalSupply = ossToken.totalSupply();
        uint256 quorumRequired = (totalSupply * QUORUM_THRESHOLD) / 100;
        
        // Check if quorum is met
        if (proposal.totalVotingPower < quorumRequired) {
            proposal.status = ProposalStatus.Failed;
            return;
        }
        
        // Check if proposal passes
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        uint256 approvalPercentage = (proposal.forVotes * 100) / totalVotes;
        
        if (approvalPercentage >= APPROVAL_THRESHOLD) {
            proposal.status = ProposalStatus.Passed;
        } else {
            proposal.status = ProposalStatus.Failed;
        }
    }
    
    /**
     * @dev Execute a passed proposal
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        require(proposalId < nextProposalId, "Proposal does not exist");
        require(proposals[proposalId].status == ProposalStatus.Passed, "Proposal not passed");
        require(!proposals[proposalId].executed, "Proposal already executed");
        
        Proposal storage proposal = proposals[proposalId];
        proposal.executed = true;
        proposal.status = ProposalStatus.Executed;
        
        // Execute the proposal if it has execution data
        if (proposal.executionData.length > 0 && proposal.targetContract != address(0)) {
            (bool success, ) = proposal.targetContract.call(proposal.executionData);
            require(success, "Proposal execution failed");
        }
        
        emit ProposalExecuted(proposalId);
    }
    
    /**
     * @dev Cancel a proposal (only proposer or owner)
     */
    function cancelProposal(uint256 proposalId) external {
        require(proposalId < nextProposalId, "Proposal does not exist");
        require(proposals[proposalId].status == ProposalStatus.Active, "Proposal not active");
        require(
            msg.sender == proposals[proposalId].proposer || msg.sender == owner(),
            "Not authorized to cancel"
        );
        
        proposals[proposalId].status = ProposalStatus.Cancelled;
        emit ProposalCancelled(proposalId);
    }
    
    /**
     * @dev Get proposal details
     */
    function getProposal(uint256 proposalId) 
        external 
        view 
        returns (Proposal memory) 
    {
        require(proposalId < nextProposalId, "Proposal does not exist");
        return proposals[proposalId];
    }
    
    /**
     * @dev Get user's proposal IDs
     */
    function getUserProposals(address user) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return userProposals[user];
    }
    
    /**
     * @dev Get vote information for a proposal and voter
     */
    function getVote(uint256 proposalId, address voter) 
        external 
        view 
        returns (bool hasVoted, bool support, uint256 votingPower) 
    {
        Vote memory userVote = votes[proposalId][voter];
        return (userVote.hasVoted, userVote.support, userVote.votingPower);
    }
    
    /**
     * @dev Get current voting power of an address
     */
    function getVotingPower(address voter) external view returns (uint256) {
        return ossToken.balanceOf(voter);
    }
    
    /**
     * @dev Check if an address can create proposals
     */
    function canCreateProposal(address proposer) external view returns (bool) {
        return ossToken.balanceOf(proposer) >= MIN_PROPOSAL_THRESHOLD;
    }
    
    /**
     * @dev Get total number of proposals
     */
    function getTotalProposals() external view returns (uint256) {
        return nextProposalId - 1;
    }
    
    /**
     * @dev Get active proposals
     */
    function getActiveProposals() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextProposalId; i++) {
            if (proposals[i].status == ProposalStatus.Active && 
                block.timestamp <= proposals[i].endTime) {
                count++;
            }
        }
        
        uint256[] memory activeProposals = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 1; i < nextProposalId; i++) {
            if (proposals[i].status == ProposalStatus.Active && 
                block.timestamp <= proposals[i].endTime) {
                activeProposals[index] = i;
                index++;
            }
        }
        
        return activeProposals;
    }
    
    /**
     * @dev Pause the contract (emergency use)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }
} 