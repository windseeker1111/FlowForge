#!/bin/bash
# FlowForge — Main pipeline runner
# Usage: run_forge.sh <workspace_path>

set -e

WORKSPACE="${1:-}"
if [[ -z "$WORKSPACE" || ! -d "$WORKSPACE" ]]; then
  echo "Usage: run_forge.sh <workspace_path>"
  exit 1
fi

source "$WORKSPACE/forge.env"
SKILL_DIR="$HOME/clawd/skills/flowforge"
LOG="$WORKSPACE/progress.log"

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

run_claude() {
  local STEP="$1"
  local PROMPT="$2"
  local OUTPUT="$3"
  local MAX_RETRIES=3
  local ATTEMPT=0

  log "→ $STEP"
  while [[ $ATTEMPT -lt $MAX_RETRIES ]]; do
    if claude --dangerously-skip-permissions --print "$PROMPT" > "$OUTPUT" 2>>"$LOG"; then
      log "✅ $STEP complete"
      return 0
    fi

    # Check for rate limit
    if grep -qi "rate limit\|quota\|429" "$LOG" 2>/dev/null; then
      log "⚠️  Rate limit hit — rotating account"
      bash "$SKILL_DIR/scripts/rotate_account.sh" | tee -a "$LOG"
      sleep 10
    fi

    ATTEMPT=$((ATTEMPT + 1))
    log "Retry $ATTEMPT/$MAX_RETRIES for $STEP"
    sleep 5
  done

  log "❌ $STEP failed after $MAX_RETRIES attempts"
  exit 1
}

# ─── STEP 1: SPEC ───────────────────────────────────────────────
SPEC_PROMPT="$(cat "$SKILL_DIR/references/spec-prompt.md")

## Task
$(cat "$WORKSPACE/task.md")

## Repository
$(ls "$REPO_PATH" 2>/dev/null | head -30)

Write spec.md to stdout. Output ONLY the spec, no commentary."

run_claude "Spec generation" "$SPEC_PROMPT" "$WORKSPACE/spec.md"

# ─── STEP 2: PLAN ───────────────────────────────────────────────
PLAN_PROMPT="$(cat "$SKILL_DIR/references/planner-prompt.md")

## Spec
$(cat "$WORKSPACE/spec.md")

## Repo structure
$(find "$REPO_PATH" -type f | grep -v '.git\|node_modules\|_build\|deps' | head -60)

Output ONLY valid JSON for implementation_plan.json. No commentary."

run_claude "Implementation planning" "$PLAN_PROMPT" "$WORKSPACE/implementation_plan.json"

# ─── STEP 3: CODE ───────────────────────────────────────────────
CODE_PROMPT="$(cat "$SKILL_DIR/references/coder-prompt.md")

## Implementation Plan
$(cat "$WORKSPACE/implementation_plan.json")

## Repository path
$REPO_PATH

Work through every subtask in order. For each subtask:
1. Implement the code changes in the repo
2. Run the verification command
3. Mark status as 'completed' or 'failed' in the plan
4. Move to next subtask

When done, output the updated implementation_plan.json with all statuses filled in."

run_claude "Code implementation" "$CODE_PROMPT" "$WORKSPACE/implementation_plan_done.json"

# ─── STEP 4: QA ─────────────────────────────────────────────────
QA_PROMPT="$(cat "$SKILL_DIR/references/qa-prompt.md")

## Spec
$(cat "$WORKSPACE/spec.md")

## Implementation Plan (completed)
$(cat "$WORKSPACE/implementation_plan_done.json")

## Repository path
$REPO_PATH

Review the implementation against the spec. Score each acceptance criterion YES/NO.
Output a qa_report.md with: score, findings, any remaining gaps."

run_claude "QA review" "$QA_PROMPT" "$WORKSPACE/qa_report.md"

# ─── DONE ───────────────────────────────────────────────────────
SCORE=$(grep -oP '\d+/\d+' "$WORKSPACE/qa_report.md" | head -1 || echo "see qa_report.md")
log "🏁 FlowForge complete — Score: $SCORE"
log "📄 QA report: $WORKSPACE/qa_report.md"

echo ""
echo "════════════════════════════════"
echo "  FlowForge Complete"
echo "  Score: $SCORE"
echo "  Workspace: $WORKSPACE"
echo "════════════════════════════════"
