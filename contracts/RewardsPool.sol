//SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract RewardsPool is AccessControl {
    uint256 public constant REWARD_DEPOSIT_INTERVAL = 7 days;
    bytes32 public constant TEAM_MEMBER_ROLE = keccak256("TEAM_MEMBER_ROLE");

    struct TimestampedDeposit {
        uint256 amount;
        uint256 timestamp;
    }

    /**
     * Last timestamp when rewards were deposited by team member
     */
    uint256 public lastRewardDepositTimestamp;

    /**
     * Total value of deposits made by users (excluding reward deposits)
     */
    uint256 public totalDepositedAmount;

    mapping(address => TimestampedDeposit) public deposits;

    event Deposit(address indexed from, uint256 value);
    event RewardDeposit(address indexed from, uint256 value);
    event RewardWithdraw(address indexed to, uint256 value);

    constructor(address[] memory teamMembers) {
        // Grant admin role to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Grant roles to team members
        for (uint256 i = 0; i < teamMembers.length; ++i) {
            require(
                teamMembers[i] != address(0),
                "Team member cannot be the zero address"
            );
            _grantRole(TEAM_MEMBER_ROLE, teamMembers[i]);
        }
    }

    /**
     * @dev Allows a team member to deposit reward value to this contract
     *
     * Emits {RewardDeposit} event
     *
     * Requirements:
     * - `msg.sender` must be have a team member role
     * - An interval of `REWARD_DEPOSIT_INTERVAL` must have passed since the last reward deposit
     */
    function depositReward() external payable onlyRole(TEAM_MEMBER_ROLE) {
        require(
            block.timestamp >
                lastRewardDepositTimestamp + REWARD_DEPOSIT_INTERVAL,
            "RewardsPool: Reward deposit interval has not passed"
        );
        lastRewardDepositTimestamp = block.timestamp;
        emit RewardDeposit(msg.sender, msg.value);
    }

    /**
     * @dev Allows user to withdraw deposited amount and reward (if deposited before last reward deposit timestamp)
     * The amount user withdraws is proportional to the amount it deposited.
     * If amount is deposited after `lastRewardDepositTimestamp` timestamp, then
     * the amount equal to deposited amount is sent over. Otherwise, an additional
     * reward amount is included in the amount sent.
     *
     * Emits {RewardWithdraw} event
     *
     * Requirements:
     * - Deposited amount of `msg.sender` must be greater than zero
     *
     */
    function withdraw() external {
        TimestampedDeposit storage deposit = deposits[msg.sender];
        require(deposit.amount > 0, "No deposit to withdraw");

        uint256 withdrawAmount;
        if (block.timestamp > deposit.timestamp) {
            withdrawAmount =
                (deposit.amount * address(this).balance) /
                totalDepositedAmount;
        } else {
            withdrawAmount = deposit.amount;
        }

        totalDepositedAmount -= deposit.amount;
        deposit.amount = 0;

        _withdraw(msg.sender, withdrawAmount);
    }

    /**
     * @dev Deposits received amount to the pool
     *
     * Emits {Deposit} event
     *
     * Requirements:
     * - `msg.sender` must not be a team member
     */
    function _deposit() internal {
        require(
            !hasRole(TEAM_MEMBER_ROLE, msg.sender),
            "Team Member cannot be participant in rewards pool"
        );

        TimestampedDeposit storage deposit = deposits[msg.sender];
        deposit.amount += msg.value;
        deposit.timestamp = block.timestamp;

        totalDepositedAmount += msg.value;

        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Transers `value` eth to `to` address, reverting for unsuccessful transfer
     * @param to The address to eth transfer to
     * @param value The amount of eth to transfer
     *
     * Emits {RewardWithdrawn} event
     *
     * Requirements:
     * - `to` address must not be zero addrss
     * - `value` must be greater than zero
     */
    function _withdraw(address to, uint256 value) internal {
        require(to != address(0), "Cannot transfer to the zero address");
        require(value > 0, "Cannot transfer zero value");

        (bool success, ) = to.call{value: value}("");
        require(success, "RewardsPool: Unable to send value");
        emit RewardWithdraw(to, value);
    }

    /**
     * @dev Sending any value and empty calldata would be interpreted as a deposit
     */
    receive() external payable {
        _deposit();
    }

    /**
     * @dev Any unexpected invocation with calldata should revert
     */
    fallback() external payable {
        require(false, "RewardsPool: Unexpected fallback");
    }
}
