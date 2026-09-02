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

Then restart the shell (or `source` the file). Requires a shell argument —
one of `bash|zsh|fish`.
