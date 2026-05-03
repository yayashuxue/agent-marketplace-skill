// Shared wallet bootstrap — same wallet file as agent-marketplace-mcp so MCP + Skill
// users share one balance. Local hot wallet only (no CDP path here — keep skill minimal).

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createWalletClient, createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

export const PROXY_URL = process.env.AGENT_MARKETPLACE_URL || "https://agent-marketplace-proxy.vercel.app";
export const NETWORK = process.env.X402_NETWORK || "base";
const WALLET_DIR = process.env.AGENT_MARKETPLACE_WALLET_DIR || join(homedir(), ".agent-marketplace");
const WALLET_FILE = join(WALLET_DIR, "wallet.json");

const USDC = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export function chain() {
  return NETWORK === "base-sepolia" ? baseSepolia : base;
}

export function loadOrCreateKey() {
  if (existsSync(WALLET_FILE)) {
    const data = JSON.parse(readFileSync(WALLET_FILE, "utf8"));
    if (!data.privateKey?.startsWith("0x")) throw new Error(`Malformed wallet at ${WALLET_FILE}`);
    return { privateKey: data.privateKey, fresh: false };
  }
  mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 });
  const pk = generatePrivateKey();
  writeFileSync(WALLET_FILE, JSON.stringify({ privateKey: pk, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  chmodSync(WALLET_FILE, 0o600);
  return { privateKey: pk, fresh: true };
}

export function getAccount() {
  const { privateKey, fresh } = loadOrCreateKey();
  return { account: privateKeyToAccount(privateKey), walletFile: WALLET_FILE, fresh };
}

export function getWalletClient() {
  const { account, walletFile, fresh } = getAccount();
  const client = createWalletClient({ account, chain: chain(), transport: http() });
  return { client, account, walletFile, fresh };
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
  } catch (e) {
    return null;
  }
}
