import { isClaudeInstalled } from '../../detection';
import { HttpStatusError, StaleError, UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { parseClaudeUsage, parseCredentials } from './parse';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export interface ClaudeDeps {
  credentialsPath: string;
  readFile: (path: string) => Promise<string>;
  fetch: typeof fetch;
  now: () => Date;
  cooldownMs?: number;
  isInstalled?: () => Promise<boolean>;
}

/** Só lê o token do Claude Code. Nunca renova nem grava o arquivo de credenciais. */
export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const;
  private lastFetchTime = 0;
  private lastSnapshot: AgentSnapshot | null = null;
  private rateLimitUntil = 0;

  constructor(private readonly deps: ClaudeDeps) {}

  async isInstalled(): Promise<boolean> {
    if (this.deps.isInstalled) return this.deps.isInstalled();
    return isClaudeInstalled(this.deps.credentialsPath);
  }

  async fetch(signal?: AbortSignal, opts?: { force?: boolean }): Promise<AgentSnapshot> {
    const nowTime = this.deps.now().getTime();
    const cooldown = this.deps.cooldownMs ?? 0;

    if (nowTime < this.rateLimitUntil && this.lastSnapshot) {
      return {
        ...this.lastSnapshot,
        status: 'stale',
        note: 'limite de requisições da Anthropic (429), aguardando liberação',
      };
    }

    if (!opts?.force && cooldown > 0 && nowTime - this.lastFetchTime < cooldown && this.lastSnapshot) {
      return this.lastSnapshot;
    }

    let text: string;
    try {
      text = await this.deps.readFile(this.deps.credentialsPath);
    } catch {
      throw new UnavailableError('Claude Code sem login neste usuário');
    }
    const credentials = parseCredentials(text);
    if (credentials.expiresAt.getTime() <= nowTime) {
      throw new StaleError('token expirado, abra o Claude Code');
    }
    const response = await this.deps.fetch(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new StaleError('token recusado, abra o Claude Code');
    }
    if (response.status === 429) {
      const retryHeader = response.headers?.get?.('retry-after');
      const retrySec = retryHeader ? parseInt(retryHeader, 10) : 60;
      this.rateLimitUntil = nowTime + (Number.isFinite(retrySec) ? retrySec * 1000 : 60_000);
      throw new HttpStatusError(429);
    }
    if (!response.ok) throw new HttpStatusError(response.status);
    this.lastFetchTime = nowTime;
    const snap = parseClaudeUsage(await response.json(), this.deps.now());
    this.lastSnapshot = snap;
    return snap;
  }
}
