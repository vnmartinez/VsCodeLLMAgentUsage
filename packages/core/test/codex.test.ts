import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceFormatError, UnavailableError } from '../src/errors';
import { codexSnapshot, findLatestReading, parseCodexLine } from '../src/providers/codex/parse';
import { CodexProvider } from '../src/providers/codex/provider';

let failStatOnce = false;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (file: any, opts: any) => {
      if (failStatOnce) {
        failStatOnce = false;
        const err = new Error('ENOENT: no such file or directory');
        (err as any).code = 'ENOENT';
        throw err;
      }
      return actual.stat(file, opts);
    },
  };
});

const FIXTURE = fileURLToPath(new URL('./fixtures/codex-rollout.jsonl', import.meta.url));
const LIVE_NOW = new Date('2026-09-21T15:35:00Z');

async function fixtureText(): Promise<string> {
  return readFile(FIXTURE, 'utf8');
}

describe('parseCodexLine', () => {
  it('ignora linhas sem rate_limits ou de outro tipo', () => {
    expect(parseCodexLine('{"type":"session_meta","payload":{}}')).toBeNull();
    expect(parseCodexLine('{"type":"event_msg","payload":{"type":"agent_message","rate_limits":1}}')).toBeNull();
    expect(parseCodexLine('{"rate_limits": trunc')).toBeNull();
  });

  it('lê o evento token_count', async () => {
    const line = (await fixtureText()).split('\n')[1];
    const reading = parseCodexLine(line);
    expect(reading?.timestamp.toISOString()).toBe('2026-09-21T15:32:42.157Z');
    expect(reading?.windows).toHaveLength(2);
  });

  it('rejeita rate_limits com formato inesperado', () => {
    const line = '{"timestamp":"2026-09-21T15:32:42Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"window_minutes":300},"secondary":null}}}';
    expect(() => parseCodexLine(line)).toThrow(SourceFormatError);
  });
});

describe('codexSnapshot', () => {
  it('fica live com leitura recente', async () => {
    const snap = codexSnapshot(findLatestReading(await fixtureText())!, LIVE_NOW);
    expect(snap).toEqual({
      agent: 'codex',
      status: 'live',
      fetchedAt: new Date('2026-09-21T15:32:42.157Z'),
      note: undefined,
      limits: [
        { agent: 'codex', window: '5h', usedPct: 58, resetsAt: new Date('2026-09-21T17:14:24Z') },
        { agent: 'codex', window: 'weekly', usedPct: 41, resetsAt: new Date('2026-09-27T16:46:10Z') },
      ],
    });
  });

  it('continua live com leitura antiga', async () => {
    const snap = codexSnapshot(findLatestReading(await fixtureText())!, new Date('2026-09-21T16:00:00Z'));
    expect(snap.status).toBe('live');
  });

  it('zera a janela que já reiniciou', async () => {
    const snap = codexSnapshot(findLatestReading(await fixtureText())!, new Date('2026-09-21T18:00:00Z'));
    expect(snap.limits[0]).toEqual({ agent: 'codex', window: '5h', usedPct: 0, resetsAt: null });
    expect(snap.limits[1].usedPct).toBe(41);
    expect(snap.note).toBe('janela reiniciada desde a última leitura');
    expect(snap.status).toBe('live');
  });

  it('rejeita janela de duração desconhecida', async () => {
    const reading = findLatestReading(await fixtureText())!;
    reading.windows[0].window_minutes = 60;
    expect(() => codexSnapshot(reading, LIVE_NOW)).toThrow(SourceFormatError);
  });
});

describe('CodexProvider', () => {
  let root: string;

  function dayDir(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return path.join(root, String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()));
  }

  async function writeRollout(date: Date, name: string, content: string, mtime: Date): Promise<void> {
    const dir = dayDir(date);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await writeFile(file, content);
    await utimes(file, mtime, mtime);
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'codex-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('usa o rollout mais recente que tem rate_limits', async () => {
    const text = await fixtureText();
    const newer = text.replace('"used_percent":58.0', '"used_percent":70.0');
    await writeRollout(LIVE_NOW, 'rollout-a.jsonl', text, new Date('2026-09-21T15:00:00Z'));
    await writeRollout(LIVE_NOW, 'rollout-b.jsonl', newer, new Date('2026-09-21T15:10:00Z'));
    await writeRollout(LIVE_NOW, 'rollout-c.jsonl', text.split('\n')[0], new Date('2026-09-21T15:20:00Z'));

    const snap = await new CodexProvider({ sessionsDir: root, now: () => LIVE_NOW }).fetch();
    expect(snap.limits[0].usedPct).toBe(70);
  });

  it('procura nos dias anteriores', async () => {
    const yesterday = new Date(LIVE_NOW.getTime() - 24 * 3_600_000);
    await writeRollout(yesterday, 'rollout-a.jsonl', await fixtureText(), yesterday);

    const snap = await new CodexProvider({ sessionsDir: root, now: () => LIVE_NOW }).fetch();
    expect(snap.limits[1].usedPct).toBe(41);
  });

  it('fica indisponível sem sessões', async () => {
    const provider = new CodexProvider({ sessionsDir: path.join(root, 'nao-existe'), now: () => LIVE_NOW });
    await expect(provider.fetch()).rejects.toBeInstanceOf(UnavailableError);
  });

  it('respeita AbortSignal já abortado com a classe real CodexProvider', async () => {
    await writeRollout(LIVE_NOW, 'rollout-a.jsonl', await fixtureText(), LIVE_NOW);
    const provider = new CodexProvider({ sessionsDir: root, now: () => LIVE_NOW });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.fetch(controller.signal)).rejects.toThrow();
  });

  it('ignora arquivo que sumiu entre readdir e stat sem lançar ENOENT cru', async () => {
    await writeRollout(LIVE_NOW, 'rollout-a.jsonl', await fixtureText(), LIVE_NOW);
    const provider = new CodexProvider({ sessionsDir: root, now: () => LIVE_NOW });
    failStatOnce = true;
    // Com apenas 1 arquivo que falha no stat, o resultado deve ser UnavailableError e não ENOENT
    await expect(provider.fetch()).rejects.toBeInstanceOf(UnavailableError);
  });

  it('encontra rate_limits no fallback de leitura quando não está no tail inicial', async () => {
    const text = await fixtureText();
    // Preenche com 300KB de linhas vazias/comentários e coloca a leitura no começo
    const padding = '\n'.repeat(300 * 1024);
    await writeRollout(LIVE_NOW, 'rollout-fallback.jsonl', text + padding, LIVE_NOW);
    const provider = new CodexProvider({ sessionsDir: root, now: () => LIVE_NOW });
    const snap = await provider.fetch();
    expect(snap.limits[0].usedPct).toBe(58);
  });
});
