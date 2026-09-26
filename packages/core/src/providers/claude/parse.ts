import { SourceFormatError } from '../../errors';
import type { AgentSnapshot, Limit, LimitWindow } from '../../types';

export interface ClaudeCredentials {
  accessToken: string;
  expiresAt: Date;
}

export function parseCredentials(text: string): ClaudeCredentials {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new SourceFormatError('credenciais do claude');
  }
  const oauth = obj?.claudeAiOauth;
  if (typeof oauth?.accessToken !== 'string' || typeof oauth?.expiresAt !== 'number') {
    throw new SourceFormatError('credenciais do claude');
  }
  const expiresAt = new Date(oauth.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new SourceFormatError('credenciais do claude');
  }
  return { accessToken: oauth.accessToken, expiresAt };
}

function parseWindow(raw: any, window: LimitWindow): Limit {
  const validReset = raw?.resets_at === null || typeof raw?.resets_at === 'string';
  if (typeof raw?.utilization !== 'number' || !validReset) throw new SourceFormatError(`claude ${window}`);
  return {
    agent: 'claude',
    window,
    usedPct: raw.utilization,
    resetsAt: raw.resets_at ? new Date(raw.resets_at) : null,
  };
}

export function parseClaudeUsage(json: unknown, fetchedAt: Date): AgentSnapshot {
  const body = json as any;
  return {
    agent: 'claude',
    status: 'live',
    fetchedAt,
    limits: [parseWindow(body?.five_hour, '5h'), parseWindow(body?.seven_day, 'weekly')],
  };
}
