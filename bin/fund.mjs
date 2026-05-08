#!/usr/bin/env node
// fund.mjs — open the proxy /fund page in the user's default browser.

import { spawn } from "node:child_process";
import { platform } from "node:os";
import { PROXY_URL, readSession, SetupRequiredError } from "./_wallet.mjs";

function parseAmount(argv) {
  const i = argv.indexOf("--amount");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return "5";
}

const session = readSession();
if (!session?.spenderAddress) {
  process.stderr.write(
    new SetupRequiredError("No session found. Run `node bin/setup.mjs` to authorize a spender via your Base Account.").message + "\n",
  );
  process.exit(2);
}

const amount = parseAmount(process.argv.slice(2));
const url = `${PROXY_URL}/fund?addr=${session.spenderAddress}&amount=${amount}`;

process.stdout.write(`Opening fund page for spender ${session.spenderAddress} ($${amount} USDC):\n  ${url}\n`);

const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
const child = spawn(opener, [url], { stdio: "ignore", detached: true });
child.on("error", (e) => {
  process.stderr.write(`Couldn't open browser (${e.message}). Open the URL manually.\n`);
  process.exit(1);
});
child.unref();
