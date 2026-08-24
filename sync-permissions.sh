#!/bin/bash
#
# sync-permissions.sh — Claude Code Stop hook
#
# Merges project-level Claude Code permissions into the global
# ~/.claude/settings.json so they never need re-approval
# in other workspaces.
#
# NOTE: We write to settings.json (not settings.local.json) because
# Claude Code only reads ~/.claude/settings.json at the user level.
# The .local.json variant is only recognized at the project level.
#
# Called automatically by Claude Code after every response when
# registered as a Stop hook.

# Claude Code pipes tool results to Stop hook stdin.
# We must drain it or the hook process may block the parent.
cat > /dev/null

# Bail if jq is not available
command -v jq &>/dev/null || exit 0

# Guard against missing HOME
[ -z "$HOME" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
[ -z "$PROJECT_DIR" ] && exit 0

PROJECT_SETTINGS="$PROJECT_DIR/.claude/settings.local.json"
GLOBAL_SETTINGS="$HOME/.claude/settings.json"

# Nothing to do if project has no settings
[ -f "$PROJECT_SETTINGS" ] || exit 0

# Ensure global settings file exists with a valid structure
if [ ! -f "$GLOBAL_SETTINGS" ]; then
    mkdir -p "$(dirname "$GLOBAL_SETTINGS")"
    echo '{}' > "$GLOBAL_SETTINGS"
fi

LOCK_FILE="$GLOBAL_SETTINGS.lock"

# jq filter that checks if a permission is reusable (no absolute user paths, no heredoc commits).
# IMPORTANT: Keep in sync with isReusablePermission() in utils/permission-sync.ts.
IS_REUSABLE='def is_reusable: (test("/Users/|/home/") | not) and (test("cat <<.*EOF") | not);'

# jq filter to compute new allow entries:
#   project_allow - global_allow - global_deny, filtered for reusability
COMPUTE_ALLOW='
  '"$IS_REUSABLE"'
  ($project.permissions.allow // []) as $pa |
  ($global.permissions.allow // []) as $ga |
  ($global.permissions.deny // []) as $gd |
  [$pa[] | select(is_reusable) | select(. as $e | ($ga | index($e)) | not) | select(. as $e | ($gd | index($e)) | not)]
'

# jq filter to compute new deny entries:
#   project_deny - global_deny, filtered for reusability
COMPUTE_DENY='
  '"$IS_REUSABLE"'
  ($project.permissions.deny // []) as $pd |
  ($global.permissions.deny // []) as $gd |
  [$pd[] | select(is_reusable) | select(. as $e | ($gd | index($e)) | not)]
'

# Read project settings once
PROJECT_JSON=$(cat "$PROJECT_SETTINGS" 2>/dev/null) || exit 0

# Check if there's anything to sync before acquiring the lock
NEW_ALLOW=$(jq -n --argjson project "$PROJECT_JSON" --argjson global "$(cat "$GLOBAL_SETTINGS")" "$COMPUTE_ALLOW")
NEW_DENY=$(jq -n --argjson project "$PROJECT_JSON" --argjson global "$(cat "$GLOBAL_SETTINGS")" "$COMPUTE_DENY")

# Exit early if nothing to add
if [ "$NEW_ALLOW" = "[]" ] && [ "$NEW_DENY" = "[]" ]; then
    exit 0
fi

# Use flock for exclusive access during the read-modify-write cycle.
# macOS doesn't ship flock; fall back to mkdir-based locking.
acquire_lock() {
    if command -v flock &>/dev/null; then
        exec 9>"$LOCK_FILE"
        flock -w 5 9 || return 1
    else
        local attempts=0
        while ! mkdir "$LOCK_FILE" 2>/dev/null; do
            attempts=$((attempts + 1))
            if [ $attempts -ge 50 ]; then
                # Stale lock — remove and retry once
                rm -rf "$LOCK_FILE"
                mkdir "$LOCK_FILE" 2>/dev/null || return 1
                break
            fi
            sleep 0.1
        done
    fi
}

release_lock() {
    if command -v flock &>/dev/null; then
        exec 9>&-
        rm -f "$LOCK_FILE"
    else
        rm -rf "$LOCK_FILE"
    fi
}

# Clean up lock on exit
trap release_lock EXIT

acquire_lock || exit 0

# Re-read global settings under the lock (another process may have changed it)
GLOBAL_JSON=$(cat "$GLOBAL_SETTINGS" 2>/dev/null) || GLOBAL_JSON='{}'

# Recompute with fresh global state
NEW_ALLOW=$(jq -n --argjson project "$PROJECT_JSON" --argjson global "$GLOBAL_JSON" "$COMPUTE_ALLOW")
NEW_DENY=$(jq -n --argjson project "$PROJECT_JSON" --argjson global "$GLOBAL_JSON" "$COMPUTE_DENY")

# Exit if nothing to add after re-check
if [ "$NEW_ALLOW" = "[]" ] && [ "$NEW_DENY" = "[]" ]; then
    exit 0
fi

# Build the merge filter
MERGE_FILTER='
  .permissions.allow = ((.permissions.allow // []) + $new_allow | unique) |
  .permissions.deny  = ((.permissions.deny  // []) + $new_deny  | unique)
'

# Write atomically via temp file
TEMP_FILE=$(mktemp "${GLOBAL_SETTINGS}.XXXXXX")
if jq --argjson new_allow "$NEW_ALLOW" --argjson new_deny "$NEW_DENY" "$MERGE_FILTER" <<< "$GLOBAL_JSON" > "$TEMP_FILE" 2>/dev/null; then
    mv "$TEMP_FILE" "$GLOBAL_SETTINGS"
else
    rm -f "$TEMP_FILE"
fi
