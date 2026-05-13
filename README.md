# agent-marketplace-skill

Paid Google SERP for AI agents, distributed as a Claude/Anthropic Skill. **First 5 calls/day are free**, then $0.001 USDC per call from a scoped spender wallet authorized once via your Base Account passkey on Base. No signup, no API key, no credit card. **The Base Account master key never leaves your device** — it stays in your secure enclave, and you can revoke the spender anytime.

## Install (Claude Code)

```bash
curl -sSL https://raw.githubusercontent.com/yayashuxue/agent-marketplace-skill/main/install.sh | bash
```

Free tier (5/day) works immediately. To enable unlimited paid search, authorize a spender via your Base Account (one-time, ~30 sec — passkey + spend approval):

```bash
node ~/.claude/skills/agent-marketplace/bin/setup.mjs
```

Then ask Claude:

> Search the web for "latest Claude Sonnet release notes"

Claude Code picks up the skill automatically from `~/.claude/skills/agent-marketplace/`.

## How it works

```
Claude Code  ─────►  ~/.claude/skills/agent-marketplace/bin/search.mjs
                       │
                       ├── 1st call: POST /try (free, 5/IP/day, no wallet)
                       └── 6th call: POST /search with x402-fetch
                                       │
                                       ├── HTTP 402 + payment requirements
                                       ├── Local spender signs EIP-3009 USDC transferWithAuthorization
                                       │   (Base Account master key stays in your secure enclave)
                                       └── Coinbase facilitator submits on-chain (it pays the gas)
                                       
                       ◄──── SERP JSON
```

Config lives at `~/.agent-marketplace/session.json` (chmod 600) — only the scoped spender private key, not the master key. Shared with the [`agent-marketplace-mcp`](https://github.com/yayashuxue/agent-marketplace-mcp) package.

## Setup flow (~30 sec)

1. Run `setup.mjs`. The skill starts a one-shot localhost listener and prints a URL.
2. The setup page in your browser:
   - Generates a fresh "spender" key (the privkey lives only in your browser tab and your local skill — never on our servers).
   - Asks you to **Connect Base Account** → passkey login (Touch ID / Face ID).
   - Asks you to **Authorize $20/month** → another passkey signature grants a [SpendPermission](https://docs.base.org/identity/smart-wallet/guides/spend-permissions) scoped to this app's revenue address. Coinbase's Base paymaster sponsors the gas.
3. The page POSTs the spender private key + permission to your local listener. Saved at `~/.agent-marketplace/session.json` (chmod 600).
4. Run `wallet-info.mjs` for the fund link. Apple Pay $5 (no ID for first $500) → spender address.
5. Use `search.mjs`. Each call signs an EIP-3009 `transferWithAuthorization`; the x402 facilitator submits on-chain so your spender wallet never spends ETH for gas.

> **Manage / revoke**: `wallet-info.mjs` prints a dashboard URL where you can see balance, remaining allowance, and revoke the spend permission anytime.

> **Headless / CI**: skip `setup.mjs` and set `AGENT_MARKETPLACE_SPENDER_KEY` to a `0x…` private key. The env var takes precedence over the session file.

## Commands the skill exposes

Once installed, every command is reachable both as `node bin/<name>.mjs` and as
`agent-marketplace <subcommand>` (or `npx agent-marketplace <subcommand>` without a local
install):

| Command | What it does |
|---|---|
| `agent-marketplace setup` | One-time spender authorization via Base Account passkey (~30 sec) |
| `agent-marketplace search --q "query"` | Run a SERP query (free or paid) |
| `agent-marketplace wallet` | Print spender + Base Account + USDC balance + fund + dashboard URLs |
| `agent-marketplace fund [--amount 5]` | Open the fund page (Apple Pay) in your browser |
| `agent-marketplace pull [--amount 5]` | Pull USDC from Base Account → spender (SpendPermission) |
| `agent-marketplace withdraw [--amount <USDC>]` | Pull USDC from spender → Base Account (the escape hatch) |

The skill instructs Claude to call these for you — you don't normally invoke them by hand.

## Funding

Two paths:

1. **Apple Pay (recommended)** — `node bin/fund.mjs` opens a hosted Coinbase Onramp page. Guest checkout, no ID for first $500.
2. **Direct USDC transfer** — `node bin/wallet-info.mjs` prints the spender address; send USDC on Base from any exchange.

$1 covers ~1000 searches. Keep balance small — this is a hot, scoped wallet.

## Configuration (all optional)

| Env var | Default | What it does |
|---|---|---|
| `AGENT_MARKETPLACE_URL` | `https://agent-marketplace-proxy.vercel.app` | Override the proxy host (self-host or staging) |
| `X402_NETWORK` | `base` | Use `base-sepolia` for free testnet USDC during dev |
| `AGENT_MARKETPLACE_CONFIG_DIR` | `~/.agent-marketplace` | Where the session file lives |
| `AGENT_MARKETPLACE_SPENDER_KEY` | (session file) | `0x`-prefixed 32-byte hex; bypasses setup (headless / CI mode) |

## Security model

- **Spend cap.** Your Base Account grants the spender at most $20 USDC over 30 days, scoped to this app. Even if `~/.agent-marketplace/session.json` leaks, the attacker can drain at most that cap before your daily allowance recharges, and you can revoke instantly via the dashboard URL printed by `wallet-info.mjs`.
- **Master key never on disk.** Your Base Account passkey stays in your device's secure enclave. The local file holds only the scoped spender key, not the master key.
- **No gas exposure.** The spender wallet never holds ETH. x402's facilitator submits all on-chain transactions and pays gas itself.

## Why a skill (vs MCP)?

Skills run in-process (no separate daemon, no JSON-RPC, no `claude_desktop_config.json` to edit). One-line install, easier to debug, works the same way across Claude Code, Anthropic API, and Claude Desktop.

If you need MCP-style interop (Cursor, ChatGPT Desktop, Goose, etc.), use the [`agent-marketplace-mcp`](https://github.com/yayashuxue/agent-marketplace-mcp) package instead — same backend, same wallet, MCP transport.

## Migrating from v1 (CDP-managed)

v1 used a CDP API key + Wallet Secret per user (~10 minute signup at the CDP portal). v2 replaces that with Base Account passkey + scoped Spend Permission (~30 seconds). v1's `~/.agent-marketplace/config.json` is ignored — run `setup.mjs` once to migrate. Your old CDP wallet still works if you want to drain it; it's just no longer used by this skill.

## Cost & legal

- $0.001 / call (≈ $1 = 1000 searches). First 5 calls/day free.
- USDC on Base. No KYC for direct transfers; Apple Pay funding goes through Coinbase Onramp (their guest tier needs no ID up to $500).
- Backend: DataForSEO. The Base Account passkey lives in your device's secure enclave; the skill only holds the scoped spender private key (revocable, capped, auto-expiring).

## License

MIT.
