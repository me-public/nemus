#!/bin/bash

# Nemus - Uninstall Script

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "============================================================"
echo -e "${CYAN}Nemus - Uninstall${NC}"
echo "============================================================"
echo ""

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

# Confirm uninstall
echo -e "${YELLOW}This will remove:${NC}"
echo "  • Global nemus/nem command"
echo "  • npm link"
echo ""
echo -e "${YELLOW}This will NOT remove:${NC}"
echo "  • Your workspaces ($HOME/workspaces/)"
echo "  • Cache files (~/.workspace-manager-cache/)"
echo "  • Configuration files (~/.workspace-manager-claude-config.json)"
echo "  • Shell integration (from .zshrc or .bashrc and ~/.nemus/)"
echo "  • ghq (if installed)"
echo ""

read -p "Continue with uninstall? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Remove permission sync hook from Claude Code settings
PERM_SYNC_JS="$SCRIPT_DIR/dist/utils/permission-sync.js"
if [ -f "$PERM_SYNC_JS" ]; then
    print_info "Removing Claude Code permission sync hook..."
    node -e "require('$PERM_SYNC_JS').uninstallPermissionSyncHook()" 2>/dev/null && \
        print_success "Permission sync hook removed" || \
        print_warning "Could not remove permission sync hook (non-critical)"
    print_info "Removing permission review skill and reminder hook..."
    node -e "require('$PERM_SYNC_JS').uninstallReviewSkillAndReminder()" 2>/dev/null && \
        print_success "Permission review skill and reminder hook removed" || \
        print_warning "Could not remove permission review skill (non-critical)"
    print_info "Removing Nemus skills..."
    node -e "require('$PERM_SYNC_JS').uninstallWorkspaceSkills()" 2>/dev/null && \
        print_success "Nemus skills removed" || \
        print_warning "Could not remove Nemus skills (non-critical)"
fi

# Unlink global command
print_info "Removing global command..."
cd "$SCRIPT_DIR"
npm unlink || true
print_success "Global command removed"

# Optionally clean up shell integration
echo ""
read -p "Remove shell integration from .zshrc/.bashrc? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Remove from .zshrc
    if [ -f "$HOME/.zshrc" ]; then
        if grep -q "# Nemus - Shell Integration" "$HOME/.zshrc"; then
            # Create backup
            cp "$HOME/.zshrc" "$HOME/.zshrc.backup.$(date +%Y%m%d_%H%M%S)"
            TMPFILE=$(mktemp)
            awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$HOME/.zshrc" > "$TMPFILE"
            chmod --reference="$HOME/.zshrc" "$TMPFILE" 2>/dev/null || chmod "$(stat -f '%Lp' "$HOME/.zshrc")" "$TMPFILE" 2>/dev/null || true
            mv "$TMPFILE" "$HOME/.zshrc"
            print_success "Removed from .zshrc (backup created)"
        fi
    fi

    # Remove from .bashrc
    if [ -f "$HOME/.bashrc" ]; then
        if grep -q "# Nemus - Shell Integration" "$HOME/.bashrc"; then
            # Create backup
            cp "$HOME/.bashrc" "$HOME/.bashrc.backup.$(date +%Y%m%d_%H%M%S)"
            TMPFILE=$(mktemp)
            awk -f "$SCRIPT_DIR/remove-shell-block.awk" "$HOME/.bashrc" > "$TMPFILE"
            chmod --reference="$HOME/.bashrc" "$TMPFILE" 2>/dev/null || chmod "$(stat -f '%Lp' "$HOME/.bashrc")" "$TMPFILE" 2>/dev/null || true
            mv "$TMPFILE" "$HOME/.bashrc"
            print_success "Removed from .bashrc (backup created)"
        fi
    fi

    if [ -f "$HOME/.nemus/shell-integration.sh" ]; then
        rm -f "$HOME/.nemus/shell-integration.sh"
        print_success "Removed ~/.nemus/shell-integration.sh"
    fi
fi

# Optionally remove cache
echo ""
read -p "Remove cache files? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$HOME/.workspace-manager-cache"
    print_success "Cache removed"
fi

# Optionally remove config
echo ""
read -p "Remove configuration files? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -f "$HOME/.workspace-manager-claude-config.json"
    rm -f "$HOME/.workspace-templates.json"
    rm -f "$HOME/.workspace-last-created"
    print_success "Configuration files removed"
fi

# Ask about workspaces
echo ""
echo -e "${YELLOW}Your workspaces are still at:${NC}"
echo "  $HOME/workspaces/"
echo ""
read -p "Remove ALL workspaces? (THIS CANNOT BE UNDONE) (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Are you ABSOLUTELY sure? Type 'DELETE' to confirm: " CONFIRM
    if [ "$CONFIRM" = "DELETE" ]; then
        rm -rf $HOME/workspaces
        print_success "All workspaces removed"
    else
        print_info "Workspace removal cancelled (keeping workspaces)"
    fi
else
    print_info "Keeping workspaces"
fi

echo ""
echo "============================================================"
echo -e "${GREEN}Uninstall Complete${NC}"
echo "============================================================"
echo ""

echo "What was removed:"
print_success "Global nemus/nem command unlinked"
echo ""

echo "To completely remove the source code:"
echo "  rm -rf $SCRIPT_DIR"
echo ""

echo "To reinstall:"
echo "  cd $SCRIPT_DIR"
echo "  ./install.sh"
echo ""
