#!/usr/bin/env node
/**
 * Dashboard sidebar entry point.
 *
 * This is a plain .js file (not .ts) to preserve the real dynamic import().
 * TypeScript compiles `await import('ink')` into `require('ink')` in CJS mode,
 * which fails because ink v7 is ESM-only with top-level await.
 *
 * By keeping this as .js, tsc copies it as-is to dist/ and the real
 * import() call is preserved at runtime.
 */

async function main() {
  try {
    const React = require('react');
    const path = require('path');

    // Real dynamic ESM import — NOT compiled by tsc
    const { render, Box, Text, useInput, useApp } = await import('ink');

    // CJS require for our compiled TSX components
    const { DashboardSidebar } = require(path.join(__dirname, '..', '..', 'cli', 'dashboard'));

    const App = () => React.createElement(DashboardSidebar, {
      Box,
      Text,
      useInput,
      useApp,
    });

    render(React.createElement(App), { exitOnCtrlC: false });
  } catch (error) {
    console.error('Dashboard sidebar failed to start:', error.message);
    // Keep the pane alive so user can see the error
    await new Promise(() => {});
  }
}

main();
