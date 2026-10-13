import type { SnapshotCache } from './cache';
import { HttpStatusError, SourceFormatError, UnavailableError } from './errors';
import type { AgentId, AgentSnapshot, Provider } from './types';

export const DEFAULT_INTERVALS_MS: Record<AgentId, number> = {
  claude: 300_000,
  codex: 60_000,
  antigravity: 60_000,
};

export interface CollectorOptions {
  providers: Provider[];
  intervalsMs?: Partial<Record<AgentId, number>>;
  timeoutMs?: number;
  maxBackoffMs?: number;
  now?: () => Date;
  cache?: SnapshotCache;
}

type Listener = (snaps: AgentSnapshot[]) => void;

export class Collector {
  private readonly snaps = new Map<AgentId, AgentSnapshot>();
  private readonly lastGood = new Map<AgentId, AgentSnapshot>();
  private readonly timers = new Map<AgentId, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<Listener>();
  private readonly baseInterval: Record<AgentId, number>;
  private readonly interval: Record<AgentId, number>;
  private readonly timeoutMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => Date;
  private readonly installedStatus = new Map<AgentId, boolean>();
  private stopped = true;

  constructor(private readonly options: CollectorOptions) {
    this.baseInterval = { ...DEFAULT_INTERVALS_MS, ...options.intervalsMs };
    this.interval = { ...this.baseInterval };
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 1_800_000;
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    this.stopped = false;
    for (const cached of (await this.options.cache?.load()) ?? []) {
      this.lastGood.set(cached.agent, cached);
      this.snaps.set(cached.agent, { ...cached, status: 'stale', note: cached.note ?? 'último valor salvo' });
    }
    if (this.snaps.size > 0) this.emit();
    await Promise.all(this.options.providers.map((p) => this.cycle(p)));
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  current(): AgentSnapshot[] {
    return [...this.snaps.values()];
  }

  async refreshNow(opts?: { force?: boolean }): Promise<void> {
    this.installedStatus.clear();
    await Promise.all(this.options.providers.map((p) => this.runOnce(p, opts)));
  }

  intervalOf(id: AgentId): number {
    return this.interval[id];
  }

  private async isProviderInstalled(provider: Provider): Promise<boolean> {
    if (this.installedStatus.has(provider.id)) {
      return this.installedStatus.get(provider.id)!;
    }
    const isInst = provider.isInstalled ? await provider.isInstalled() : true;
    this.installedStatus.set(provider.id, isInst);
    return isInst;
  }

  private async cycle(provider: Provider): Promise<void> {
    await this.runOnce(provider);
    if (this.stopped) return;
    const isInst = this.installedStatus.get(provider.id) ?? true;
    const nextInterval = isInst ? this.interval[provider.id] : 300_000;
    this.timers.set(
      provider.id,
      setTimeout(() => void this.cycle(provider), nextInterval),
    );
  }

  private async runOnce(provider: Provider, opts?: { force?: boolean }): Promise<void> {
    const isInst = await this.isProviderInstalled(provider);
    if (!isInst) {
      this.snaps.set(provider.id, {
        agent: provider.id,
        status: 'not_installed',
        limits: [],
        fetchedAt: this.now(),
        note: 'não instalado',
      });
      this.emit();
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('tempo esgotado'));
      }, this.timeoutMs);
    });
    try {
      const snap = await Promise.race([provider.fetch(controller.signal, opts), timeout]);
      this.lastGood.set(provider.id, snap);
      this.snaps.set(provider.id, snap);
      this.interval[provider.id] = this.baseInterval[provider.id];
    } catch (error) {
      this.snaps.set(provider.id, this.fromError(provider.id, error));
      if (error instanceof HttpStatusError && error.status === 429) {
        this.interval[provider.id] = Math.min(this.interval[provider.id] * 2, this.maxBackoffMs);
      }
    } finally {
      clearTimeout(timer);
    }
    this.emit();
    await this.options.cache?.save([...this.lastGood.values()]).catch(() => undefined);
  }

  private fromError(agent: AgentId, error: unknown): AgentSnapshot {
    let note = error instanceof Error ? error.message : String(error);
    if (error instanceof HttpStatusError && error.status === 429) {
      note = 'limite de requisições excedido (HTTP 429), aguardando liberação';
    }
    const last = this.lastGood.get(agent);
    if (error instanceof SourceFormatError) {
      return { agent, status: 'unavailable', limits: [], fetchedAt: this.now(), note };
    }
    if (error instanceof UnavailableError && error.quiet && last) return { ...last, status: 'live', note: undefined };
    if (error instanceof UnavailableError) {
      return { agent, status: 'unavailable', limits: last?.limits ?? [], fetchedAt: last?.fetchedAt ?? this.now(), note };
    }
    if (!last) return { agent, status: 'unavailable', limits: [], fetchedAt: this.now(), note };
    return { ...last, status: 'stale', note };
  }

  private emit(): void {
    const snaps = this.current();
    for (const listener of this.listeners) {
      try {
        listener(snaps);
      } catch {
        // um frontend com erro não derruba o coletor
      }
    }
  }
}
