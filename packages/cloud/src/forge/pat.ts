import { ForgeToken, ForgeTokenSource, TokenScope } from './types';

/** Far-future expiry for tokens that don't expire (static PATs). */
const FAR_FUTURE = new Date('9999-12-31T00:00:00Z');

/**
 * The zero-config forge auth: a static personal access token. Works for every
 * forge and every runner (including the local Docker runner and users who don't
 * want to set up a GitHub App). Cannot scope per-call, so `scope` is ignored.
 */
export class PatTokenSource implements ForgeTokenSource {
  readonly id = 'pat';

  constructor(private readonly token: string) {
    if (!token || !token.trim()) {
      throw new Error('PatTokenSource: a non-empty token is required');
    }
  }

  async getToken(_scope?: TokenScope): Promise<ForgeToken> {
    return { token: this.token, expiresAt: FAR_FUTURE };
  }
}
