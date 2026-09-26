import { SourceFormatError } from '../../errors';
import type { AgentSnapshot, Limit } from '../../types';

export interface LanguageServer {
  pid: number;
  csrfToken: string;
  /** Portas em escuta no 127.0.0.1, da maior para a menor (a HTTP costuma ser a maior). */
  ports: number[];
}

const GROUP_NAMES: Record<string, string> = {
  'Gemini Models': 'Gemini',
  'Claude and GPT models': 'Claude/GPT',
};

export function extractCsrfToken(commandLine: string): string | null {
  const match = /(?:^|\s)--csrf_token[= ]+"?([^\s"]+)/.exec(commandLine);
  return match ? match[1] : null;
}

/** Recebe a saída JSON do DISCOVERY_SCRIPT. A linha de comando é descartada depois de extrair o token. */
export function parseDiscoveryOutput(stdout: string): LanguageServer[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new SourceFormatError('descoberta do antigravity');
  }
  const servers: LanguageServer[] = [];
  for (const entry of (Array.isArray(raw) ? raw : [raw]) as any[]) {
    const csrfToken = typeof entry?.cmd === 'string' ? extractCsrfToken(entry.cmd) : null;
    const rawPorts: unknown[] = Array.isArray(entry?.ports) ? entry.ports : [entry?.ports];
    const ports = rawPorts.filter((p): p is number => typeof p === 'number').sort((a, b) => b - a);
    if (typeof entry?.pid !== 'number' || !csrfToken || ports.length === 0) continue;
    servers.push({ pid: entry.pid, csrfToken, ports });
  }
  return servers;
}

export function parseQuotaSummary(json: unknown, fetchedAt: Date): AgentSnapshot {
  const groups = (json as any)?.response?.groups;
  if (!Array.isArray(groups)) throw new SourceFormatError('antigravity groups');
  const limits: Limit[] = [];
  for (const group of groups) {
    const name = GROUP_NAMES[group?.displayName] ?? String(group?.displayName ?? '?');
    for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
      if (bucket?.window !== '5h' && bucket?.window !== 'weekly') continue;
      const remaining = bucket.remainingFraction ?? 0; // proto3 JSON omite o valor zero
      if (typeof remaining !== 'number' || typeof bucket.resetTime !== 'string') {
        throw new SourceFormatError('antigravity bucket');
      }
      limits.push({
        agent: 'antigravity',
        group: name,
        window: bucket.window,
        usedPct: Math.min(100, Math.max(0, (1 - remaining) * 100)),
        resetsAt: new Date(bucket.resetTime),
      });
    }
  }
  if (limits.length === 0) throw new SourceFormatError('antigravity sem janelas 5h/weekly');
  return { agent: 'antigravity', status: 'live', limits, fetchedAt };
}
