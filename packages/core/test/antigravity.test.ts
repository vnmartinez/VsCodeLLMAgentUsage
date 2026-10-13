import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SourceFormatError, UnavailableError } from '../src/errors';
import {
  extractCsrfToken,
  parseDiscoveryOutput,
  parseQuotaSummary,
  type LanguageServer,
} from '../src/providers/antigravity/parse';
import { AntigravityProvider, QUOTA_PATH } from '../src/providers/antigravity/provider';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/antigravity-quota.json', import.meta.url)), 'utf8'),
);
const NOW = new Date('2026-09-21T19:00:00Z');

describe('parseQuotaSummary', () => {
  it('converte buckets em limites por grupo', () => {
    const snap = parseQuotaSummary(FIXTURE, NOW);
    expect(snap.status).toBe('live');
    expect(snap.limits).toHaveLength(4);
    const gemini5h = snap.limits.find((l) => l.group === 'Gemini' && l.window === '5h')!;
    expect(gemini5h.usedPct).toBeCloseTo(11.02, 2);
    expect(gemini5h.resetsAt).toEqual(new Date('2026-09-21T22:37:35Z'));
    const thirdPartyWeekly = snap.limits.find((l) => l.group === 'Claude/GPT' && l.window === 'weekly')!;
    expect(thirdPartyWeekly.usedPct).toBe(0);
  });

  it('trata remainingFraction ausente como zero (proto3 omite zero)', () => {
    const body = {
      response: { groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', resetTime: '2026-09-21T22:00:00Z' }] }] },
    };
    expect(parseQuotaSummary(body, NOW).limits[0].usedPct).toBe(100);
  });

  it('limita usedPct entre 0 e 100 mesmo com remainingFraction fora da faixa', () => {
    const body = {
      response: {
        groups: [
          {
            displayName: 'Gemini Models',
            buckets: [
              { window: '5h', remainingFraction: 1.5, resetTime: '2026-09-21T22:00:00Z' },
              { window: 'weekly', remainingFraction: -0.5, resetTime: '2026-09-21T22:00:00Z' },
            ],
          },
        ],
      },
    };
    const snap = parseQuotaSummary(body, NOW);
    expect(snap.limits[0].usedPct).toBe(0);
    expect(snap.limits[1].usedPct).toBe(100);
  });

  it('rejeita formatos inesperados', () => {
    expect(() => parseQuotaSummary({ response: {} }, NOW)).toThrow(SourceFormatError);
    const noWindows = { response: { groups: [{ displayName: 'X', buckets: [{ window: 'daily' }] }] } };
    expect(() => parseQuotaSummary(noWindows, NOW)).toThrow(SourceFormatError);
  });
});

describe('extractCsrfToken', () => {
  it('lê --csrf_token com espaço ou =', () => {
    expect(extractCsrfToken('ls.exe --standalone --csrf_token abc-123 --app_data_dir antigravity')).toBe('abc-123');
    expect(extractCsrfToken('ls.exe --csrf_token=abc')).toBe('abc');
  });

  it('ignora outras flags de token', () => {
    expect(extractCsrfToken('ls.exe --extension_server_csrf_token zzz')).toBeNull();
    expect(extractCsrfToken('ls.exe --standalone')).toBeNull();
  });
});

describe('parseDiscoveryOutput', () => {
  it('lê objeto único ou lista e ordena portas da maior para a menor', () => {
    expect(parseDiscoveryOutput('')).toEqual([]);
    expect(parseDiscoveryOutput('{"pid":7,"cmd":"ls.exe --csrf_token t1","ports":[51395,51396]}')).toEqual([
      { pid: 7, csrfToken: 't1', ports: [51396, 51395] },
    ]);
    const list = '[{"pid":7,"cmd":"ls.exe","ports":[1]},{"pid":8,"cmd":"ls.exe --csrf_token t2","ports":51396}]';
    expect(parseDiscoveryOutput(list)).toEqual([{ pid: 8, csrfToken: 't2', ports: [51396] }]);
  });

  it('rejeita saída que não é JSON', () => {
    expect(() => parseDiscoveryOutput('erro')).toThrow(SourceFormatError);
  });
});

describe('AntigravityProvider', () => {
  const server: LanguageServer = { pid: 1, csrfToken: 't1', ports: [51396, 51395] };

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  it('fica indisponível sem language_server', async () => {
    const provider = new AntigravityProvider({
      discover: async () => [],
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      now: () => NOW,
    });
    await expect(provider.fetch()).rejects.toMatchObject({ name: 'UnavailableError', quiet: true });
  });

  it('fica indisponível (quiet) quando aberto sem resposta de cota', async () => {
    const provider = new AntigravityProvider({
      discover: async () => [server],
      fetch: (async () => jsonResponse({ error: 'x' }, 400)) as unknown as typeof globalThis.fetch,
      now: () => NOW,
    });
    await expect(provider.fetch()).rejects.toMatchObject({ name: 'UnavailableError', quiet: true });
  });

  it('tenta as portas até uma responder e reaproveita o alvo', async () => {
    const discover = vi.fn(async () => [server]);
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes(':51396') ? jsonResponse({ error: 'https' }, 400) : jsonResponse(FIXTURE),
    );
    const provider = new AntigravityProvider({ discover, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });

    const snap = await provider.fetch();
    expect(snap.limits).toHaveLength(4);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe(`http://127.0.0.1:51395${QUOTA_PATH}`);
    expect(init?.headers).toMatchObject({ 'x-codeium-csrf-token': 't1' });

    await provider.fetch();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('redescobre quando o alvo em cache para de responder', async () => {
    const discover = vi.fn(async () => [server]);
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new TypeError('fetch failed');
      return jsonResponse(FIXTURE);
    });
    const provider = new AntigravityProvider({ discover, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });

    await provider.fetch();
    await provider.fetch();
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('propaga formato inesperado', async () => {
    const provider = new AntigravityProvider({
      discover: async () => [server],
      fetch: (async () => jsonResponse({ response: {} })) as unknown as typeof globalThis.fetch,
      now: () => NOW,
    });
    await expect(provider.fetch()).rejects.toBeInstanceOf(SourceFormatError);
  });
});
