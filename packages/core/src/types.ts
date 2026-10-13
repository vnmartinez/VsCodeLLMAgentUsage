export type AgentId = 'claude' | 'codex' | 'antigravity';
export type LimitWindow = '5h' | 'weekly';
export type SnapshotStatus = 'live' | 'stale' | 'unavailable' | 'not_installed';

export interface Limit {
  agent: AgentId;
  /** Só Antigravity: "Gemini" | "Claude/GPT". */
  group?: string;
  window: LimitWindow;
  /** 0–100, sempre % usado. */
  usedPct: number;
  /** null quando a janela não está ativa (sem uso ou já reiniciada). */
  resetsAt: Date | null;
}

export interface AgentSnapshot {
  agent: AgentId;
  status: SnapshotStatus;
  limits: Limit[];
  /** Quando o dado foi produzido na origem. */
  fetchedAt: Date;
  /** Motivo de stale/unavailable, mostrado ao usuário. */
  note?: string;
}

export interface Provider {
  readonly id: AgentId;
  isInstalled?(): Promise<boolean>;
  fetch(signal?: AbortSignal, opts?: { force?: boolean }): Promise<AgentSnapshot>;
}

export const AGENTS: AgentId[] = ['claude', 'codex', 'antigravity'];

export const AGENT_LABEL: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};
