import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { codexSnapshot, findLatestReading } from './parse';

export interface CodexDeps {
  sessionsDir: string;
  now: () => Date;
}

const LOOKBACK_DAYS = 7;
const MAX_FILES = 10;
const TAIL_BYTES = 256 * 1024;

const pad = (n: number) => String(n).padStart(2, '0');

async function readTail(file: string, bytes: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Rollouts dos últimos dias (pastas AAAA/MM/DD em data local), mais recentes primeiro. */
async function recentRollouts(root: string, now: Date, signal?: AbortSignal): Promise<string[]> {
  const found: { file: string; mtime: number }[] = [];
  for (let d = 0; d < LOOKBACK_DAYS; d++) {
    signal?.throwIfAborted();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const dir = path.join(root, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      signal?.throwIfAborted();
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      found.push({ file, mtime: (await stat(file)).mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

export class CodexProvider implements Provider {
  readonly id = 'codex' as const;

  constructor(private readonly deps: CodexDeps) {}

  async fetch(signal?: AbortSignal): Promise<AgentSnapshot> {
    signal?.throwIfAborted();
    const now = this.deps.now();
    const files = await recentRollouts(this.deps.sessionsDir, now, signal);
    signal?.throwIfAborted();
    if (files.length === 0) throw new UnavailableError('nenhuma sessão do Codex nos últimos 7 dias');
    for (const file of files.slice(0, MAX_FILES)) {
      signal?.throwIfAborted();
      const tail = await readTail(file, TAIL_BYTES);
      signal?.throwIfAborted();
      const reading =
        findLatestReading(tail) ??
        findLatestReading(await readTail(file, Number.MAX_SAFE_INTEGER));
      if (reading) return codexSnapshot(reading, now);
    }
    throw new UnavailableError('sem dados de limite nas sessões recentes do Codex');
  }
}
