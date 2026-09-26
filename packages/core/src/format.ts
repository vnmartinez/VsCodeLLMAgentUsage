import { AGENTS, AGENT_LABEL, type AgentId, type AgentSnapshot, type LimitWindow, type SnapshotStatus } from './types';

export type Band = 'normal' | 'warning' | 'critical';

export function band(pct: number): Band {
  if (pct >= 95) return 'critical';
  if (pct >= 80) return 'warning';
  return 'normal';
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return '<1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) return `${totalH}h${String(totalMin % 60).padStart(2, '0')}`;
  return `${Math.floor(totalH / 24)}d ${totalH % 24}h`;
}

export function formatCountdown(resetsAt: Date | null, now: Date): string {
  if (!resetsAt) return 'sem janela ativa';
  const diff = resetsAt.getTime() - now.getTime();
  if (diff <= 0) return 'reinicia agora';
  return `reinicia em ${formatDuration(diff)}`;
}

export function statusText(snap: AgentSnapshot, now: Date): string {
  if (snap.status === 'live') return 'ao vivo';
  if (snap.status === 'stale') return `lido há ${formatDuration(now.getTime() - snap.fetchedAt.getTime())}`;
  return 'indisponível';
}

export function windowMax(snap: AgentSnapshot | undefined, window: LimitWindow): number | null {
  if (!snap || snap.status === 'unavailable') return null;
  const values = snap.limits.filter((l) => l.window === window).map((l) => l.usedPct);
  return values.length ? Math.max(...values) : null;
}

export function worstPct(snaps: AgentSnapshot[]): number | null {
  const values = snaps.filter((s) => s.status !== 'unavailable').flatMap((s) => s.limits.map((l) => l.usedPct));
  return values.length ? Math.max(...values) : null;
}

export function worstBand(snaps: AgentSnapshot[]): Band | null {
  const pct = worstPct(snaps);
  return pct === null ? null : band(pct);
}

const SHORT: Record<AgentId, string> = { claude: 'CC', codex: 'CX', antigravity: 'AG' };

function pctText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return String(Math.round(value));
}

export function statusBarText(snaps: AgentSnapshot[]): string {
  const parts = AGENTS.map((id) => {
    const snap = snaps.find((s) => s.agent === id);
    if (!snap || snap.status === 'unavailable') return `${SHORT[id]} --`;
    return `${SHORT[id]} ${pctText(windowMax(snap, '5h'))}/${pctText(windowMax(snap, 'weekly'))}`;
  });
  return `$(pulse) ${parts.join('  ')}`;
}

export interface LimitView {
  label: string;
  usedPct: number;
  band: Band;
  resetText: string;
}

export interface AgentView {
  agent: AgentId;
  name: string;
  status: SnapshotStatus;
  statusText: string;
  note?: string;
  limits: LimitView[];
}

const WINDOW_LABEL: Record<LimitWindow, string> = { '5h': '5h', weekly: 'Semanal' };

/** Modelo serializável (sem Date) para tooltip e popup. */
export function buildViewModel(snaps: AgentSnapshot[], now: Date): AgentView[] {
  return AGENTS.map((id) => {
    const snap = snaps.find((s) => s.agent === id);
    if (!snap) {
      return { agent: id, name: AGENT_LABEL[id], status: 'unavailable', statusText: 'carregando…', limits: [] };
    }
    return {
      agent: id,
      name: AGENT_LABEL[id],
      status: snap.status,
      statusText: statusText(snap, now),
      note: snap.note,
      limits: snap.limits.map((l) => ({
        label: l.group ? `${l.group} · ${WINDOW_LABEL[l.window]}` : WINDOW_LABEL[l.window],
        usedPct: Math.round(l.usedPct),
        band: band(l.usedPct),
        resetText: formatCountdown(l.resetsAt, now),
      })),
    };
  });
}
