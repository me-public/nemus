import { SecretRef } from '../runner/types';
import { SecretSource } from './types';
import { EnvSecretSource, DotenvSecretSource, GhCliSecretSource } from './sources';

export * from './types';
export { EnvSecretSource, DotenvSecretSource, GhCliSecretSource, parseDotenv } from './sources';

/** A set of secret sources keyed by scheme. */
export type SecretSources = Record<string, SecretSource>;

/** The default chain: `env:` and `gh:` (no filesystem access assumed). Pass a
 *  DotenvSecretSource explicitly to enable `dotenv:`. */
export function defaultSecretSources(env: NodeJS.ProcessEnv = process.env): SecretSources {
  const src: SecretSource[] = [new EnvSecretSource(env), new GhCliSecretSource()];
  return Object.fromEntries(src.map((s) => [s.id, s]));
}

function splitScheme(from: string): { scheme: string; locator: string } {
  const i = from.indexOf(':');
  if (i === -1) return { scheme: 'env', locator: from }; // bare name defaults to env
  return { scheme: from.slice(0, i), locator: from.slice(i + 1) };
}

/** Resolve one `SecretRef.from` locator using the given sources. */
export async function resolveSecret(from: string, sources: SecretSources): Promise<string> {
  const { scheme, locator } = splitScheme(from);
  const source = sources[scheme];
  if (!source) {
    throw new Error(
      `no secret source for scheme "${scheme}" (have: ${Object.keys(sources).sort().join(', ') || 'none'})`,
    );
  }
  return source.resolve(locator);
}

/**
 * Resolve every `SecretRef` into a plain env map — what a runner without a
 * native secret store (e.g. Docker) needs merged into `TaskSpec.env` before
 * launch. Resolved concurrently; a single failure rejects with the ref name.
 */
export async function resolveSecretsToEnv(
  secrets: SecretRef[] | undefined,
  sources: SecretSources,
): Promise<Record<string, string>> {
  if (!secrets?.length) return {};
  const entries = await Promise.all(
    secrets.map(async (ref) => {
      try {
        return [ref.name, await resolveSecret(ref.from, sources)] as const;
      } catch (e) {
        throw new Error(`resolving secret "${ref.name}" (${ref.from}): ${(e as Error).message}`);
      }
    }),
  );
  return Object.fromEntries(entries);
}
