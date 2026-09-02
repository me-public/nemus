import { confirm, input, select, search } from './prompt';
import * as fuzzy from 'fuzzy';
import { GitHubRepo } from '../types';
import { validateWorkspaceName, checkWorkspaceExists, sanitizeWorkspaceName } from './validation';
import { colorize } from './colors';

export interface RepoSelection {
  repo: GitHubRepo;
  directoryName: string;
}

export const promptInstanceSuffix = async (
  repoName: string,
  existingDirectoryNames: string[]
): Promise<string> => {
  const suffix = await input({
    message: `"${repoName}" already exists. Enter a suffix for this instance:`,
    validate: (input: string) => {
      if (!input || input.trim().length === 0) {
        return 'Suffix cannot be empty';
      }

      const trimmed = input.trim();

      // Validate characters (alphanumeric, hyphens, underscores)
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return 'Suffix can only contain letters, numbers, hyphens, and underscores';
      }

      const candidateName = `${repoName}-${trimmed}`;
      if (existingDirectoryNames.includes(candidateName)) {
        return `"${candidateName}" already exists. Choose a different suffix`;
      }

      return true;
    },
  });

  return suffix.trim();
};

export const promptRepositorySelection = async (
  repos: GitHubRepo[],
  existingDirectoryNames: string[] = []
): Promise<RepoSelection[]> => {
  const selectedEntries: RepoSelection[] = [];
  const repoMap = new Map(repos.map(repo => [repo.name, repo]));

  // Track all directory names (existing + newly selected) for collision detection
  const allDirectoryNames = [...existingDirectoryNames];

  console.log('\n' + colorize('Repository Selection', 'bright'));
  console.log('Type to search repositories. Use arrow keys to navigate, Enter to select.');
  console.log('Type "done" when finished selecting repositories.\n');

  while (true) {
    try {
      const repoName = await search<string>({
        message: `Search and select repository (${colorize(String(selectedEntries.length), 'cyan')} selected):`,
        pageSize: 16,
        source: async (term: string | undefined) => {
          const searchInput = term || '';

          // Always include done option
          const doneOption = { name: colorize('done - Finish selection', 'green'), value: 'done' };

          // If no input or "done" typed, show done + top repos
          if (!searchInput || searchInput.toLowerCase().startsWith('done')) {
            return [
              doneOption,
              ...repos.slice(0, 15).map(repo => ({
                name: `${repo.name}${repo.description ? ` - ${colorize(repo.description, 'gray')}` : ''}`,
                value: repo.name,
              }))
            ];
          }

          // Perform fuzzy search
          const results = fuzzy.filter(searchInput, repos, {
            extract: (repo) => `${repo.name} ${repo.description || ''}`,
          });

          const suggestions = results.slice(0, 15).map(result => ({
            name: `${result.original.name}${result.original.description ? ` - ${colorize(result.original.description, 'gray')}` : ''}`,
            value: result.original.name,
          }));

          return [doneOption, ...suggestions];
        },
      });

      if (repoName === 'done') {
        if (selectedEntries.length === 0) {
          console.log(colorize('\nYou must select at least one repository\n', 'yellow'));
          continue;
        }
        break;
      }

      const repo = repoMap.get(repoName);
      if (!repo) continue;

      let directoryName = repo.name;

      // Check if this directory name already exists (in workspace or in current selection)
      if (allDirectoryNames.includes(directoryName)) {
        const suffix = await promptInstanceSuffix(repo.name, allDirectoryNames);
        directoryName = `${repo.name}-${suffix}`;
      }

      selectedEntries.push({ repo, directoryName });
      allDirectoryNames.push(directoryName);

      const displayName = directoryName !== repo.name
        ? `${directoryName} (${repo.name})`
        : repo.name;
      console.log(colorize(`Added: ${displayName}`, 'green'));
    } catch (error) {
      // Handle Ctrl+C
      console.log('\n');
      process.exit(0);
    }
  }

  console.log(`\n${colorize(`Selected ${selectedEntries.length} repositories:`, 'cyan')}`);
  selectedEntries.forEach(entry => {
    const displayName = entry.directoryName !== entry.repo.name
      ? `${entry.directoryName} (${entry.repo.name})`
      : entry.repo.name;
    console.log(`  - ${displayName}`);
  });
  console.log('');

  return selectedEntries;
};

export const promptWorkspaceName = async (): Promise<string> => {
  const raw = await input({
    message: 'Enter workspace name:',
    validate: (value: string) => {
      const validationResult = validateWorkspaceName(sanitizeWorkspaceName(value));
      if (validationResult !== true) {
        return validationResult;
      }
      return true;
    },
  });

  return sanitizeWorkspaceName(raw);
};

export const confirmWorkspaceCreation = async (
  workspaceName: string,
  repoCount: number,
  workspacePath: string
): Promise<boolean> => {
  console.log('\n' + '='.repeat(60));
  console.log('Workspace Configuration');
  console.log('='.repeat(60));
  console.log(`Name: ${colorize(workspaceName, 'cyan')}`);
  console.log(`Location: ${colorize(workspacePath, 'gray')}`);
  console.log(`Repositories: ${colorize(String(repoCount), 'yellow')}`);
  console.log('='.repeat(60) + '\n');

  const confirmed = await confirm({
    message: 'Create workspace with these settings?',
    default: true,
  });

  return confirmed;
};

export const promptWorkspaceSelection = async (workspaces: Array<{ name: string; path: string; metadata: any }>): Promise<string> => {
  if (workspaces.length === 0) {
    throw new Error('No workspaces found. Create one first with: workspace create');
  }

  const choices = workspaces.map(ws => ({
    name: ws.metadata
      ? `${ws.name} (${ws.metadata.repositories.length} repos)`
      : ws.name,
    value: ws.name,
  }));

  const workspaceName = await select<string>({
    message: 'Select workspace to update:',
    choices,
    pageSize: 15,
  });

  return workspaceName;
};

export const promptMultiWorkspaceSelection = async (
  workspaces: Array<{ name: string; path: string; metadata: any }>
): Promise<string[]> => {
  const selectedNames: string[] = [];
  const workspaceNames = workspaces.map(ws => ws.name);

  console.log('\n' + colorize('Workspace Selection', 'bright'));
  console.log('Type to search workspaces. Use arrow keys to navigate, Enter to select.');
  console.log('Type "done" when finished selecting workspaces.\n');

  while (true) {
    try {
      const availableNames = workspaceNames.filter(name => !selectedNames.includes(name));

      if (availableNames.length === 0) {
        console.log(colorize('All workspaces selected.', 'yellow'));
        break;
      }

      const workspaceName = await search<string>({
        message: `Search and select workspace (${colorize(String(selectedNames.length), 'cyan')} selected):`,
        pageSize: 16,
        source: async (term: string | undefined) => {
          const searchInput = term || '';

          const doneOption = { name: colorize('done - Finish selection', 'green'), value: 'done' };

          if (!searchInput || searchInput.toLowerCase().startsWith('done')) {
            return [
              doneOption,
              ...availableNames.slice(0, 15).map(name => ({
                name,
                value: name,
              }))
            ];
          }

          const results = fuzzy.filter(searchInput, availableNames);

          const suggestions = results.slice(0, 15).map(result => ({
            name: result.original,
            value: result.original,
          }));

          return [doneOption, ...suggestions];
        },
      });

      if (workspaceName === 'done') {
        if (selectedNames.length === 0) {
          console.log(colorize('\nYou must select at least one workspace\n', 'yellow'));
          continue;
        }
        break;
      }

      selectedNames.push(workspaceName);
      console.log(colorize(`Added: ${workspaceName}`, 'green'));
    } catch (error) {
      // Handle Ctrl+C
      console.log('\n');
      process.exit(0);
    }
  }

  console.log(`\n${colorize(`Selected ${selectedNames.length} workspace${selectedNames.length === 1 ? '' : 's'}:`, 'cyan')}`);
  selectedNames.forEach(name => {
    console.log(`  - ${name}`);
  });
  console.log('');

  return selectedNames;
};
