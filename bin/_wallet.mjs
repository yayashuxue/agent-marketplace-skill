// Shared wallet bootstrap — Base Account + Spend Permission (v2, no CDP signup).
//
// One-time `setup.mjs` opens a hosted browser flow that:
//   - generates a fresh "spender" EOA in the browser (privkey never leaves the tab),
//   - prompts the user to connect their Base Account (Coinbase Smart Wallet) with passkey,
//   - grants a SpendPermission scoped to USDC, $20 / 30 days, on this app's revenue address,
//   - POSTs the spender privkey + permission to a one-shot localhost listener.
//
// We persist to ~/.agent-marketplace/session.json (chmod 600). Searches sign x402 EIP-3009
// transferWithAuthorization with the spender key — the facilitator submits on-chain, so the
// spender wallet never needs ETH for gas. User retains control via the hosted dashboard.
//
// Env vars (advanced / headless): AGENT_MARKETPLACE_SPENDER_KEY takes precedence over the
// session file, so CI can pin a 0x-prefixed 32-byte hex without touching the home dir.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createPublicClient, http, formatUnits, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

export const PROXY_URL = process.env.AGENT_MARKETPLACE_URL || "https://agent-marketplace-proxy.vercel.app";
export const NETWORK = process.env.X402_NETWORK || "base";
export const CONFIG_DIR = process.env.AGENT_MARKETPLACE_CONFIG_DIR || join(homedir(), ".agent-marketplace");
export const SESSION_FILE = join(CONFIG_DIR, "session.json");

const USDC = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export function chain() {
  return NETWORK === "base-sepolia" ? baseSepolia : base;
}

export function caip2Network() {
  return NETWORK === "base-sepolia" ? "eip155:84532" : "eip155:8453";
}

class SetupRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "SetupRequiredError";
    this.code = "SETUP_REQUIRED";
  }
}

export function readSession() {
  if (!existsSync(SESSION_FILE)) return null;
  // chmod 600 sanity — warn (don't fail) if the user widened it.
  try {
    const mode = statSync(SESSION_FILE).mode & 0o777;
    if (mode !== 0o600) {
      process.stderr.write(`warn: ${SESSION_FILE} mode is ${mode.toString(8)}, expected 600.\n`);
    }
  } catch {}
  return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
}

let _account = null;
let _fetchWithPay = null;

function resolvePrivKey() {
  const envKey = process.env.AGENT_MARKETPLACE_SPENDER_KEY;
  const session = readSession();
  const privKey = envKey || session?.spenderPrivKey;
  if (!privKey || !isHex(privKey) || privKey.length !== 66) {
    throw new SetupRequiredError(
      `Wallet not configured. Run \`node ${join(import.meta.dirname || "", "setup.mjs")}\` to authorize a spender via your Base Account, ` +
      `or set AGENT_MARKETPLACE_SPENDER_KEY env var (headless mode).`,
    );
  }
  return privKey;
}

export function getAccount() {
  if (_account) return _account;
  _account = privateKeyToAccount(resolvePrivKey());
  return _account;
}

export function getFetchWithPayment() {
  if (_fetchWithPay) return { fetchWithPay: _fetchWithPay, account: _account };
  const account = getAccount();
  _fetchWithPay = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: caip2Network(), client: new ExactEvmScheme(account) }],
  });
  return { fetchWithPay: _fetchWithPay, account };
}

export async function usdcBalance(address) {
  try {
    const pub = createPublicClient({ chain: chain(), transport: http() });
    const bal = await pub.readContract({
      address: USDC[NETWORK] || USDC.base,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [address],
    });
    return formatUnits(bal, 6);
  } catch {
    return null;
  }
}

export { SetupRequiredError };
