import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Vitest's 5s default is tuned for pure unit tests. Much of this suite shells
    // out (the infra/docker/*.test.sh wrappers, CLI smoke tests) or does real
    // filesystem work, and those durations scale with how loaded the machine is —
    // not with correctness. On the default they failed INTERMITTENTLY as the suite
    // grew: 15 failures, then 1, then 0 across three consecutive local runs, all
    // timeouts at 8-13s rather than assertion failures. A random red CI is worse
    // than a slow one, and per-test annotations get forgotten by the next test.
    // A genuine hang still fails here, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
