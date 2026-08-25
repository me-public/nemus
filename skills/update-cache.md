---
name: update-cache
description: Force refresh the GitHub repository cache
---

```bash
nemus cache refresh
```

This fetches the latest list of repositories from the GitHub org and updates the local cache.

- When `nemus cache search` doesn't find a recently created repo
- Periodically to keep the cache fresh (auto-refreshes daily)
