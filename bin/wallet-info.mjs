#!/usr/bin/env node
// wallet-info.mjs — print buyer wallet address, balance, and fund URL.

import { PROXY_URL, NETWORK, getAccount, usdcBalance } from "./_wallet.mjs";

const { account, walletFile, fresh } = getAccount();
const bal = await usdcBalance(account.address);
const netLabel = NETWORK === "base-sepolia" ? "Base Sepolia (testnet)" : "Base (mainnet)";
const fundUrl = `${PROXY_URL}/fund?addr=${account.address}&amount=5`;
const faucet = NETWORK === "base-sepolia" ? "https://faucet.circle.com" : null;

const lines = [
  `Buyer wallet`,
  `  Address:   ${account.address}`,
  `  Network:   ${netLabel}`,
  `  Balance:   ${bal ?? "unknown"} USDC`,
  `  Key file:  ${walletFile} (chmod 600)`,
  ``,
  `Cost: $0.001 per search → $1 covers ~1000 calls.`,
];
if (fresh) lines.push(``, `(Wallet was just created on first run — fund it before paid searches.)`);
if (faucet) lines.push(``, `Free testnet USDC: ${faucet}`);
else lines.push(``, `Fund with Apple Pay (Coinbase Onramp guest checkout):`, `  ${fundUrl}`);
lines.push(``, `Or transfer existing USDC on Base directly to ${account.address}.`);

process.stdout.write(lines.join("\n") + "\n");
