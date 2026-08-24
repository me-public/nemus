#!/usr/bin/env node
/**
 * Hook handler for Claude Code hooks.
 * Invoked via ~/.claude/settings.json hooks — reads JSON from stdin,
 * maps the event to an agent status, and writes to state file.
 *
 * Status model:
 *   idle    — agent is not working (new, finished, waiting for input)
 *   working — agent is actively processing (thinking, calling tools)
 *   waiting — agent needs user action (permission approval)
 *   stopped — session ended
 *
 * Event mapping:
 *   SessionStart      → idle     (session opened, not working yet)
 *   UserPromptSubmit  → working  (user sent prompt, agent starts)
 *   PreToolUse        → working  (agent calling a tool)
 *   PostToolUse       → working  (tool done, agent still processing)
 *   Notification:
 *     permission_prompt → waiting (needs user to approve tool use)
 *     idle_prompt       → idle    (agent finished, waiting for input)
 *   Stop              → idle     (agent finished its turn)
 *   SessionEnd        → stopped  (session ended)
 *
 * IMPORTANT: Must never write to stderr or throw — always exit 0.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentState, AgentStatus } from '../../types/dashboard';
import { readAgentState, writeAgentState, ensureStateDir } from '../../utils/agent-state';
import { WORKSPACES_DIR } from '../../utils/config';

function main() {
  try {
    const args = process.argv.slice(2);
    const eventIdx = args.indexOf('--event');
    const event = eventIdx >= 0 ? args[eventIdx + 1] : null;

    if (!event) {
      process.exit(0);
    }

    let input: any;
    try {
      const raw = fs.readFileSync('/dev/stdin', 'utf-8');
      input = JSON.parse(raw);
    } catch {
      process.exit(0);
    }

    const sessionId = input.session_id;
    if (!sessionId || !/^[a-zA-Z0-9\-]{1,100}$/.test(sessionId)) {
      process.exit(0); // reject missing or invalid session IDs
    }

    ensureStateDir();

    let newStatus: AgentStatus;
    switch (event) {
      case 'SessionStart':
        newStatus = 'idle';
        break;
      case 'UserPromptSubmit':
        newStatus = 'working';
        break;
      case 'PreToolUse':
        newStatus = 'working';
        break;
      case 'PostToolUse':
        newStatus = 'working';
        break;
      case 'Notification': {
        const notifType = input.notification_type || '';
        if (notifType === 'permission_prompt') {
          newStatus = 'waiting'; // needs user to approve
        } else if (notifType === 'idle_prompt') {
          newStatus = 'idle'; // just idle, not a special state
        } else {
          process.exit(0);
        }
        break;
      }
      case 'Stop':
        newStatus = 'idle';
        break;
      case 'SessionEnd':
        newStatus = 'stopped';
        break;
      default:
        process.exit(0);
    }

    const now = new Date().toISOString();

    const existing = readAgentState(sessionId);
    if (existing) {
      existing.status = newStatus;
      existing.lastUpdatedAt = now;
      // Always update PID — handles resumed sessions where the old
      // process is dead but session ID is reused with a new process
      existing.pid = process.ppid || existing.pid;
      writeAgentState(existing);
      process.exit(0);
    }

    // New session — infer workspace from cwd
    const cwd = input.cwd || process.cwd();
    let workspace = 'unknown';
    let workspacePath = cwd;

    const workspacesDir = WORKSPACES_DIR;
    if (cwd.startsWith(workspacesDir + path.sep) || cwd === workspacesDir) {
      const relative = cwd.slice(workspacesDir.length + 1);
      const parts = relative.split(path.sep);
      if (parts[0]) {
        workspace = parts[0];
        workspacePath = path.join(workspacesDir, workspace);
      }
    }

    const state: AgentState = {
      sessionId,
      workspace,
      workspacePath,
      pid: process.ppid || 0,
      status: newStatus,
      startedAt: now,
      lastUpdatedAt: now,
    };

    writeAgentState(state);
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
