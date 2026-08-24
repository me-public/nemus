# Suite Import

Import suites from a JSON file (exported by `grove suite export`).

## Instructions

1. Run:
   ```bash
   grove suite import <file-path>
   ```

2. Existing suites with the same name will be skipped by default.

3. After import, verify with `grove suite list`.

## Success Criteria

- Suites from the file are imported.
- Imported suites appear in `grove suite list`.
