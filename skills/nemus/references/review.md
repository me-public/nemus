# review

AI code review of the uncommitted changes across a whole workspace, using the
user's **own** configured agent + model (Claude / pi / opencode …) — local-first,
no external service. Findings come back grouped by severity with file/line, a
rationale, and a suggested fix.

## CLI

```bash
nemus review [workspace] [options]
```

- `[workspace]` — workspace name; omitted, resolves the current/default one.
- `--only <repos>` — comma-separated subset of repos to review.
- `--staged` — review only staged changes (`git diff --cached`).
- `--base <ref>` — review committed changes on the current branch vs `<ref>`
  (three-dot, e.g. `--base main`) — good for a pre-PR review of a whole branch.
- `--severity <level>` — minimum severity to report (`critical|high|medium|low|nit`).
- `--model <model>` / `--thinking <level>` — passed to the agent.
- `--json` — machine-readable findings.
- `--dry-run` — print the exact prompt that would be sent, without calling the agent.

## Behavior

- Diffs each repo (working tree vs `HEAD` by default), skips clean repos, and
  sends **one** prompt covering all changed repos to the configured agent.
- Per-repo diffs are truncated to a budget so a huge change can't blow context.
- The agent returns structured findings `{repo, file, line, severity, title,
  detail, suggestion}`; the reply is normalized/validated before display.
- Env overrides: `NEMUS_JUDGE_MODEL`, `NEMUS_JUDGE_THINKING`,
  `NEMUS_JUDGE_TIMEOUT_MS`.

## Notes

- Reviews committed state (tracked changes); untracked files aren't included.
- Nothing is sent anywhere except through the user's own agent CLI.
- Not a gate/CI tool — it's an on-demand assistant. Use `--json` to script on it.
