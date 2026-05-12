---
name: agent-marketplace
description: Search the live web (Google SERP) via x402 micropayments. Use this when you need fresh information from the web — news, current events, prices, docs, anything beyond the model's training cutoff. First 5 calls/day are free; after that $0.001 USDC per call, paid from a scoped spender wallet authorized once via the user's Base Account passkey (no signup, no API key, no private key on disk for the master wallet).
---

You are an agent with access to a paid web-search backend (`agent-marketplace-proxy`). Use this skill when the user asks something that requires fresh web data.

## When to use

- News, current events, prices, sports scores, weather, recent product releases
- Documentation lookups (npm/PyPI versions, GitHub README content via search)
- Fact-checking against the live web
- Anything where the model's training data is stale

## Commands

The skill ships five scripts under `${CLAUDE_SKILL_DIR}/bin/`. Run them with `node`:

### 1. `search.mjs` — main search command

```bash
node ${CLAUDE_SKILL_DIR}/bin/search.mjs --q "your query" [--num 10] [--location "United States"]
```

Output: JSON with top-N organic Google results (`{rank, title, url, snippet}[]`).

Pricing flow:
- First 5 calls per UTC day per IP → free (no wallet needed)
- After that → $0.001 USDC per call, signed by the local spender key authorized via Base Account
- If wallet is empty, script prints fund instructions and exits with status 402
- If wallet hasn't been set up yet, exits with status 2 and points to `setup.mjs`

### 2. `setup.mjs` — one-time wallet authorization (~30 sec)

```bash
node ${CLAUDE_SKILL_DIR}/bin/setup.mjs
```

Starts a one-shot localhost listener and opens a hosted setup page in the user's browser. The page:
1. Generates a fresh "spender" EOA (private key never leaves the browser tab).
2. Asks the user to **Connect Base Account** → passkey login (Touch ID / Face ID).
3. Asks the user to **Authorize $20 / 30 days** → another passkey signature grants a [SpendPermission](https://docs.base.org/identity/smart-wallet/guides/spend-permissions) scoped to this app's revenue address. Coinbase's Base paymaster sponsors the gas.
4. POSTs the spender private key + permission back to the localhost listener. Saved at `~/.agent-marketplace/session.json` (chmod 600). The Base Account master key never leaves the user's device.

Headless / CI alternative: set `AGENT_MARKETPLACE_SPENDER_KEY=0x<32-byte hex>` and skip setup.

### 3. `wallet-info.mjs` — wallet status + funding + revoke link

```bash
node ${CLAUDE_SKILL_DIR}/bin/wallet-info.mjs
```

Prints the spender address, the Base Account that authorized it, current USDC balance on Base, a fund URL (Apple Pay, no ID for first $500), and a dashboard URL where the user can revoke the spend permission anytime. Run this once before the user's first paid search.

### 4. `fund.mjs` — open the fund page in browser

```bash
node ${CLAUDE_SKILL_DIR}/bin/fund.mjs [--amount 5]
```

Opens `https://agent-marketplace-proxy.vercel.app/fund?addr=...&amount=5` in the user's default browser. Use this when the user explicitly asks "how do I add money".

### 5. `pull.mjs` — pull USDC from Base Account → spender via SpendPermission

```bash
node ${CLAUDE_SKILL_DIR}/bin/pull.mjs [--amount 5] [--dry-run]
```

If the user already has USDC on their Base Account (the Smart Wallet that authorized the spender) but the spender itself is at 0 USDC, run this instead of `fund.mjs`. It calls `SpendPermissionManager.spend(...)` on-chain, which pulls USDC from the owner Smart Wallet to the spender — the design intent of SpendPermission.

Caveat (until upstream paymaster support lands): the spender pays gas, so it needs a small ETH balance (~$0.50 covers many pulls). The script prints a clear message and exits 3 if ETH is zero. `--dry-run` shows the planned call sequence without signing.

## Workflow

1. User asks a question that needs fresh data → call `search.mjs --q "..."`
2. Parse JSON output, cite top results in your reply (link + snippet)
3. If `search.mjs` exits with status `2` (setup required):
   - Tell the user: "Run `node ${CLAUDE_SKILL_DIR}/bin/setup.mjs` once to authorize a scoped spender via your Base Account (~30 sec; passkey + spend approval). Free tier still works without it."
4. If `search.mjs` exits with status `402` (wallet empty):
   - Run `wallet-info.mjs` to show address + balance
   - Tell user "your search wallet is empty — run `node ${CLAUDE_SKILL_DIR}/bin/fund.mjs` to add $5 with Apple Pay (covers ~5000 searches)"
   - Don't retry until user confirms they've funded

## Wallet model

The user's master wallet is a **Base Account (Coinbase Smart Wallet)** — passkey-bound smart contract, master key in the device's secure enclave, never on disk. The user authorizes a scoped **spender** EOA via a SpendPermission: at most $20 USDC over 30 days, scoped to this app's revenue address. The local file at `~/.agent-marketplace/session.json` (chmod 600) holds only the spender key, not the master key.

Even if the session file leaks, the attacker can drain at most the remaining allowance before it recharges, and only to the predefined recipient. The user can revoke instantly via the dashboard URL printed by `wallet-info.mjs`.

For `search.mjs` the spender only ever holds USDC; no ETH required — the x402 facilitator submits the on-chain transactions and pays gas itself. The optional `pull.mjs` path (which moves USDC from the user's Base Account to the spender via `SpendPermissionManager.spend`) is the only flow that asks the spender to hold a small amount of ETH, until upstream paymaster support lands.

## Configuration

All optional, sensible defaults work out of the box:

- `AGENT_MARKETPLACE_URL` — proxy URL (default: `https://agent-marketplace-proxy.vercel.app`)
- `X402_NETWORK` — `base` (default) or `base-sepolia` (free testnet USDC for dev)
- `AGENT_MARKETPLACE_CONFIG_DIR` — config storage (default: `~/.agent-marketplace`)
- `AGENT_MARKETPLACE_SPENDER_KEY` — `0x`-prefixed 32-byte hex; bypasses setup (headless mode)

## Costs

- $0.001 per paid search → $1 covers ~1000 searches
- Free tier covers casual / one-off use without a wallet
- No subscription, no signup, no API key

## How it works (one paragraph)

`search.mjs` POSTs to `https://agent-marketplace-proxy.vercel.app/search`. The proxy returns HTTP 402 with x402 payment requirements; `x402-fetch` signs an EIP-3009 USDC `transferWithAuthorization` with the local spender key, retries with the signed payload, and gets the SERP JSON back. The Coinbase facilitator submits on-chain (it pays the gas, not the user), and the spender's USDC balance ticks down by $0.001. Total roundtrip ~2s. The Base Account passkey never leaves the user's device — the spender is scoped + revocable + auto-expires after 30 days.
