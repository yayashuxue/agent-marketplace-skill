#!/usr/bin/env node
// fund.mjs — open the proxy /fund page in the user's default browser.

import { spawn } from "node:child_process";
import { platform } from "node:os";
import { PROXY_URL, getAccount, SetupRequiredError } from "./_wallet.mjs";

function parseAmount(argv) {
  const i = argv.indexOf("--amount");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return "5";
}

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

const amount = parseAmount(process.argv.slice(2));
const url = `${PROXY_URL}/fund?addr=${account.address}&amount=${amount}`;

process.stdout.write(`Opening fund page for ${account.address} ($${amount} USDC):\n  ${url}\n`);

const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
const child = spawn(opener, [url], { stdio: "ignore", detached: true });
child.on("error", (e) => {
  process.stderr.write(`Couldn't open browser (${e.message}). Open the URL manually.\n`);
  process.exit(1);
});
child.unref();
