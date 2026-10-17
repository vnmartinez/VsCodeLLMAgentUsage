import type { AgentView, Band } from '@agent-usage/core';

const MARK: Record<Band, string> = { normal: '', warning: ' ⚠', critical: ' ⛔' };

export function tooltipMarkdown(views: AgentView[], version: string): string {
  const blocks = views.map((view) => {
    const lines = [`**${view.name}** · ${view.statusText}`];
    if (view.note) lines.push(`_${view.note}_`);
    for (const limit of view.limits) {
      lines.push(`${limit.label}: **${limit.usedPct}%**${MARK[limit.band]} · ${limit.resetText}`);
    }
    return lines.join('  \n');
  });
  return `**Agent Usage v${version}**\n\n${blocks.join('\n\n---\n\n')}\n\n_Clique para atualizar_`;
}
