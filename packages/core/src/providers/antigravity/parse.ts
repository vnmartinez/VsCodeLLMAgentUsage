import { SourceFormatError, UnavailableError } from '../../errors';
import type { AgentSnapshot, Limit } from '../../types';

const GROUP_NAMES: Record<string, string> = {
  'Gemini Models': 'Gemini',
  'Claude and GPT models': 'Claude/GPT',
  'Gemini 4 Argon': 'Gemini 4',
};

/**
 * Recebe a saída de `agy -p /usage --output-format json`.
 * O comando não devolve grupos quando o agy é antigo (o `/usage` vira prompt) ou quando o
 * processo falha: nesses casos o último valor bom continua valendo, sem nota.
 */
export function parseUsageOutput(stdout: string, fetchedAt: Date): AgentSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.trim());
  } catch {
    throw new UnavailableError('agy não devolveu JSON', true);
  }
  const groups = (raw as any)?.command?.data?.groups;
  if (!Array.isArray(groups)) throw new UnavailableError('agy sem dados de cota no /usage', true);
  const limits: Limit[] = [];
  for (const group of groups) {
    const name = GROUP_NAMES[group?.name] ?? String(group?.name ?? '?');
    for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
      if (bucket?.window !== '5h' && bucket?.window !== 'weekly') continue;
      const remaining = bucket.remaining_fraction ?? 0;
      if (typeof remaining !== 'number' || typeof bucket.reset_time !== 'string') {
        throw new SourceFormatError('agy /usage bucket');
      }
      limits.push({
        agent: 'antigravity',
        group: name,
        window: bucket.window,
        usedPct: Math.min(100, Math.max(0, (1 - remaining) * 100)),
        resetsAt: new Date(bucket.reset_time),
      });
    }
  }
  if (limits.length === 0) throw new SourceFormatError('agy /usage sem janelas 5h/weekly');
  return { agent: 'antigravity', status: 'live', limits, fetchedAt };
}
