---
name: config
description: Read and write Nemus configuration non-interactively (get/set/unset/list/path/edit)
---

Non-interactive configuration in `~/.nemus/config.json` (no wizard):
```bash
nemus config list                 # all keys + resolved values (alias: ls; --json)
nemus config get <key>            # print one value (--json)
nemus config set <key> <value>    # set + validate + persist
nemus config unset <key>          # revert a key to its default
nemus config path                 # print the config file path
```

- Values are validated/coerced per key: booleans accept `true/false/yes/no/on/off/1/0`; enums (e.g. `cloneProtocol=ssh|https`) are checked. Invalid key/value exits non-zero.
- Common keys: `workspacesDir`, `githubOrg`, `cloneProtocol`, `aiAgent`, `primaryAgent`. Run `nemus config list` to see all.
- For a guided first-time setup, use `nemus configure` instead.
