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

const VALID_STATUSES: readonly string[] = ['live', 'stale', 'unavailable'];
const VALID_WINDOWS: readonly string[] = ['5h', 'weekly'];

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
    if (!s || typeof s !== 'object') continue;
    if (!AGENTS.includes(s.agent)) continue;
    if (!VALID_STATUSES.includes(s.status)) continue;
    if (!Array.isArray(s.limits)) continue;

    const fetchedAt = new Date(s.fetchedAt);
    if (Number.isNaN(fetchedAt.getTime())) continue;

    let limitsValid = true;
    const limits: AgentSnapshot['limits'] = [];
    for (const l of s.limits) {
      if (!l || typeof l !== 'object') {
        limitsValid = false;
        break;
      }
      if (!VALID_WINDOWS.includes(l.window)) {
        limitsValid = false;
        break;
      }
      const rawPct = Number(l.usedPct);
      if (!Number.isFinite(rawPct)) {
        limitsValid = false;
        break;
      }
      let resetsAt: Date | null = null;
      if (l.resetsAt !== null && l.resetsAt !== undefined) {
        resetsAt = new Date(l.resetsAt);
        if (Number.isNaN(resetsAt.getTime())) {
          limitsValid = false;
          break;
        }
      }
      const limit = {
        agent: s.agent,
        window: l.window,
        usedPct: Math.min(100, Math.max(0, rawPct)),
        resetsAt,
      };
      limits.push(l.group ? { ...limit, group: l.group } : limit);
    }
    if (!limitsValid) continue;

    const snap: AgentSnapshot = {
      agent: s.agent,
      status: s.status,
      fetchedAt,
      limits,
    };
    if (typeof s.note === 'string') snap.note = s.note;
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
