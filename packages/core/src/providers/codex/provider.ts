import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isCodexInstalled } from '../../detection';
import { UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { codexSnapshot, findLatestReading } from './parse';

export interface CodexDeps {
  sessionsDir: string;
  now: () => Date;
  isInstalled?: () => Promise<boolean>;
}

const LOOKBACK_DAYS = 7;
const MAX_FILES = 10;
const TAIL_BYTES = 256 * 1024;
const MAX_READ_BYTES = 32 * 1024 * 1024;

const pad = (n: number) => String(n).padStart(2, '0');

async function readTail(file: string, bytes: number): Promise<string> {
  const boundedBytes = Math.min(bytes, MAX_READ_BYTES);
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - boundedBytes);
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
      try {
        found.push({ file, mtime: (await stat(file)).mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

export class CodexProvider implements Provider {
  readonly id = 'codex' as const;

  constructor(private readonly deps: CodexDeps) {}

  async isInstalled(): Promise<boolean> {
    if (this.deps.isInstalled) return this.deps.isInstalled();
    return isCodexInstalled(this.deps.sessionsDir);
  }

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
        findLatestReading(await readTail(file, MAX_READ_BYTES));
      if (reading) return codexSnapshot(reading, now);
    }
    throw new UnavailableError('sem dados de limite nas sessões recentes do Codex');
  }
}
