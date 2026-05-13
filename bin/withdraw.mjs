#!/usr/bin/env node
// withdraw.mjs — pull USDC from the agent's spender EOA back to the owner Base Account.
//
// Inverse of fund (Refill agent ($5) button on /dashboard) — which moves USDC from the
// owner Smart Wallet to the spender. This script moves it back the other way: spender
// signs and submits a plain ERC-20 transfer to the owner.
//
// Why CLI-only and not a dashboard button: the spender private key lives at
// ~/.agent-marketplace/session.json (chmod 600) on the user's machine. The browser
// can't sign on the spender's behalf — that's the whole point of the B-bridge model.
//
// Gas: this version has the spender submit the transfer itself, so the spender needs
// a tiny amount of ETH (~$0.02–0.05 per withdraw on Base mainnet). Gasless withdraw via
// EIP-3009 transferWithAuthorization + facilitator relay is on the roadmap alongside
// session keys / TEE autonomous draws.
//
// Usage:
//   withdraw                         # withdraw full spender balance
//   withdraw --amount 2.50           # withdraw a specific USDC amount
//   withdraw --to 0xabc…             # override destination (default: session.account)
//   withdraw --dry-run               # print the planned tx, do not sign or send

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, formatEther, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readSession, chain, NETWORK, SetupRequiredError } from "./_wallet.mjs";

const USDC_BY_NETWORK = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

function parseArgs(argv) {
  const args = { amount: null, to: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--amount") args.amount = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: withdraw [--amount <USDC>] [--to 0x…] [--dry-run]\n" +
        "Pull USDC from the agent spender back to your Base Account.\n" +
        "Default: withdraws the full spender USDC balance to the owner wallet recorded in session.json.\n",
      );
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const { amount, to: toOverride, dryRun } = parseArgs(process.argv.slice(2));

  const session = readSession();
  if (!session?.spenderPrivKey || !session?.account) {
    process.stderr.write(
      new SetupRequiredError(
        "No session found. Run `agent-marketplace setup` (or `node bin/setup.mjs`) to authorize a spender first.",
      ).message + "\n",
    );
    process.exit(2);
  }

  const destination = toOverride || session.account;
  if (!isAddress(destination)) {
    process.stderr.write(`error: --to "${destination}" is not a valid address\n`);
    process.exit(2);
  }

  const spender = privateKeyToAccount(session.spenderPrivKey);
  const usdcAddr = USDC_BY_NETWORK[NETWORK] || USDC_BY_NETWORK.base;
  const pub = createPublicClient({ chain: chain(), transport: http() });

  const balance = await pub.readContract({
    address: usdcAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [spender.address],
  });
  if (balance === 0n) {
    process.stderr.write(
      `Spender ${spender.address} has 0 USDC — nothing to withdraw.\n` +
      `If you expected a balance, check on-chain at https://basescan.org/address/${spender.address}\n`,
    );
    process.exit(2);
  }

  const amountUnits = amount ? parseUnits(amount, 6) : balance;
  if (amountUnits <= 0n) {
    process.stderr.write(`error: --amount must be positive (got "${amount}")\n`);
    process.exit(2);
  }
  if (amountUnits > balance) {
    process.stderr.write(
      `Requested ${formatUnits(amountUnits, 6)} USDC exceeds spender balance ${formatUnits(balance, 6)} USDC.\n`,
    );
    process.exit(2);
  }

  const ethBalance = await pub.getBalance({ address: spender.address });

  process.stdout.write(
    `Withdraw plan\n` +
    `  Spender EOA:           ${spender.address}\n` +
    `  Destination:           ${destination}${toOverride ? "" : "  (owner Base Account from session.json)"}\n` +
    `  Amount:                ${formatUnits(amountUnits, 6)} USDC\n` +
    `  Spender USDC after:    ${formatUnits(balance - amountUnits, 6)} USDC\n` +
    `  Spender ETH (for gas): ${formatEther(ethBalance)} ETH\n` +
    `  Network:               ${NETWORK}\n\n`,
  );

  if (!dryRun && ethBalance === 0n) {
    process.stderr.write(
      `Spender has 0 ETH and needs gas to submit the transfer (~$0.02 worth).\n` +
      `Send a tiny amount of ETH on Base mainnet to ${spender.address}, then retry.\n` +
      `(Gasless withdraw via facilitator relay is on the roadmap.)\n`,
    );
    process.exit(3);
  }

  if (dryRun) {
    process.stdout.write(
      `--dry-run: not signing or submitting. Tx would be:\n` +
      `  to:   ${usdcAddr}\n` +
      `  fn:   transfer(${destination}, ${amountUnits.toString()})\n`,
    );
    return;
  }

  const wallet = createWalletClient({ account: spender, chain: chain(), transport: http() });

  process.stdout.write(`→ Submitting USDC.transfer to ${usdcAddr}…\n`);
  const hash = await wallet.writeContract({
    address: usdcAddr,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [destination, amountUnits],
  });
  process.stdout.write(`  tx hash: ${hash}\n`);

  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    process.stderr.write(`✗ tx ${hash} reverted (status=${receipt.status}). Aborting.\n`);
    process.exit(1);
  }
  process.stdout.write(`  ✓ confirmed in block ${receipt.blockNumber}\n\n`);
  process.stdout.write(
    `✓ Withdrew ${formatUnits(amountUnits, 6)} USDC from ${spender.address} to ${destination}.\n` +
    `  https://basescan.org/tx/${hash}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
