import { describe, it, expect, vi } from 'vitest';
import { isRetryableError, withRetry } from './retry';

// Mock the logger to avoid console output during tests
vi.mock('./logger', () => ({
  logWarning: vi.fn(),
}));

describe('isRetryableError', () => {
  it('returns true for timeout errors', () => {
    expect(isRetryableError(new Error('Operation timeout'))).toBe(true);
  });

  it('returns true for ETIMEDOUT errors', () => {
    expect(isRetryableError(new Error('connect ETIMEDOUT 1.2.3.4:443'))).toBe(true);
  });

  it('returns true for ECONNREFUSED errors', () => {
    expect(isRetryableError(new Error('connect ECONNREFUSED 127.0.0.1:22'))).toBe(true);
  });

  it('returns true for ECONNRESET errors', () => {
    expect(isRetryableError(new Error('read ECONNRESET'))).toBe(true);
  });

  it('returns true for ENOTFOUND errors', () => {
    expect(isRetryableError(new Error('getaddrinfo ENOTFOUND github.com'))).toBe(true);
  });

  it('returns false for authentication failed', () => {
    expect(isRetryableError(new Error('Authentication failed for repo'))).toBe(false);
  });

  it('returns false for permission denied', () => {
    expect(isRetryableError(new Error('Permission denied (publickey)'))).toBe(false);
  });

  it('returns false for 404 errors', () => {
    expect(isRetryableError(new Error('Repository not found: 404'))).toBe(false);
  });

  it('returns false for 401 errors', () => {
    expect(isRetryableError(new Error('HTTP 401 Unauthorized'))).toBe(false);
  });

  it('returns false for 403 errors', () => {
    expect(isRetryableError(new Error('HTTP 403 Forbidden'))).toBe(false);
  });

  it('returns false for repository not found', () => {
    expect(isRetryableError(new Error('repository not found'))).toBe(false);
  });

  it('returns false for generic errors', () => {
    expect(isRetryableError(new Error('Something went wrong'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('succeeds on first try', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on retry after retryable failure', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
      .mockResolvedValueOnce('success');

    const result = await withRetry(fn, { maxRetries: 1, initialDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT'));

    await expect(
      withRetry(fn, { maxRetries: 2, initialDelayMs: 10 })
    ).rejects.toThrow('connect ETIMEDOUT');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Authentication failed'));

    await expect(
      withRetry(fn, { maxRetries: 3, initialDelayMs: 10 })
    ).rejects.toThrow('Authentication failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('success');

    const start = Date.now();
    await withRetry(fn, { maxRetries: 2, initialDelayMs: 50, backoffMultiplier: 2, maxDelayMs: 10000 });
    const elapsed = Date.now() - start;

    // Should have waited ~50ms + ~100ms = ~150ms (with some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects maxDelayMs', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('success');

    const start = Date.now();
    await withRetry(fn, { maxRetries: 2, initialDelayMs: 100, backoffMultiplier: 100, maxDelayMs: 150 });
    const elapsed = Date.now() - start;

    // First delay 100ms, second should be capped at 150ms (not 100*100=10000)
    expect(elapsed).toBeLessThan(500);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
