#!/usr/bin/env node
// search.mjs — paid Google SERP via x402.
// Usage: node search.mjs --q "query" [--num 10] [--location "United States"] [--free]
// Free tier (5/IP/day) is tried first; paid path requires `setup.mjs` to have configured CDP.

import {
  PROXY_URL,
  NETWORK,
  getFetchWithPayment,
  getAccount,
  usdcBalance,
  SetupRequiredError,
} from "./_wallet.mjs";

function parseArgs(argv) {
  const args = { q: null, num: 10, location: "United States", free: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--q") args.q = argv[++i];
    else if (a === "--num") args.num = parseInt(argv[++i], 10);
    else if (a === "--location") args.location = argv[++i];
    else if (a === "--free") args.free = true;
    else if (a === "--help" || a === "-h") {
      process.stderr.write(
        "Usage: search.mjs --q \"query\" [--num 10] [--location \"United States\"] [--free]\n",
      );
      process.exit(0);
    }
  }
  return args;
}

async function callFree({ q, location, num }) {
  const r = await fetch(`${PROXY_URL}/try`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q, location, num }),
  });
  return { status: r.status, text: await r.text() };
}

async function callPaid({ q, location, num }) {
  const { fetchWithPay, account } = getFetchWithPayment();
  const r = await fetchWithPay(`${PROXY_URL}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q, location, num }),
  });
  return { status: r.status, text: await r.text(), address: account.address };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.q) {
    process.stderr.write("error: --q is required\n");
    process.exit(2);
  }

  // Try free tier first — saves a CDP roundtrip if the user is under the daily limit.
  const free = await callFree(args);
  if (free.status === 200) {
    process.stdout.write(free.text);
    return;
  }
  if (args.free) {
    process.stderr.write(`free tier exhausted (HTTP ${free.status}): ${free.text}\n`);
    process.exit(free.status);
  }

  // Paid path.
  let paid;
  try {
    paid = await callPaid(args);
  } catch (e) {
    if (e instanceof SetupRequiredError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(2);
    }
    // x402-fetch throws when the wallet can't sign (e.g. zero balance + no allowance).
    process.stderr.write(`payment error: ${e.message}\n`);
    try {
      const account = getAccount();
      const bal = await usdcBalance(account.address);
      process.stderr.write(`\nWallet ${account.address} has ${bal ?? "?"} USDC on ${NETWORK}.\n`);
      process.stderr.write(`Fund it: ${PROXY_URL}/fund?addr=${account.address}&amount=5\n`);
    } catch {}
    process.exit(402);
  }
  if (paid.status === 200) {
    process.stdout.write(paid.text);
    return;
  }
  if (paid.status === 402) {
    const bal = await usdcBalance(paid.address);
    process.stderr.write(
      `HTTP 402 — payment required.\nWallet ${paid.address} has ${bal ?? "?"} USDC.\n` +
      `Fund: ${PROXY_URL}/fund?addr=${paid.address}&amount=5\n`,
    );
    process.exit(402);
  }
  process.stderr.write(`HTTP ${paid.status}: ${paid.text}\n`);
  process.exit(paid.status === 200 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
