# agent-marketplace-skill

Paid Google SERP for AI agents, distributed as a Claude/Anthropic Skill. **First 5 calls/day are free**, then $0.001 USDC per call from a local hot wallet on Base. No signup, no API key, no credit card.

## Install (Claude Code)

```bash
curl -sSL https://raw.githubusercontent.com/yayashuxue/agent-marketplace-skill/main/install.sh | bash
```

Done. Try it:

> Search the web for "latest Claude Sonnet release notes"

Claude Code picks up the skill automatically from `~/.claude/skills/agent-marketplace/`.

## How it works

```
Claude Code  ─────►  ~/.claude/skills/agent-marketplace/bin/search.mjs
                       │
                       ├── 1st call: POST /try (free, 5/IP/day)
                       └── 6th call: POST /search with x402-fetch
                                       │
                                       ├── HTTP 402 + payment requirements
                                       ├── sign EIP-3009 USDC transferWithAuthorization (off-chain, no gas)
                                       └── Coinbase facilitator submits on-chain
                                       
                       ◄──── SERP JSON
```

Wallet lives at `~/.agent-marketplace/wallet.json` (chmod 600). Same wallet as the [`agent-marketplace-mcp`](https://github.com/yayashuxue/agent-marketplace-mcp) package — install one or the other (or both, they share state).

## Commands the skill exposes

| Command | What it does |
|---|---|
| `node bin/search.mjs --q "query"` | Run a SERP query (free or paid) |
| `node bin/wallet-info.mjs` | Print buyer address + USDC balance + fund URL |
| `node bin/fund.mjs [--amount 5]` | Open the fund page (Apple Pay) in your browser |

The skill instructs Claude to call these for you — you don't normally invoke them by hand.

## Funding

Two paths:

1. **Apple Pay (recommended)** — `node bin/fund.mjs` opens a hosted Coinbase Onramp page. Guest checkout, no ID for first $500.
2. **Direct USDC transfer** — `node bin/wallet-info.mjs` prints the address; send USDC on Base from any exchange.

$1 covers ~1000 searches. Keep balance small — this is a hot wallet.

## Configuration (all optional)

| Env var | Default | What it does |
|---|---|---|
| `AGENT_MARKETPLACE_URL` | `https://agent-marketplace-proxy.vercel.app` | Override the proxy host (self-host or staging) |
| `X402_NETWORK` | `base` | Use `base-sepolia` for free testnet USDC during dev |
| `AGENT_MARKETPLACE_WALLET_DIR` | `~/.agent-marketplace` | Where the wallet file lives |

## Why a skill (vs MCP)?

Skills run in-process (no separate daemon, no JSON-RPC, no `claude_desktop_config.json` to edit). One-line install, easier to debug, works the same way across Claude Code, Anthropic API, and Claude Desktop.

If you need MCP-style interop (Cursor, ChatGPT Desktop, Goose, etc.), use the [`agent-marketplace-mcp`](https://github.com/yayashuxue/agent-marketplace-mcp) package instead — same backend, same wallet, MCP transport.

## Cost & legal

- $0.001 / call (≈ $1 = 1000 searches). First 5 calls/day free.
- USDC on Base. No KYC for direct transfers; Apple Pay funding goes through Coinbase Onramp (their guest tier needs no ID up to $500).
- Backend: DataForSEO. We never see your wallet keys (they live on your machine).

## License

MIT.
