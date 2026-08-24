/**
 * Shared utilities for CONTEXT.md file formatting.
 * Used by both the CLI (save-context command) and MCP tool (handleSaveContext).
 */

/**
 * Format a fresh CONTEXT.md file with header and body.
 */
export function formatContextFile(workspaceName: string, body: string, timestamp?: string): string {
  const ts = timestamp || new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  return `# Workspace Context: ${workspaceName}

> This file contains saved progress and context for AI agents.
> It persists across \`/clear\` and session restarts.
> Last updated: ${ts}

${body}
`;
}

/**
 * Append content to an existing CONTEXT.md, adding a timestamped separator.
 * If the existing file can't be read, returns a fresh formatted file.
 */
export function appendToContextFile(
  existingContent: string | null,
  workspaceName: string,
  newContent: string,
  timestamp?: string
): string {
  const ts = timestamp || new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
  if (existingContent) {
    return existingContent.trimEnd() + `\n\n---\n\n### Update (${ts})\n\n${newContent}`;
  }
  return formatContextFile(workspaceName, newContent, ts);
}
