#!/bin/bash

# Grove - Installation Script
# This script installs Grove and optionally installs ghq

set -e

# Detect if running via npm postinstall
NPM_INSTALL_MODE=${NPM_INSTALL_MODE:-false}
if [ -n "$npm_config_global" ] || [ -n "$npm_execpath" ]; then
    NPM_INSTALL_MODE=true
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$NPM_INSTALL_MODE" = false ]; then
    echo ""
    echo "============================================================"
    echo -e "${CYAN}Grove - Installation${NC}"
    echo "============================================================"
    echo ""
fi

# Function to print colored messages
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check prerequisites
echo "Checking prerequisites..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    echo "Please install Node.js 22+ from: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    print_error "Node.js 22+ required, but found $(node --version)"
    echo "Please upgrade Node.js: https://nodejs.org/"
    echo ""
    echo "Current version: $(node --version)"
    echo "Required version: v22.0.0 or higher"
    exit 1
fi
print_success "Node.js $(node --version) found"

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed"
    echo "Please install npm"
    exit 1
fi
print_success "npm $(npm --version) found"

# Check git
if ! command -v git &> /dev/null; then
    print_error "Git is not installed"
    echo "Please install Git"
    exit 1
fi
print_success "Git $(git --version | cut -d' ' -f3) found"

# Check gh CLI
if ! command -v gh &> /dev/null; then
    print_warning "GitHub CLI (gh) is not installed"
    echo ""
    echo "Grove requires GitHub CLI to fetch repositories."
    echo ""
    read -p "Install GitHub CLI now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [[ "$OS" == "Darwin" ]]; then
            if command -v brew &> /dev/null; then
                print_info "Installing GitHub CLI via Homebrew..."
                brew install gh
                print_success "GitHub CLI installed"
            else
                print_error "Homebrew not found. Please install from: https://brew.sh/"
                exit 1
            fi
        elif [[ "$OS" == "Linux" ]]; then
            print_info "Installing GitHub CLI..."
            type -p curl >/dev/null || (sudo apt update && sudo apt install curl -y)
            curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
            && sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
            && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
            && sudo apt update \
            && sudo apt install gh -y
            print_success "GitHub CLI installed"
        else
            print_error "Unsupported OS for automatic installation"
            echo "Please install GitHub CLI manually: https://cli.github.com/"
            exit 1
        fi
    else
        print_warning "Skipping GitHub CLI installation"
        echo "You'll need to install it manually before using Grove."
    fi
else
    print_success "GitHub CLI $(gh --version | head -1 | cut -d' ' -f3) found"
fi

echo ""
echo "============================================================"
echo "Installing Grove"
echo "============================================================"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
print_info "Installing from: $SCRIPT_DIR"

# Install npm dependencies (skip if already running via npm install)
if [ "$NPM_INSTALL_MODE" = false ]; then
    print_info "Installing dependencies..."
    cd "$SCRIPT_DIR"
    npm install

    # Build TypeScript
    print_info "Building TypeScript files..."
    npm run build

    # Create global link
    print_info "Creating global command..."
    npm link

    print_success "Grove installed!"
else
    print_info "Installing via npm - dependencies already handled"
    cd "$SCRIPT_DIR"
fi

echo ""
echo "============================================================"
echo "Optional: Install ghq (Recommended)"
echo "============================================================"
echo ""
echo "ghq provides 10-15x faster workspace creation for repeated repos."
echo ""

# Check if ghq is already installed
if command -v ghq &> /dev/null; then
    print_success "ghq is already installed ($(ghq --version))"
    GHQ_INSTALLED=true
else
    read -p "Install ghq for faster workspace creation? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [[ "$OS" == "Darwin" ]]; then
            if command -v brew &> /dev/null; then
                print_info "Installing ghq via Homebrew..."
                brew install ghq
                print_success "ghq installed"
                GHQ_INSTALLED=true
            else
                print_error "Homebrew not found"
                echo "Install manually: brew install ghq"
                GHQ_INSTALLED=false
            fi
        elif [[ "$OS" == "Linux" ]]; then
            if command -v go &> /dev/null; then
                print_info "Installing ghq via go..."
                go install github.com/x-motemen/ghq@latest
                print_success "ghq installed"
                GHQ_INSTALLED=true
            else
                print_error "Go not found"
                echo "Install Go first, then: go install github.com/x-motemen/ghq@latest"
                GHQ_INSTALLED=false
            fi
        else
            print_warning "Unsupported OS for automatic ghq installation"
            GHQ_INSTALLED=false
        fi
    else
        print_info "Skipping ghq installation"
        echo "You can install it later with: brew install ghq (macOS)"
        GHQ_INSTALLED=false
    fi
fi

echo ""
echo "============================================================"
echo "Optional: Shell Integration (Auto-CD)"
echo "============================================================"
echo ""
echo "Shell integration allows automatic CD to workspace after creation."
echo ""

read -p "Install shell integration? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    bash "$SCRIPT_DIR/install-shell-integration.sh"
    SHELL_INTEGRATION=true
else
    print_info "Skipping shell integration"
    echo "You can install it later with: ./install-shell-integration.sh"
    SHELL_INTEGRATION=false
fi

echo ""
echo "============================================================"
echo "Workspace Directory Setup"
echo "============================================================"
echo ""

# Determine workspace directory
DEFAULT_WORKSPACE_DIR="$HOME/workspaces"
CURRENT_WORKSPACE_DIR="${WORKSPACE_MANAGER_DIR:-$DEFAULT_WORKSPACE_DIR}"

echo "Workspaces will be created in: $CURRENT_WORKSPACE_DIR"
echo ""
read -p "Use this directory? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Enter workspace directory path (e.g., $HOME/Work/workspaces):"
    read -r CUSTOM_WORKSPACE_DIR
    if [ -n "$CUSTOM_WORKSPACE_DIR" ]; then
        CURRENT_WORKSPACE_DIR="$CUSTOM_WORKSPACE_DIR"

        # Add to shell config
        SHELL_RC=""
        if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "/bin/zsh" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -n "$BASH_VERSION" ] || [ "$SHELL" = "/bin/bash" ]; then
            SHELL_RC="$HOME/.bashrc"
        fi

        if [ -n "$SHELL_RC" ]; then
            if ! grep -q "WORKSPACE_MANAGER_DIR" "$SHELL_RC" 2>/dev/null; then
                echo "" >> "$SHELL_RC"
                echo "# Grove configuration" >> "$SHELL_RC"
                echo "export WORKSPACE_MANAGER_DIR=\"$CURRENT_WORKSPACE_DIR\"" >> "$SHELL_RC"
                print_success "Added WORKSPACE_MANAGER_DIR to $SHELL_RC"
            else
                print_info "WORKSPACE_MANAGER_DIR already set in $SHELL_RC"
            fi
        fi
    fi
fi

# Create workspaces directory
mkdir -p "$CURRENT_WORKSPACE_DIR"
print_success "Workspace directory ready at $CURRENT_WORKSPACE_DIR"
echo ""

echo ""
echo "============================================================"
echo "Authentication Setup"
echo "============================================================"
echo ""

# Check gh auth status
if gh auth status &> /dev/null; then
    print_success "GitHub CLI is authenticated"
else
    print_warning "GitHub CLI is not authenticated"
    echo ""
    read -p "Authenticate with GitHub now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        gh auth login
    else
        print_info "You can authenticate later with: gh auth login"
    fi
fi

echo ""
echo "============================================================"
echo "AI Agent Integration"
echo "============================================================"
echo ""

MCP_INSTALL_JS="$SCRIPT_DIR/dist/mcp/install.js"
HAS_CLAUDE=false
HAS_PI=false

if command -v claude &> /dev/null; then
    HAS_CLAUDE=true
    print_success "Claude Code CLI detected"
fi

if command -v pi &> /dev/null; then
    HAS_PI=true
    print_success "Pi CLI detected"
fi

if [ "$HAS_CLAUDE" = true ] || [ "$HAS_PI" = true ]; then
    if [ -f "$MCP_INSTALL_JS" ]; then
        print_info "Registering MCP server, hooks, skills, and extensions..."
        node "$MCP_INSTALL_JS" install 2>/dev/null && \
            print_success "MCP server, hooks, skills, extensions, and .mcp.json backfill installed" || \
            print_warning "Install had issues (run 'grove mcp install' manually)"
    else
        print_warning "Build not found — run 'npm run build' then 'grove mcp install'"
    fi
else
    print_info "No AI agent CLI found — skipping integration"
    echo "  Install Claude Code or Pi and run: grove mcp install"
    # Still backfill .mcp.json for existing workspaces (doesn't require agent CLI)
    BACKFILL_JS="$SCRIPT_DIR/dist/mcp/install.js"
    if [ -f "$BACKFILL_JS" ]; then
        node -e "
          const { generateMcpConfig } = require('$SCRIPT_DIR/dist/utils/claude-integration.js');
          const { listWorkspaces } = require('$SCRIPT_DIR/dist/utils/workspace-meta.js');
          const { getUserConfig } = require('$SCRIPT_DIR/dist/utils/config.js');
          if (!getUserConfig().installMcp) process.exit(0);
          listWorkspaces(false).then(async (ws) => {
            let n = 0;
            for (const w of ws) { if (await generateMcpConfig(w.path)) n++; }
            if (n > 0) console.log('  Updated .mcp.json in ' + n + ' workspace(s)');
          }).catch(() => {});
        " 2>/dev/null || true
    fi
fi

echo ""
echo "============================================================"
echo -e "${GREEN}Installation Complete!${NC}"
echo "============================================================"
echo ""

# Summary
echo "Summary:"
echo ""
print_success "Grove installed"
if command -v gh &> /dev/null; then
    print_success "GitHub CLI available"
else
    print_warning "GitHub CLI not installed"
fi
if [ "$GHQ_INSTALLED" = true ]; then
    print_success "ghq installed (10-15x faster workspaces!)"
else
    print_warning "ghq not installed (install with: brew install ghq)"
fi
if [ "$SHELL_INTEGRATION" = true ]; then
    print_success "Shell integration installed"
else
    print_warning "Shell integration not installed"
fi

echo ""
echo "Available Commands:"
echo "  ${CYAN}grove create${NC}              Create a new workspace"
echo "  ${CYAN}grove list${NC}                List existing workspaces"
echo "  ${CYAN}grove update${NC}              Add repos to workspace"
echo "  ${CYAN}grove delete${NC}              Delete a workspace"
echo "  ${CYAN}grove sync${NC}                Git pull all repos"
echo "  ${CYAN}grove switch-branch${NC}       Bulk branch switching"
echo "  ${CYAN}grove save-template${NC}       Save workspace as template"
echo "  ${CYAN}grove from-template${NC}       Create from template"
echo "  ${CYAN}grove cache${NC}               Manage cache"
echo "  ${CYAN}grove configure-claude${NC}    Configure Claude integration"
echo "  ${CYAN}grove ghq-status${NC}          Check ghq status"
echo "  ${CYAN}grove help${NC}                Show help"
echo ""

if [ "$SHELL_INTEGRATION" = true ]; then
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Restart your terminal (or run: source ~/.zshrc)"
    echo "  2. Run: ${CYAN}grove create${NC}"
    echo "  3. Select repositories and create your first workspace!"
else
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Run: ${CYAN}grove create${NC}"
    echo "  2. Select repositories and create your first workspace!"
fi

echo ""
echo "Documentation: ${SCRIPT_DIR}/README.md"
echo ""
echo "Happy coding! 🚀"
echo ""
