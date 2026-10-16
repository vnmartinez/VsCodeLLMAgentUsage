import { isAntigravityInstalled } from '../../detection';
import type { AgentSnapshot, Provider } from '../../types';
import { parseUsageOutput } from './parse';
import type { RunAgy } from './usage';

export interface AntigravityDeps {
  run: RunAgy;
  now: () => Date;
  isInstalled?: () => Promise<boolean>;
}

export class AntigravityProvider implements Provider {
  readonly id = 'antigravity' as const;

  constructor(private readonly deps: AntigravityDeps) {}

  async isInstalled(): Promise<boolean> {
    if (this.deps.isInstalled) return this.deps.isInstalled();
    return isAntigravityInstalled();
  }

  async fetch(signal?: AbortSignal): Promise<AgentSnapshot> {
    return parseUsageOutput(await this.deps.run(signal), this.deps.now());
  }
}
