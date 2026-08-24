import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WORKSPACES_DIR } from '../utils/config';
import { loadMetadata, saveMetadata } from '../utils/workspace-meta';
import { generateClaudeContext } from '../utils/claude-integration';
import { logInfo, logSuccess, logError, logStep } from '../utils/logger';
import { colorize } from '../utils/colors';
import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
import * as fuzzy from 'fuzzy';
import { getGlobalOpts, resolveWorkspace, parseList } from '../utils/command-helpers';

inquirer.registerPrompt('autocomplete', autocompletePrompt);

export function registerRemoveRepoCommand(parent: Command) {
  parent
    .command('remove-repo')
    .alias('rr')
    .description('Remove a repo from a workspace')
    .option('-w, --workspace <name>', 'Workspace name')
    .option('-r, --repos <repos>', 'Comma-separated repository directory names')
    .action(async (opts, cmd) => {
      const globalOpts = getGlobalOpts(cmd);
      await handleRemoveRepo({ ...opts, ...globalOpts });
    });
}

async function handleRemoveRepo(opts: {
  workspace?: string;
  repos?: string;
  yes: boolean;
  forceRefresh: boolean;
}) {
  console.log('\n' + '='.repeat(60));
  console.log(colorize('Remove Repository Instances', 'bright'));
  console.log('='.repeat(60) + '\n');

  try {
    logStep(1, 4, 'Select workspace...');
    const workspaceName = await resolveWorkspace(opts.workspace);
    const workspacePath = path.join(WORKSPACES_DIR, workspaceName);
    logInfo(`Selected workspace: ${colorize(workspaceName, 'cyan')}`);

    logStep(2, 4, 'Loading repository instances...');
    const metadata = await loadMetadata(workspacePath);
    const successRepos = metadata?.repositories.filter(r => r.status === 'success') ?? [];

    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    const diskDirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    const metaDirNames = new Set(successRepos.map(r => r.directoryName));
    const repoEntries: Array<{ displayName: string; dirName: string }> = [];

    for (const repo of successRepos) {
      repoEntries.push({
        displayName: repo.directoryName !== repo.name
          ? `${repo.directoryName} (${repo.name})`
          : repo.directoryName,
        dirName: repo.directoryName,
      });
    }

    for (const dir of diskDirs) {
      if (!metaDirNames.has(dir)) {
        repoEntries.push({ displayName: `${dir} (untracked)`, dirName: dir });
      }
    }

    if (repoEntries.length === 0) {
      logInfo('No repositories found in this workspace.');
      if (opts.yes) {
        await fs.rm(workspacePath, { recursive: true, force: true });
        logSuccess(`Workspace "${workspaceName}" deleted.`);
      } else {
        const { deleteWorkspace } = await inquirer.prompt([{
          type: 'confirm', name: 'deleteWorkspace',
          message: `Delete the entire workspace folder "${workspaceName}"?`, default: false,
        }]);
        if (deleteWorkspace) {
          await fs.rm(workspacePath, { recursive: true, force: true });
          logSuccess(`Workspace "${workspaceName}" deleted.`);
        } else {
          logInfo('No action taken.');
        }
      }
      process.exit(0);
    }

    logStep(3, 4, 'Select instances to remove...');

    let selectedDirs: string[];

    if (opts.repos) {
      selectedDirs = parseList(opts.repos);
      const unknownDirs = selectedDirs.filter(d => !repoEntries.some(e => e.dirName === d));
      if (unknownDirs.length > 0) {
        logError(`Directories not found in workspace: ${unknownDirs.join(', ')}`);
        process.exit(1);
      }
    } else {
      console.log('\n' + colorize('Repository Selection', 'bright'));
      console.log('Type to search repositories. Use arrow keys to navigate, Enter to select.');
      console.log('Type "done" when finished selecting.\n');

      selectedDirs = [];

      while (true) {
        const available = repoEntries.filter(e => !selectedDirs.includes(e.dirName));
        if (available.length === 0) {
          console.log(colorize('All repositories selected.', 'yellow'));
          break;
        }

        try {
          const { repoDir } = await inquirer.prompt([{
            type: 'autocomplete', name: 'repoDir',
            message: `Search and select repository (${colorize(String(selectedDirs.length), 'cyan')} selected):`,
            source: async (_answersSoFar: any, input: string | undefined) => {
              const searchInput = input || '';
              const doneOption = { name: colorize('done - Finish selection', 'green'), value: 'done' };
              if (!searchInput || searchInput.toLowerCase().startsWith('done')) {
                return [doneOption, ...available.map(e => ({ name: e.displayName, value: e.dirName }))];
              }
              const results = fuzzy.filter(searchInput, available, { extract: (e) => e.displayName });
              return [doneOption, ...results.map(result => ({ name: result.original.displayName, value: result.original.dirName }))];
            },
            pageSize: 16,
          } as any]);

          if (repoDir === 'done') {
            if (selectedDirs.length === 0) { console.log(colorize('\nYou must select at least one repository\n', 'yellow')); continue; }
            break;
          }

          selectedDirs.push(repoDir);
          const entry = repoEntries.find(e => e.dirName === repoDir);
          console.log(colorize(`Added: ${entry?.displayName || repoDir}`, 'green'));
        } catch { console.log('\n'); process.exit(0); }
      }
    }

    console.log(`\n${colorize(`Selected ${selectedDirs.length} repository instance${selectedDirs.length === 1 ? '' : 's'}:`, 'cyan')}`);
    selectedDirs.forEach(dir => console.log(`  - ${dir}`));
    console.log('');

    if (!opts.yes) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm', name: 'confirm',
        message: `Remove ${selectedDirs.length} instance(s)? This will delete the directories.`, default: false,
      }]);
      if (!confirm) { logInfo('Removal cancelled'); process.exit(0); }
    }

    logStep(4, 4, 'Removing instances...');

    for (const dirName of selectedDirs) {
      const dirPath = path.join(workspacePath, dirName);
      try {
        await fs.rm(dirPath, { recursive: true, force: true });
        logSuccess(`Removed: ${dirName}`);
      } catch (error) {
        logError(`Failed to remove ${dirName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const removedSet = new Set(selectedDirs);
    if (metadata) {
      metadata.repositories = metadata.repositories.filter(r => !removedSet.has(r.directoryName));
      await saveMetadata(workspacePath, metadata);

      const remainingRepos = metadata.repositories
        .filter(r => r.status === 'success')
        .map(r => ({
          name: r.name, url: '', sshUrl: r.cloneUrl,
          owner: { login: r.owner }, description: '', isPrivate: true,
        }));

      if (remainingRepos.length > 0) {
        await generateClaudeContext(workspacePath, workspaceName, remainingRepos, metadata);
      }

      console.log(`\nWorkspace now has ${colorize(String(metadata.repositories.length), 'cyan')} repositories\n`);
    }
    logSuccess('Repository instances removed successfully!');

  } catch (error) {
    logError('Failed to remove repository instances');
    if (error instanceof Error) { logError(error.message); }
    process.exit(1);
  }
}
