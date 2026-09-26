import type { AgentSnapshot } from '@agent-usage/core';
import { describe, expect, it } from 'vitest';
import { trayTooltip } from '../src/tooltip';

const NOW = new Date('2026-09-21T19:00:00Z');

const claude: AgentSnapshot = {
  agent: 'claude',
  status: 'live',
  fetchedAt: NOW,
  limits: [
    { agent: 'claude', window: '5h', usedPct: 12.4, resetsAt: NOW },
    { agent: 'claude', window: 'weekly', usedPct: 46, resetsAt: NOW },
  ],
};

describe('trayTooltip', () => {
  it('mostra uma linha por agente na ordem fixa', () => {
    const codex: AgentSnapshot = { agent: 'codex', status: 'unavailable', fetchedAt: NOW, limits: [] };
    expect(trayTooltip([codex, claude])).toBe(
      'Claude Code: 12% 5h · 46% sem\nCodex: indisponível\nAntigravity: indisponível',
    );
  });

  it('respeita o limite de 127 caracteres do Windows', () => {
    expect(trayTooltip([claude]).length).toBeLessThanOrEqual(127);
  });
});
