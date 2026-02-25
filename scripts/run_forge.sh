#!/bin/bash
# FlowForge — Main pipeline runner
# Usage: run_forge.sh <workspace_path> [--rubric]

set -e

WORKSPACE="${1:-}"
USE_RUBRIC=false
if [[ "$2" == "--rubric" ]]; then USE_RUBRIC=true; fi

if [[ -z "$WORKSPACE" || ! -d "$WORKSPACE" ]]; then
  echo "Usage: run_forge.sh <workspace_path> [--rubric]"
  exit 1
fi

source "$WORKSPACE/forge.env"
SKILL_DIR="$HOME/clawd/skills/flowforge"
LOG="$WORKSPACE/progress.log"

# ─── Retry configuration (mirrors Auto-Claude base.py) ───────────────────────
MAX_STEP_RETRIES=5          # Logic/execution failures per pipeline step
MAX_CONCURRENCY_RETRIES=5   # Separate budget for transient 400/concurrency errors
INITIAL_BACKOFF=2           # Exponential backoff start (seconds)
MAX_BACKOFF=32              # Cap (2→4→8→16→32)
MAX_RATE_LIMIT_WAIT=7200    # Max wait for rate limit reset (2 hours)
RATE_LIMIT_POLL=30          # Poll interval when waiting for rate limit (seconds)
AUTH_POLL=10                # Poll interval when waiting for re-auth (seconds)
AUTH_MAX_WAIT=86400         # Max wait for auth recovery (24 hours)

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }

# Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped)
backoff() {
  local ATTEMPT=$1
  local DELAY=$(( INITIAL_BACKOFF * (2 ** (ATTEMPT - 1)) ))
  [[ $DELAY -gt $MAX_BACKOFF ]] && DELAY=$MAX_BACKOFF
  log "  ↳ Waiting ${DELAY}s before retry (attempt $ATTEMPT)..."
  sleep "$DELAY"
}

# Detect error type from output/log
is_rate_limit()    { grep -qi "rate.limit\|quota\|429\|too many requests" "$1" 2>/dev/null; }
is_auth_failure()  { grep -qi "auth\|401\|unauthorized\|invalid.*token\|token.*invalid" "$1" 2>/dev/null; }
is_concurrency()   { grep -qi "concurrency\|concurrent\|400\|tool.*busy\|resource.*busy" "$1" 2>/dev/null; }

# Wait for rate limit reset with polling
wait_for_rate_limit() {
  log "⏸  Rate limit hit — rotating account and waiting for reset"
  bash "$SKILL_DIR/scripts/rotate_account.sh" | tee -a "$LOG"
  local WAITED=0
  while [[ $WAITED -lt $MAX_RATE_LIMIT_WAIT ]]; do
    sleep "$RATE_LIMIT_POLL"
    WAITED=$((WAITED + RATE_LIMIT_POLL))
    log "  ↳ ${WAITED}s elapsed, checking if rate limit cleared..."
    # Try a lightweight probe; if it passes, resume
    if claude --dangerously-skip-permissions --print "ping" > /dev/null 2>&1; then
      log "✅ Rate limit cleared after ${WAITED}s — resuming"
      return 0
    fi
  done
  log "❌ Rate limit did not clear within ${MAX_RATE_LIMIT_WAIT}s"
  return 1
}

# Wait for auth recovery with polling
wait_for_auth() {
  log "⏸  Auth failure — waiting for re-authentication"
  local WAITED=0
  while [[ $WAITED -lt $AUTH_MAX_WAIT ]]; do
    sleep "$AUTH_POLL"
    WAITED=$((AUTH_POLL + WAITED))
    if claude --dangerously-skip-permissions --print "ping" > /dev/null 2>&1; then
      log "✅ Auth recovered after ${WAITED}s — resuming"
      return 0
    fi
  done
  log "❌ Auth did not recover within ${AUTH_MAX_WAIT}s"
  return 1
}

run_claude() {
  local STEP="$1"
  local PROMPT="$2"
  local OUTPUT="$3"
  local ERR_TMP
  ERR_TMP="$(mktemp)"

  log "→ $STEP"

  local LOGIC_ATTEMPT=0
  local CONCURRENCY_ATTEMPT=0

  while true; do
    if claude --dangerously-skip-permissions --print "$PROMPT" > "$OUTPUT" 2>"$ERR_TMP"; then
      cat "$ERR_TMP" >> "$LOG"
      log "✅ $STEP complete"
      rm -f "$ERR_TMP"
      return 0
    fi

    cat "$ERR_TMP" >> "$LOG"

    # ── Tier 3: Rate limit — don't count, rotate + wait ──────────────────
    if is_rate_limit "$ERR_TMP" || is_rate_limit "$LOG"; then
      wait_for_rate_limit || { log "❌ $STEP aborted: rate limit unrecoverable"; rm -f "$ERR_TMP"; exit 1; }
      log "  ↳ Resuming $STEP (rate limit cleared, logic attempt $LOGIC_ATTEMPT/$MAX_STEP_RETRIES)"
      continue
    fi

    # ── Tier 4: Auth failure — don't count, wait ─────────────────────────
    if is_auth_failure "$ERR_TMP"; then
      wait_for_auth || { log "❌ $STEP aborted: auth unrecoverable"; rm -f "$ERR_TMP"; exit 1; }
      log "  ↳ Resuming $STEP (auth recovered, logic attempt $LOGIC_ATTEMPT/$MAX_STEP_RETRIES)"
      continue
    fi

    # ── Tier 2: Concurrency / transient 400 — separate budget ────────────
    if is_concurrency "$ERR_TMP"; then
      CONCURRENCY_ATTEMPT=$((CONCURRENCY_ATTEMPT + 1))
      if [[ $CONCURRENCY_ATTEMPT -ge $MAX_CONCURRENCY_RETRIES ]]; then
        log "  ↳ Concurrency retries exhausted ($MAX_CONCURRENCY_RETRIES) — counting as logic failure"
        LOGIC_ATTEMPT=$((LOGIC_ATTEMPT + 1))
        CONCURRENCY_ATTEMPT=0
      else
        log "  ↳ Transient error — concurrency retry $CONCURRENCY_ATTEMPT/$MAX_CONCURRENCY_RETRIES"
        backoff "$CONCURRENCY_ATTEMPT"
        continue
      fi
    else
      # ── Tier 1: Logic / execution failure ──────────────────────────────
      LOGIC_ATTEMPT=$((LOGIC_ATTEMPT + 1))
    fi

    if [[ $LOGIC_ATTEMPT -ge $MAX_STEP_RETRIES ]]; then
      log "❌ $STEP failed after $MAX_STEP_RETRIES logic attempts"
      rm -f "$ERR_TMP"
      exit 1
    fi

    log "  ↳ Logic failure — attempt $LOGIC_ATTEMPT/$MAX_STEP_RETRIES"
    backoff "$LOGIC_ATTEMPT"
  done
}

# ─── STEP 1: SPEC ───────────────────────────────────────────────────────────
SPEC_PROMPT="$(cat "$SKILL_DIR/references/spec-prompt.md")

## Task
$(cat "$WORKSPACE/task.md")

## Repository
$(ls "$REPO_PATH" 2>/dev/null | head -30)

Write spec.md to stdout. Output ONLY the spec, no commentary."

run_claude "Spec generation" "$SPEC_PROMPT" "$WORKSPACE/spec.md"

# ─── STEP 2: PLAN ───────────────────────────────────────────────────────────
PLAN_PROMPT="$(cat "$SKILL_DIR/references/planner-prompt.md")

## Spec
$(cat "$WORKSPACE/spec.md")

## Repo structure
$(find "$REPO_PATH" -type f | grep -v '.git\|node_modules\|_build\|deps' | head -60)

Output ONLY valid JSON for implementation_plan.json. No commentary."

run_claude "Implementation planning" "$PLAN_PROMPT" "$WORKSPACE/implementation_plan.json"

# ─── STEP 3: CODE ───────────────────────────────────────────────────────────
CODE_PROMPT="$(cat "$SKILL_DIR/references/coder-prompt.md")

## Implementation Plan
$(cat "$WORKSPACE/implementation_plan.json")

## Repository path
$REPO_PATH

Work through every subtask in order. For each subtask:
1. Validate file paths — auto-correct if files_to_modify paths don't exist (fuzzy match)
2. Implement the code changes in the repo
3. Run the verification command
4. Apply the correct retry tier on failure (Tier 1 logic: 5 attempts w/ exponential backoff; Tier 2 concurrency: separate 5-attempt budget; Tier 3 rate limit: rotate + wait, don't count; Tier 4 auth: wait, don't count)
5. Mark status as 'completed', 'failed', or 'stuck' in the plan
6. Move to next subtask

When done, output the updated implementation_plan.json with all statuses filled in."

run_claude "Code implementation" "$CODE_PROMPT" "$WORKSPACE/implementation_plan_done.json"

# ─── STEP 4: QA (spec-based) ────────────────────────────────────────────────
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

# ─── STEP 5: RUBRIC (optional, 200 criteria) ────────────────────────────────
if [[ "$USE_RUBRIC" == "true" ]]; then
  log "→ Rubric scoring (200 criteria)"
  RUBRIC_PROMPT="$(cat "$SKILL_DIR/references/rubric-prompt.md")

## Repository path
$REPO_PATH

## Spec
$(cat "$WORKSPACE/spec.md")

Score every criterion YES/NO. Output rubric_report.md with full table and final score."

  run_claude "Rubric scoring (200 criteria)" "$RUBRIC_PROMPT" "$WORKSPACE/rubric_report.md"
  RUBRIC_SCORE=$(grep -oP '\d+/200' "$WORKSPACE/rubric_report.md" | head -1 || echo "see rubric_report.md")
  log "📊 Rubric score: $RUBRIC_SCORE"
fi

# ─── DONE ───────────────────────────────────────────────────────────────────
SCORE=$(grep -oP '\d+/\d+' "$WORKSPACE/qa_report.md" | head -1 || echo "see qa_report.md")
log "🏁 FlowForge complete — QA Score: $SCORE${USE_RUBRIC:+ | Rubric: $RUBRIC_SCORE}"
log "📄 QA report: $WORKSPACE/qa_report.md"
[[ "$USE_RUBRIC" == "true" ]] && log "📊 Rubric report: $WORKSPACE/rubric_report.md"

openclaw system event --text "FlowForge complete: QA $SCORE${USE_RUBRIC:+ | Rubric: $RUBRIC_SCORE} — $WORKSPACE" --mode now 2>/dev/null || true

echo ""
echo "════════════════════════════════════════"
echo "  FlowForge Complete"
echo "  QA Score:  $SCORE"
[[ "$USE_RUBRIC" == "true" ]] && echo "  Rubric:    $RUBRIC_SCORE"
echo "  Workspace: $WORKSPACE"
echo "════════════════════════════════════════"
