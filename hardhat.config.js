require("@nomiclabs/hardhat-waffle");

module.exports = {
  solidity: "0.8.7",
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 1337,
    }
  }
};
