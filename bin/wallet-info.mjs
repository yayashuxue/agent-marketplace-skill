#!/usr/bin/env node
// wallet-info.mjs — print spender wallet, Base Account, balance, fund + dashboard URLs.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  PROXY_URL,
  NETWORK,
  CONFIG_DIR,
  SESSION_FILE,
  readSession,
  usdcBalance,
  SetupRequiredError,
} from "./_wallet.mjs";

// v0.1 residue check: a leftover wallet.json (from the CDP-managed-EOA era) is
// silently ignored by v2, but if a stale v0.1 install on the same machine is
// still printing that EOA as the fund target, the user can lose money funding a
// wallet the v2 spender path can't sign for. Surface the conflict once.
const LEGACY_WALLET = join(CONFIG_DIR, "wallet.json");
if (existsSync(LEGACY_WALLET)) {
  process.stderr.write(
    `warn: legacy v0.1 wallet detected at ${LEGACY_WALLET} — v2 ignores it.\n` +
    `      If you funded that address by mistake, sweep it before using the v2 spender below.\n\n`,
  );
}

const session = readSession();
if (!session?.spenderAddress) {
  process.stderr.write(
    new SetupRequiredError("No session found. Run `node bin/setup.mjs` to authorize a spender via your Base Account.").message + "\n",
  );
  process.exit(2);
}

const bal = await usdcBalance(session.spenderAddress);
const netLabel = NETWORK === "base-sepolia" ? "Base Sepolia (testnet)" : "Base (mainnet)";
const dashboardUrl = `${PROXY_URL}/wallet?account=${session.account}&spender=${session.spenderAddress}`;
const fundUrl = `${PROXY_URL}/fund?addr=${session.spenderAddress}&amount=5`;
const faucet = NETWORK === "base-sepolia" ? "https://faucet.circle.com" : null;

const lines = [
  `Agent spender wallet (Base Account-authorized — you control via Coinbase passkey)`,
  `  Base Account: ${session.account}`,
  `  Spender:      ${session.spenderAddress}`,
  `  Network:      ${netLabel}`,
  `  Balance:      ${bal ?? "unknown"} USDC`,
  `  Config:       ${SESSION_FILE} (chmod 600)`,
  ``,
  `Cost: $0.001 per search → $1 covers ~1000 calls.`,
];
if (faucet) lines.push(``, `Free testnet USDC: ${faucet}`);
else lines.push(``, `Fund with Apple Pay (Coinbase Onramp guest checkout):`, `  ${fundUrl}`);
lines.push(``, `Manage / revoke: ${dashboardUrl}`);

process.stdout.write(lines.join("\n") + "\n");
