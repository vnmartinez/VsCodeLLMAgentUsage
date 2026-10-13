import { SourceFormatError } from '../../errors';
import type { AgentSnapshot, Limit, LimitWindow } from '../../types';

interface RawWindow {
  used_percent: number;
  window_minutes: number;
  resets_at: number;
}

export interface CodexReading {
  timestamp: Date;
  windows: RawWindow[];
}

const WINDOW_BY_MINUTES: Record<number, LimitWindow> = { 300: '5h', 10080: 'weekly' };

function isRawWindow(value: unknown): value is RawWindow {
  const w = value as RawWindow | null;
  return (
    !!w &&
    typeof w.used_percent === 'number' &&
    typeof w.window_minutes === 'number' &&
    typeof w.resets_at === 'number'
  );
}

export function parseCodexLine(line: string): CodexReading | null {
  if (!line.includes('"rate_limits"')) return null;
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null; // linha cortada no início do trecho lido
  }
  const payload = obj?.payload;
  if (obj?.type !== 'event_msg' || payload?.type !== 'token_count' || !payload.rate_limits) return null;
  const { primary, secondary } = payload.rate_limits;
  if (!isRawWindow(primary) || !isRawWindow(secondary)) throw new SourceFormatError('codex rate_limits');
  const timestamp = new Date(obj.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw new SourceFormatError('codex timestamp');
  return { timestamp, windows: [primary, secondary] };
}

export function findLatestReading(text: string): CodexReading | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const reading = parseCodexLine(lines[i]);
    if (reading) return reading;
  }
  return null;
}

export function codexSnapshot(reading: CodexReading, now: Date): AgentSnapshot {
  let reset = false;
  const limits: Limit[] = reading.windows.map((w) => {
    const window = WINDOW_BY_MINUTES[w.window_minutes];
    if (!window) throw new SourceFormatError(`codex window_minutes=${w.window_minutes}`);
    const resetsAt = new Date(w.resets_at * 1000);
    if (resetsAt.getTime() <= now.getTime()) {
      reset = true;
      return { agent: 'codex', window, usedPct: 0, resetsAt: null };
    }
    return { agent: 'codex', window, usedPct: w.used_percent, resetsAt };
  });
  return {
    agent: 'codex',
    status: 'live',
    limits,
    fetchedAt: reading.timestamp,
    note: reset ? 'janela reiniciada desde a última leitura' : undefined,
  };
}
