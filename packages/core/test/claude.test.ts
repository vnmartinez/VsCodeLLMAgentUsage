import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { HttpStatusError, SourceFormatError, StaleError, UnavailableError } from '../src/errors';
import { CLAUDE_USAGE_URL, ClaudeProvider } from '../src/providers/claude/provider';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/claude-usage.json', import.meta.url)), 'utf8'),
);
const NOW = new Date('2026-09-21T19:00:00Z');
const TOKEN = 'tok-secreto-de-teste';

function setup(opts: { expiresAt?: number; body?: unknown; status?: number; readFails?: boolean } = {}) {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(opts.body ?? FIXTURE), { status: opts.status ?? 200 }),
  );
  const provider = new ClaudeProvider({
    credentialsPath: 'credenciais.json',
    readFile: async () => {
      if (opts.readFails) throw new Error('ENOENT');
      return JSON.stringify({
        claudeAiOauth: { accessToken: TOKEN, refreshToken: 'r', expiresAt: opts.expiresAt ?? NOW.getTime() + 3_600_000 },
      });
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => NOW,
  });
  return { provider, fetch };
}

describe('ClaudeProvider', () => {
  it('lê as janelas de 5h e semanal', async () => {
    const { provider, fetch } = setup();
    const snap = await provider.fetch();
    expect(snap).toEqual({
      agent: 'claude',
      status: 'live',
      fetchedAt: NOW,
      limits: [
        { agent: 'claude', window: '5h', usedPct: 12, resetsAt: new Date('2026-09-21T23:00:00.745Z') },
        { agent: 'claude', window: 'weekly', usedPct: 46, resetsAt: new Date('2026-09-25T02:00:00.745Z') },
      ],
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(CLAUDE_USAGE_URL);
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'anthropic-beta': 'oauth-2025-04-20' });
  });

  it('aceita resets_at nulo', async () => {
    const body = { ...FIXTURE, five_hour: { utilization: 0, resets_at: null } };
    const snap = await setup({ body }).provider.fetch();
    expect(snap.limits[0]).toEqual({ agent: 'claude', window: '5h', usedPct: 0, resetsAt: null });
  });

  it('não chama a API com token expirado', async () => {
    const { provider, fetch } = setup({ expiresAt: NOW.getTime() - 1 });
    await expect(provider.fetch()).rejects.toThrow(new StaleError('token expirado, abra o Claude Code'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trata 401 como token recusado', async () => {
    await expect(setup({ status: 401 }).provider.fetch()).rejects.toThrow(
      new StaleError('token recusado, abra o Claude Code'),
    );
  });

  it('propaga 429 como HttpStatusError', async () => {
    const error = await setup({ status: 429 }).provider.fetch().catch((e) => e);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error.status).toBe(429);
  });

  it('fica indisponível sem arquivo de credenciais', async () => {
    await expect(setup({ readFails: true }).provider.fetch()).rejects.toBeInstanceOf(UnavailableError);
  });

  it('rejeita resposta com formato inesperado', async () => {
    await expect(setup({ body: { five_hour: null } }).provider.fetch()).rejects.toBeInstanceOf(SourceFormatError);
  });

  it('nunca expõe o token em mensagens de erro', async () => {
    const cases = [
      setup({ expiresAt: 0 }),
      setup({ status: 401 }),
      setup({ status: 500 }),
      setup({ body: {} }),
      setup({ readFails: true }),
    ];
    for (const { provider } of cases) {
      const error: Error = await provider.fetch().catch((e) => e);
      expect(`${error.name} ${error.message} ${error.stack}`).not.toContain(TOKEN);
    }
  });
});
