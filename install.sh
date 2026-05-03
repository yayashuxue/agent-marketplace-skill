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
(cd "${SKILL_DIR}" && npm install --silent --omit=dev --omit=optional)

echo ""
echo "✓ Installed. Try it from any Claude Code session:"
echo "    > Search the web for 'latest GPT-5 release'"
echo ""
echo "Wallet status:"
node "${SKILL_DIR}/bin/wallet-info.mjs"
