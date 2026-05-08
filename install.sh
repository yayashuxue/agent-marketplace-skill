#!/usr/bin/env bash
# Install agent-marketplace skill into ~/.claude/skills/agent-marketplace/
# Usage: curl -sSL https://raw.githubusercontent.com/yayashuxue/agent-marketplace-skill/main/install.sh | bash

set -euo pipefail

SKILL_NAME="agent-marketplace"
SKILL_DIR="${HOME}/.claude/skills/${SKILL_NAME}"
REPO_URL="https://github.com/yayashuxue/agent-marketplace-skill.git"

echo "→ Installing ${SKILL_NAME} skill to ${SKILL_DIR}"

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

if [ -d "${SKILL_DIR}/.git" ]; then
  echo "→ Updating existing install"
  git -C "${SKILL_DIR}" pull --ff-only
else
  if [ -e "${SKILL_DIR}" ]; then
    echo "✗ ${SKILL_DIR} exists but is not a git repo. Remove or rename it first." >&2
    exit 1
  fi
  git clone --depth 1 "${REPO_URL}" "${SKILL_DIR}"
fi

echo "→ Installing dependencies"
(cd "${SKILL_DIR}" && npm install --silent --omit=dev)

echo ""
echo "✓ Installed."
echo ""
echo "Free tier (5 calls/day, no wallet) works immediately. To enable unlimited"
echo "paid search, authorize a scoped spender via your Base Account (~30 sec):"
echo ""
echo "    node ${SKILL_DIR}/bin/setup.mjs"
echo ""
echo "Setup opens a browser, asks for a passkey + spend approval (\$20/30d), then"
echo "saves a scoped spender key at ~/.agent-marketplace/session.json (chmod 600)."
echo "Your Base Account master key never leaves your device."
