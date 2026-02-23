#!/bin/bash
# FlowForge — Account rotation for Claude Code
# Switches to next available Claude Max account

ACCOUNTS=(
  "eric@flowindustries.ai"
  "eric.xm@gmail.com"
  "eric@vivaepic.com"
)

CURRENT=$(claude auth status 2>/dev/null | grep email | awk '{print $2}')
echo "Current account: $CURRENT"

# Find next account
NEXT=""
for i in "${!ACCOUNTS[@]}"; do
  if [[ "${ACCOUNTS[$i]}" == "$CURRENT" ]]; then
    NEXT="${ACCOUNTS[$(( (i + 1) % ${#ACCOUNTS[@]} ))]}"
    break
  fi
done

if [[ -z "$NEXT" ]]; then
  NEXT="${ACCOUNTS[0]}"
fi

echo "Switching to: $NEXT"

# Switch credentials
CREDS_DIR="$HOME/.claude/accounts"
if [[ -f "$CREDS_DIR/$NEXT.json" ]]; then
  cp "$CREDS_DIR/$NEXT.json" "$HOME/.claude/.credentials.json"
  echo "✅ Switched to $NEXT"
else
  echo "⚠️  No saved credentials for $NEXT — run: claude auth login"
  echo "Then save with: cp ~/.claude/.credentials.json ~/.claude/accounts/$NEXT.json"
  exit 1
fi
