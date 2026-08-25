# Workspace Cleanup

```bash
nemus cleanup <workspace> --all --yes
```

Or specify what to clean:
```bash
nemus cleanup <workspace> --node-modules --yes
nemus cleanup <workspace> --build --yes
nemus cleanup <workspace> --git-clean --yes
```

## Flags

| Flag | Description |
|---|---|
| `--all` | Remove everything (node_modules + build artifacts + git clean) |
| `--node-modules` | Remove `node_modules` directories |
| `--build` | Remove `dist`, `build`, `.next`, `coverage`, `out` |
| `--git-clean` | Remove untracked files via git clean |
| `--yes` / `-y` | Skip confirmation prompt |

Remind the user they'll need to run `npm install` before building again.
