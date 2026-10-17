import type { AgentView, LimitView } from '@agent-usage/core';

declare global {
  interface Window {
    agentUsage: {
      onModel(callback: (views: AgentView[]) => void): void;
      getModel(): Promise<AgentView[]>;
      getVersion(): Promise<string>;
      refreshNow(): Promise<void>;
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
  const root = document.getElementById('root')!;
  if (views.length === 0) {
    root.replaceChildren(el('div', 'empty', 'Nenhum agente instalado detectado (Claude Code, Codex ou Antigravity).'));
    return;
  }
  root.replaceChildren(...views.map(agentNode));
}

const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement | null;
if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '↻ Atualizando…';
    try {
      await window.agentUsage.refreshNow();
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻ Atualizar tudo';
    }
  });
}

window.agentUsage.onModel(render);
void window.agentUsage.getModel().then(render);

const versionLabel = document.getElementById('version');
if (versionLabel) void window.agentUsage.getVersion().then((v) => (versionLabel.textContent = `v${v}`));
