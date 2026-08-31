#!/bin/bash
# Tests for shell integration functions.
# Run with: bash shell-integration.test.sh
# Exit code 0 = all passed, non-zero = failures.

set -euo pipefail

TEMP_DIR=$(mktemp -d)
RESULTS_FILE="$TEMP_DIR/results"
echo "0 0" > "$RESULTS_FILE"

trap 'rm -rf "$TEMP_DIR"' EXIT

# ── source the shell functions ──────────────────────────────────────
# Extract the heredoc content from install-shell-integration.sh.
# The functions live between the first 'EOF' marker lines.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FUNC_FILE="$TEMP_DIR/functions.sh"

# Extract the shell functions: content between the heredoc delimiters.
# Starts after the line containing "<< 'EOF'" and ends at standalone "EOF".
awk "
  /<<.*'EOF'/{start=1; next}
  /^EOF\$/ && start{exit}
  start{print}
" "$SCRIPT_DIR/install-shell-integration.sh" > "$FUNC_FILE"

source "$FUNC_FILE"

# ── helpers ─────────────────────────────────────────────────────────
_record() {
  local pass_delta="$1" fail_delta="$2"
  local cur
  cur=$(cat "$RESULTS_FILE")
  local p f
  p=$(echo "$cur" | awk '{print $1}')
  f=$(echo "$cur" | awk '{print $2}')
  echo "$(( p + pass_delta )) $(( f + fail_delta ))" > "$RESULTS_FILE"
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    _record 1 0
    echo "  PASS: $label"
  else
    _record 0 1
    echo "  FAIL: $label"
    echo "    expected: $expected"
    echo "    actual:   $actual"
  fi
}

assert_file_absent() {
  local label="$1" file="$2"
  if [ ! -f "$file" ]; then
    _record 1 0
    echo "  PASS: $label"
  else
    _record 0 1
    echo "  FAIL: $label (file still exists: $file)"
  fi
}

# Create a fake workspace directory
FAKE_WS="$TEMP_DIR/workspaces/my-ws"
mkdir -p "$FAKE_WS"

# Override HOME so temp files go to our temp dir
export HOME="$TEMP_DIR"

# ── fake binaries ───────────────────────────────────────────────────
# Create fake 'nemus' and 'nem' commands that simulate the real CLI.
# They read env vars to decide: which go file to write, and what exit code.
FAKE_BIN="$TEMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/nemus" << 'BINEOF'
#!/bin/bash
# Simulate: write go/created/ai-prompt files as the real CLI would, then exit
if [ -n "${FAKE_GO_FILE:-}" ] && [ -n "${FAKE_GO_PATH:-}" ]; then
  echo "$FAKE_GO_PATH" > "$FAKE_GO_FILE"
fi
if [ -n "${FAKE_CREATED_FILE:-}" ] && [ -n "${FAKE_CREATED_PATH:-}" ]; then
  echo "$FAKE_CREATED_PATH" > "$FAKE_CREATED_FILE"
fi
if [ -n "${FAKE_AI_PROMPT:-}" ]; then
  echo "$FAKE_AI_PROMPT" > "$HOME/.workspace-ai-prompt"
fi
exit "${FAKE_EXIT_CODE:-0}"
BINEOF
chmod +x "$FAKE_BIN/nemus"
cp "$FAKE_BIN/nemus" "$FAKE_BIN/nem"

# Fake claude binary — logs invocation args so tests can inspect them
cat > "$FAKE_BIN/claude" << 'BINEOF'
#!/bin/bash
echo "$@" >> "$HOME/.claude-invocations"
exit 0
BINEOF
chmod +x "$FAKE_BIN/claude"

export PATH="$FAKE_BIN:$PATH"

# ════════════════════════════════════════════════════════════════════
echo ""
echo "Shell Integration Tests"
echo "======================="

# ── Test 1: nemus l → CD happens after exit 0 ──────────────────────
echo ""
echo "Test 1: 'nemus l' with exit 0 → should CD to workspace"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nemus l
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "go file cleaned up" "$HOME/.workspace-last-go"
)

# ── Test 2: nemus l → CD happens even after non-zero exit (Ctrl+C) ──
echo ""
echo "Test 2: 'nemus l' with exit 130 (SIGINT) → should still CD"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=130
  cd "$TEMP_DIR"
  # 'nemus l' will return 130, but we still want CD
  nemus l || true
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "go file cleaned up" "$HOME/.workspace-last-go"
)

# ── Test 3: nem list → same behavior via nem command ─────────────────
echo ""
echo "Test 3: 'nem list' with exit 0 → should CD"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nem list
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "go file cleaned up" "$HOME/.workspace-last-go"
)

# ── Test 4: nemus c → CD only on exit 0 ───────────────────────────
echo ""
echo "Test 4: 'nemus c' (create) with exit 0 → should CD"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nemus c
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "created file cleaned up" "$HOME/.workspace-last-created"
)

# ── Test 5: nemus c → no CD on non-zero exit ──────────────────────
echo ""
echo "Test 5: 'nemus c' (create) with exit 1 → should NOT CD"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=1
  cd "$TEMP_DIR"
  nemus c || true
  assert_eq "pwd unchanged" "$TEMP_DIR" "$(pwd)"
)

# ── Test 5a: deprecated create aliases → CD on exit 0 ────────────
echo ""
echo "Test 5a: deprecated create aliases (from-template, ft, from-suite, fs) → should CD"
(
  for alias in from-template ft from-suite fs; do
    export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
    export FAKE_CREATED_PATH="$FAKE_WS"
    export FAKE_EXIT_CODE=0
    cd "$TEMP_DIR"
    nemus $alias
    assert_eq "'nemus $alias' CDs to workspace" "$FAKE_WS" "$(pwd)"
  done
)

# ── Test 5b: grouped create commands → CD on exit 0 ─────────────
echo ""
echo "Test 5b: 'nemus suite use' and 'nemus template use' → should CD"
(
  for group in suite template; do
    export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
    export FAKE_CREATED_PATH="$FAKE_WS"
    export FAKE_EXIT_CODE=0
    cd "$TEMP_DIR"
    nemus $group use
    assert_eq "'nemus $group use' CDs to workspace" "$FAKE_WS" "$(pwd)"
  done
)

# ── Test 5c: grouped non-create subcommands → no CD ─────────────
echo ""
echo "Test 5c: 'nemus suite list' → should NOT CD"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nemus suite list
  assert_eq "pwd unchanged" "$TEMP_DIR" "$(pwd)"
)

# ── Test 6: nemus go → CD even after non-zero exit ────────────────
echo ""
echo "Test 6: 'nemus go' with exit 130 → should CD"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=130
  cd "$TEMP_DIR"
  nemus go || true
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "go file cleaned up" "$HOME/.workspace-last-go"
)

# ── Test 7: nemgo → CD after exit 0 ────────────────────────────────
echo ""
echo "Test 7: 'nemgo' with exit 0 → should CD"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nemgo
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "go file cleaned up" "$HOME/.workspace-last-go"
)

# ── Test 8: nemgo → CD even after non-zero exit ────────────────────
echo ""
echo "Test 8: 'nemgo' with exit 130 → should CD"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=130
  cd "$TEMP_DIR"
  nemgo || true
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "go file cleaned up" "$HOME/.workspace-last-go"
)

# ── Test 9: no go file → no CD ────────────────────────────────────
echo ""
echo "Test 9: 'nemus l' without go file → no CD"
(
  unset FAKE_GO_FILE FAKE_GO_PATH FAKE_CREATED_FILE FAKE_CREATED_PATH
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nemus l
  assert_eq "pwd unchanged" "$TEMP_DIR" "$(pwd)"
)

# ── Test 10: stale go file cleaned before run ──────────────────────
echo ""
echo "Test 10: stale go file is cleaned before running 'nemus l'"
(
  echo "/some/old/path" > "$HOME/.workspace-last-go"
  unset FAKE_GO_FILE FAKE_GO_PATH FAKE_CREATED_FILE FAKE_CREATED_PATH
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nemus l
  # The stale file was cleaned before running, and the fake binary
  # didn't write a new one, so no CD should happen
  assert_eq "pwd unchanged" "$TEMP_DIR" "$(pwd)"
  assert_file_absent "stale go file removed" "$HOME/.workspace-last-go"
)

# ── Test 11: nemus with no args → passes through to binary for help ─
echo ""
echo "Test 11: 'nemus' with no args → runs binary with no args"
(
  unset FAKE_GO_FILE FAKE_GO_PATH FAKE_CREATED_FILE FAKE_CREATED_PATH
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nemus
  assert_eq "pwd unchanged (no CD)" "$TEMP_DIR" "$(pwd)"
)

# ── Test 12: nem with no args → same ────────────────────────────────
echo ""
echo "Test 12: 'nem' with no args → runs binary with no args"
(
  unset FAKE_GO_FILE FAKE_GO_PATH FAKE_CREATED_FILE FAKE_CREATED_PATH
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  nem
  assert_eq "pwd unchanged (no CD)" "$TEMP_DIR" "$(pwd)"
)

# ── Test 12a: installer keeps functions out of the RC file ──────────
echo ""
echo "Test 12a: installer writes functions to ~/.nemus and sources them from .zshrc"
(
  INSTALL_HOME="$TEMP_DIR/install-home"
  mkdir -p "$INSTALL_HOME"
  cat > "$INSTALL_HOME/.zshrc" << 'RCEOF'
export USER_SETTING=kept
RCEOF

  HOME="$INSTALL_HOME" bash "$SCRIPT_DIR/install-shell-integration.sh" zsh >/dev/null

  assert_eq "generated integration file exists" "1" "$([ -f "$INSTALL_HOME/.nemus/shell-integration.sh" ] && echo 1 || echo 0)"
  assert_eq "functions moved to generated file" "1" "$(grep -c '^nemus()' "$INSTALL_HOME/.nemus/shell-integration.sh")"
  assert_eq "functions absent from .zshrc" "0" "$(grep -c '^nemus()' "$INSTALL_HOME/.zshrc")"
  assert_eq "source line added once" "1" "$(grep -Fc '[ -f "$HOME/.nemus/shell-integration.sh" ] && source "$HOME/.nemus/shell-integration.sh"' "$INSTALL_HOME/.zshrc")"
  assert_eq "user setting preserved" "1" "$(grep -c 'USER_SETTING=kept' "$INSTALL_HOME/.zshrc")"

  HOME="$INSTALL_HOME" bash "$SCRIPT_DIR/install-shell-integration.sh" zsh >/dev/null
  assert_eq "reinstall does not duplicate source line" "1" "$(grep -Fc '[ -f "$HOME/.nemus/shell-integration.sh" ] && source "$HOME/.nemus/shell-integration.sh"' "$INSTALL_HOME/.zshrc")"

  cat >> "$INSTALL_HOME/.zshrc" << 'RCEOF'
# user content after integration
user_function() { echo kept; }
RCEOF
  TMPFILE=$(mktemp)
  awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$INSTALL_HOME/.zshrc" > "$TMPFILE"
  mv "$TMPFILE" "$INSTALL_HOME/.zshrc"
  assert_eq "source line can be removed" "0" "$(grep -Fc 'shell-integration.sh' "$INSTALL_HOME/.zshrc")"
  assert_eq "function after source line preserved" "1" "$(grep -c 'user_function()' "$INSTALL_HOME/.zshrc")"
  assert_eq "comment after source line preserved" "1" "$(grep -c '# user content after integration' "$INSTALL_HOME/.zshrc")"
)

# ── Test 12b: installer migrates the legacy inline block ────────────
echo ""
echo "Test 12b: installer migrates an inline block without touching user content"
(
  INSTALL_HOME="$TEMP_DIR/migration-home"
  mkdir -p "$INSTALL_HOME"
  cat > "$INSTALL_HOME/.zshrc" << 'RCEOF'
export BEFORE=yes

# Nemus - Shell Integration (v50)
nemus() {
  command nemus "$@"
}

# user content after integration
export AFTER=yes
RCEOF

  HOME="$INSTALL_HOME" bash "$SCRIPT_DIR/install-shell-integration.sh" zsh >/dev/null

  assert_eq "legacy function removed from .zshrc" "0" "$(grep -c '^nemus()' "$INSTALL_HOME/.zshrc")"
  assert_eq "source line added" "1" "$(grep -Fc '[ -f "$HOME/.nemus/shell-integration.sh" ] && source "$HOME/.nemus/shell-integration.sh"' "$INSTALL_HOME/.zshrc")"
  assert_eq "content before integration preserved" "1" "$(grep -c 'BEFORE=yes' "$INSTALL_HOME/.zshrc")"
  assert_eq "content after integration preserved" "1" "$(grep -c 'AFTER=yes' "$INSTALL_HOME/.zshrc")"
  assert_eq "comment after integration preserved" "1" "$(grep -c '# user content after integration' "$INSTALL_HOME/.zshrc")"
)

# ── Test 13: upgrade removes old block and preserves rest ──────────
echo ""
echo "Test 13: upgrade from old version preserves rest of RC file"
(
  # Simulate an old .zshrc with shell integration + user content after
  TEST_RC="$TEMP_DIR/.zshrc-test"
  cat > "$TEST_RC" << 'RCEOF'
# user stuff before
export FOO=bar

# Nemus - Shell Integration
nemus() {
  command nemus "$@"
}

# user stuff after
export BAZ=qux
alias ll='ls -la'
RCEOF

  # Run the shared awk upgrade logic
  TMPFILE=$(mktemp)
  awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$TEST_RC" > "$TMPFILE"
  mv "$TMPFILE" "$TEST_RC"

  # Verify user content before and after is preserved
  assert_eq "FOO line preserved" "1" "$(grep -c 'export FOO=bar' "$TEST_RC")"
  assert_eq "BAZ line preserved" "1" "$(grep -c 'export BAZ=qux' "$TEST_RC")"
  assert_eq "alias preserved" "1" "$(grep -c "alias ll=" "$TEST_RC")"
  assert_eq "user comment preserved" "1" "$(grep -c '# user stuff after' "$TEST_RC")"
  assert_eq "old nemus() removed" "0" "$(grep -c 'nemus()' "$TEST_RC")"
  assert_eq "old marker removed" "0" "$(grep -c 'Nemus - Shell Integration' "$TEST_RC")"
  rm -f "$TEST_RC"
)

# ── Test 14: upgrade removes old block WITH nemgo and preserves rest ─
echo ""
echo "Test 14: upgrade from version with nemgo preserves rest of RC file"
(
  TEST_RC="$TEMP_DIR/.zshrc-test2"
  cat > "$TEST_RC" << 'RCEOF'
export BEFORE=yes

# Nemus - Shell Integration
nemus() {
  command nemus "$@"
}

nem() {
  command nem "$@"
}

nemgo() {
  command nemus go "$@"
}

export AFTER=yes
RCEOF

  TMPFILE=$(mktemp)
  awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$TEST_RC" > "$TMPFILE"
  mv "$TMPFILE" "$TEST_RC"

  assert_eq "BEFORE preserved" "1" "$(grep -c 'BEFORE=yes' "$TEST_RC")"
  assert_eq "AFTER preserved" "1" "$(grep -c 'AFTER=yes' "$TEST_RC")"
  assert_eq "old nemus() removed" "0" "$(grep -c 'nemus()' "$TEST_RC")"
  assert_eq "old nem() removed" "0" "$(grep -c 'nem()' "$TEST_RC")"
  assert_eq "old nemgo() removed" "0" "$(grep -c 'nemgo()' "$TEST_RC")"
  assert_eq "old marker removed" "0" "$(grep -c 'Nemus - Shell Integration' "$TEST_RC")"
  rm -f "$TEST_RC"
)

# ── Test 15: upgrade handles single-line function definitions ────────
echo ""
echo "Test 15: upgrade from single-line function defs preserves rest of RC file"
(
  TEST_RC="$TEMP_DIR/.zshrc-test3"
  cat > "$TEST_RC" << 'RCEOF'
export TOP=yes

# Nemus - Shell Integration
nemus() { command nemus "$@"; }
nem() { command nem "$@"; }
nemgo() { command nemus go "$@"; }

export BOTTOM=yes
RCEOF

  TMPFILE=$(mktemp)
  awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$TEST_RC" > "$TMPFILE"
  mv "$TMPFILE" "$TEST_RC"

  assert_eq "TOP preserved" "1" "$(grep -c 'TOP=yes' "$TEST_RC")"
  assert_eq "BOTTOM preserved" "1" "$(grep -c 'BOTTOM=yes' "$TEST_RC")"
  assert_eq "old nemus() removed" "0" "$(grep -c 'nemus()' "$TEST_RC")"
  assert_eq "old nem() removed" "0" "$(grep -c 'nem()' "$TEST_RC")"
  assert_eq "old nemgo() removed" "0" "$(grep -c 'nemgo()' "$TEST_RC")"
  assert_eq "old marker removed" "0" "$(grep -c 'Nemus - Shell Integration' "$TEST_RC")"
  rm -f "$TEST_RC"
)

# ── Test 16: user comments directly after old block are preserved ───
echo ""
echo "Test 16: user comments immediately after old block are preserved"
(
  TEST_RC="$TEMP_DIR/.zshrc-test4"
  cat > "$TEST_RC" << 'RCEOF'
export TOP=yes

# Nemus - Shell Integration
nemus() {
  command nemus "$@"
}

nemgo() {
  command nemus go "$@"
}

# My custom aliases
alias gs='git status'
# Another comment
export BOTTOM=yes
RCEOF

  TMPFILE=$(mktemp)
  awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$TEST_RC" > "$TMPFILE"
  mv "$TMPFILE" "$TEST_RC"

  assert_eq "TOP preserved" "1" "$(grep -c 'TOP=yes' "$TEST_RC")"
  assert_eq "BOTTOM preserved" "1" "$(grep -c 'BOTTOM=yes' "$TEST_RC")"
  assert_eq "user comment preserved" "1" "$(grep -c '# My custom aliases' "$TEST_RC")"
  assert_eq "second user comment preserved" "1" "$(grep -c '# Another comment' "$TEST_RC")"
  assert_eq "alias preserved" "1" "$(grep -c "alias gs=" "$TEST_RC")"
  assert_eq "old nemus() removed" "0" "$(grep -c 'nemus()' "$TEST_RC")"
  assert_eq "old nemgo() removed" "0" "$(grep -c 'nemgo()' "$TEST_RC")"
  assert_eq "old marker removed" "0" "$(grep -c 'Nemus - Shell Integration' "$TEST_RC")"
  rm -f "$TEST_RC"
)

# ── Test 17: user content after block at EOF is preserved ────────────
echo ""
echo "Test 17: user comments after old block at EOF are flushed"
(
  TEST_RC="$TEMP_DIR/.zshrc-test5"
  cat > "$TEST_RC" << 'RCEOF'
export TOP=yes

# Nemus - Shell Integration
nemus() {
  command nemus "$@"
}

# my trailing comment
RCEOF

  TMPFILE=$(mktemp)
  awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$TEST_RC" > "$TMPFILE"
  mv "$TMPFILE" "$TEST_RC"

  assert_eq "TOP preserved" "1" "$(grep -c 'TOP=yes' "$TEST_RC")"
  assert_eq "trailing comment preserved" "1" "$(grep -c '# my trailing comment' "$TEST_RC")"
  assert_eq "old nemus() removed" "0" "$(grep -c 'nemus()' "$TEST_RC")"
  assert_eq "old marker removed" "0" "$(grep -c 'Nemus - Shell Integration' "$TEST_RC")"
  rm -f "$TEST_RC"
)

# ── Test 18: tab title is set to workspace name ─────────────────────
echo ""
echo "Test 18: 'nemus l' sets terminal tab title to workspace name"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  # Capture raw output including escape sequences
  OUTPUT=$(nemus l 2>&1 | /bin/cat -v)
  # OSC 0 sequence: ^[]0;my-ws^G
  assert_eq "OSC title escape emitted" "1" "$(echo "$OUTPUT" | grep -cF ']0;my-ws')"
)

# ── Test 19: tab title is set for create command ─────────────────────
echo ""
echo "Test 19: 'nemus c' sets terminal tab title to workspace name"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  OUTPUT=$(nemus c 2>&1 | /bin/cat -v)
  assert_eq "OSC title escape emitted" "1" "$(echo "$OUTPUT" | grep -cF ']0;my-ws')"
)

# ── Test 20: tab title is set for nemgo ───────────────────────────────
echo ""
echo "Test 20: 'nemgo' sets terminal tab title to workspace name"
(
  export FAKE_GO_FILE="$HOME/.workspace-last-go"
  export FAKE_GO_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  cd "$TEMP_DIR"
  OUTPUT=$(nemgo 2>&1 | /bin/cat -v)
  assert_eq "OSC title escape emitted" "1" "$(echo "$OUTPUT" | grep -cF ']0;my-ws')"
)

# ── Test 21: nemus -- (AI prompt) → CD + pass prompt to follow-up Claude session
echo ""
echo "Test 21: 'nemus -- create payments workspace' → CD + prompt handoff"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_AI_PROMPT="create payments workspace"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus -- create payments workspace
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "ai prompt file cleaned up" "$HOME/.workspace-ai-prompt"
  assert_file_absent "created file cleaned up" "$HOME/.workspace-last-created"
  # Verify claude called with --name and prompt as positional arg
  CLAUDE_ARGS=$(cat "$HOME/.claude-invocations" 2>/dev/null || echo "")
  if echo "$CLAUDE_ARGS" | grep -q -- "--name my-ws" && echo "$CLAUDE_ARGS" | grep -q "create payments workspace"; then
    _record 1 0
    echo "  PASS: claude called with --name and prompt"
  else
    _record 0 1
    echo "  FAIL: claude args missing --name or prompt"
    echo "    actual: $CLAUDE_ARGS"
  fi
  CALL_COUNT=$(echo "$CLAUDE_ARGS" | wc -l | tr -d ' ')
  if [ "$CALL_COUNT" -eq 1 ]; then
    _record 1 0
    echo "  PASS: single interactive claude call (no two-step)"
  else
    _record 0 1
    echo "  FAIL: expected 1 claude call, got $CALL_COUNT"
  fi
  rm -f "$HOME/.claude-invocations"
)

# ── Test 22: nemus -- without workspace creation → ai prompt file cleaned up
echo ""
echo "Test 22: 'nemus -- list workspaces' (no workspace created) → ai prompt file cleaned"
(
  unset FAKE_CREATED_FILE FAKE_CREATED_PATH FAKE_GO_FILE FAKE_GO_PATH
  export FAKE_AI_PROMPT="list workspaces"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus -- list workspaces
  assert_eq "pwd unchanged" "$TEMP_DIR" "$(pwd)"
  assert_file_absent "ai prompt file cleaned up" "$HOME/.workspace-ai-prompt"
  rm -f "$HOME/.claude-invocations"
)

# ── Test 23: nemus -- with exit 1 → no CD, ai prompt file cleaned up
echo ""
echo "Test 23: 'nemus --' with exit 1 → no CD, ai prompt file cleaned"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_AI_PROMPT="create something"
  export FAKE_EXIT_CODE=1
  cd "$TEMP_DIR"
  nemus -- create something || true
  assert_eq "pwd unchanged" "$TEMP_DIR" "$(pwd)"
  assert_file_absent "ai prompt file cleaned up" "$HOME/.workspace-ai-prompt"
)

# ── Test 24: nemus create (non-AI) → no ai prompt handoff, plain claude launch
echo ""
echo "Test 24: 'nemus create' (non-AI) → plain claude launch without prompt handoff"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus create
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  CLAUDE_ARGS=$(cat "$HOME/.claude-invocations" 2>/dev/null || echo "")
  if echo "$CLAUDE_ARGS" | grep -q -- "--name my-ws" && ! echo "$CLAUDE_ARGS" | grep -q -- "--append-system-prompt"; then
    _record 1 0
    echo "  PASS: claude called with --name only (no prompt handoff)"
  else
    _record 0 1
    echo "  FAIL: expected --name without --append-system-prompt"
    echo "    actual: $CLAUDE_ARGS"
  fi
  rm -f "$HOME/.claude-invocations"
)

# ── Test 25: 'nemus create --yes' → CD but skip agent auto-launch ──
echo ""
echo "Test 25: 'nemus create --workspace X --repos Y --yes' → CD, no agent launch"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus create --workspace my-ws --repos foo --yes
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "created file cleaned up" "$HOME/.workspace-last-created"
  assert_file_absent "claude NOT launched (--yes)" "$HOME/.claude-invocations"
)

# ── Test 26: 'nemus c -y' (short flag) → skip agent auto-launch ────
echo ""
echo "Test 26: 'nemus c -y' (short flag) → CD, no agent launch"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus c --workspace my-ws -y
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "claude NOT launched (-y)" "$HOME/.claude-invocations"
)

# ── Test 27: 'nemus suite use --yes' → skip agent auto-launch ──────
echo ""
echo "Test 27: 'nemus suite use --yes' → CD, no agent launch"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus suite use --suite my-suite --workspace my-ws --yes
  assert_eq "pwd is workspace" "$FAKE_WS" "$(pwd)"
  assert_file_absent "claude NOT launched (--yes)" "$HOME/.claude-invocations"
)

# ── Test 28: 'nemus create' without --yes → agent still launches ──
echo ""
echo "Test 28: 'nemus create' (no --yes) → agent still auto-launches (unchanged)"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus create --workspace my-ws --repos foo
  CLAUDE_ARGS=$(cat "$HOME/.claude-invocations" 2>/dev/null || echo "")
  if [ -n "$CLAUDE_ARGS" ]; then
    _record 1 0
    echo "  PASS: claude still launched when --yes is absent"
  else
    _record 0 1
    echo "  FAIL: claude was not launched"
  fi
  rm -f "$HOME/.claude-invocations"
)

# ── Test 29: 'nemus -- prompt --yes' (AI path) → agent still launches ─
# The AI-prompt handoff is interactive-only by design; --yes appearing
# in the natural-language prompt text must not suppress the handoff.
echo ""
echo "Test 29: 'nemus -- prompt --yes' (AI path) → agent still launches"
(
  export FAKE_CREATED_FILE="$HOME/.workspace-last-created"
  export FAKE_CREATED_PATH="$FAKE_WS"
  export FAKE_AI_PROMPT="create payments workspace"
  export FAKE_EXIT_CODE=0
  rm -f "$HOME/.claude-invocations"
  cd "$TEMP_DIR"
  nemus -- create payments workspace --yes
  CLAUDE_ARGS=$(cat "$HOME/.claude-invocations" 2>/dev/null || echo "")
  if [ -n "$CLAUDE_ARGS" ]; then
    _record 1 0
    echo "  PASS: claude still launched for AI-prompt path despite --yes"
  else
    _record 0 1
    echo "  FAIL: claude was not launched"
  fi
  rm -f "$HOME/.claude-invocations"
)

# ── Summary ─────────────────────────────────────────────────────────
FINAL=$(cat "$RESULTS_FILE")
PASS=$(echo "$FINAL" | awk '{print $1}')
FAIL=$(echo "$FINAL" | awk '{print $2}')
echo ""
echo "======================="
echo "Results: $PASS passed, $FAIL failed"
echo "======================="

exit "$FAIL"
