---
name: agent-marketplace
description: Search the live web (Google SERP) via x402 micropayments. Use this when you need fresh information from the web — news, current events, prices, docs, anything beyond the model's training cutoff. First 5 calls/day are free; after that $0.001 USDC per call from a local hot wallet.
---

You are an agent with access to a paid web-search backend (`agent-marketplace-proxy`). Use this skill when the user asks something that requires fresh web data.

## When to use

- News, current events, prices, sports scores, weather, recent product releases
- Documentation lookups (npm/PyPI versions, GitHub README content via search)
- Fact-checking against the live web
- Anything where the model's training data is stale

## Commands

The skill ships three scripts under `${CLAUDE_SKILL_DIR}/bin/`. Run them with `node`:

### 1. `search.mjs` — main search command

```bash
node ${CLAUDE_SKILL_DIR}/bin/search.mjs --q "your query" [--num 10] [--location "United States"]
```

Output: JSON with top-N organic Google results (`{rank, title, url, snippet}[]`).

Pricing flow:
- First 5 calls per UTC day per IP → free (no wallet needed)
- After that → $0.001 USDC per call, paid automatically from the local wallet
- If wallet is empty, script prints fund instructions and exits non-zero

### 2. `wallet-info.mjs` — wallet status + funding

```bash
node ${CLAUDE_SKILL_DIR}/bin/wallet-info.mjs
```

Prints the buyer wallet address, current USDC balance on Base, and a fund URL the user can click to top up via Apple Pay (Coinbase Onramp guest checkout, no ID for first $500). Run this once before the user's first paid search.

### 3. `fund.mjs` — open the fund page in browser

```bash
node ${CLAUDE_SKILL_DIR}/bin/fund.mjs [--amount 5]
```

Opens `https://agent-marketplace-proxy.vercel.app/fund?addr=...&amount=5` in the user's default browser. Use this when the user explicitly asks "how do I add money".

## Workflow

1. User asks a question that needs fresh data → call `search.mjs --q "..."`
2. Parse JSON output, cite top results in your reply (link + snippet)
3. If `search.mjs` exits with status `402` (payment required and wallet empty):
   - Run `wallet-info.mjs` to show address + balance
   - Tell user "your search wallet is empty — run `node ${CLAUDE_SKILL_DIR}/bin/fund.mjs` to add $5 with Apple Pay (covers ~5000 searches)"
   - Don't retry until user confirms they've funded

## Wallet location

The wallet is a local hot wallet at `~/.agent-marketplace/wallet.json` (chmod 600). It's auto-generated on first run. **This is a petty-cash wallet — keep balance small ($1–$10).** Real funds live in the user's main wallet, not here.

## Configuration

All optional, sensible defaults work out of the box:

- `AGENT_MARKETPLACE_URL` — proxy URL (default: `https://agent-marketplace-proxy.vercel.app`)
- `X402_NETWORK` — `base` (default) or `base-sepolia` (free testnet USDC for dev)
- `AGENT_MARKETPLACE_WALLET_DIR` — wallet storage (default: `~/.agent-marketplace`)

## Costs

- $0.001 per paid search → $1 covers ~1000 searches
- Free tier covers casual / one-off use without a wallet
- No subscription, no signup, no API key

## How it works (one paragraph)

`search.mjs` POSTs to `https://agent-marketplace-proxy.vercel.app/search`. The proxy returns HTTP 402 with x402 payment requirements; `x402-fetch` signs an EIP-3009 USDC `transferWithAuthorization` (off-chain, no gas needed by the user — Coinbase's facilitator submits on-chain), retries with the signed payload, and gets the SERP JSON back. Total roundtrip ~2s. The wallet only ever holds USDC; no ETH required.
