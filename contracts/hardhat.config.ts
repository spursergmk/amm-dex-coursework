import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.20",
    settings: {
      // 兼容教学中使用的 Ganache 节点。
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      throwOnTransactionFailures: false,
      chainType: "l1",
      chainId: 31337,
    },
    localhost: {
      type: "http",
      chainType: "l1",
      chainId: 31337,
      url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      accounts: "remote",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    ganache: {
      type: "http",
      chainType: "l1",
      url: process.env.GANACHE_RPC_URL ?? "http://127.0.0.1:8545",
      accounts: "remote",
    },
  },
});
