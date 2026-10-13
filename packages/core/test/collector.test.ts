import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotCache } from '../src/cache';
import { Collector } from '../src/collector';
import { HttpStatusError, SourceFormatError, StaleError, UnavailableError } from '../src/errors';
import type { AgentId, AgentSnapshot, Provider } from '../src/types';

const NOW = new Date('2026-09-21T19:00:00Z');

function snap(agent: AgentId, usedPct: number): AgentSnapshot {
  return {
    agent,
    status: 'live',
    fetchedAt: NOW,
    limits: [{ agent, window: '5h', usedPct, resetsAt: new Date('2026-09-21T22:00:00Z') }],
  };
}

type FakeProvider = Provider & { calls: number };

/** Devolve os resultados em ordem; o último se repete. */
function fake(id: AgentId, ...results: Array<AgentSnapshot | Error>): FakeProvider {
  const provider: FakeProvider = {
    id,
    calls: 0,
    async fetch() {
      const result = results[Math.min(provider.calls, results.length - 1)];
      provider.calls++;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return provider;
}

function memoryCache(initial: AgentSnapshot[] = []): SnapshotCache & { saved: AgentSnapshot[][] } {
  const cache = {
    saved: [] as AgentSnapshot[][],
    load: async () => initial,
    save: async (snaps: AgentSnapshot[]) => {
      cache.saved.push(snaps);
    },
  };
  return cache;
}

const byAgent = (c: Collector, id: AgentId) => c.current().find((s) => s.agent === id);

describe('Collector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('roda todos os providers no start e notifica', async () => {
    const c = new Collector({ providers: [fake('claude', snap('claude', 10)), fake('codex', snap('codex', 20))], now: () => NOW });
    const listener = vi.fn();
    c.subscribe(listener);
    await c.start();
    c.stop();
    expect(byAgent(c, 'claude')?.limits[0].usedPct).toBe(10);
    expect(byAgent(c, 'codex')?.status).toBe('live');
    expect(listener).toHaveBeenCalled();
  });

  it('isola a falha de um provider', async () => {
    const c = new Collector({
      providers: [fake('claude', new Error('fetch failed')), fake('codex', snap('codex', 20))],
      now: () => NOW,
    });
    await c.start();
    c.stop();
    expect(byAgent(c, 'claude')).toEqual({ agent: 'claude', status: 'unavailable', limits: [], fetchedAt: NOW, note: 'fetch failed' });
    expect(byAgent(c, 'codex')?.status).toBe('live');
  });

  it('mantém o último valor bom como stale após erro', async () => {
    const c = new Collector({ providers: [fake('claude', snap('claude', 10), new Error('fetch failed'))], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'stale', note: 'fetch failed', limits: [{ usedPct: 10 }] });
  });

  it('StaleError vira stale com o último valor', async () => {
    const error = new StaleError('token expirado, abra o Claude Code');
    const c = new Collector({ providers: [fake('claude', snap('claude', 10), error)], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'stale', note: 'token expirado, abra o Claude Code', limits: [{ usedPct: 10 }] });
  });

  it('UnavailableError vira unavailable mantendo o último valor', async () => {
    const error = new UnavailableError('Antigravity fechado');
    const c = new Collector({ providers: [fake('antigravity', snap('antigravity', 30), error)], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    expect(byAgent(c, 'antigravity')).toMatchObject({ status: 'unavailable', note: 'Antigravity fechado', limits: [{ usedPct: 30 }] });
  });

  it('erro quiet mantém último valor como live sem nota', async () => {
    const c = new Collector({ providers: [fake('antigravity', snap('antigravity', 30), new UnavailableError('x', true))], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    const result = byAgent(c, 'antigravity');
    expect(result).toMatchObject({ status: 'live', limits: [{ usedPct: 30 }] });
    expect(result?.note).toBeUndefined();
  });

  it('erro quiet sem último valor fica unavailable', async () => {
    const c = new Collector({ providers: [fake('antigravity', new UnavailableError('x', true))], now: () => NOW });
    await c.start();
    c.stop();
    expect(byAgent(c, 'antigravity')).toMatchObject({ status: 'unavailable', limits: [] });
  });

  it('SourceFormatError vira unavailable sem números', async () => {
    const c = new Collector({ providers: [fake('antigravity', snap('antigravity', 30), new SourceFormatError('x'))], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    const result = byAgent(c, 'antigravity');
    expect(result?.status).toBe('unavailable');
    expect(result?.limits).toEqual([]);
    expect(result?.note).toContain('formato da fonte mudou');
  });

  it('aborta o provider no timeout', async () => {
    let captured: AbortSignal | undefined;
    const hanging: Provider = {
      id: 'claude',
      fetch: (signal) => {
        captured = signal;
        return new Promise(() => {});
      },
    };
    const c = new Collector({ providers: [hanging], now: () => NOW });
    const started = c.start();
    await vi.advanceTimersByTimeAsync(5_000);
    await started;
    c.stop();
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'unavailable', note: 'tempo esgotado' });
    expect(captured?.aborted).toBe(true);
  });

  it('dobra o intervalo no 429 até o teto e volta no sucesso', async () => {
    const tooMany = new HttpStatusError(429);
    const c = new Collector({ providers: [fake('claude', tooMany, tooMany, tooMany, snap('claude', 10))], now: () => NOW });
    await c.start();
    expect(c.intervalOf('claude')).toBe(600_000);
    await c.refreshNow();
    expect(c.intervalOf('claude')).toBe(1_200_000);
    await c.refreshNow();
    expect(c.intervalOf('claude')).toBe(1_800_000);
    await c.refreshNow();
    expect(c.intervalOf('claude')).toBe(300_000);
    c.stop();
  });

  it('agenda a próxima execução pelo intervalo e para no stop', async () => {
    const codex = fake('codex', snap('codex', 20));
    const c = new Collector({ providers: [codex], now: () => NOW });
    await c.start();
    expect(codex.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(codex.calls).toBe(2);
    c.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(codex.calls).toBe(2);
  });

  it('carrega o cache como stale e salva os últimos valores bons', async () => {
    const cache = memoryCache([snap('claude', 77)]);
    const listener = vi.fn();
    const c = new Collector({
      providers: [fake('claude', new StaleError('token expirado, abra o Claude Code')), fake('codex', snap('codex', 20))],
      now: () => NOW,
      cache,
    });
    c.subscribe(listener);
    await c.start();
    c.stop();
    expect(listener.mock.calls[0][0]).toEqual([{ ...snap('claude', 77), status: 'stale', note: 'último valor salvo' }]);
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'stale', note: 'token expirado, abra o Claude Code', limits: [{ usedPct: 77 }] });
    expect(cache.saved.at(-1)?.map((s) => s.agent).sort()).toEqual(['claude', 'codex']);
  });

  it('não chama fetch se o provedor não estiver instalado', async () => {
    const uninstalledProvider = {
      id: 'antigravity' as const,
      isInstalled: vi.fn(async () => false),
      fetch: vi.fn(async () => snap('antigravity', 50)),
    };
    const c = new Collector({ providers: [uninstalledProvider], now: () => NOW });
    await c.start();
    c.stop();
    expect(uninstalledProvider.fetch).not.toHaveBeenCalled();
    expect(byAgent(c, 'antigravity')).toEqual({
      agent: 'antigravity',
      status: 'not_installed',
      limits: [],
      fetchedAt: NOW,
      note: 'não instalado',
    });
  });

  it('re-detecta instalação quando refreshNow é chamado', async () => {
    let installed = false;
    const dynamicProvider = {
      id: 'codex' as const,
      isInstalled: vi.fn(async () => installed),
      fetch: vi.fn(async () => snap('codex', 15)),
    };
    const c = new Collector({ providers: [dynamicProvider], now: () => NOW });
    await c.start();
    expect(dynamicProvider.fetch).not.toHaveBeenCalled();
    expect(byAgent(c, 'codex')?.status).toBe('not_installed');

    installed = true;
    await c.refreshNow();
    expect(dynamicProvider.fetch).toHaveBeenCalledTimes(1);
    expect(byAgent(c, 'codex')?.status).toBe('live');
    c.stop();
  });

  it('formata nota amigável quando ocorre erro 429', async () => {
    const tooMany = new HttpStatusError(429);
    const c = new Collector({ providers: [fake('claude', tooMany)], now: () => NOW });
    await c.start();
    c.stop();
    expect(byAgent(c, 'claude')?.note).toBe('limite de requisições excedido (HTTP 429), aguardando liberação');
  });
});
