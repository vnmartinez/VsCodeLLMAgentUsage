import type { AgentView } from '@agent-usage/core';
import { describe, expect, it } from 'vitest';
import { tooltipMarkdown } from '../src/tooltip';

const VIEWS: AgentView[] = [
  {
    agent: 'claude',
    name: 'Claude Code',
    status: 'live',
    statusText: 'ativo',
    limits: [
      { label: '5h', usedPct: 12, band: 'normal', resetText: 'reinicia em 3h56' },
      { label: 'Semanal', usedPct: 96, band: 'critical', resetText: 'reinicia em 3d 6h' },
    ],
  },
  {
    agent: 'codex',
    name: 'Codex',
    status: 'unavailable',
    statusText: 'indisponível',
    note: 'nenhuma sessão do Codex nos últimos 7 dias',
    limits: [],
  },
];

describe('tooltipMarkdown', () => {
  it('lista agentes, janelas, marcas de faixa e notas', () => {
    const md = tooltipMarkdown(VIEWS);
    expect(md).toContain('**Claude Code** · ativo');
    expect(md).toContain('5h: **12%** · reinicia em 3h56');
    expect(md).toContain('Semanal: **96%** ⛔ · reinicia em 3d 6h');
    expect(md).toContain('**Codex** · indisponível');
    expect(md).toContain('_nenhuma sessão do Codex nos últimos 7 dias_');
    expect(md.endsWith('_Clique para atualizar_')).toBe(true);
  });
});
