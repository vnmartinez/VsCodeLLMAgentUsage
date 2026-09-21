import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AGENTS, type AgentSnapshot } from './types';

export interface SnapshotCache {
  load(): Promise<AgentSnapshot[]>;
  save(snaps: AgentSnapshot[]): Promise<void>;
}

export function defaultCachePath(): string {
  const base = process.env.APPDATA ?? path.join(os.homedir(), '.config');
  return path.join(base, 'agent-usage', 'last.json');
}

/** Copia campo a campo: nada fora do modelo (ex.: dados pessoais) vai para o disco. */
export function serialize(snaps: AgentSnapshot[]): string {
  return JSON.stringify(
    snaps.map((s) => ({
      agent: s.agent,
      status: s.status,
      fetchedAt: s.fetchedAt.toISOString(),
      note: s.note ?? null,
      limits: s.limits.map((l) => ({
        group: l.group ?? null,
        window: l.window,
        usedPct: l.usedPct,
        resetsAt: l.resetsAt ? l.resetsAt.toISOString() : null,
      })),
    })),
  );
}

export function deserialize(text: string): AgentSnapshot[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const snaps: AgentSnapshot[] = [];
  for (const s of raw as any[]) {
    if (!AGENTS.includes(s?.agent) || !Array.isArray(s?.limits)) continue;
    const snap: AgentSnapshot = {
      agent: s.agent,
      status: s.status,
      fetchedAt: new Date(s.fetchedAt),
      limits: s.limits.map((l: any) => {
        const limit = {
          agent: s.agent,
          window: l.window,
          usedPct: Number(l.usedPct),
          resetsAt: l.resetsAt ? new Date(l.resetsAt) : null,
        };
        return l.group ? { ...limit, group: l.group } : limit;
      }),
    };
    if (s.note) snap.note = s.note;
    snaps.push(snap);
  }
  return snaps;
}

export function fileCache(file: string = defaultCachePath()): SnapshotCache {
  return {
    async load() {
      try {
        return deserialize(await readFile(file, 'utf8'));
      } catch {
        return [];
      }
    },
    async save(snaps) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, serialize(snaps));
      await rename(tmp, file); // tray e extensão podem gravar ao mesmo tempo
    },
  };
}
