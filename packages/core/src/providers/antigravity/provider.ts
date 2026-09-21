import { HttpStatusError, SourceFormatError, UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { parseQuotaSummary, type LanguageServer } from './parse';

export const QUOTA_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

export interface AntigravityDeps {
  discover: () => Promise<LanguageServer[]>;
  fetch: typeof fetch;
  now: () => Date;
}

interface Target {
  port: number;
  csrfToken: string;
}

export class AntigravityProvider implements Provider {
  readonly id = 'antigravity' as const;
  private target: Target | null = null;

  constructor(private readonly deps: AntigravityDeps) {}

  async fetch(signal?: AbortSignal): Promise<AgentSnapshot> {
    if (this.target) {
      try {
        return await this.query(this.target, signal);
      } catch (error) {
        if (error instanceof SourceFormatError) throw error;
        this.target = null; // IDE reiniciou: porta e token mudaram
      }
    }
    const servers = await this.deps.discover();
    if (servers.length === 0) throw new UnavailableError('Antigravity fechado');
    for (const server of servers) {
      for (const port of server.ports) {
        const candidate = { port, csrfToken: server.csrfToken };
        try {
          const snap = await this.query(candidate, signal);
          this.target = candidate;
          return snap;
        } catch (error) {
          if (error instanceof SourceFormatError) throw error;
        }
      }
    }
    throw new UnavailableError('Antigravity aberto, mas sem resposta de cota');
  }

  private async query(target: Target, signal?: AbortSignal): Promise<AgentSnapshot> {
    const response = await this.deps.fetch(`http://127.0.0.1:${target.port}${QUOTA_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': target.csrfToken,
      },
      body: '{}',
      signal,
    });
    if (!response.ok) throw new HttpStatusError(response.status);
    return parseQuotaSummary(await response.json(), this.deps.now());
  }
}
