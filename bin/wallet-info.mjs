#!/usr/bin/env node
// wallet-info.mjs — print buyer wallet address, balance, and fund URL.

import { PROXY_URL, NETWORK, CONFIG_FILE, getAccount, usdcBalance, SetupRequiredError } from "./_wallet.mjs";

let account;
try {
  account = await getAccount();
} catch (e) {
  if (e instanceof SetupRequiredError) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  throw e;
}

const bal = await usdcBalance(account.address);
const netLabel = NETWORK === "base-sepolia" ? "Base Sepolia (testnet)" : "Base (mainnet)";
const fundUrl = `${PROXY_URL}/fund?addr=${account.address}&amount=5`;
const faucet = NETWORK === "base-sepolia" ? "https://faucet.circle.com" : null;

const lines = [
  `Buyer wallet (CDP-managed — Coinbase enclave holds the key)`,
  `  Address:   ${account.address}`,
  `  Network:   ${netLabel}`,
  `  Balance:   ${bal ?? "unknown"} USDC`,
  `  Config:    ${CONFIG_FILE} (chmod 600, no privkey)`,
  ``,
  `Cost: $0.001 per search → $1 covers ~1000 calls.`,
];
if (faucet) lines.push(``, `Free testnet USDC: ${faucet}`);
else lines.push(``, `Fund with Apple Pay (Coinbase Onramp guest checkout):`, `  ${fundUrl}`);
lines.push(``, `Or transfer existing USDC on Base directly to ${account.address}.`);

process.stdout.write(lines.join("\n") + "\n");
