#!/usr/bin/env node
// setup.mjs — interactive one-time CDP wallet registration.
//
// Walks the user through:
//   1. Creating a CDP API key at portal.cdp.coinbase.com (90-second click path).
//   2. Pasting the 3 secrets (api key id, api key secret, wallet secret).
//   3. Creating a server-side EVM wallet under their CDP project.
//   4. Persisting config to ~/.agent-marketplace/config.json (chmod 600).
//
// Headless alternative (CI): set CDP_API_KEY_ID + CDP_API_KEY_SECRET + CDP_WALLET_SECRET
// env vars and skip this script — _wallet.mjs reads env first, file second.

import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output, stderr } from "node:process";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_ACCOUNT_NAME, readConfig } from "./_wallet.mjs";

function isTTY() {
  return Boolean(input.isTTY && output.isTTY);
}

function ask(prompt, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    if (mask) {
      // Naive masking: rewrite the line as the user types so the secret isn't echoed back.
      const onData = (char) => {
        const c = char.toString();
        if (c === "\n" || c === "\r" || c === "\r\n" || c === "\u0004") return;
        // Repaint with asterisks to hide the buffered secret.
        rl.output.write(`\r\u001b[K${prompt}${"*".repeat(rl.line.length)}`);
      };
      rl.input.on("data", onData);
      rl.question(prompt, (answer) => {
        rl.input.off("data", onData);
        rl.close();
        output.write("\n");
        resolve(answer.trim());
      });
    } else {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  if (!isTTY()) {
    stderr.write(
      "setup.mjs requires an interactive terminal. For headless use, set CDP_API_KEY_ID, " +
      "CDP_API_KEY_SECRET, and CDP_WALLET_SECRET as env vars instead.\n",
    );
    process.exit(2);
  }

  const existing = readConfig();
  if (existing?.cdpApiKeyId) {
    output.write(`Wallet already configured at ${CONFIG_FILE} (address ${existing.address || "unknown"}).\n`);
    const replace = await ask("Overwrite? [y/N] ");
    if (replace.toLowerCase() !== "y") {
      output.write("Aborted. Existing config kept.\n");
      process.exit(0);
    }
  }

  output.write(`
agent-marketplace setup
=======================
This creates a Coinbase-managed wallet (CDP) that the skill uses to pay $0.001 per
search. The private key lives inside Coinbase's enclave — never on your disk.

Step 1. Open https://portal.cdp.coinbase.com/projects/api-keys
Step 2. Click "Create API Key" → download the JSON. It contains:
          - id          (looks like "organizations/.../apiKeys/...")
          - privateKey  (PEM block: -----BEGIN PRIVATE KEY----- ...)
Step 3. From the same page, click "Create Wallet Secret" → copy the secret string.

Paste the three values below. Each input is masked. (Blank line aborts.)

`);

  const cdpApiKeyId = await ask("CDP API Key ID:        ");
  if (!cdpApiKeyId) { output.write("Aborted.\n"); process.exit(1); }
  const cdpApiKeySecret = await ask("CDP API Key Secret:    ", { mask: true });
  if (!cdpApiKeySecret) { output.write("Aborted.\n"); process.exit(1); }
  const cdpWalletSecret = await ask("CDP Wallet Secret:     ", { mask: true });
  if (!cdpWalletSecret) { output.write("Aborted.\n"); process.exit(1); }

  output.write("\nVerifying credentials and creating wallet...\n");

  let address;
  try {
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    const cdp = new CdpClient({
      apiKeyId: cdpApiKeyId,
      apiKeySecret: cdpApiKeySecret,
      walletSecret: cdpWalletSecret,
    });
    const account = await cdp.evm.getOrCreateAccount({ name: DEFAULT_ACCOUNT_NAME });
    address = account.address;
  } catch (err) {
    stderr.write(`\n✗ CDP error: ${err?.message || err}\n`);
    stderr.write("Common causes:\n");
    stderr.write("  - API key secret pasted with line breaks mangled (try copying the JSON file value directly)\n");
    stderr.write("  - Wallet Secret confused with API Key Secret (they are two separate strings on the portal)\n");
    stderr.write("  - API key not enabled for the EVM scope (re-create with default scopes)\n");
    process.exit(1);
  }

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const config = {
    cdpApiKeyId,
    cdpApiKeySecret,
    cdpWalletSecret,
    accountName: DEFAULT_ACCOUNT_NAME,
    address,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);

  output.write(`
✓ CDP authentication OK
✓ Wallet created: ${address}
✓ Saved to ${CONFIG_FILE} (chmod 600)

Next steps:
  - Fund the wallet:  node bin/fund.mjs --amount 5
  - Check status:     node bin/wallet-info.mjs
  - Run a search:     node bin/search.mjs --q "your query"
`);
}

main().catch((e) => {
  stderr.write(`fatal: ${e?.stack || e}\n`);
  process.exit(1);
});
