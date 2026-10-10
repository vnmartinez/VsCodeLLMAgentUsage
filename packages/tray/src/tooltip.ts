import { AGENTS, AGENT_LABEL, windowMax, type AgentSnapshot } from '@agent-usage/core';

const pct = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

/** Tooltip nativo da bandeja: uma linha por agente, até 127 caracteres. */
export function trayTooltip(snaps: AgentSnapshot[]): string {
  const lines = AGENTS.flatMap((id) => {
    const snap = snaps.find((s) => s.agent === id);
    if (snap?.status === 'not_installed') return [];
    if (!snap || snap.status === 'unavailable') return [`${AGENT_LABEL[id]}: indisponível`];
    return [`${AGENT_LABEL[id]}: ${pct(windowMax(snap, '5h'))} 5h · ${pct(windowMax(snap, 'weekly'))} sem`];
  });
  if (lines.length === 0) return 'Agent Usage: nenhum agente instalado';
  return lines.join('\n').slice(0, 127);
}
