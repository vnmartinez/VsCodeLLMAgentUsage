import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileCache } from './cache';
import { Collector } from './collector';
import { AntigravityProvider } from './providers/antigravity/provider';
import { runAgy } from './providers/antigravity/usage';
import { ClaudeProvider } from './providers/claude/provider';
import { CodexProvider } from './providers/codex/provider';
import type { AgentId } from './types';

export function createDefaultCollector(options: { intervalsMs?: Partial<Record<AgentId, number>> } = {}): Collector {
  const home = os.homedir();
  const now = () => new Date();
  return new Collector({
    providers: [
      new ClaudeProvider({
        credentialsPath: path.join(home, '.claude', '.credentials.json'),
        readFile: (file) => readFile(file, 'utf8'),
        fetch: globalThis.fetch,
        now,
        cooldownMs: 60_000,
      }),
      new CodexProvider({ sessionsDir: path.join(home, '.codex', 'sessions'), now }),
      new AntigravityProvider({ run: runAgy, now }),
    ],
    intervalsMs: options.intervalsMs,
    cache: fileCache(),
    now,
  });
}
