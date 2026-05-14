#!/usr/bin/env bash
# Install agent-marketplace skill into ~/.claude/skills/agent-marketplace/
# Usage: curl -sSL https://raw.githubusercontent.com/yayashuxue/agent-marketplace-skill/main/install.sh | bash

set -euo pipefail

SKILL_NAME="agent-marketplace"
SKILL_DIR="${HOME}/.claude/skills/${SKILL_NAME}"
REPO_URL="https://github.com/yayashuxue/agent-marketplace-skill.git"

echo "[1/4] Installing ${SKILL_NAME} skill to ${SKILL_DIR}"

if ! command -v node >/dev/null; then
  echo "✗ node not found. Install Node 20+ first: https://nodejs.org" >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "✗ Node ${NODE_MAJOR} found; need >= 20. Upgrade: https://nodejs.org" >&2
  exit 1
fi

mkdir -p "$(dirname "${SKILL_DIR}")"

echo "[2/4] Fetching skill source"
if [ -d "${SKILL_DIR}/.git" ]; then
  echo "  → updating existing install"
  git -C "${SKILL_DIR}" pull --ff-only
else
  if [ -e "${SKILL_DIR}" ]; then
    echo "✗ ${SKILL_DIR} exists but is not a git repo. Remove or rename it first." >&2
    exit 1
  fi
  git clone --depth 1 "${REPO_URL}" "${SKILL_DIR}"
fi

echo "[3/4] Installing dependencies"
(cd "${SKILL_DIR}" && npm install --silent --omit=dev)

echo "[4/4] Done"
echo "✓ Installed at ${SKILL_DIR}"
echo ""

# v0.1 residue: warn if a legacy wallet.json (CDP-managed EOA) is still on disk.
# v2 ignores it, but `wallet-info.mjs` from a leftover v0.1 install would still
# print that EOA as the fund destination — leading users to fund a wallet that
# the v2 spender path can't sign for. Tell the user once so they don't loop.
LEGACY_WALLET="${HOME}/.agent-marketplace/wallet.json"
if [ -f "${LEGACY_WALLET}" ]; then
  echo "ℹ v0.1 wallet detected at ${LEGACY_WALLET}"
  echo "  v2 ignores it. If you funded that address by mistake, sweep it before"
  echo "  funding the new spender (see ${SKILL_DIR}/README.md for recovery steps)."
  echo ""
fi

echo "Free tier (5 calls/day, no wallet) works immediately. To enable unlimited"
echo "paid search, authorize a scoped spender via your Base Account (~30 sec):"
echo ""
echo "    node ${SKILL_DIR}/bin/setup.mjs"
echo ""
echo "Setup opens a browser, asks for a passkey + spend approval (\$20/30d), then"
echo "saves a scoped spender key at ~/.agent-marketplace/session.json (chmod 600)."
echo "Your Base Account master key never leaves your device."
