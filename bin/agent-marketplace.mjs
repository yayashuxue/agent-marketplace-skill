#!/usr/bin/env node
// agent-marketplace.mjs — unified entry point. Dispatches subcommands to the
// individual bin scripts so users can write `npx agent-marketplace <cmd>` instead
// of having to remember per-command bin names (`agent-marketplace-setup`,
// `agent-marketplace-search`, …). The dashed bins still ship as aliases for
// backward compat with existing installs.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  setup: "setup.mjs",
  search: "search.mjs",
  wallet: "wallet-info.mjs",
  "wallet-info": "wallet-info.mjs",
  fund: "fund.mjs",
  pull: "pull.mjs",
  withdraw: "withdraw.mjs",
};

function usage(code = 0) {
  const out = code === 0 ? process.stdout : process.stderr;
  out.write(
    "Usage: agent-marketplace <command> [args]\n\n" +
    "Commands:\n" +
    "  setup       One-time Base Account + spender authorization (~30 sec).\n" +
    "  search      Paid Google SERP via x402.   Run `agent-marketplace search --q \"…\"`.\n" +
    "  wallet      Print spender address, balance, dashboard URL.\n" +
    "  fund        Open the browser fund page (Apple Pay → spender).\n" +
    "  pull        Pull USDC from your Base Account to the spender (SpendPermission).\n" +
    "  withdraw    Pull USDC from the spender back to your Base Account.\n\n" +
    "Run `agent-marketplace <command> --help` for command-specific options.\n",
  );
  process.exit(code);
}

const [, , cmd, ...rest] = process.argv;
if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") usage(0);

const script = COMMANDS[cmd];
if (!script) {
  process.stderr.write(`error: unknown command "${cmd}"\n\n`);
  usage(2);
}

const result = spawnSync(process.execPath, [join(HERE, script), ...rest], { stdio: "inherit" });
if (result.error) {
  process.stderr.write(`failed to launch "${script}": ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 0);
