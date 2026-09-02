#!/usr/bin/env ts-node

import { verifyGhAuth, fetchOrgRepos, displayAuthInstructions } from '../../utils/github';
import { promptRepositorySelection, promptWorkspaceSelection } from '../../utils/prompts';
import { listWorkspaces } from '../../utils/workspace-meta';
import { logInfo, logSuccess, logError, logStep } from '../../utils/logger';
import { colorize } from '../../utils/colors';
import { saveSuite, getSuite, validateSuiteName } from '../../utils/suite';
import { SuiteEntry, WorkspaceSuite, PostCloneHook } from '../../types';
import { confirm, input, select } from '../../utils/prompt';

async function promptSuiteDetails(defaultName?: string): Promise<{ name: string; description: string }> {
  const name = (await input({
    message: 'Suite name:',
    default: defaultName,
    validate: (input: string) => validateSuiteName(input.trim()),
  })).trim();

  const description = await input({
    message: 'Suite description (optional):',
  });

  return { name, description: description || '' };
}

async function promptPostCloneHooks(): Promise<PostCloneHook[] | undefined> {
  const addHooks = await confirm({
    message: 'Add post-clone hooks?',
    default: false,
  });

  if (!addHooks) return undefined;

  const commands: string[] = [];
  console.log('Enter commands one at a time. Type "done" when finished.\n');

  while (true) {
    const command = await input({
      message: `Command ${commands.length + 1} (or "done"):`,
    });

    if (command.trim().toLowerCase() === 'done') break;
    if (command.trim()) {
      commands.push(command.trim());
    }
  }

  if (commands.length === 0) return undefined;

  return [{
    commands,
    continueOnError: true,
  }];
}

async function checkOverwrite(name: string): Promise<boolean> {
  const existing = await getSuite(name);
  if (!existing) return true;

  const overwrite = await confirm({
    message: `Suite "${name}" already exists (${existing.entries.length} repos). Overwrite?`,
    default: false,
  });

  return overwrite;
}

async function createInteractive() {
  // Step 1: Verify gh CLI authentication
  logStep(1, 4, 'Verifying GitHub CLI authentication...');
  const isAuthenticated = await verifyGhAuth();

  if (!isAuthenticated) {
    logError('GitHub CLI is not authenticated');
    displayAuthInstructions();
    process.exit(1);
  }

  logSuccess('GitHub CLI authenticated');

  // Step 2: Fetch repos
  logStep(2, 4, 'Fetching repositories...');
  const forceRefresh = process.argv.includes('--force-refresh') || process.argv.includes('-f');
  const repos = await fetchOrgRepos({ forceRefresh });

  if (repos.length === 0) {
    logError('No repositories found');
    process.exit(1);
  }

  // Step 3: Select repositories
  logStep(3, 4, 'Select repositories for the suite...');
  const selections = await promptRepositorySelection(repos);

  const entries: SuiteEntry[] = selections.map(s => ({
    repoName: s.repo.name,
    directoryName: s.directoryName,
  }));

  // Step 4: Name and save
  logStep(4, 5, 'Enter suite details...');
  const { name, description } = await promptSuiteDetails();

  if (!(await checkOverwrite(name))) {
    logInfo('Suite creation cancelled');
    process.exit(0);
  }

  // Step 5: Optional hooks
  logStep(5, 5, 'Post-clone hooks (optional)...');
  const postCloneHooks = await promptPostCloneHooks();

  const existing = await getSuite(name);
  const now = new Date().toISOString();
  const suite: WorkspaceSuite = {
    name,
    description,
    entries,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    ...(postCloneHooks && { postCloneHooks }),
  };

  await saveSuite(suite);
  logSuccess(`Suite "${colorize(name, 'cyan')}" created with ${entries.length} repositories`);
}

async function createFromWorkspace() {
  // Step 1: Select workspace
  logStep(1, 3, 'Select a workspace...');
  const workspaces = await listWorkspaces();

  if (workspaces.length === 0) {
    logError('No workspaces found. Create one first with: workspace create');
    process.exit(1);
  }

  const workspaceName = await promptWorkspaceSelection(workspaces);
  const workspace = workspaces.find(ws => ws.name === workspaceName);

  if (!workspace?.metadata) {
    logError('No metadata found for this workspace');
    process.exit(1);
  }

  const entries: SuiteEntry[] = workspace.metadata.repositories
    .filter(r => r.status === 'success')
    .map(r => ({
      repoName: r.name,
      directoryName: r.directoryName,
    }));

  console.log(`\n${colorize('Repositories from workspace:', 'cyan')} ${entries.length}`);
  for (const e of entries) {
    const alias = e.directoryName !== e.repoName ? ` (${e.repoName})` : '';
    console.log(`  - ${e.directoryName}${alias}`);
  }
  console.log('');

  // Step 2: Name and save
  logStep(2, 4, 'Enter suite details...');
  const { name, description } = await promptSuiteDetails(workspaceName);

  if (!(await checkOverwrite(name))) {
    logInfo('Suite creation cancelled');
    process.exit(0);
  }

  // Step 3: Optional hooks
  logStep(3, 4, 'Post-clone hooks (optional)...');
  const postCloneHooks = await promptPostCloneHooks();

  const existing = await getSuite(name);
  const now = new Date().toISOString();
  const suite: WorkspaceSuite = {
    name,
    description,
    entries,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    ...(postCloneHooks && { postCloneHooks }),
  };

  // Step 4: Save
  logStep(4, 4, 'Saving suite...');
  await saveSuite(suite);
  logSuccess(`Suite "${colorize(name, 'cyan')}" created with ${entries.length} repositories`);
}

export async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Create Suite', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    const mode = await select({
      message: 'How would you like to create the suite?',
      choices: [
        { name: 'Pick repositories interactively', value: 'interactive' },
        { name: 'Save from an existing workspace', value: 'workspace' },
      ],
    });

    if (mode === 'interactive') {
      await createInteractive();
    } else {
      await createFromWorkspace();
    }
  } catch (error) {
    logError('Failed to create suite');
    if (error instanceof Error) {
      logError(error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
