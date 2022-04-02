const { ethers, network } = require("hardhat");

const BLOCK_TIME = 13.6; // seconds

// Times in units of no. of blocks
const ONE_DAY = Math.floor((24 * 60 * 60) / BLOCK_TIME);
const ONE_WEEK = 7 * ONE_DAY;

async function main() {
  console.log("DEPLOYMENT NETWORK:", network.name);
  const [deployer] = await ethers.getSigners();
  console.log("\nDeployer:", deployer.address);
  console.log(
    "Deployer account balance:",
    (await deployer.getBalance()).toString()
  );

  const rewardRoundDelay = ONE_WEEK;
  const teamMembers = [deployer.address];

  const RewardsPoolFactory = await ethers.getContractFactory("RewardsPool");
  const pool = await RewardsPoolFactory.deploy(teamMembers, rewardRoundDelay);
  const tx = await pool.deployTransaction.wait();

  console.log("\nContract Deployed!");
  console.log("Address: ", pool.address);
  console.log("Transaction Hash: ", tx.transactionHash);
  console.log("Block Number:", tx.blockNumber);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
