// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ClawGuardRegistry — on-chain threat intelligence sharing for AI agents
/// @notice Stores hashed attack patterns so agents across instances can share threat intel
contract ClawGuardRegistry {
    struct Attack {
        bytes32 patternHash;
        string category;
        string sampleRedacted;
        address reporter;
        uint256 timestamp;
        uint256 blockNumber;
    }

    Attack[] public attacks;

    // Reporter reputation tracking
    mapping(address => uint256) public reportCount;
    mapping(address => uint256) public firstReport;
    mapping(address => uint256) public lastReport;

    event AttackPublished(
        bytes32 indexed patternHash,
        string category,
        address indexed reporter,
        uint256 timestamp
    );

    /// @notice Publish a new attack pattern to the registry
    /// @param patternHash SHA-256 hash of the attack content
    /// @param category Attack category (e.g. "instruction_override", "role_override")
    /// @param sampleRedacted Redacted sample of the attack for context (max 200 chars)
    function publishAttack(
        bytes32 patternHash,
        string calldata category,
        string calldata sampleRedacted
    ) external {
        attacks.push(Attack({
            patternHash: patternHash,
            category: category,
            sampleRedacted: sampleRedacted,
            reporter: msg.sender,
            timestamp: block.timestamp,
            blockNumber: block.number
        }));

        // Update reporter stats
        if (firstReport[msg.sender] == 0) {
            firstReport[msg.sender] = block.timestamp;
        }
        lastReport[msg.sender] = block.timestamp;
        reportCount[msg.sender]++;

        emit AttackPublished(patternHash, category, msg.sender, block.timestamp);
    }

    /// @notice Get the most recent attacks
    /// @param count Number of recent attacks to return
    function getRecentAttacks(uint256 count) external view returns (Attack[] memory) {
        uint256 len = attacks.length;
        if (count > len) count = len;

        Attack[] memory recent = new Attack[](count);
        for (uint256 i = 0; i < count; i++) {
            recent[i] = attacks[len - count + i];
        }
        return recent;
    }

    /// @notice Get reporter reputation stats
    function getReporterStats(address reporter) external view returns (
        uint256, uint256, uint256
    ) {
        return (reportCount[reporter], firstReport[reporter], lastReport[reporter]);
    }

    /// @notice Total number of attacks in the registry
    function totalAttacks() external view returns (uint256) {
        return attacks.length;
    }
}
