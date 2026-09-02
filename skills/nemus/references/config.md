# Config — non-interactive configuration

`nemus config` reads and writes `~/.nemus/config.json` without the interactive
`nemus configure` wizard. Ideal for scripting and for setting one value.

```bash
nemus config list                 # show all keys + resolved values (alias: ls)
nemus config list --json          # machine-readable
nemus config get <key>            # print one value (--json for structured)
nemus config set <key> <value>    # set + validate + persist
nemus config unset <key>          # remove a key (revert to default)
nemus config path                 # print the config file path
nemus config edit                 # open the file in $VISUAL/$EDITOR (needs a TTY)
```

Values are validated and coerced per key: booleans accept
`true/false/yes/no/on/off/1/0`; enums (e.g. `cloneProtocol` = `ssh|https`) are
checked. An unknown key or invalid value exits non-zero with a clear message.

Common keys: `workspacesDir`, `githubOrg`, `cloneProtocol`, `aiAgent`,
`primaryAgent`, `autoLaunchClaude`, `generateClaudeContext`, `installMcp`.
Run `nemus config list` to see them all.

```bash
# examples
nemus config set githubOrg acme
nemus config set cloneProtocol https
nemus config get workspacesDir --json
```

Pairs well with `--quiet` for scripts. For a guided first-time setup, use
`nemus configure` instead.
