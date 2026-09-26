import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deserialize, fileCache } from '../src/cache';
import type { AgentSnapshot } from '../src/types';

const SNAPS: AgentSnapshot[] = [
  {
    agent: 'antigravity',
    status: 'live',
    fetchedAt: new Date('2026-09-21T19:00:00Z'),
    limits: [{ agent: 'antigravity', group: 'Gemini', window: '5h', usedPct: 11, resetsAt: new Date('2026-09-21T22:37:35Z') }],
  },
  {
    agent: 'codex',
    status: 'stale',
    fetchedAt: new Date('2026-09-21T18:00:00Z'),
    note: 'janela reiniciada desde a última leitura',
    limits: [{ agent: 'codex', window: '5h', usedPct: 0, resetsAt: null }],
  },
];

describe('fileCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cache-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('grava e lê de volta com datas', async () => {
    const cache = fileCache(path.join(dir, 'sub', 'last.json'));
    await cache.save(SNAPS);
    expect(await cache.load()).toEqual(SNAPS);
  });

  it('devolve lista vazia sem arquivo ou com arquivo corrompido', async () => {
    const file = path.join(dir, 'last.json');
    expect(await fileCache(file).load()).toEqual([]);
    await writeFile(file, '{corrompido');
    expect(await fileCache(file).load()).toEqual([]);
  });

  it('grava só os campos conhecidos', async () => {
    const file = path.join(dir, 'last.json');
    const withExtra = [{ ...SNAPS[0], email: 'alguem@exemplo.com' } as AgentSnapshot];
    await fileCache(file).save(withExtra);
    expect(await readFile(file, 'utf8')).not.toContain('email');
  });
});

describe('deserialize', () => {
  it('descarta snapshots com campos ausentes ou inválidos', () => {
    // status inválido
    expect(deserialize(JSON.stringify([{ agent: 'codex', status: 'banana', fetchedAt: '2026-09-21T18:00:00Z', limits: [] }]))).toEqual([]);
    // usedPct inválido (abc)
    expect(deserialize(JSON.stringify([{ agent: 'codex', status: 'live', fetchedAt: '2026-09-21T18:00:00Z', limits: [{ window: '5h', usedPct: 'abc' }] }]))).toEqual([]);
    // window inválida
    expect(deserialize(JSON.stringify([{ agent: 'codex', status: 'live', fetchedAt: '2026-09-21T18:00:00Z', limits: [{ window: 'diario', usedPct: 10 }] }]))).toEqual([]);
    // resetsAt inválido
    expect(deserialize(JSON.stringify([{ agent: 'codex', status: 'live', fetchedAt: '2026-09-21T18:00:00Z', limits: [{ window: '5h', usedPct: 10, resetsAt: 'ontem' }] }]))).toEqual([]);
    // fetchedAt ausente ou inválido
    expect(deserialize(JSON.stringify([{ agent: 'codex', status: 'live', fetchedAt: 'invalido', limits: [] }]))).toEqual([]);
    // limits com null
    expect(deserialize(JSON.stringify([{ agent: 'codex', status: 'live', fetchedAt: '2026-09-21T18:00:00Z', limits: [null] }]))).toEqual([]);
  });

  it('aplica clamp de 0 a 100 em usedPct', () => {
    const raw = [{ agent: 'codex', status: 'live', fetchedAt: '2026-09-21T18:00:00Z', limits: [{ window: '5h', usedPct: 9999 }] }];
    const snaps = deserialize(JSON.stringify(raw));
    expect(snaps[0].limits[0].usedPct).toBe(100);
  });
});
