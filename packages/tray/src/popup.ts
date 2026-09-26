import type { AgentView, LimitView } from '@agent-usage/core';

declare global {
  interface Window {
    agentUsage: {
      onModel(callback: (views: AgentView[]) => void): void;
      getModel(): Promise<AgentView[]>;
    };
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // só textContent: nada de HTML vindo de fora
  return node;
}

function limitNode(limit: LimitView): HTMLElement {
  const node = el('div', 'limit');
  const row = el('div', 'row');
  row.append(el('span', undefined, `${limit.label}: ${limit.usedPct}%`), el('span', 'reset', limit.resetText));
  const track = el('div', 'track');
  const fill = el('div', `fill ${limit.band}`);
  fill.style.width = `${Math.min(100, Math.max(0, limit.usedPct))}%`;
  track.append(fill);
  node.append(row, track);
  return node;
}

function agentNode(view: AgentView): HTMLElement {
  const node = el('section', `agent ${view.status}`);
  const head = el('div', 'head');
  head.append(el('span', undefined, view.name), el('span', 'status', view.statusText));
  node.append(head);
  if (view.note) node.append(el('div', 'note', view.note));
  node.append(...view.limits.map(limitNode));
  return node;
}

function render(views: AgentView[]): void {
  document.getElementById('root')!.replaceChildren(...views.map(agentNode));
}

window.agentUsage.onModel(render);
void window.agentUsage.getModel().then(render);
