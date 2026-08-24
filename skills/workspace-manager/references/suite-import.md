# Suite Import

Import suites from a JSON file (exported by `nemus suite export`).

## Instructions

1. Run:
   ```bash
   nemus suite import <file-path>
   ```

2. Existing suites with the same name will be skipped by default.

3. After import, verify with `nemus suite list`.

## Success Criteria

- Suites from the file are imported.
- Imported suites appear in `nemus suite list`.
