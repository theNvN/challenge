//SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title RewardsPool
 * @author Naveen Sahu - <thenvnsahu@gmail.com>
 *
 * This contract manages a reward pool, which runs multiple rounds of rewards.
 * These rewards are paid out proportionately to participants of each round.
 * To be eligible to avail the rewards, a user must deposit a certain amount before
 * current round ends. When round ends, the use can withdraw a share of that round's
 * reward along with origingal deposit. The reward amount for the current round is
 * added by a team member, which consequently ends current round and starts next one.
 * In case user did not withdraw for many rounds, the original deposit is considered
 * as deposit for next rounds and rewards are accumulated acc. to original deposit's proportion.
 * In case user withdraws before current round ends, the reward for the current round is
 * 0 and original deposit is sent to user.
 */
contract RewardsPool is AccessControl {
    // time interval between reward rounds (in terms of no. of blocks)
    uint256 public immutable REWARD_ROUND_INTERVAL;

    bytes32 public constant TEAM_MEMBER_ROLE = keccak256("TEAM_MEMBER_ROLE");

    struct Snapshots {
        uint256[] rounds;
        uint256[] values;
    }

    /**
     * Current round of rewards
     * Every reward deposit marks end of current round and start of a new one
     * First round is round 1 (not 0) which starts at deployment of contract
     */
    uint256 public currentRound;

    /**
     * Block number at the start of current reward round
     */
    uint256 public currentRoundStartBlock;

    /**
     * Snapshots of user deposits in each round
     * The last snapshot's value must hold the current deposit of the user
     */
    mapping(address => Snapshots) private _depositSnapshots;

    /**
     * Account to last round at which user withdrew rewards
     * A value of 0 means user never participated in any round
     * since round starts from 1 not 0. See `currentRound`
     */
    mapping(address => uint256) private _lastRewardWithdrawRound;

    /**
     * Reward round to reward amount mapping
     */
    mapping(uint256 => uint256) private _rewards;

    /*
     * Reward round to current total user deposit (excluding any
     * reward value) mapping
     */
    mapping(uint256 => uint256) private _totalDeposits;

    event Deposit(address indexed from, uint256 value);
    event Withdraw(address indexed to, uint256 value);
    event NewRound(uint256 indexed round, address from, uint256 value);

    constructor(address[] memory teamMembers, uint256 rewardInterval) {
        REWARD_ROUND_INTERVAL = rewardInterval;

        // Grant admin role to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Grant roles to team members
        for (uint256 i = 0; i < teamMembers.length; ++i) {
            require(
                teamMembers[i] != address(0),
                "Team member cannot be a zero address"
            );
            _grantRole(TEAM_MEMBER_ROLE, teamMembers[i]);
        }

        // Starts the first round
        _startNextRound();
    }

    /**
     * @dev Returns whether `REWARD_ROUND_INTERVAL` blocks have passed since the last reward deposit.
     */
    function hasRewardRoundIntervalPassed() public view returns (bool) {
        return block.number > currentRoundStartBlock + REWARD_ROUND_INTERVAL;
    }

    /**
     * @dev Latest saved deposit snapshot for `account` address
     *
     * @param account Address of user
     * @return Latest snapshot of user deposits or (0, 0) if no snapshot exists
     */
    function latestSnapshotOf(address account)
        public
        view
        returns (uint256, uint256)
    {
        uint256 len = _depositSnapshots[account].rounds.length;
        if (len > 0) {
            return (
                _depositSnapshots[account].rounds[len - 1],
                _depositSnapshots[account].values[len - 1]
            );
        }

        return (0, 0);
    }

    /**
     * @dev Gets reward sent by team member for round - `round`
     * @param round Reward round
     *
     * @return Amount of reward sent by team member for `round`
     */
    function totalRewardAt(uint256 round) public view returns (uint256) {
        return _rewards[round];
    }

    /**
     * @dev Gets total user deposit that was sent by user up until the
     * end of round `round`
     *
     * @param round Reward round
     * @return Total user deposit at the end of `round` round
     */
    function totalDepositAt(uint256 round) public view returns (uint256) {
        return _totalDeposits[round];
    }

    /**
     * @dev Returns the total amount of reward a user can avail up to
     * the end of previous round
     *
     * @param account Address of user
     * @return Total reward share for `account` address
     */
    function totalRewardOf(address account) public view returns (uint256) {
        uint256 lastWithdrawRound = _lastRewardWithdrawRound[account];
        return _calcAggregateRewards(account, lastWithdrawRound + 1);
    }

    /**
     * @dev Allows a team member to add reward value for current round and starting
     * the next round consequently
     *
     * Requirements:
     * - `msg.sender` must be have a team member role
     * - An interval of `REWARD_ROUND_INTERVAL` must have passed since the last reward deposit
     *
     */
    function addReward() external payable onlyRole(TEAM_MEMBER_ROLE) {
        require(
            hasRewardRoundIntervalPassed(),
            "Reward round interval has not passed yet"
        );
        // Drop reward for current round
        _rewards[currentRound] += msg.value;

        // Start next round
        _startNextRound();
        emit NewRound(currentRound, msg.sender, msg.value);
    }

    /**
     * @dev Allows a user to withdraw all deposits and total earned
     * rewards upto this point (if any)
     *
     * Requirements:
     * - `msg.sender` must have deposited at least one time
     * - `msg.sender` must have non-zero deposit + reward amount
     */
    function withdraw() external {
        // Get the current deposit amount
        uint256 len = _depositSnapshots[msg.sender].rounds.length;
        require(len > 0, "No deposits found");
        uint256 totalDeposit = _depositSnapshots[msg.sender].values[len - 1];

        // Calculate rewards if any
        uint256 reward = totalRewardOf(msg.sender);

        uint256 totalAmount = totalDeposit + reward;
        require(totalAmount > 0, "No deposit/reward to withdraw");

        _updateDepositSnapshot(
            _depositSnapshots[msg.sender],
            totalDeposit,
            _subtract
        );
        _lastRewardWithdrawRound[msg.sender] = _depositSnapshots[msg.sender]
            .rounds[len - 1];
        _totalDeposits[currentRound] -= totalDeposit;

        _withdraw(msg.sender, totalAmount);
    }

    /**
     * @dev Start the next round, retaining the count total deposits
     * from previous round
     */
    function _startNextRound() internal {
        currentRound++;
        currentRoundStartBlock = block.number;
        _totalDeposits[currentRound] = _totalDeposits[currentRound - 1];
    }

    /**
     * @dev Allows user tp deposit received amount to the pool
     *
     * Emits {Deposit} event
     */
    function deposit() external payable {
        _deposit(msg.sender, msg.value);
    }

    /**
     * @dev Update the snapshot of `account` with value `amount`
     *
     * Emits {Deposit} event
     *
     * Requirements:
     * - `msg.sender` must not be a team member
     */
    function _deposit(address account, uint256 amount) internal {
        require(
            !hasRole(TEAM_MEMBER_ROLE, account),
            "Team Member cannot be participant in rewards pool"
        );

        _updateDepositSnapshot(_depositSnapshots[account], amount, _add);
        _totalDeposits[currentRound] += amount;

        emit Deposit(account, amount);
    }

    /**
     * @dev Transers `amount` eth to `account` address, reverting for
     * unsuccessful transfer
     *
     * @param account The address to eth transfer to
     * @param amount The amount of eth to transfer
     *
     * Emits {Withdrawn} event
     *
     * Requirements:
     * - `account` address must not be zero addrss
     * - `amount` must be greater than zero
     */
    function _withdraw(address account, uint256 amount) internal {
        require(account != address(0), "Cannot transfer to the zero address");
        require(amount > 0, "Cannot transfer zero value");

        (bool success, ) = account.call{value: amount}("");
        require(success, "Unable to send value");
        emit Withdraw(account, amount);
    }

    /**
     * @dev Calculates the total amount of reward a user aggregated
     * from round `fromRound` up to last participated round
     *
     * @param account Address of user to calculate rewards for
     * @param fromRound Start round to calculate rewards from
     *
     * @return Sum of all rewards earned by `account` from `fromRound`
     * up to last participated round
     */
    function _calcAggregateRewards(address account, uint256 fromRound)
        private
        view
        returns (uint256)
    {
        assert(fromRound > _lastRewardWithdrawRound[account]);
        Snapshots storage snapshots = _depositSnapshots[account];

        uint256 reward;
        uint256 len = snapshots.rounds.length;

        if (len == 0) {
            return 0;
        }

        uint256 i = len - 1;
        while (i >= 0) {
            if (snapshots.rounds[i] < fromRound) {
                break;
            }

            reward += _rewardAt(snapshots, i);

            if (i == 0) {
                break;
            }

            --i;
        }

        return reward;
    }

    /**
     * @dev Returns the reward for round at index `roundIndex` in `snapshots`
     *
     * @param snapshots Snapshots to calculate reward from
     * @param roundIndex Index of round to calculate reward for
     *
     * @return Reward for round at index `roundIndex` in `snapshots`
     */
    function _rewardAt(Snapshots storage snapshots, uint256 roundIndex)
        private
        view
        returns (uint256)
    {
        uint256 round = snapshots.rounds[roundIndex];

        uint256 accountDeposit = snapshots.values[roundIndex];
        uint256 totalReward = _rewards[round];
        uint256 totalDeposit = _totalDeposits[round];

        uint256 reward = totalDeposit > 0
            ? (accountDeposit * totalReward) / totalDeposit
            : 0;

        return reward;
    }

    /**
     * @dev Updates latest snapshot of `msg.sender`
     *
     * @param snapshots Snapshots to update
     * @param delta The amount by which to update the snapshot
     * @param op The operation to perform to calculate new value with `delta`
     *
     * NOTE This creates a new snapshot if user has not participated in `currentRound` yet
     * else updates snapshot for `currentRound`
     */
    function _updateDepositSnapshot(
        Snapshots storage snapshots,
        uint256 delta,
        function(uint256, uint256) view returns (uint256) op
    ) internal {
        uint256 len = snapshots.rounds.length;
        uint256 lastWithdrawRound = len == 0 ? 0 : snapshots.rounds[len - 1];

        if (lastWithdrawRound < currentRound) {
            // New round
            uint256 oldValue = len == 0 ? 0 : snapshots.values[len - 1];
            uint256 newValue = op(oldValue, delta);
            snapshots.rounds.push(currentRound);
            snapshots.values.push(newValue);
        } else {
            // Same round
            require(lastWithdrawRound == currentRound, "Invalid round");
            uint256 oldValue = snapshots.values[len - 1];
            uint256 newValue = op(oldValue, delta);
            snapshots.values[len - 1] = newValue;
        }
    }

    /**
     * @dev Sending any value and empty calldata would be interpreted as a deposit
     *
     * Emits {Deposit} event
     */
    receive() external payable {
        _deposit(msg.sender, msg.value);
    }

    /**
     * @dev Any unexpected invocation with calldata should revert
     */
    fallback() external payable {
        require(false, "Unexpected fallback");
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) {
        return a + b;
    }

    function _subtract(uint256 a, uint256 b) private pure returns (uint256) {
        return a - b;
    }
}
