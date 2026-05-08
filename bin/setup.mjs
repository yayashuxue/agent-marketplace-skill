#!/usr/bin/env node
// setup.mjs — one-time Base Account + Spend Permission authorization (v2).
//
// Flow:
//   1. Start a one-shot localhost HTTP listener on an ephemeral port.
//   2. Open the hosted setup page in the user's browser, with our localhost callback URL.
//   3. The page generates a spender EOA, prompts passkey + grant in Base Account,
//      then POSTs the spender privkey + permission JSON back to localhost.
//   4. Persist to ~/.agent-marketplace/session.json (chmod 600).
//
// Headless alternative (CI): set AGENT_MARKETPLACE_SPENDER_KEY=0x<32-byte hex> and skip this.

import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { stderr } from "node:process";
import { isAddress, isHex } from "viem";
import { CONFIG_DIR, SESSION_FILE, PROXY_URL, readSession } from "./_wallet.mjs";

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 min for the user to complete setup

function startCallback() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const origin = req.headers.origin || "";
      res.setHeader("access-control-allow-origin", origin || "*");
      res.setHeader("access-control-allow-methods", "POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      if (req.method === "OPTIONS") return res.writeHead(204).end();
      if (req.method !== "POST" || !req.url.startsWith("/session")) {
        return res.writeHead(404).end();
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
          clearTimeout(timer);
          server.close();
          server.emit("session", payload);
        } catch {
          res.writeHead(400).end("invalid JSON");
        }
      });
    });
    const timer = setTimeout(() => {
      server.close();
      server.emit("session-error", new Error(`Setup timed out after ${CALLBACK_TIMEOUT_MS / 1000}s.`));
    }, CALLBACK_TIMEOUT_MS);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const awaitSession = new Promise((res2, rej2) => {
        server.once("session", res2);
        server.once("session-error", rej2);
      });
      resolve({ port, awaitSession });
    });
    server.on("error", reject);
  });
}

function openBrowser(url) {
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  const child = spawn(opener, [url], { stdio: "ignore", detached: true });
  child.on("error", () => {
    stderr.write(`Couldn't auto-open browser. Open this URL manually:\n  ${url}\n`);
  });
  child.unref();
}

async function main() {
  const existing = readSession();
  if (existing?.spenderAddress && !process.argv.includes("--force")) {
    process.stdout.write(
      `Wallet already configured at ${SESSION_FILE}\n` +
      `  Base Account: ${existing.account || "unknown"}\n` +
      `  Spender:      ${existing.spenderAddress}\n\n` +
      `Pass --force to re-authorize.\n`,
    );
    process.exit(0);
  }

  process.stdout.write(`
agent-marketplace setup
=======================
This authorizes a scoped spender for this skill via your Base Account (Coinbase Smart Wallet).
The spender can spend up to $20 USDC over 30 days, scoped to this app's revenue address.
Your master Base Account passkey stays in your device's secure enclave — never on disk.

Starting one-shot localhost listener...
`);

  const { port, awaitSession } = await startCallback();
  const callbackUrl = `http://127.0.0.1:${port}/session`;
  const connectUrl = `${PROXY_URL}/wallet/connect?callback=${encodeURIComponent(callbackUrl)}`;

  process.stdout.write(
    `Opening browser to:\n  ${connectUrl}\n\n` +
    `(Listening on ${callbackUrl}; will save session to ${SESSION_FILE} when you complete the flow.)\n\n`,
  );
  openBrowser(connectUrl);

  let session;
  try {
    session = await awaitSession;
  } catch (e) {
    stderr.write(`✗ ${e.message}\n`);
    process.exit(1);
  }

  if (
    !session?.spenderPrivKey || !isHex(session.spenderPrivKey) ||
    !session?.spenderAddress || !isAddress(session.spenderAddress) ||
    !session?.account || !isAddress(session.account)
  ) {
    stderr.write(`✗ Invalid session payload from setup page.\n`);
    process.exit(1);
  }

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const record = {
    spenderPrivKey: session.spenderPrivKey,
    spenderAddress: session.spenderAddress,
    account: session.account,
    chainId: session.chainId,
    permission: session.permission,
    createdAt: session.createdAt || new Date().toISOString(),
  };
  writeFileSync(SESSION_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
  chmodSync(SESSION_FILE, 0o600);

  process.stdout.write(`
✓ Base Account connected: ${session.account}
✓ Spender authorized:     ${session.spenderAddress}
✓ Saved to ${SESSION_FILE} (chmod 600)

Next steps:
  - Fund the spender:  node bin/fund.mjs --amount 5
  - Check status:      node bin/wallet-info.mjs
  - Run a search:      node bin/search.mjs --q "your query"
`);
}

main().catch((e) => {
  stderr.write(`fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
