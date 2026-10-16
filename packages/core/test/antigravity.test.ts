import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SourceFormatError, UnavailableError } from '../src/errors';
import { parseUsageOutput } from '../src/providers/antigravity/parse';
import { AntigravityProvider } from '../src/providers/antigravity/provider';

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/antigravity-quota.json', import.meta.url)), 'utf8');
const NOW = new Date('2026-09-21T19:00:00Z');

describe('parseUsageOutput', () => {
  it('converte buckets em limites por grupo, incluindo o Gemini 4 Argon', () => {
    const snap = parseUsageOutput(FIXTURE, NOW);
    expect(snap.status).toBe('live');
    expect(snap.limits).toHaveLength(5);
    const gemini5h = snap.limits.find((l) => l.group === 'Gemini' && l.window === '5h')!;
    expect(gemini5h.usedPct).toBeCloseTo(11.02, 2);
    expect(gemini5h.resetsAt).toEqual(new Date('2026-09-21T22:37:35Z'));
    const thirdPartyWeekly = snap.limits.find((l) => l.group === 'Claude/GPT' && l.window === 'weekly')!;
    expect(thirdPartyWeekly.usedPct).toBe(0);
    const argon = snap.limits.find((l) => l.group === 'Gemini 4')!;
    expect(argon.window).toBe('weekly');
    expect(argon.usedPct).toBeCloseTo(38.47, 2);
    expect(argon.resetsAt).toEqual(new Date('2026-09-24T23:07:24Z'));
  });

  it('trata remaining_fraction ausente como zero (valor zerado omitido)', () => {
    const body = {
      command: {
        name: 'usage',
        data: {
          groups: [
            { name: 'Gemini Models', buckets: [{ window: '5h', reset_time: '2026-09-21T22:00:00Z' }] },
          ],
        },
      },
    };
    expect(parseUsageOutput(JSON.stringify(body), NOW).limits[0].usedPct).toBe(100);
  });

  it('limita usedPct entre 0 e 100 mesmo com remaining_fraction fora da faixa', () => {
    const body = {
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                { window: '5h', remaining_fraction: 1.5, reset_time: '2026-09-21T22:00:00Z' },
                { window: 'weekly', remaining_fraction: -0.5, reset_time: '2026-09-21T22:00:00Z' },
              ],
            },
          ],
        },
      },
    };
    const snap = parseUsageOutput(JSON.stringify(body), NOW);
    expect(snap.limits[0].usedPct).toBe(0);
    expect(snap.limits[1].usedPct).toBe(100);
  });

  it('ignora janelas que não são 5h/weekly e rejeita formatos inesperados', () => {
    const withDaily = {
      command: {
        name: 'usage',
        data: {
          groups: [{ name: 'Gemini Models', buckets: [{ window: 'daily', remaining_fraction: 0.5, reset_time: 'x' }] }],
        },
      },
    };
    expect(() => parseUsageOutput(JSON.stringify(withDaily), NOW)).toThrow(SourceFormatError);
    const badBucket = {
      command: { name: 'usage', data: { groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 'x', reset_time: 'x' }] }] } },
    };
    expect(() => parseUsageOutput(JSON.stringify(badBucket), NOW)).toThrow(SourceFormatError);
  });

  it('trata agy antigo (sem o comando usage) e saída não-JSON como indisponível quieto', () => {
    expect(() => parseUsageOutput('erro de rede', NOW)).toThrow(UnavailableError);
    const oldAgy = JSON.stringify({ status: 'SUCCESS', response: 'Usage\n- Gemini Models: 3%' });
    expect(() => parseUsageOutput(oldAgy, NOW)).toThrow(UnavailableError);
  });
});

describe('AntigravityProvider', () => {
  it('usa a saída do agy e propaga falha de formato', async () => {
    const run = vi.fn(async () => FIXTURE);
    const provider = new AntigravityProvider({ run, now: () => NOW });

    const snap = await provider.fetch();
    expect(snap.limits).toHaveLength(5);
    expect(snap.fetchedAt).toEqual(NOW);

    const broken = new AntigravityProvider({
      run: async () =>
        JSON.stringify({ command: { name: 'usage', data: { groups: [{ name: 'X', buckets: [{ window: '5h', remaining_fraction: 1, reset_time: 'z' }] }] } } }),
      now: () => NOW,
    });
    expect((await broken.fetch()).limits[0].group).toBe('X');
    await expect(new AntigravityProvider({ run: async () => 'nao json', now: () => NOW }).fetch()).rejects.toMatchObject({
      name: 'UnavailableError',
      quiet: true,
    });
  });
});
