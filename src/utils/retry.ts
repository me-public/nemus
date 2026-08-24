import { logWarning } from './logger';

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 1,
  initialDelayMs: 2000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
};

const NON_RETRYABLE_PATTERNS = [
  'authentication failed',
  'permission denied',
  'repository not found',
  'could not read from remote repository',
  '401',
  '403',
  '404',
];

const RETRYABLE_PATTERNS = [
  'timeout',
  'etimedout',
  'econnrefused',
  'econnreset',
  'enotfound',
];

export function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (message.includes(pattern)) {
      return false;
    }
  }

  for (const pattern of RETRYABLE_PATTERNS) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: Partial<RetryOptions>,
  operationName?: string
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const name = operationName || 'operation';
      logWarning(`${name} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), retrying in ${(delay / 1000).toFixed(1)}s...`);

      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}
