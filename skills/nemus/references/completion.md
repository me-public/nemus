# Shell Completions

`nemus completion <shell>` prints a completion script for `bash`, `zsh`, or
`fish`. It completes subcommands and, for workspace-scoped commands, live
workspace names (the script calls back into `nemus completion --workspaces`, so
completions stay fresh without regenerating). Registered for both `nemus` and
`nem`.

Install (pick your shell):
```bash
# bash
nemus completion bash > /etc/bash_completion.d/nemus     # or: >> ~/.bashrc

# zsh — save on your $fpath as _nemus
nemus completion zsh > "${fpath[1]}/_nemus"

# fish
nemus completion fish > ~/.config/fish/completions/nemus.fish
```

Then restart the shell (or `source` the file). The shell argument is inferred
from `$SHELL` when omitted (`nemus completion`), so you usually don't need to
pass it; an explicit `bash|zsh|fish` always wins.

Completions cover second-level subcommands too — e.g. `nemus config <TAB>`
(get/set/…), `nemus config set <TAB>` (config keys), and `nemus reflect <TAB>`
(history/show).
