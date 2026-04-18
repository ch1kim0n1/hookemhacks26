// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Optional x402 / bounty hook (no-op if unset)
interface IBountyHook {
    function onAttackPublished(bytes32 patternHash, address reporter) external;
}

/// @title ThreatRegistry — on-chain threat intelligence for ClawGuard / SENTINEL
/// @notice Stores hashed attack patterns so agents across instances can share threat intel
contract ThreatRegistry {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ThreatRegistry: not owner");
        _;
    }

    struct Attack {
        bytes32 patternHash;
        string category;
        string sampleRedacted;
        address reporter;
        uint256 timestamp;
        uint256 blockNumber;
    }

    Attack[] public attacks;

    mapping(address => uint256) public reportCount;
    mapping(address => uint256) public firstReport;
    mapping(address => uint256) public lastReport;

    /// @notice SENTINEL-compatible: fast lookup for `SentinelGuard`
    mapping(bytes32 => bool) public knownPattern;

    address public bountyHook;

    event BountyHookUpdated(address indexed previous, address indexed current);

    event AttackPublished(
        bytes32 indexed patternHash,
        string category,
        address indexed reporter,
        uint256 timestamp
    );

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

        if (firstReport[msg.sender] == 0) {
            firstReport[msg.sender] = block.timestamp;
        }
        lastReport[msg.sender] = block.timestamp;
        reportCount[msg.sender]++;

        knownPattern[patternHash] = true;

        emit AttackPublished(patternHash, category, msg.sender, block.timestamp);

        if (bountyHook != address(0)) {
            IBountyHook(bountyHook).onAttackPublished(patternHash, msg.sender);
        }
    }

    function setBountyHook(address hook) external onlyOwner {
        address prev = bountyHook;
        bountyHook = hook;
        emit BountyHookUpdated(prev, hook);
    }

    function getRecentAttacks(uint256 count) external view returns (Attack[] memory) {
        uint256 len = attacks.length;
        if (count > len) count = len;

        Attack[] memory recent = new Attack[](count);
        for (uint256 i = 0; i < count; i++) {
            recent[i] = attacks[len - count + i];
        }
        return recent;
    }

    /// @notice Paginate attacks from a starting index (for pollers)
    function getAttacksSince(uint256 fromIndex) external view returns (Attack[] memory) {
        uint256 len = attacks.length;
        if (fromIndex >= len) {
            return new Attack[](0);
        }
        uint256 n = len - fromIndex;
        Attack[] memory out = new Attack[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = attacks[fromIndex + i];
        }
        return out;
    }

    function getReporterStats(address reporter) external view returns (
        uint256, uint256, uint256
    ) {
        return (reportCount[reporter], firstReport[reporter], lastReport[reporter]);
    }

    function totalAttacks() external view returns (uint256) {
        return attacks.length;
    }

    /// @notice Compatibility with SENTINEL `ThreatRegistry.isThreat`
    function isThreat(bytes32 signatureHash) external view returns (bool) {
        return knownPattern[signatureHash];
    }
}
