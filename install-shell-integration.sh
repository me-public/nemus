#!/bin/bash

# Nemus - Shell Integration Installer
# This script installs a shell function that allows automatic CD after workspace creation

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHELL_TYPE="${1:-detect}"

# Detect shell if not specified
if [ "$SHELL_TYPE" = "detect" ]; then
  if [ -n "$BASH_VERSION" ]; then
    SHELL_TYPE="bash"
  elif [ -n "$ZSH_VERSION" ]; then
    SHELL_TYPE="zsh"
  else
    SHELL_CURRENT=$(basename "$SHELL")
    if [ "$SHELL_CURRENT" = "bash" ]; then
      SHELL_TYPE="bash"
    elif [ "$SHELL_CURRENT" = "zsh" ]; then
      SHELL_TYPE="zsh"
    else
      echo "Could not detect shell type. Please specify: bash or zsh"
      exit 1
    fi
  fi
fi

# Shell function to wrap workspace command
read -r -d '' SHELL_FUNCTION << 'EOF' || true

# Nemus - Shell Integration (v49)
# Wraps both 'nemus' and 'nem' commands so the shell can CD after
# create / list / go commands. A child process cannot change the parent
# shell's directory, so we need shell functions that read a temp file
# written by the Node CLI and call `cd` in the current shell.

# ── helper: deterministic tab color from workspace name ──────────────
# Hashes the workspace name and maps it to a color on the full HSL hue
# wheel, then converts to RGB. This gives ~360 distinct, readable colors
# (vs the old 16-entry palette that repeated after a handful of
# workspaces). Always produces the same color for the same name.
# Output: "R G B" as three space-separated integers (0-255).
__workspace_hash_color() {
  local str="$1"
  local hash=0
  local i char
  for (( i=0; i<${#str}; i++ )); do
    char="${str:$i:1}"
    # 24-bit accumulator for a wide, well-distributed hash.
    hash=$(( (hash * 31 + $(printf '%d' "'$char")) % 16777216 ))
  done

  # Derive hue across the whole wheel (0-359) plus small saturation/lightness
  # variation from independent slices of the hash for extra distinctness,
  # kept within a tasteful, readable band (not neon, not muddy).
  local hue=$(( hash % 360 ))
  local sat=$(( 58 + (hash / 360) % 15 ))    # 58-72 %
  local light=$(( 60 + (hash / 97) % 11 ))   # 60-70 %

  # HSL -> RGB. Prefer awk (handles the float math) for a smooth spectrum;
  # fall back to a small built-in palette if awk is somehow unavailable.
  if command -v awk >/dev/null 2>&1; then
    awk -v h="$hue" -v s="$sat" -v l="$light" 'BEGIN{
      s/=100.0; l/=100.0;
      c=(1-((2*l-1)<0?-(2*l-1):(2*l-1)))*s;
      hp=h/60.0;
      m2=hp-2*int(hp/2); d=m2-1; if(d<0)d=-d;
      x=c*(1-d);
      if(hp<1){r=c;g=x;b=0} else if(hp<2){r=x;g=c;b=0}
      else if(hp<3){r=0;g=c;b=x} else if(hp<4){r=0;g=x;b=c}
      else if(hp<5){r=x;g=0;b=c} else {r=c;g=0;b=x}
      m=l-c/2.0;
      printf "%d %d %d", (r+m)*255+0.5, (g+m)*255+0.5, (b+m)*255+0.5;
    }'
  else
    # Fallback palette (only used if awk is missing).
    local palette=(
      "86 156 214" "106 153 85" "214 157 133" "156 220 254"
      "220 220 170" "197 134 192" "78 201 176" "255 198 109"
      "229 192 123" "97 175 239" "224 108 117" "152 195 121"
      "180 100 166" "209 154 102" "129 162 190" "140 170 175"
    )
    local idx=$(( hash % ${#palette[@]} ))
    if [ -n "${ZSH_VERSION:-}" ]; then idx=$(( idx + 1 )); fi
    echo "${palette[$idx]}"
  fi
}

# ── helper: set iTerm2 tab background color ────────────────────────
# Uses the xterm OSC 6 escape sequence that iTerm2 supports.
# Silently does nothing in terminals that don't understand it.
__workspace_set_tab_color() {
  local r="$1" g="$2" b="$3"
  if [ "${TERM_PROGRAM:-}" = "iTerm.app" ] || [ "${TERM_PROGRAM:-}" = "iTerm2" ]; then
    printf '\033]6;1;bg;red;brightness;%d\007'   "$r"
    printf '\033]6;1;bg;green;brightness;%d\007' "$g"
    printf '\033]6;1;bg;blue;brightness;%d\007'  "$b"
  fi
}

# ── helper: reset iTerm2 tab color to the profile default ─────────
__workspace_reset_tab_color() {
  if [ "${TERM_PROGRAM:-}" = "iTerm.app" ] || [ "${TERM_PROGRAM:-}" = "iTerm2" ]; then
    printf '\033]6;1;bg;*;default\007'
  fi
}

# ── helper: set terminal tab title + iTerm2 tab color ────────────────
# Uses both OSC 0 (window title) and OSC 1 (tab title) for broad
# terminal support. Installs a precmd/PROMPT_COMMAND hook so the title
# and color persist across prompts (zsh/oh-my-zsh and bash reset titles
# on each prompt). The hook auto-clears when the user CDs out of the
# workspace, restoring the default tab color.
__workspace_set_tab_title() {
  local title="$1"
  # Set title immediately
  printf '\033]0;%s\007' "$title"
  printf '\033]1;%s\007' "$title"

  # Compute and apply a deterministic color for this workspace
  local color r g b
  color=$(__workspace_hash_color "$title")
  read -r r g b <<< "$color"
  __workspace_set_tab_color "$r" "$g" "$b"

  # Persist state for the hook
  export __WORKSPACE_TAB_TITLE="$title"
  export __WORKSPACE_TAB_DIR="$PWD"
  export __WORKSPACE_TAB_R="$r"
  export __WORKSPACE_TAB_G="$g"
  export __WORKSPACE_TAB_B="$b"

  if [ -n "${ZSH_VERSION:-}" ]; then
    # Disable oh-my-zsh auto-title so it doesn't overwrite ours
    if [ -z "${__WORKSPACE_PREV_DISABLE_AUTO_TITLE+x}" ]; then
      export __WORKSPACE_PREV_DISABLE_AUTO_TITLE="${DISABLE_AUTO_TITLE:-}"
    fi
    export DISABLE_AUTO_TITLE=true
    __workspace_precmd() {
      if [ -n "$__WORKSPACE_TAB_TITLE" ]; then
        if [ "$PWD" = "$__WORKSPACE_TAB_DIR" ] || [[ "$PWD" = "$__WORKSPACE_TAB_DIR"/* ]]; then
          printf '\033]0;%s\007' "$__WORKSPACE_TAB_TITLE"
          printf '\033]1;%s\007' "$__WORKSPACE_TAB_TITLE"
          __workspace_set_tab_color "$__WORKSPACE_TAB_R" "$__WORKSPACE_TAB_G" "$__WORKSPACE_TAB_B"
        else
          # Left the workspace — clear everything and restore defaults
          unset __WORKSPACE_TAB_TITLE __WORKSPACE_TAB_DIR
          unset __WORKSPACE_TAB_R __WORKSPACE_TAB_G __WORKSPACE_TAB_B
          __workspace_reset_tab_color
          # Restore previous DISABLE_AUTO_TITLE value
          if [ -n "${__WORKSPACE_PREV_DISABLE_AUTO_TITLE:-}" ]; then
            export DISABLE_AUTO_TITLE="$__WORKSPACE_PREV_DISABLE_AUTO_TITLE"
          else
            unset DISABLE_AUTO_TITLE
          fi
          unset __WORKSPACE_PREV_DISABLE_AUTO_TITLE
          # Remove ourselves from precmd_functions
          precmd_functions=(${precmd_functions:#__workspace_precmd})
        fi
      fi
    }
    # Add to precmd_functions array (zsh hook mechanism)
    if (( ! ${precmd_functions[(Ie)__workspace_precmd]} )); then
      precmd_functions+=(__workspace_precmd)
    fi
  elif [ -n "${BASH_VERSION:-}" ]; then
    __workspace_prompt_command() {
      if [ -n "$__WORKSPACE_TAB_TITLE" ]; then
        if [ "$PWD" = "$__WORKSPACE_TAB_DIR" ] || [[ "$PWD" == "$__WORKSPACE_TAB_DIR"/* ]]; then
          printf '\033]0;%s\007' "$__WORKSPACE_TAB_TITLE"
          printf '\033]1;%s\007' "$__WORKSPACE_TAB_TITLE"
          __workspace_set_tab_color "$__WORKSPACE_TAB_R" "$__WORKSPACE_TAB_G" "$__WORKSPACE_TAB_B"
        else
          # Left the workspace — clear everything and restore defaults
          unset __WORKSPACE_TAB_TITLE __WORKSPACE_TAB_DIR
          unset __WORKSPACE_TAB_R __WORKSPACE_TAB_G __WORKSPACE_TAB_B
          __workspace_reset_tab_color
          PROMPT_COMMAND="${PROMPT_COMMAND//__workspace_prompt_command;/}" 2>/dev/null || true
        fi
      fi
    }
    case "${PROMPT_COMMAND:-}" in
      *__workspace_prompt_command*) ;;
      *) PROMPT_COMMAND="__workspace_prompt_command;${PROMPT_COMMAND:-}" ;;
    esac
  fi
}

# ── helper: detect configured AI agent ───────────────────────────────
# Reads primaryAgent from Nemus config and returns the CLI command.
# Falls back to 'claude' if config is missing or unreadable.
# Caches result for the shell session to avoid repeated node invocations.
__ws_cached_agent=""
__workspace_detect_agent() {
  # Return cached result if available
  if [ -n "$__ws_cached_agent" ]; then
    echo "$__ws_cached_agent"
    return
  fi
  local agent="claude"
  if command -v node >/dev/null 2>&1; then
    local cfg="$HOME/.workspace-manager-cache/config.json"
    if [ -f "$cfg" ]; then
      local ai
      ai=$(CFG="$cfg" node -e '
        try {
          const c = JSON.parse(require("fs").readFileSync(process.env.CFG, "utf-8"));
          console.log(c.primaryAgent || "auto");
        } catch { console.log("auto"); }
      ' 2>/dev/null)
      case "$ai" in
        pi) agent="pi" ;;
        opencode) agent="opencode" ;;
        claude) agent="claude" ;;
        *) # 'auto' — prefer claude if available, fall back to pi, then opencode
          if command -v claude >/dev/null 2>&1; then
            agent="claude"
          elif command -v pi >/dev/null 2>&1; then
            agent="pi"
          elif command -v opencode >/dev/null 2>&1; then
            agent="opencode"
          fi ;;
      esac
    fi
  fi
  __ws_cached_agent="$agent"
  echo "$agent"
}

# ── helper: run the real binary then handle CD ──────────────────────
__workspace_run() {
  local bin="$1"  # "nemus" or "nem"
  shift
  if [ $# -eq 0 ]; then
    command "$bin"
    return $?
  fi
  local cmd="$1"
  shift

  local temp_file="$HOME/.workspace-last-created"
  local go_file="$HOME/.workspace-last-go"
  local resume_file="$HOME/.workspace-resume-session"
  local ai_prompt_file="$HOME/.workspace-ai-prompt"

  # Classify the command
  local is_create=false
  local is_go=false
  local is_ai=false
  case "$cmd" in
    create|c) is_create=true ;;
    # Deprecated flat aliases that create workspaces
    from-template|ft|from-suite|fs) is_create=true ;;
    # AI prompt creates workspaces via MCP tools, then hands off
    --) is_create=true; is_ai=true ;;
    list|l|go|sessions|ses) is_go=true ;;
  esac
  # Grouped commands: "nemus suite use" / "nemus template use" — check second arg
  if [ "$is_create" = false ]; then
    case "$cmd" in
      suite|template)
        local sub="${1:-}"
        if [ "$sub" = "use" ]; then
          is_create=true
        fi
        ;;
    esac
  fi

  # Detect --yes/-y (non-interactive mode): skip auto-launching the agent
  # after workspace creation so one-shot/scripted invocations don't hang
  # waiting on an interactive claude/pi/opencode session. Does not apply
  # to the AI-prompt path ("nemus -- <prompt>"), which is interactive-only.
  local skip_agent_launch=false
  if [ "$is_create" = true ] && [ "$is_ai" = false ]; then
    local arg
    for arg in "$@"; do
      case "$arg" in
        -y|--yes) skip_agent_launch=true ;;
      esac
    done
  fi

  # Remove stale temp files before running
  if [ "$is_create" = true ]; then
    [ -f "$temp_file" ] && rm -f "$temp_file"
    [ -f "$ai_prompt_file" ] && rm -f "$ai_prompt_file"
  fi
  if [ "$is_go" = true ]; then
    [ -f "$go_file" ] && rm -f "$go_file"
    [ -f "$resume_file" ] && rm -f "$resume_file"
  fi

  # Run the real binary
  command "$bin" "$cmd" "$@"
  local exit_code=$?

  # For go-like commands, always CD if the go file exists (even after
  # Ctrl+C in the fuzzy picker, which exits non-zero).
  if [ "$is_go" = true ] && [ -f "$go_file" ]; then
    local workspace_path
    workspace_path=$(cat "$go_file")
    rm -f "$go_file"
    if [ -d "$workspace_path" ]; then
      local ws_name
      ws_name="$(basename "$workspace_path")"
      echo ""
      echo "📁 Changing directory to: $workspace_path"
      cd "$workspace_path" || return 1
      __workspace_set_tab_title "$ws_name"
      local __ws_agent
      __ws_agent=$(__workspace_detect_agent)
      if command -v "$__ws_agent" >/dev/null 2>&1; then
        # Check for resume file and read session's agent type.
        # Resume file format: JSON { sessionId, agentType } (new) or plain sessionId (old).
        # Old format gracefully falls back to configured agent type.
        local resume_agent=""
        if [ -f "$resume_file" ]; then
          local resume_data
          resume_data=$(cat "$resume_file")
          rm -f "$resume_file"
          # Default to configured agent (ensures --continue for old-format files)
          resume_agent="$__ws_agent"
          # Extract agentType from JSON resume file
          local resume_agent_type
          resume_agent_type=$(RESUME_DATA="$resume_data" node -e '
            try {
              const d = JSON.parse(process.env.RESUME_DATA);
              console.log(d.agentType || "");
            } catch { console.log(""); }
          ' 2>/dev/null)
          # Override with session's agent type if available
          if [ "$resume_agent_type" = "pi" ] && command -v pi >/dev/null 2>&1; then
            resume_agent="pi"
          elif [ "$resume_agent_type" = "opencode" ] && command -v opencode >/dev/null 2>&1; then
            resume_agent="opencode"
          elif [ "$resume_agent_type" = "claude" ] && command -v claude >/dev/null 2>&1; then
            resume_agent="claude"
          fi
        fi

        # Launch agent: with resume if file existed, otherwise fresh session
        if [ -n "$resume_agent" ]; then
          if [ "$resume_agent" = "pi" ]; then
            pi --continue
          elif [ "$resume_agent" = "opencode" ]; then
            opencode --continue
          else
            claude --continue --name "$ws_name"
          fi
        else
          # No resume file - fresh session
          if [ "$__ws_agent" = "pi" ]; then
            pi
          elif [ "$__ws_agent" = "opencode" ]; then
            opencode
          else
            claude --name "$ws_name"
          fi
        fi
      fi
      # Re-apply tab title after agent exits
      __workspace_set_tab_title "$ws_name"
    fi
  fi

  # For create-like commands, only CD on success
  if [ $exit_code -eq 0 ] && [ "$is_create" = true ] && [ -f "$temp_file" ]; then
    local workspace_path
    workspace_path=$(cat "$temp_file")
    rm -f "$temp_file"
    if [ -d "$workspace_path" ]; then
      local ws_name
      ws_name="$(basename "$workspace_path")"
      echo ""
      echo "📁 Changing directory to: $workspace_path"
      cd "$workspace_path" || return 1
      __workspace_set_tab_title "$ws_name"
      local __ws_agent
      __ws_agent=$(__workspace_detect_agent)
      if [ "$skip_agent_launch" = true ]; then
        echo "🤖 Skipping agent auto-launch (--yes / non-interactive mode)"
      elif command -v "$__ws_agent" >/dev/null 2>&1; then
        if [ "$__ws_agent" = "claude" ]; then
          if [ "$is_ai" = true ] && [ -f "$ai_prompt_file" ]; then
            local original_prompt
            original_prompt=$(cat "$ai_prompt_file")
            rm -f "$ai_prompt_file"
            claude --name "$ws_name" "$original_prompt"
          else
            claude --name "$ws_name"
          fi
        elif [ "$__ws_agent" = "opencode" ]; then
          if [ "$is_ai" = true ] && [ -f "$ai_prompt_file" ]; then
            local original_prompt
            original_prompt=$(cat "$ai_prompt_file")
            rm -f "$ai_prompt_file"
            opencode run "$original_prompt"
          else
            opencode
          fi
        else
          if [ "$is_ai" = true ] && [ -f "$ai_prompt_file" ]; then
            local original_prompt
            original_prompt=$(cat "$ai_prompt_file")
            rm -f "$ai_prompt_file"
            # Interactive mode with initial prompt (positional arg)
            pi "$original_prompt"
          else
            pi
          fi
        fi
      fi
      # Re-apply tab title after agent exits
      __workspace_set_tab_title "$ws_name"
    fi
  fi

  # Clean up ai prompt file if it wasn't consumed (e.g. no workspace was created)
  [ -f "$ai_prompt_file" ] && rm -f "$ai_prompt_file"

  return $exit_code
}

# ── public wrappers ─────────────────────────────────────────────────
nemus() { __workspace_run nemus "$@"; }
nem()    { __workspace_run nem "$@"; }

# Quick navigation to workspace with fuzzy search
nemgo() {
  local temp_file="$HOME/.workspace-last-go"
  [ -f "$temp_file" ] && rm -f "$temp_file"

  command nemus go "$@"
  local exit_code=$?

  if [ -f "$temp_file" ]; then
    local workspace_path
    workspace_path=$(cat "$temp_file")
    rm -f "$temp_file"
    if [ -d "$workspace_path" ]; then
      local ws_name
      ws_name="$(basename "$workspace_path")"
      cd "$workspace_path" || return 1
      __workspace_set_tab_title "$ws_name"
      local __ws_agent
      __ws_agent=$(__workspace_detect_agent)
      if command -v "$__ws_agent" >/dev/null 2>&1; then
        if [ "$__ws_agent" = "claude" ]; then
          claude --name "$ws_name"
        elif [ "$__ws_agent" = "opencode" ]; then
          opencode
        else
          pi
        fi
      fi
      __workspace_set_tab_title "$ws_name"
    fi
  fi

  return $exit_code
}
EOF

# Determine RC file based on shell type
if [ "$SHELL_TYPE" = "bash" ]; then
  RC_FILE="$HOME/.bashrc"
elif [ "$SHELL_TYPE" = "zsh" ]; then
  RC_FILE="$HOME/.zshrc"
else
  echo "❌ Unsupported shell: $SHELL_TYPE"
  echo "Supported shells: bash, zsh"
  exit 1
fi

# Check if already installed (version marker is in the grep below)
if grep -q "Shell Integration (v49)" "$RC_FILE" 2>/dev/null; then
  echo "✅ Shell integration already up to date in $RC_FILE"
elif grep -q "# Nemus - Shell Integration" "$RC_FILE" 2>/dev/null; then
  # Old version installed — remove it and install new version
  echo "🔄 Upgrading shell integration in $RC_FILE..."
  TMPFILE=$(mktemp)
  awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$RC_FILE" > "$TMPFILE"
  # Append new shell integration to temp file so mv is atomic
  echo "" >> "$TMPFILE"
  echo "$SHELL_FUNCTION" >> "$TMPFILE"
  cp "$RC_FILE" "${RC_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
  chmod --reference="$RC_FILE" "$TMPFILE" 2>/dev/null || chmod "$(stat -f '%Lp' "$RC_FILE")" "$TMPFILE" 2>/dev/null || true
  mv "$TMPFILE" "$RC_FILE"

  echo "✅ Shell integration upgraded in $RC_FILE"
else
  # Backup RC file if it exists
  if [ -f "$RC_FILE" ]; then
    cp "$RC_FILE" "${RC_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    echo "📦 Backup created: ${RC_FILE}.backup.*"
  fi

  # Append shell function (creates the file if it doesn't exist)
  echo "" >> "$RC_FILE"
  echo "$SHELL_FUNCTION" >> "$RC_FILE"

  echo "✅ Shell integration installed in $RC_FILE"
  echo ""
  echo "To activate, run:"
  echo "  source $RC_FILE"
  echo ""
  echo "Or restart your terminal."
fi

echo ""
echo "After activation:"
echo "  • 'nemus create' / 'nemus list' will automatically CD to the workspace! 🚀"
echo "  • 'nemgo' command for quick navigation with fuzzy search! 🔍"
