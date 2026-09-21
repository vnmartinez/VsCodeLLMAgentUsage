import { describe, expect, it } from 'vitest';
import {
  band,
  buildViewModel,
  formatCountdown,
  formatDuration,
  statusBarText,
  statusText,
  windowMax,
  worstBand,
  worstPct,
} from '../src/format';
import type { AgentSnapshot } from '../src/types';

const NOW = new Date('2026-09-21T19:00:00Z');

const claude: AgentSnapshot = {
  agent: 'claude',
  status: 'live',
  fetchedAt: NOW,
  limits: [
    { agent: 'claude', window: '5h', usedPct: 12, resetsAt: new Date('2026-09-21T22:56:00Z') },
    { agent: 'claude', window: 'weekly', usedPct: 46, resetsAt: new Date('2026-09-25T01:00:00Z') },
  ],
};

const codex: AgentSnapshot = {
  agent: 'codex',
  status: 'stale',
  fetchedAt: new Date('2026-09-21T18:35:00Z'),
  limits: [
    { agent: 'codex', window: '5h', usedPct: 58.4, resetsAt: new Date('2026-09-21T20:40:00Z') },
    { agent: 'codex', window: 'weekly', usedPct: 41, resetsAt: null },
  ],
};

const antigravity: AgentSnapshot = {
  agent: 'antigravity',
  status: 'live',
  fetchedAt: NOW,
  limits: [
    { agent: 'antigravity', group: 'Gemini', window: '5h', usedPct: 11.02, resetsAt: new Date('2026-09-21T22:37:35Z') },
    { agent: 'antigravity', group: 'Gemini', window: 'weekly', usedPct: 49.06, resetsAt: new Date('2026-09-23T03:24:57Z') },
    { agent: 'antigravity', group: 'Claude/GPT', window: '5h', usedPct: 96, resetsAt: new Date('2026-09-21T23:09:21Z') },
    { agent: 'antigravity', group: 'Claude/GPT', window: 'weekly', usedPct: 0, resetsAt: new Date('2026-09-28T18:09:21Z') },
  ],
};

describe('band', () => {
  it('separa as faixas em 80 e 95', () => {
    expect(band(79.9)).toBe('normal');
    expect(band(80)).toBe('warning');
    expect(band(94.9)).toBe('warning');
    expect(band(95)).toBe('critical');
  });
});

describe('formatDuration / formatCountdown', () => {
  it('formata minutos, horas e dias', () => {
    expect(formatDuration(30_000)).toBe('<1 min');
    expect(formatDuration(42 * 60_000)).toBe('42 min');
    expect(formatDuration((2 * 60 + 13) * 60_000)).toBe('2h13');
    expect(formatDuration((3 * 24 + 6) * 3_600_000 + 5 * 60_000)).toBe('3d 6h');
  });

  it('formata a contagem regressiva do reset', () => {
    expect(formatCountdown(new Date('2026-09-21T21:13:00Z'), NOW)).toBe('reinicia em 2h13');
    expect(formatCountdown(new Date('2026-09-21T18:00:00Z'), NOW)).toBe('reinicia agora');
    expect(formatCountdown(null, NOW)).toBe('sem janela ativa');
  });
});

describe('statusText', () => {
  it('descreve live, stale e unavailable', () => {
    expect(statusText(claude, NOW)).toBe('ao vivo');
    expect(statusText(codex, NOW)).toBe('lido há 25 min');
    expect(statusText({ ...claude, status: 'unavailable' }, NOW)).toBe('indisponível');
  });
});

describe('windowMax / worstPct / worstBand', () => {
  it('pega o maior % da janela entre grupos', () => {
    expect(windowMax(antigravity, '5h')).toBe(96);
    expect(windowMax(undefined, '5h')).toBeNull();
    expect(windowMax({ ...claude, status: 'unavailable' }, '5h')).toBeNull();
  });

  it('pega o pior % entre todos os agentes', () => {
    expect(worstPct([claude, codex, antigravity])).toBe(96);
    expect(worstBand([claude, codex, antigravity])).toBe('critical');
    expect(worstPct([])).toBeNull();
    expect(worstBand([])).toBeNull();
  });
});

describe('statusBarText', () => {
  it('mostra 5h/semanal por agente na ordem fixa', () => {
    expect(statusBarText([antigravity, codex, claude])).toBe('$(pulse) CC 12/46  CX 58/41  AG 96/49');
  });

  it('mostra -- para agente sem dado', () => {
    expect(statusBarText([claude])).toBe('$(pulse) CC 12/46  CX --  AG --');
  });
});

describe('buildViewModel', () => {
  it('monta as views na ordem fixa com rótulos e resets', () => {
    const views = buildViewModel([codex, antigravity], NOW);
    expect(views.map((v) => v.agent)).toEqual(['claude', 'codex', 'antigravity']);
    expect(views[0]).toMatchObject({ name: 'Claude Code', status: 'unavailable', statusText: 'carregando…', limits: [] });
    expect(views[1].statusText).toBe('lido há 25 min');
    expect(views[1].limits[0]).toEqual({ label: '5h', usedPct: 58, band: 'normal', resetText: 'reinicia em 1h40' });
    expect(views[1].limits[1]).toEqual({ label: 'Semanal', usedPct: 41, band: 'normal', resetText: 'sem janela ativa' });
    expect(views[2].limits[2]).toMatchObject({ label: 'Claude/GPT · 5h', usedPct: 96, band: 'critical' });
  });
});
