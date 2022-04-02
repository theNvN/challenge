const { expect } = require("chai");
const { ethers } = require("hardhat");

const {
  utils: { parseEther },
} = ethers;

const FIVE_ETHER = parseEther("5");
const TEN_ETHER = parseEther("10");
const TWENTY_ETHER = parseEther("20");
const THIRTY_ETHER = parseEther("30");
const FIFTY_ETHER = parseEther("50");
const HUNDRED_ETHER = parseEther("100");

const BLOCK_TIME = 13.6; // seconds

// Times in units of no. of blocks
const ONE_DAY = Math.floor((24 * 60 * 60) / BLOCK_TIME);
const ONE_WEEK = 7 * ONE_DAY;

const advanceBlock = () => ethers.provider.send("evm_mine");
const advanceBlockBy = (n) =>
  ethers.provider.send("hardhat_mine", ["0x" + n.toString(16)]);

describe("RewardsPool", function () {
  let deployer;
  let teamMembers;
  let users;

  before(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    teamMembers = signers.slice(1, 4);
    users = signers.slice(4);

    this.RewardsPool = await ethers.getContractFactory("RewardsPool");
  });

  beforeEach(async function () {
    this.pool = await this.RewardsPool.deploy(
      teamMembers.map((tm) => tm.address),
      ONE_WEEK
    );
  });

  describe("Deployment", function () {
    it("deploys correctly with valid parameters", async function () {
      await expect(
        this.RewardsPool.deploy(
          teamMembers.map((tm) => tm.address),
          ONE_WEEK
        )
      ).to.not.be.reverted;
    });

    it("deploy fails with invalid parameters", async function () {
      await expect(
        this.RewardsPool.deploy(
          [
            ...teamMembers.map((tm) => tm.address),
            ethers.constants.AddressZero,
          ],
          ONE_WEEK
        )
      ).to.be.revertedWith("Team member cannot be a zero address");
    });

    it("deployed with expected params", async function () {
      expect(await this.pool.currentRound()).to.eq(1);
      expect(await this.pool.currentRoundStartBlock()).to.be.gt(0);
    });
  });

  describe("Reward Drop", function () {
    it("team member successfully deposits reward amount", async function () {
      const round0 = await this.pool.currentRound();
      expect(round0).to.eq(1);

      await advanceBlockBy(ONE_WEEK);
      await expect(
        this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER })
      ).to.not.be.reverted;

      const round1 = await this.pool.currentRound();
      expect(round1).to.eq(2);

      expect(await this.pool.totalRewardAt(round0)).equal(TEN_ETHER);
    });

    it("non-team member cannot deposit reward amount", async function () {
      await advanceBlockBy(ONE_WEEK);

      await expect(this.pool.connect(users[0]).addReward({ value: TEN_ETHER }))
        .to.be.reverted;

      const round = await this.pool.currentRound();
      expect(round).to.eq(1);

      expect(await this.pool.totalRewardAt(round)).equal(0);
    });

    it("next reward amount can be deposited only after specified period", async function () {
      expect(await this.pool.currentRound()).to.eq(1);
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });
      expect(await this.pool.currentRound()).to.eq(2);

      await expect(
        this.pool.connect(teamMembers[0]).addReward({ value: THIRTY_ETHER })
      ).to.be.revertedWith("Reward round interval has not passed yet");
      expect(await this.pool.currentRound()).to.eq(2);

      // 5 days passed
      advanceBlockBy(ONE_WEEK - 2 * ONE_DAY);
      await expect(
        this.pool.connect(teamMembers[0]).addReward({ value: FIFTY_ETHER })
      ).to.be.revertedWith("Reward round interval has not passed yet");
      expect(await this.pool.currentRound()).to.eq(2);

      // 7 days passed
      advanceBlockBy(2 * ONE_DAY);
      const blockNum = await ethers.provider.getBlock().then((b) => b.number);

      await expect(
        this.pool.connect(teamMembers[0]).addReward({ value: TWENTY_ETHER })
      ).to.not.be.reverted;
      expect(await this.pool.currentRound()).to.eq(3);

      expect(await this.pool.currentRoundStartBlock()).to.gte(blockNum);

      expect(await this.pool.totalRewardAt(1)).equal(TEN_ETHER);
      expect(await this.pool.totalRewardAt(2)).equal(TWENTY_ETHER);
      expect(await this.pool.totalRewardAt(3)).equal(0);
    });
  });

  describe("Deposit", function () {
    it("user successfully deposits by calling deposit()", async function () {
      const [round0, value0] = await this.pool.latestSnapshotOf(
        users[0].address
      );

      expect(round0).to.equal(0);
      expect(value0).to.equal(0);

      await this.pool.connect(users[0]).deposit({
        value: TEN_ETHER,
      });

      const [round1, value1] = await this.pool.latestSnapshotOf(
        users[0].address
      );

      expect(round1).to.equal(1);
      expect(value1).to.equal(TEN_ETHER);
    });

    it("user successfully deposits by sending transaction with no calldata", async function () {
      const [round0, value0] = await this.pool.latestSnapshotOf(
        users[0].address
      );

      expect(round0).to.equal(0);
      expect(value0).to.equal(0);

      await users[0].sendTransaction({
        to: this.pool.address,
        value: TEN_ETHER,
      });

      const [round1, value1] = await this.pool.latestSnapshotOf(
        users[0].address
      );

      expect(round1).to.equal(1);
      expect(value1).to.equal(TEN_ETHER);
    });

    it("multiple user deposits in same round updates same snapshot corresponding to current round", async function () {
      await this.pool.connect(users[0]).deposit({
        value: TEN_ETHER,
      });

      const [round0, value0] = await this.pool.latestSnapshotOf(
        users[0].address
      );
      expect(round0).to.equal(1);
      expect(value0).to.equal(TEN_ETHER);

      await this.pool.connect(users[0]).deposit({
        value: FIVE_ETHER,
      });

      const [round1, value1] = await this.pool.latestSnapshotOf(
        users[0].address
      );
      expect(round1).to.equal(round0);
      expect(value1).to.equal(TEN_ETHER.add(FIVE_ETHER));
    });

    it("first deposit in a new round creates a new snapshot corresponding to new round", async function () {
      await this.pool.connect(users[0]).deposit({
        value: TEN_ETHER,
      });

      const [round0, value0] = await this.pool.latestSnapshotOf(
        users[0].address
      );
      expect(round0).to.equal(1);
      expect(value0).to.equal(TEN_ETHER);

      // Start new round
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: FIVE_ETHER });

      await this.pool.connect(users[0]).deposit({
        value: FIVE_ETHER,
      });

      const [round1, value1] = await this.pool.latestSnapshotOf(
        users[0].address
      );
      expect(round1).to.equal(round0.add(1));
      expect(value1).to.equal(FIVE_ETHER.add(TEN_ETHER));
    });

    it("total deposit is sum of all user deposits at particular round", async function () {
      const round0 = await this.pool.currentRound();

      await this.pool.connect(users[0]).deposit({
        value: TEN_ETHER,
      });
      await this.pool.connect(users[1]).deposit({
        value: FIVE_ETHER,
      });

      expect(await this.pool.totalDepositAt(round0)).equal(
        TEN_ETHER.add(FIVE_ETHER)
      );

      // Start new round
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: FIVE_ETHER });

      await this.pool.connect(users[0]).deposit({
        value: TEN_ETHER.add(FIVE_ETHER),
      });
      const [_, value0] = await this.pool.latestSnapshotOf(users[0].address);
      expect(value0).to.equal(TWENTY_ETHER.add(FIVE_ETHER));
      const [__, value1] = await this.pool.latestSnapshotOf(users[1].address);
      expect(value1).to.equal(FIVE_ETHER);

      const round1 = await this.pool.currentRound();
      expect(await this.pool.totalDepositAt(round1)).equal(THIRTY_ETHER);
    });

    it("user cannot deposit by sending transaction with calldata", async function () {
      await expect(
        users[0].sendTransaction({
          to: this.pool.address,
          value: TEN_ETHER,
          data: "0xffffffff",
        })
      ).to.be.revertedWith("Unexpected fallback");

      const [round, value] = await this.pool.latestSnapshotOf(users[0].address);
      expect(round).to.equal(0);
      expect(value).to.equal(0);
    });

    it("team member CANNOT make deposits as participant", async function () {
      await expect(
        teamMembers[0].sendTransaction({
          to: this.pool.address,
          value: TEN_ETHER,
        })
      ).to.be.revertedWith("Team Member cannot be participant in rewards pool");

      await expect(
        this.pool.connect(teamMembers[0]).deposit({ value: TEN_ETHER })
      ).to.be.revertedWith("Team Member cannot be participant in rewards pool");
    });
  });

  describe("Reward Withdraw", function () {
    it("reverts if user has no deposits", async function () {
      await expect(this.pool.connect(users[0]).withdraw()).to.be.revertedWith(
        "No deposits found"
      );
    });

    it("no reward in withdrawal amount if deposited after start of reward round", async function () {
      advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });

      await this.pool.connect(users[0]).deposit({ value: FIVE_ETHER });

      const [round0, value0] = await this.pool.latestSnapshotOf(
        users[0].address
      );
      expect(round0).to.equal(2);
      expect(value0).to.equal(FIVE_ETHER);

      const rewardAmount = await this.pool
        .connect(users[0])
        .totalRewardOf(users[0].address);
      expect(rewardAmount).to.equal(0);

      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], FIVE_ETHER);

      const [round1, value1] = await this.pool.latestSnapshotOf(
        users[0].address
      );
      expect(round1).to.equal(round0);
      expect(value1).to.equal(0);
    });

    it("user cannot withdraw multiple times for same deposit", async function () {
      await this.pool.connect(users[0]).deposit({ value: TWENTY_ETHER });
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });

      const rewardAmount = await this.pool
        .connect(users[0])
        .totalRewardOf(users[0].address);
      expect(rewardAmount).to.equal(TEN_ETHER);

      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], THIRTY_ETHER);

      await advanceBlockBy(ONE_WEEK);
      await expect(this.pool.connect(users[0]).withdraw()).to.be.revertedWith(
        "No deposit/reward to withdraw"
      );

      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });

      await expect(this.pool.connect(users[0]).withdraw()).to.be.revertedWith(
        "No deposit/reward to withdraw"
      );
    });

    it("user can withdraw original amount for a round that has not ended yet", async function () {
      await this.pool.connect(users[0]).deposit({ value: TWENTY_ETHER });
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });

      const rewardAmount = await this.pool
        .connect(users[0])
        .totalRewardOf(users[0].address);
      expect(rewardAmount).to.equal(TEN_ETHER);

      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], THIRTY_ETHER);

      await advanceBlockBy(ONE_WEEK);
      await expect(this.pool.connect(users[0]).withdraw()).to.be.revertedWith(
        "No deposit/reward to withdraw"
      );

      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });
      await this.pool.connect(users[0]).deposit({ value: TEN_ETHER });
      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], TEN_ETHER);
      await this.pool.connect(users[0]).deposit({ value: FIVE_ETHER });
      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], FIVE_ETHER);

      await expect(this.pool.connect(users[0]).withdraw()).to.be.revertedWith(
        "No deposit/reward to withdraw"
      );
    });

    it("user gets all reward as a single depositor", async function () {
      await this.pool.connect(users[0]).deposit({ value: TWENTY_ETHER });

      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });

      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], THIRTY_ETHER);
    });

    it("user gets all reward as the only depositor who deposited before reward deposit", async function () {
      await this.pool.connect(users[0]).deposit({ value: TWENTY_ETHER });

      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });
      advanceBlock();

      await this.pool.connect(users[1]).deposit({ value: FIFTY_ETHER });

      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], THIRTY_ETHER);
      await expect(
        await this.pool.connect(users[1]).withdraw()
      ).to.changeEtherBalance(users[1], FIFTY_ETHER);
    });

    it("users gets proportionate share of reward", async function () {
      await this.pool
        .connect(users[0])
        .deposit({ value: TWENTY_ETHER.add(FIVE_ETHER) });
      await this.pool.connect(users[1]).deposit({ value: TEN_ETHER });
      await this.pool.connect(users[2]).deposit({ value: FIFTY_ETHER });
      await this.pool.connect(users[3]).deposit({ value: FIVE_ETHER });
      await this.pool.connect(users[4]).deposit({ value: TEN_ETHER });

      await advanceBlockBy(ONE_WEEK);
      await this.pool
        .connect(teamMembers[0])
        .addReward({ value: HUNDRED_ETHER });

      const reward0 = await this.pool.totalRewardOf(users[0].address);
      const reward1 = await this.pool.totalRewardOf(users[1].address);
      const reward2 = await this.pool.totalRewardOf(users[2].address);
      const reward3 = await this.pool.totalRewardOf(users[3].address);
      const reward4 = await this.pool.totalRewardOf(users[4].address);
      expect(reward0).to.equal(TWENTY_ETHER.add(FIVE_ETHER));
      expect(reward1).to.equal(TEN_ETHER);
      expect(reward2).to.equal(FIFTY_ETHER);
      expect(reward3).to.equal(FIVE_ETHER);
      expect(reward4).to.equal(TEN_ETHER);

      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(users[0], reward0.mul(2));
      await expect(
        await this.pool.connect(users[1]).withdraw()
      ).to.changeEtherBalance(users[1], reward1.mul(2));
      await expect(
        await this.pool.connect(users[2]).withdraw()
      ).to.changeEtherBalance(users[2], reward2.mul(2));
      await expect(
        await this.pool.connect(users[3]).withdraw()
      ).to.changeEtherBalance(users[3], reward3.mul(2));
      await expect(
        await this.pool.connect(users[4]).withdraw()
      ).to.changeEtherBalance(users[4], reward4.mul(2));
    });

    it("user gets rewards share for all past participated rounds", async function () {
      // round 1 start here
      await this.pool.connect(users[0]).deposit({ value: TWENTY_ETHER });
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: TEN_ETHER });
      // round 1 ends here
      const reward1 = await this.pool.totalRewardOf(users[0].address);
      expect(reward1).to.equal(TEN_ETHER);

      // round 2 start
      await this.pool.connect(users[0]).deposit({ value: TEN_ETHER });
      await this.pool.connect(users[1]).deposit({ value: TEN_ETHER });
      await advanceBlockBy(ONE_WEEK);
      await this.pool
        .connect(teamMembers[0])
        .addReward({ value: TWENTY_ETHER });

      // total reward at end of round 2 = reward at round 1 + 3/4th of reward at this round
      const reward2 = reward1.add(TWENTY_ETHER.mul(3).div(4));
      expect(await this.pool.totalRewardOf(users[0].address)).to.equal(reward2);

      // round 3 start
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(users[2]).deposit({ value: TEN_ETHER });
      await this.pool.connect(teamMembers[0]).addReward({ value: FIFTY_ETHER });

      // same reward as before as user 0 did not participate in this round
      const reward3 = reward2;
      expect(await this.pool.totalRewardOf(users[0].address)).to.equal(reward3);

      // round 4 start
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(teamMembers[0]).addReward({ value: FIVE_ETHER });
      // same reward as before as user 0 did not participate in this round
      const reward4 = reward3;
      expect(await this.pool.totalRewardOf(users[0].address)).to.equal(reward4);

      // round 5 start
      await advanceBlockBy(ONE_WEEK);
      await this.pool.connect(users[0]).deposit({ value: TWENTY_ETHER });
      await this.pool.connect(users[4]).deposit({ value: TEN_ETHER });
      await this.pool
        .connect(teamMembers[0])
        .addReward({ value: THIRTY_ETHER });
      // total reward at end of round 5 = reward at round 4 + 5/8th of reward at this round
      const reward5 = reward4.add(THIRTY_ETHER.mul(5).div(8));
      expect(await this.pool.totalRewardOf(users[0].address)).to.equal(reward5);

      await expect(
        await this.pool.connect(users[0]).withdraw()
      ).to.changeEtherBalance(
        users[0],
        reward5.add(
          // all deposits of user[0]
          TWENTY_ETHER.add(TEN_ETHER).add(TWENTY_ETHER)
        )
      );

      await expect(this.pool.connect(users[0]).withdraw()).to.be.revertedWith(
        "No deposit/reward to withdraw"
      );
    });
  });
});
