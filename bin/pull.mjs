#!/usr/bin/env node
// pull.mjs — pull USDC from the owner Smart Wallet to the spender via SpendPermission.
//
// Walks the @base-org/account `prepareSpendCallData` helper to build a 1- or 2-call sequence:
//   1. `approveWithSignature` — only on first use, registers the signed permission on-chain.
//   2. `spend(permission, amount)` — pulls USDC from owner Smart Wallet → spender EOA.
//
// The spender EOA pays gas for both calls. Estimate: ~$0.02-0.05 of ETH per pull on Base mainnet
// (first pull is ~30k gas more expensive than subsequent ones due to the approve step).
//
// After this script runs, the spender holds USDC and the existing EIP-3009 search flow works
// normally — proxy never needs to know about SpendPermission until upstream `@x402/express` adds
// a native SpendPermission scheme.
//
// Usage:
//   node pull.mjs                 # pull default $5
//   node pull.mjs --amount 2.50   # pull a specific amount in USDC
//   node pull.mjs --dry-run       # print the calls, do not sign or send

import { prepareSpendCallData, getPermissionStatus } from "@base-org/account/spend-permission/node";
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readSession, chain, NETWORK, SetupRequiredError } from "./_wallet.mjs";

function parseArgs(argv) {
  const args = { amount: "5", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--amount") args.amount = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.error("Usage: pull.mjs [--amount 5] [--dry-run]");
      console.error("Pulls USDC from your Base Account Smart Wallet to the authorized spender via SpendPermission.");
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const { amount, dryRun } = parseArgs(process.argv.slice(2));
  const amountUnits = parseUnits(amount, 6); // USDC has 6 decimals
  if (amountUnits <= 0n) {
    process.stderr.write(`error: --amount must be positive (got "${amount}")\n`);
    process.exit(2);
  }

  const session = readSession();
  if (!session) {
    process.stderr.write(new SetupRequiredError("No session found. Run `node bin/setup.mjs` to authorize a spender via your Base Account.").message + "\n");
    process.exit(2);
  }
  if (!session.permission) {
    process.stderr.write("session.json has no permission bundle. Re-run setup: `node bin/setup.mjs --force` (or `npx -y github:yayashuxue/agent-marketplace-mcp init --force`).\n");
    process.exit(2);
  }
  if (!session.spenderPrivKey?.startsWith("0x")) {
    process.stderr.write("session.json missing/invalid spenderPrivKey. Re-run setup.\n");
    process.exit(2);
  }

  const spender = privateKeyToAccount(session.spenderPrivKey);
  const pub = createPublicClient({ chain: chain(), transport: http() });

  // Permission status drives all the pre-flight checks (revoked / not enough allowance / first use).
  const status = await getPermissionStatus(session.permission);
  if (status.isRevoked) {
    process.stderr.write("Spend permission has been revoked on-chain. Re-authorize via the dashboard or re-run init.\n");
    process.exit(2);
  }
  if (amountUnits > status.remainingSpend) {
    process.stderr.write(
      `Requested ${amount} USDC exceeds remaining permission allowance ${formatUnits(status.remainingSpend, 6)} USDC.\n` +
      `(Cap is $20 / 30 days by default; pull less, or wait for the period to roll over.)\n`,
    );
    process.exit(2);
  }

  const ethBal = await pub.getBalance({ address: spender.address });
  if (!dryRun && ethBal === 0n) {
    process.stderr.write(
      `Spender ${spender.address} has 0 ETH — needs a small amount for gas.\n` +
      `Send ~$0.50 of ETH (Base mainnet) to ${spender.address}, then retry. This is one-time bootstrap; ETH balance carries forward.\n`,
    );
    process.exit(3);
  }

  // prepareSpendCallData returns [approveCall?, spendCall, transferCall?]. We never pass a
  // recipient — we want USDC to land in the spender so the existing EIP-3009 path keeps working.
  const calls = await prepareSpendCallData(session.permission, amountUnits, undefined);
  const willApprove = !status.isApprovedOnchain;

  process.stdout.write(
    `Pull plan\n` +
    `  Owner Smart Wallet: ${session.account}\n` +
    `  Spender EOA:        ${spender.address}\n` +
    `  Amount:             ${amount} USDC\n` +
    `  Remaining allowance after: ${formatUnits(status.remainingSpend - amountUnits, 6)} USDC\n` +
    `  Spender ETH balance: ${formatEther(ethBal)} ETH\n` +
    `  Calls: ${calls.length}${willApprove ? " (approveWithSignature first, then spend)" : " (spend only — permission already on-chain)"}\n` +
    `  Network: ${NETWORK}\n\n`,
  );

  if (dryRun) {
    if (ethBal === 0n) {
      process.stdout.write(`⚠ spender has 0 ETH — a real run would exit 3 here. Send ~$0.50 ETH to ${spender.address} (Base mainnet) before \`pull --amount\`.\n\n`);
    }
    process.stdout.write("--dry-run: not signing or submitting. Calls:\n");
    process.stdout.write(JSON.stringify(calls.map((c) => ({ to: c.to, value: c.value.toString(), dataLen: c.data.length })), null, 2) + "\n");
    return;
  }

  const wallet = createWalletClient({ account: spender, chain: chain(), transport: http() });

  // Each call must be a separate eth_sendTransaction from the spender EOA. Submit sequentially —
  // the spend call depends on approveWithSignature landing first when both are present.
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const label = willApprove && i === 0 ? "approveWithSignature" : "spend";
    process.stdout.write(`→ Submitting tx ${i + 1}/${calls.length} (${label}) to ${call.to}…\n`);
    const hash = await wallet.sendTransaction({ to: call.to, data: call.data, value: call.value });
    process.stdout.write(`  tx hash: ${hash}\n`);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      process.stderr.write(`✗ tx ${hash} reverted (status=${receipt.status}). Aborting.\n`);
      process.exit(1);
    }
    process.stdout.write(`  ✓ confirmed in block ${receipt.blockNumber}\n`);
  }

  process.stdout.write(`\n✓ Pulled ${amount} USDC from ${session.account} to spender ${spender.address}.\n`);
  process.stdout.write(`Run \`node bin/wallet-info.mjs\` to verify the new spender balance.\n`);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
