import { HttpStatusError, StaleError, UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { parseClaudeUsage, parseCredentials } from './parse';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export interface ClaudeDeps {
  credentialsPath: string;
  readFile: (path: string) => Promise<string>;
  fetch: typeof fetch;
  now: () => Date;
}

/** Só lê o token do Claude Code. Nunca renova nem grava o arquivo de credenciais. */
export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const;

  constructor(private readonly deps: ClaudeDeps) {}

  async fetch(signal?: AbortSignal): Promise<AgentSnapshot> {
    let text: string;
    try {
      text = await this.deps.readFile(this.deps.credentialsPath);
    } catch {
      throw new UnavailableError('Claude Code sem login neste usuário');
    }
    const credentials = parseCredentials(text);
    if (credentials.expiresAt.getTime() <= this.deps.now().getTime()) {
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
    if (!response.ok) throw new HttpStatusError(response.status);
    return parseClaudeUsage(await response.json(), this.deps.now());
  }
}
