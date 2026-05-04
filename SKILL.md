---
name: agent-marketplace
description: Search the live web (Google SERP) via x402 micropayments. Use this when you need fresh information from the web — news, current events, prices, docs, anything beyond the model's training cutoff. First 5 calls/day are free; after that $0.001 USDC per call paid from a Coinbase-managed wallet (private key stays in Coinbase's enclave, never on disk).
---

You are an agent with access to a paid web-search backend (`agent-marketplace-proxy`). Use this skill when the user asks something that requires fresh web data.

## When to use

- News, current events, prices, sports scores, weather, recent product releases
- Documentation lookups (npm/PyPI versions, GitHub README content via search)
- Fact-checking against the live web
- Anything where the model's training data is stale

## Commands

The skill ships four scripts under `${CLAUDE_SKILL_DIR}/bin/`. Run them with `node`:

### 1. `search.mjs` — main search command

```bash
node ${CLAUDE_SKILL_DIR}/bin/search.mjs --q "your query" [--num 10] [--location "United States"]
```

Output: JSON with top-N organic Google results (`{rank, title, url, snippet}[]`).

Pricing flow:
- First 5 calls per UTC day per IP → free (no wallet needed)
- After that → $0.001 USDC per call, signed by the user's CDP-managed wallet
- If wallet is empty, script prints fund instructions and exits with status 402
- If CDP wallet hasn't been set up yet, exits with status 2 and points to `setup.mjs`

### 2. `setup.mjs` — one-time CDP wallet registration

```bash
node ${CLAUDE_SKILL_DIR}/bin/setup.mjs
```

Interactive ~90 second walkthrough: opens https://portal.cdp.coinbase.com/projects/api-keys, asks the user to create a CDP API key + Wallet Secret, then creates a server-side EVM wallet under their CDP project. Saves credentials to `~/.agent-marketplace/config.json` (chmod 600). **No private key is ever written to disk** — the key lives in Coinbase's enclave.

Headless / CI alternative: set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` env vars instead of running setup.

### 3. `wallet-info.mjs` — wallet status + funding

```bash
node ${CLAUDE_SKILL_DIR}/bin/wallet-info.mjs
```

Prints the buyer wallet address (assigned by CDP), current USDC balance on Base, and a fund URL the user can click to top up via Apple Pay (Coinbase Onramp guest checkout, no ID for first $500). Run this once before the user's first paid search.

### 4. `fund.mjs` — open the fund page in browser

```bash
node ${CLAUDE_SKILL_DIR}/bin/fund.mjs [--amount 5]
```

Opens `https://agent-marketplace-proxy.vercel.app/fund?addr=...&amount=5` in the user's default browser. Use this when the user explicitly asks "how do I add money".

## Workflow

1. User asks a question that needs fresh data → call `search.mjs --q "..."`
2. Parse JSON output, cite top results in your reply (link + snippet)
3. If `search.mjs` exits with status `2` (setup required):
   - Tell the user: "Run `node ${CLAUDE_SKILL_DIR}/bin/setup.mjs` once to register a Coinbase-managed wallet (~90 sec). Free tier still works without it."
4. If `search.mjs` exits with status `402` (wallet empty):
   - Run `wallet-info.mjs` to show address + balance
   - Tell user "your search wallet is empty — run `node ${CLAUDE_SKILL_DIR}/bin/fund.mjs` to add $5 with Apple Pay (covers ~5000 searches)"
   - Don't retry until user confirms they've funded

## Wallet model

The wallet is **CDP-managed** — Coinbase's enclave holds the private key, the user holds the API credentials that authorize signing, and the skill never touches the key. This eliminates the historical EOA-on-disk risk where a leaked private-key file could drain the wallet.

The local config file at `~/.agent-marketplace/config.json` (chmod 600) holds only the CDP API key + Wallet Secret, not any signing key. The wallet itself is identified by an address assigned by CDP at setup time.

Still a hot wallet — keep balance small ($1–$10). Real funds live in the user's main wallet, not here.

## Configuration

All optional, sensible defaults work out of the box:

- `AGENT_MARKETPLACE_URL` — proxy URL (default: `https://agent-marketplace-proxy.vercel.app`)
- `X402_NETWORK` — `base` (default) or `base-sepolia` (free testnet USDC for dev)
- `AGENT_MARKETPLACE_CONFIG_DIR` — config storage (default: `~/.agent-marketplace`)
- `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` / `CDP_WALLET_SECRET` — override config file (headless mode)

## Costs

- $0.001 per paid search → $1 covers ~1000 searches
- Free tier covers casual / one-off use without a wallet
- No subscription, no signup, no API key

## How it works (one paragraph)

`search.mjs` POSTs to `https://agent-marketplace-proxy.vercel.app/search`. The proxy returns HTTP 402 with x402 payment requirements; `x402-fetch` calls into the CDP SDK to sign an EIP-3009 USDC `transferWithAuthorization` (off-chain — Coinbase's facilitator submits on-chain), retries with the signed payload, and gets the SERP JSON back. Total roundtrip ~2s. Signing happens inside Coinbase's MPC enclave; the skill never sees the private key. The wallet only ever holds USDC; no ETH required.
