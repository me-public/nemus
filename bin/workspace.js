#!/usr/bin/env node

const path = require('path');
const command = process.argv[2];

// Handle --version / -V directly (works without compiled dist/)
if (command === '--version' || command === '-V') {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  console.log(pkg.version);
  process.exit(0);
}

// Pre-check: if dist/ doesn't exist, show fallback help and exit.
// If dist/ exists, the module is cached and the else block below handles execution.
if (!command || command === '--help' || command === '-h' || command === 'help') {
  try {
    require(path.join(__dirname, '..', 'dist', 'program.js'));
  } catch {
    // Fallback: dist/ not built yet (e.g., CI test step runs before build)
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    console.log(`Grove v${pkg.version} · multi-repo workspaces`);
    console.log(`Use "npm run build" then "grove --help" for full command reference.`);
    process.exit(0);
  }
}

// Best-effort version upgrade check (non-blocking)
try {
  const { checkForUpdate } = require(path.join(__dirname, '..', 'dist', 'utils', 'version-check.js'));
  checkForUpdate().then((msg) => { if (msg) process.stderr.write(msg + '\n'); }).catch(() => {});
} catch {}

// Best-effort self-heal: repair Claude Code hook paths that point to a stale
// install location (e.g. Volta's ephemeral postinstall temp dir). Runs from the
// package's stable location so re-resolved paths are correct. Silent + cheap.
try {
  const { repairStaleHooks } = require(path.join(__dirname, '..', 'dist', 'utils', 'permission-sync.js'));
  const fixed = repairStaleHooks();
  if (fixed > 0) {
    process.stderr.write(`[grove] Repaired ${fixed} stale Claude Code hook path(s).\n`);
  }
} catch {}

// Shared handler: capture the error for `w report-bug`, optionally auto-file it.
// Build a privacy-safe command string for the bug report. The AI prompt in
// `w -- <prompt>` can contain private/sensitive text, so never publish it.
function redactCommand(command) {
  const argv = Array.isArray(command) ? command : [String(command || '')];
  if (argv[0] === '--') return '-- <prompt omitted for privacy>';
  // No `--`, but `-p/--prompt <text>` (create/iterate) also carries a private
  // task/prompt — redact its value too so it never lands in a bug report.
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-p' || a === '--prompt') {
      out.push(a, '<omitted>');
      i++; // skip the value
    } else if (a.startsWith('--prompt=')) {
      out.push('--prompt=<omitted>');
    } else if (a.startsWith('-p=')) {
      out.push('-p=<omitted>');
    } else {
      out.push(a);
    }
  }
  return out.join(' ');
}

function handleFatalError(err, command) {
  const msg = (err && (err.message || String(err))) || 'Unknown error';
  console.error(msg);
  try {
    const { captureLastError, reportBug } = require(path.join(__dirname, '..', 'dist', 'utils', 'bug-report.js'));
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    const captured = {
      command: 'w ' + redactCommand(command),
      message: msg,
      stack: err && err.stack ? String(err.stack) : undefined,
      timestamp: new Date().toISOString(),
      version: pkg.version,
    };
    captureLastError(captured);

    let autoReport = false;
    try {
      const { getUserConfig } = require(path.join(__dirname, '..', 'dist', 'utils', 'config.js'));
      autoReport = getUserConfig().autoReportBugs === true;
    } catch {}

    if (autoReport) {
      const result = reportBug(captured, pkg.version);
      if (result.status === 'created') {
        console.error('\n[grove] Filed bug report: ' + result.url);
      } else if (result.status === 'duplicate') {
        console.error('\n[grove] Known issue: ' + result.url);
      } else {
        // skipped (e.g. environmental) or failed (e.g. gh not authed) —
        // surface the specific reason instead of a generic hint.
        if (result.reason) console.error('\n[grove] Not filed: ' + result.reason);
        const retry = result.status === 'skipped'
          ? 'Run "w report-bug --force" to file it anyway.'
          : 'Run "w report-bug" to try again.';
        console.error('[grove] ' + retry);
      }
    } else {
      console.error('\n[grove] Run "w report-bug" to file this as a GitHub issue.');
    }
  } catch {
    // bug-report machinery is best-effort; never mask the original error
  }
  process.exit(1);
}

// Intercept `w -- <prompt>` before Commander (Commander treats -- as end-of-options)
if (command === '--') {
  try {
    const { handleAiPrompt } = require(path.join(__dirname, '..', 'dist', 'commands', 'ai-prompt.js'));
    handleAiPrompt(process.argv.slice(3).join(' ')).catch((err) => {
      handleFatalError(err, process.argv.slice(2));
    });
  } catch {
    console.error('Run "npm run build" first to use the AI prompt feature.');
    process.exit(1);
  }
} else {
  const { program } = require(path.join(__dirname, '..', 'dist', 'program.js'));
  program.parseAsync(process.argv).catch((err) => {
    handleFatalError(err, process.argv.slice(2));
  });
}
