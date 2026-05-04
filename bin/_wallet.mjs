// Shared wallet bootstrap — CDP-managed (Coinbase enclave holds the key, not us, not the user).
//
// The user runs `setup.mjs` once to register a CDP API key + create a server-side wallet.
// After that, every search signs through the CDP API; no privkey ever lives on the user's disk.
//
// Config layout: ~/.agent-marketplace/config.json (chmod 600), shared with agent-marketplace-mcp.
//   {
//     "cdpApiKeyId": "organizations/.../apiKeys/...",
//     "cdpApiKeySecret": "<PEM or base64 Ed25519>",
//     "cdpWalletSecret": "<wallet secret>",
//     "accountName": "agent-marketplace-buyer",
//     "address": "0x..."   // cached CDP wallet address
//   }
//
// Env vars (advanced / headless): CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET take
// precedence over the config file, so CI can pin creds without touching the home dir.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWalletClient, createPublicClient, http, formatUnits } from "viem";
import { toAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

export const PROXY_URL = process.env.AGENT_MARKETPLACE_URL || "https://agent-marketplace-proxy.vercel.app";
export const NETWORK = process.env.X402_NETWORK || "base";
export const CONFIG_DIR = process.env.AGENT_MARKETPLACE_CONFIG_DIR || join(homedir(), ".agent-marketplace");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const DEFAULT_ACCOUNT_NAME = "agent-marketplace-buyer";

const USDC = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export function chain() {
  return NETWORK === "base-sepolia" ? baseSepolia : base;
}

class SetupRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "SetupRequiredError";
    this.code = "SETUP_REQUIRED";
  }
}

export function readConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  // chmod 600 sanity — warn (don't fail) if the user widened it.
  try {
    const mode = statSync(CONFIG_FILE).mode & 0o777;
    if (mode !== 0o600) {
      process.stderr.write(`warn: ${CONFIG_FILE} mode is ${mode.toString(8)}, expected 600.\n`);
    }
  } catch {}
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function resolveCreds() {
  const fromEnv = {
    cdpApiKeyId: process.env.CDP_API_KEY_ID,
    cdpApiKeySecret: process.env.CDP_API_KEY_SECRET,
    cdpWalletSecret: process.env.CDP_WALLET_SECRET,
  };
  const fromFile = readConfig() || {};
  const creds = {
    cdpApiKeyId: fromEnv.cdpApiKeyId || fromFile.cdpApiKeyId,
    cdpApiKeySecret: fromEnv.cdpApiKeySecret || fromFile.cdpApiKeySecret,
    cdpWalletSecret: fromEnv.cdpWalletSecret || fromFile.cdpWalletSecret,
    accountName: fromFile.accountName || DEFAULT_ACCOUNT_NAME,
    cachedAddress: fromFile.address,
  };
  if (!creds.cdpApiKeyId || !creds.cdpApiKeySecret || !creds.cdpWalletSecret) {
    throw new SetupRequiredError(
      `Wallet not configured. Run \`node ${join(import.meta.dirname || "", "setup.mjs")}\` to register a CDP API key, ` +
      `or set CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET env vars (headless mode).`,
    );
  }
  return creds;
}

let _cdp = null;
let _account = null;
let _walletClient = null;

export async function getCdpClient() {
  if (_cdp) return _cdp;
  const creds = resolveCreds();
  const { CdpClient } = await import("@coinbase/cdp-sdk");
  _cdp = new CdpClient({
    apiKeyId: creds.cdpApiKeyId,
    apiKeySecret: creds.cdpApiKeySecret,
    walletSecret: creds.cdpWalletSecret,
  });
  return _cdp;
}

export async function getAccount() {
  if (_account) return _account;
  const creds = resolveCreds();
  const cdp = await getCdpClient();
  // getOrCreateAccount is idempotent — same name returns the existing account.
  const cdpAccount = await cdp.evm.getOrCreateAccount({ name: creds.accountName });
  // Wrap as a viem-compatible account for createWalletClient / x402-fetch.
  _account = toAccount({
    address: cdpAccount.address,
    sign: cdpAccount.sign,
    signMessage: cdpAccount.signMessage,
    signTransaction: cdpAccount.signTransaction,
    signTypedData: cdpAccount.signTypedData,
  });
  return _account;
}

export async function getWalletClient() {
  if (_walletClient) return { client: _walletClient, account: _account };
  const account = await getAccount();
  _walletClient = createWalletClient({ account, chain: chain(), transport: http() });
  return { client: _walletClient, account };
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
