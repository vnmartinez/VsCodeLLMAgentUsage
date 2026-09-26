# Agent Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, na status bar do VSCode e num ícone de bandeja do Windows, o % usado das janelas de 5h e semanal de Claude Code, Codex e Antigravity, com o horário de reset.

**Architecture:** Monorepo npm workspaces em TypeScript. `packages/core` tem um provider por agente (parse puro + I/O injetado), um coletor com intervalos, timeout, fallback e cache em disco, e funções de formatação compartilhadas. `packages/vscode` e `packages/tray` (Electron) importam o core, e o esbuild faz o bundle de cada um. Cada frontend roda o próprio coletor.

**Tech Stack:** Node 26, npm 11 workspaces, TypeScript (strict, só typecheck), vitest, esbuild, VSCode Extension API (`@types/vscode` ~1.100), `@vscode/vsce`, Electron, electron-builder (NSIS).

**Spec:** `docs/superpowers/specs/2026-09-21-agent-usage-design.md`

## Global Constraints

- Só Windows 11, uso pessoal. Sem publicação no Marketplace.
- Métrica única: % usado das janelas `5h` e `weekly` e o horário de reset. Sem tokens, custo, histórico ou notificações.
- Faixas: `normal` abaixo de 80, `warning` de 80 a 94, `critical` de 95 em diante.
- Intervalos padrão: Claude 300 000 ms; Codex e Antigravity 60 000 ms. Timeout de 5 000 ms por execução. Backoff do `429` dobra o intervalo até no máximo 1 800 000 ms.
- Codex é `live` se o evento tem menos de 10 min; senão `stale`.
- Tokens (OAuth do Claude, CSRF do Antigravity) só em memória. Nunca em log, cache, mensagem de erro ou saída de teste. Nunca escrever em `~/.claude`, `~/.codex` ou `~/.gemini`. Nunca renovar o token do Claude.
- Cache: `%APPDATA%\agent-usage\last.json`, só com agent, status, fetchedAt, note e limits (agent, group, window, usedPct, resetsAt).
- Nenhum teste acessa rede nem os diretórios reais dos agentes.
- Identificadores em inglês, textos de UI e docs em português.
- **Desvios da spec, decididos no plano:** `Limit.resetsAt` é `Date | null` (o Claude devolve `resets_at: null` para janela sem uso, e o Codex zera a janela já reiniciada); `Provider.fetch` recebe um `AbortSignal` opcional, que o coletor usa para abortar no timeout.
- Trabalhar numa branch `feat/agent-usage` (não na `main`). Cada commit termina com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

```
package.json                  workspaces, scripts test/typecheck
tsconfig.json                 typecheck de tudo (noEmit)
vitest.config.ts              inclui packages/*/test/**/*.test.ts
.gitignore
packages/core/
  package.json                main/types = src/index.ts (sem build próprio)
  src/types.ts                AgentId, LimitWindow, Limit, AgentSnapshot, Provider, AGENTS, AGENT_LABEL
  src/errors.ts               SourceFormatError, StaleError, UnavailableError, HttpStatusError
  src/format.ts               band, durações, statusBarText, buildViewModel...
  src/providers/codex/parse.ts      parse puro dos rollouts
  src/providers/codex/provider.ts   busca de arquivos + leitura do fim
  src/providers/claude/parse.ts     parse de credenciais e da resposta de usage
  src/providers/claude/provider.ts  HTTP para /api/oauth/usage
  src/providers/antigravity/parse.ts     parse da cota, do token CSRF e da descoberta
  src/providers/antigravity/discover.ts  PowerShell (Get-CimInstance / Get-NetTCPConnection)
  src/providers/antigravity/provider.ts  HTTP local + cache de alvo
  src/cache.ts                last.json (serialize/deserialize/fileCache)
  src/collector.ts            Collector
  src/defaults.ts             createDefaultCollector (liga tudo com I/O real)
  src/index.ts                exports públicos
  scripts/smoke.ts            verificação manual com dados reais
  test/fixtures/codex-rollout.jsonl, claude-usage.json, antigravity-quota.json
  test/*.test.ts
packages/vscode/
  package.json                manifest da extensão
  .vscodeignore, README.md
  src/tooltip.ts              AgentView[] -> markdown (puro)
  src/extension.ts            status bar + comando
  test/tooltip.test.ts
packages/tray/
  package.json                Electron + electron-builder
  src/icon.ts                 bitmap BGRA 32x32 com o número (puro)
  src/tooltip.ts              tooltip nativo (puro)
  src/main.ts                 Tray, popup, menu
  src/preload.ts              ponte IPC
  src/popup.html, src/popup.ts
  test/icon.test.ts, test/tooltip.test.ts
```

---

### Task 1: Scaffold do monorepo + tipos, erros e formatação do core

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/src/types.ts`, `packages/core/src/errors.ts`, `packages/core/src/format.ts`
- Test: `packages/core/test/format.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `types.ts`: `AgentId`, `LimitWindow`, `SnapshotStatus`, `Limit`, `AgentSnapshot`, `Provider { id: AgentId; fetch(signal?: AbortSignal): Promise<AgentSnapshot> }`, `AGENTS: AgentId[]`, `AGENT_LABEL: Record<AgentId, string>`
  - `errors.ts`: `SourceFormatError(detail)`, `StaleError(note)`, `UnavailableError(note)`, `HttpStatusError(status)` com `.status: number`
  - `format.ts`: `Band`, `band(pct): Band`, `formatDuration(ms): string`, `formatCountdown(resetsAt: Date | null, now: Date): string`, `statusText(snap, now): string`, `windowMax(snap | undefined, window): number | null`, `worstPct(snaps): number | null`, `worstBand(snaps): Band | null`, `statusBarText(snaps): string`, `LimitView`, `AgentView`, `buildViewModel(snaps, now): AgentView[]`

- [x] **Step 1: Criar a branch e os arquivos de raiz**

```bash
git checkout -b feat/agent-usage
```

`package.json`:
```json
{
  "name": "agent-usage-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": [
    "packages/*/src/**/*.ts",
    "packages/*/test/**/*.ts",
    "packages/*/scripts/**/*.ts",
    "vitest.config.ts"
  ]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules/
dist/
release/
*.vsix
```

`packages/core/package.json`:
```json
{
  "name": "@agent-usage/core",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [x] **Step 2: Instalar as dependências de desenvolvimento**

Run: `npm install -D typescript vitest @types/node esbuild`
Expected: cria `node_modules/` e `package-lock.json`, sem erros.

- [x] **Step 3: Escrever `types.ts` e `errors.ts`**

`packages/core/src/types.ts`:
```ts
export type AgentId = 'claude' | 'codex' | 'antigravity';
export type LimitWindow = '5h' | 'weekly';
export type SnapshotStatus = 'live' | 'stale' | 'unavailable';

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
  fetch(signal?: AbortSignal): Promise<AgentSnapshot>;
}

export const AGENTS: AgentId[] = ['claude', 'codex', 'antigravity'];

export const AGENT_LABEL: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};
```

`packages/core/src/errors.ts`:
```ts
/** A fonte respondeu num formato desconhecido: não mostrar números. */
export class SourceFormatError extends Error {
  constructor(detail: string) {
    super(`formato da fonte mudou (${detail})`);
    this.name = 'SourceFormatError';
  }
}

/** Não dá para ler agora; o coletor mostra o último valor bom como stale. */
export class StaleError extends Error {
  constructor(note: string) {
    super(note);
    this.name = 'StaleError';
  }
}

/** A fonte não existe agora (processo fechado, sem login, sem sessões). */
export class UnavailableError extends Error {
  constructor(note: string) {
    super(note);
    this.name = 'UnavailableError';
  }
}

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}
```

- [x] **Step 4: Escrever o teste de formatação (falhando)**

`packages/core/test/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  band,
  buildViewModel,
  formatCountdown,
  formatDuration,
  statusBarText,
  statusText,
  windowMax,
  worstBand,
  worstPct,
} from '../src/format';
import type { AgentSnapshot } from '../src/types';

const NOW = new Date('2026-09-21T19:00:00Z');

const claude: AgentSnapshot = {
  agent: 'claude',
  status: 'live',
  fetchedAt: NOW,
  limits: [
    { agent: 'claude', window: '5h', usedPct: 12, resetsAt: new Date('2026-09-21T22:56:00Z') },
    { agent: 'claude', window: 'weekly', usedPct: 46, resetsAt: new Date('2026-09-25T01:00:00Z') },
  ],
};

const codex: AgentSnapshot = {
  agent: 'codex',
  status: 'stale',
  fetchedAt: new Date('2026-09-21T18:35:00Z'),
  limits: [
    { agent: 'codex', window: '5h', usedPct: 58.4, resetsAt: new Date('2026-09-21T20:40:00Z') },
    { agent: 'codex', window: 'weekly', usedPct: 41, resetsAt: null },
  ],
};

const antigravity: AgentSnapshot = {
  agent: 'antigravity',
  status: 'live',
  fetchedAt: NOW,
  limits: [
    { agent: 'antigravity', group: 'Gemini', window: '5h', usedPct: 11.02, resetsAt: new Date('2026-09-21T22:37:35Z') },
    { agent: 'antigravity', group: 'Gemini', window: 'weekly', usedPct: 49.06, resetsAt: new Date('2026-09-23T03:24:57Z') },
    { agent: 'antigravity', group: 'Claude/GPT', window: '5h', usedPct: 96, resetsAt: new Date('2026-09-21T23:09:21Z') },
    { agent: 'antigravity', group: 'Claude/GPT', window: 'weekly', usedPct: 0, resetsAt: new Date('2026-09-28T18:09:21Z') },
  ],
};

describe('band', () => {
  it('separa as faixas em 80 e 95', () => {
    expect(band(79.9)).toBe('normal');
    expect(band(80)).toBe('warning');
    expect(band(94.9)).toBe('warning');
    expect(band(95)).toBe('critical');
  });
});

describe('formatDuration / formatCountdown', () => {
  it('formata minutos, horas e dias', () => {
    expect(formatDuration(30_000)).toBe('<1 min');
    expect(formatDuration(42 * 60_000)).toBe('42 min');
    expect(formatDuration((2 * 60 + 13) * 60_000)).toBe('2h13');
    expect(formatDuration((3 * 24 + 6) * 3_600_000 + 5 * 60_000)).toBe('3d 6h');
  });

  it('formata a contagem regressiva do reset', () => {
    expect(formatCountdown(new Date('2026-09-21T21:13:00Z'), NOW)).toBe('reinicia em 2h13');
    expect(formatCountdown(new Date('2026-09-21T18:00:00Z'), NOW)).toBe('reinicia agora');
    expect(formatCountdown(null, NOW)).toBe('sem janela ativa');
  });
});

describe('statusText', () => {
  it('descreve live, stale e unavailable', () => {
    expect(statusText(claude, NOW)).toBe('ao vivo');
    expect(statusText(codex, NOW)).toBe('lido há 25 min');
    expect(statusText({ ...claude, status: 'unavailable' }, NOW)).toBe('indisponível');
  });
});

describe('windowMax / worstPct / worstBand', () => {
  it('pega o maior % da janela entre grupos', () => {
    expect(windowMax(antigravity, '5h')).toBe(96);
    expect(windowMax(undefined, '5h')).toBeNull();
    expect(windowMax({ ...claude, status: 'unavailable' }, '5h')).toBeNull();
  });

  it('pega o pior % entre todos os agentes', () => {
    expect(worstPct([claude, codex, antigravity])).toBe(96);
    expect(worstBand([claude, codex, antigravity])).toBe('critical');
    expect(worstPct([])).toBeNull();
    expect(worstBand([])).toBeNull();
  });
});

describe('statusBarText', () => {
  it('mostra 5h/semanal por agente na ordem fixa', () => {
    expect(statusBarText([antigravity, codex, claude])).toBe('$(pulse) CC 12/46  CX 58/41  AG 96/49');
  });

  it('mostra -- para agente sem dado', () => {
    expect(statusBarText([claude])).toBe('$(pulse) CC 12/46  CX --  AG --');
  });
});

describe('buildViewModel', () => {
  it('monta as views na ordem fixa com rótulos e resets', () => {
    const views = buildViewModel([codex, antigravity], NOW);
    expect(views.map((v) => v.agent)).toEqual(['claude', 'codex', 'antigravity']);
    expect(views[0]).toMatchObject({ name: 'Claude Code', status: 'unavailable', statusText: 'carregando…', limits: [] });
    expect(views[1].statusText).toBe('lido há 25 min');
    expect(views[1].limits[0]).toEqual({ label: '5h', usedPct: 58, band: 'normal', resetText: 'reinicia em 1h40' });
    expect(views[1].limits[1]).toEqual({ label: 'Semanal', usedPct: 41, band: 'normal', resetText: 'sem janela ativa' });
    expect(views[2].limits[2]).toMatchObject({ label: 'Claude/GPT · 5h', usedPct: 96, band: 'critical' });
  });
});
```

- [x] **Step 5: Rodar o teste para ver falhar**

Run: `npx vitest run packages/core/test/format.test.ts`
Expected: FAIL, "Failed to resolve import ../src/format".

- [x] **Step 6: Implementar `format.ts`**

`packages/core/src/format.ts`:
```ts
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
  return value === null ? '--' : String(Math.round(value));
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
```

- [x] **Step 7: Rodar testes e typecheck**

Run: `npx vitest run packages/core/test/format.test.ts`
Expected: PASS (10 testes).

Run: `npm run typecheck`
Expected: sem erros.

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore packages/core
git commit -m "feat(core): scaffold do monorepo, tipos, erros e formatação

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Provider do Codex

**Files:**
- Create: `packages/core/src/providers/codex/parse.ts`, `packages/core/src/providers/codex/provider.ts`
- Create: `packages/core/test/fixtures/codex-rollout.jsonl`
- Test: `packages/core/test/codex.test.ts`

**Interfaces:**
- Consumes: `AgentSnapshot`, `Limit`, `LimitWindow`, `Provider` (types.ts); `SourceFormatError`, `UnavailableError` (errors.ts).
- Produces:
  - `parse.ts`: `CodexReading { timestamp: Date; windows: RawWindow[] }`, `CODEX_LIVE_MS = 600_000`, `parseCodexLine(line: string): CodexReading | null`, `findLatestReading(text: string): CodexReading | null`, `codexSnapshot(reading: CodexReading, now: Date): AgentSnapshot`
  - `provider.ts`: `CodexDeps { sessionsDir: string; now: () => Date }`, `class CodexProvider implements Provider` (`id = 'codex'`)

- [x] **Step 1: Criar a fixture**

`packages/core/test/fixtures/codex-rollout.jsonl` (3 linhas; a do meio foi copiada de um rollout real e reduzida):
```
{"timestamp":"2026-09-21T15:30:00.000Z","type":"session_meta","payload":{"id":"sessao-teste"}}
{"timestamp":"2026-09-21T15:32:42.157Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":28080,"output_tokens":441,"total_tokens":28521}},"rate_limits":{"limit_id":"codex","primary":{"used_percent":58.0,"window_minutes":300,"resets_at":1790010864},"secondary":{"used_percent":41.0,"window_minutes":10080,"resets_at":1790527570},"plan_type":"plus","rate_limit_reached_type":null}}}
{"timestamp":"2026-09-21T15:32:50.000Z","type":"event_msg","payload":{"type":"agent_message","message":"ok"}}
```
Para referência: `1790010864` é `2026-09-21T17:14:24Z` e `1790527570` é `2026-09-27T16:46:10Z`.

- [x] **Step 2: Escrever o teste (falhando)**

`packages/core/test/codex.test.ts`:
```ts
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SourceFormatError, UnavailableError } from '../src/errors';
import { codexSnapshot, findLatestReading, parseCodexLine } from '../src/providers/codex/parse';
import { CodexProvider } from '../src/providers/codex/provider';

const FIXTURE = fileURLToPath(new URL('./fixtures/codex-rollout.jsonl', import.meta.url));
const LIVE_NOW = new Date('2026-09-21T15:35:00Z');

async function fixtureText(): Promise<string> {
  return readFile(FIXTURE, 'utf8');
}

describe('parseCodexLine', () => {
  it('ignora linhas sem rate_limits ou de outro tipo', () => {
    expect(parseCodexLine('{"type":"session_meta","payload":{}}')).toBeNull();
    expect(parseCodexLine('{"type":"event_msg","payload":{"type":"agent_message","rate_limits":1}}')).toBeNull();
    expect(parseCodexLine('{"rate_limits": trunc')).toBeNull();
  });

  it('lê o evento token_count', async () => {
    const line = (await fixtureText()).split('\n')[1];
    const reading = parseCodexLine(line);
    expect(reading?.timestamp.toISOString()).toBe('2026-09-21T15:32:42.157Z');
    expect(reading?.windows).toHaveLength(2);
  });

  it('rejeita rate_limits com formato inesperado', () => {
    const line = '{"timestamp":"2026-09-21T15:32:42Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"window_minutes":300},"secondary":null}}}';
    expect(() => parseCodexLine(line)).toThrow(SourceFormatError);
  });
});

describe('codexSnapshot', () => {
  it('fica live com leitura recente', async () => {
    const snap = codexSnapshot(findLatestReading(await fixtureText())!, LIVE_NOW);
    expect(snap).toEqual({
      agent: 'codex',
      status: 'live',
      fetchedAt: new Date('2026-09-21T15:32:42.157Z'),
      note: undefined,
      limits: [
        { agent: 'codex', window: '5h', usedPct: 58, resetsAt: new Date('2026-09-21T17:14:24Z') },
        { agent: 'codex', window: 'weekly', usedPct: 41, resetsAt: new Date('2026-09-27T16:46:10Z') },
      ],
    });
  });

  it('fica stale com leitura de mais de 10 min', async () => {
    const snap = codexSnapshot(findLatestReading(await fixtureText())!, new Date('2026-09-21T16:00:00Z'));
    expect(snap.status).toBe('stale');
  });

  it('zera a janela que já reiniciou', async () => {
    const snap = codexSnapshot(findLatestReading(await fixtureText())!, new Date('2026-09-21T18:00:00Z'));
    expect(snap.limits[0]).toEqual({ agent: 'codex', window: '5h', usedPct: 0, resetsAt: null });
    expect(snap.limits[1].usedPct).toBe(41);
    expect(snap.note).toBe('janela reiniciada desde a última leitura');
  });

  it('rejeita janela de duração desconhecida', async () => {
    const reading = findLatestReading(await fixtureText())!;
    reading.windows[0].window_minutes = 60;
    expect(() => codexSnapshot(reading, LIVE_NOW)).toThrow(SourceFormatError);
  });
});

describe('CodexProvider', () => {
  let root: string;

  function dayDir(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return path.join(root, String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()));
  }

  async function writeRollout(date: Date, name: string, content: string, mtime: Date): Promise<void> {
    const dir = dayDir(date);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await writeFile(file, content);
    await utimes(file, mtime, mtime);
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'codex-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('usa o rollout mais recente que tem rate_limits', async () => {
    const text = await fixtureText();
    const newer = text.replace('"used_percent":58.0', '"used_percent":70.0');
    await writeRollout(LIVE_NOW, 'rollout-a.jsonl', text, new Date('2026-09-21T15:00:00Z'));
    await writeRollout(LIVE_NOW, 'rollout-b.jsonl', newer, new Date('2026-09-21T15:10:00Z'));
    await writeRollout(LIVE_NOW, 'rollout-c.jsonl', text.split('\n')[0], new Date('2026-09-21T15:20:00Z'));

    const snap = await new CodexProvider({ sessionsDir: root, now: () => LIVE_NOW }).fetch();
    expect(snap.limits[0].usedPct).toBe(70);
  });

  it('procura nos dias anteriores', async () => {
    const yesterday = new Date(LIVE_NOW.getTime() - 24 * 3_600_000);
    await writeRollout(yesterday, 'rollout-a.jsonl', await fixtureText(), yesterday);

    const snap = await new CodexProvider({ sessionsDir: root, now: () => LIVE_NOW }).fetch();
    expect(snap.limits[1].usedPct).toBe(41);
  });

  it('fica indisponível sem sessões', async () => {
    const provider = new CodexProvider({ sessionsDir: path.join(root, 'nao-existe'), now: () => LIVE_NOW });
    await expect(provider.fetch()).rejects.toBeInstanceOf(UnavailableError);
  });
});
```

- [x] **Step 3: Rodar o teste para ver falhar**

Run: `npx vitest run packages/core/test/codex.test.ts`
Expected: FAIL, "Failed to resolve import ../src/providers/codex/parse".

- [x] **Step 4: Implementar `parse.ts`**

`packages/core/src/providers/codex/parse.ts`:
```ts
import { SourceFormatError } from '../../errors';
import type { AgentSnapshot, Limit, LimitWindow } from '../../types';

interface RawWindow {
  used_percent: number;
  window_minutes: number;
  resets_at: number;
}

export interface CodexReading {
  timestamp: Date;
  windows: RawWindow[];
}

export const CODEX_LIVE_MS = 10 * 60_000;

const WINDOW_BY_MINUTES: Record<number, LimitWindow> = { 300: '5h', 10080: 'weekly' };

function isRawWindow(value: unknown): value is RawWindow {
  const w = value as RawWindow | null;
  return (
    !!w &&
    typeof w.used_percent === 'number' &&
    typeof w.window_minutes === 'number' &&
    typeof w.resets_at === 'number'
  );
}

export function parseCodexLine(line: string): CodexReading | null {
  if (!line.includes('"rate_limits"')) return null;
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null; // linha cortada no início do trecho lido
  }
  const payload = obj?.payload;
  if (obj?.type !== 'event_msg' || payload?.type !== 'token_count' || !payload.rate_limits) return null;
  const { primary, secondary } = payload.rate_limits;
  if (!isRawWindow(primary) || !isRawWindow(secondary)) throw new SourceFormatError('codex rate_limits');
  const timestamp = new Date(obj.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw new SourceFormatError('codex timestamp');
  return { timestamp, windows: [primary, secondary] };
}

export function findLatestReading(text: string): CodexReading | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const reading = parseCodexLine(lines[i]);
    if (reading) return reading;
  }
  return null;
}

export function codexSnapshot(reading: CodexReading, now: Date): AgentSnapshot {
  let reset = false;
  const limits: Limit[] = reading.windows.map((w) => {
    const window = WINDOW_BY_MINUTES[w.window_minutes];
    if (!window) throw new SourceFormatError(`codex window_minutes=${w.window_minutes}`);
    const resetsAt = new Date(w.resets_at * 1000);
    if (resetsAt.getTime() <= now.getTime()) {
      reset = true;
      return { agent: 'codex', window, usedPct: 0, resetsAt: null };
    }
    return { agent: 'codex', window, usedPct: w.used_percent, resetsAt };
  });
  const age = now.getTime() - reading.timestamp.getTime();
  return {
    agent: 'codex',
    status: age < CODEX_LIVE_MS ? 'live' : 'stale',
    limits,
    fetchedAt: reading.timestamp,
    note: reset ? 'janela reiniciada desde a última leitura' : undefined,
  };
}
```

- [x] **Step 5: Implementar `provider.ts`**

`packages/core/src/providers/codex/provider.ts`:
```ts
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { codexSnapshot, findLatestReading } from './parse';

export interface CodexDeps {
  sessionsDir: string;
  now: () => Date;
}

const LOOKBACK_DAYS = 7;
const MAX_FILES = 10;
const TAIL_BYTES = 256 * 1024;

const pad = (n: number) => String(n).padStart(2, '0');

async function readTail(file: string, bytes: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Rollouts dos últimos dias (pastas AAAA/MM/DD em data local), mais recentes primeiro. */
async function recentRollouts(root: string, now: Date): Promise<string[]> {
  const found: { file: string; mtime: number }[] = [];
  for (let d = 0; d < LOOKBACK_DAYS; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const dir = path.join(root, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      found.push({ file, mtime: (await stat(file)).mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

export class CodexProvider implements Provider {
  readonly id = 'codex' as const;

  constructor(private readonly deps: CodexDeps) {}

  async fetch(): Promise<AgentSnapshot> {
    const now = this.deps.now();
    const files = await recentRollouts(this.deps.sessionsDir, now);
    if (files.length === 0) throw new UnavailableError('nenhuma sessão do Codex nos últimos 7 dias');
    for (const file of files.slice(0, MAX_FILES)) {
      const reading =
        findLatestReading(await readTail(file, TAIL_BYTES)) ??
        findLatestReading(await readTail(file, Number.MAX_SAFE_INTEGER));
      if (reading) return codexSnapshot(reading, now);
    }
    throw new UnavailableError('sem dados de limite nas sessões recentes do Codex');
  }
}
```

- [x] **Step 6: Rodar testes e typecheck**

Run: `npx vitest run packages/core/test/codex.test.ts`
Expected: PASS (10 testes).

Run: `npm run typecheck`
Expected: sem erros.

- [x] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): provider do Codex a partir dos rollouts locais

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Provider do Claude Code

**Files:**
- Create: `packages/core/src/providers/claude/parse.ts`, `packages/core/src/providers/claude/provider.ts`
- Create: `packages/core/test/fixtures/claude-usage.json`
- Test: `packages/core/test/claude.test.ts`

**Interfaces:**
- Consumes: `AgentSnapshot`, `Limit`, `LimitWindow`, `Provider`; `SourceFormatError`, `StaleError`, `UnavailableError`, `HttpStatusError`.
- Produces:
  - `parse.ts`: `ClaudeCredentials { accessToken: string; expiresAt: Date }`, `parseCredentials(text: string): ClaudeCredentials`, `parseClaudeUsage(json: unknown, fetchedAt: Date): AgentSnapshot`
  - `provider.ts`: `CLAUDE_USAGE_URL`, `ClaudeDeps { credentialsPath: string; readFile: (path: string) => Promise<string>; fetch: typeof fetch; now: () => Date }`, `class ClaudeProvider implements Provider` (`id = 'claude'`)

- [x] **Step 1: Criar a fixture**

`packages/core/test/fixtures/claude-usage.json` (resposta real reduzida):
```json
{
  "five_hour": { "utilization": 12.0, "resets_at": "2026-09-21T23:00:00.745577+00:00", "limit_dollars": null },
  "seven_day": { "utilization": 46.0, "resets_at": "2026-09-25T02:00:00.745606+00:00", "limit_dollars": null },
  "seven_day_opus": null,
  "limits": [
    { "kind": "session", "group": "session", "percent": 12, "severity": "normal", "resets_at": "2026-09-21T23:00:00.745577+00:00" }
  ]
}
```

- [x] **Step 2: Escrever o teste (falhando)**

`packages/core/test/claude.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { HttpStatusError, SourceFormatError, StaleError, UnavailableError } from '../src/errors';
import { CLAUDE_USAGE_URL, ClaudeProvider } from '../src/providers/claude/provider';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/claude-usage.json', import.meta.url)), 'utf8'),
);
const NOW = new Date('2026-09-21T19:00:00Z');
const TOKEN = 'tok-secreto-de-teste';

function setup(opts: { expiresAt?: number; body?: unknown; status?: number; readFails?: boolean } = {}) {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(opts.body ?? FIXTURE), { status: opts.status ?? 200 }),
  );
  const provider = new ClaudeProvider({
    credentialsPath: 'credenciais.json',
    readFile: async () => {
      if (opts.readFails) throw new Error('ENOENT');
      return JSON.stringify({
        claudeAiOauth: { accessToken: TOKEN, refreshToken: 'r', expiresAt: opts.expiresAt ?? NOW.getTime() + 3_600_000 },
      });
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => NOW,
  });
  return { provider, fetch };
}

describe('ClaudeProvider', () => {
  it('lê as janelas de 5h e semanal', async () => {
    const { provider, fetch } = setup();
    const snap = await provider.fetch();
    expect(snap).toEqual({
      agent: 'claude',
      status: 'live',
      fetchedAt: NOW,
      limits: [
        { agent: 'claude', window: '5h', usedPct: 12, resetsAt: new Date('2026-09-21T23:00:00.745Z') },
        { agent: 'claude', window: 'weekly', usedPct: 46, resetsAt: new Date('2026-09-25T02:00:00.745Z') },
      ],
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(CLAUDE_USAGE_URL);
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'anthropic-beta': 'oauth-2025-04-20' });
  });

  it('aceita resets_at nulo', async () => {
    const body = { ...FIXTURE, five_hour: { utilization: 0, resets_at: null } };
    const snap = await setup({ body }).provider.fetch();
    expect(snap.limits[0]).toEqual({ agent: 'claude', window: '5h', usedPct: 0, resetsAt: null });
  });

  it('não chama a API com token expirado', async () => {
    const { provider, fetch } = setup({ expiresAt: NOW.getTime() - 1 });
    await expect(provider.fetch()).rejects.toThrow(new StaleError('token expirado, abra o Claude Code'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trata 401 como token recusado', async () => {
    await expect(setup({ status: 401 }).provider.fetch()).rejects.toThrow(
      new StaleError('token recusado, abra o Claude Code'),
    );
  });

  it('propaga 429 como HttpStatusError', async () => {
    const error = await setup({ status: 429 }).provider.fetch().catch((e) => e);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error.status).toBe(429);
  });

  it('fica indisponível sem arquivo de credenciais', async () => {
    await expect(setup({ readFails: true }).provider.fetch()).rejects.toBeInstanceOf(UnavailableError);
  });

  it('rejeita resposta com formato inesperado', async () => {
    await expect(setup({ body: { five_hour: null } }).provider.fetch()).rejects.toBeInstanceOf(SourceFormatError);
  });

  it('nunca expõe o token em mensagens de erro', async () => {
    const cases = [
      setup({ expiresAt: 0 }),
      setup({ status: 401 }),
      setup({ status: 500 }),
      setup({ body: {} }),
      setup({ readFails: true }),
    ];
    for (const { provider } of cases) {
      const error: Error = await provider.fetch().catch((e) => e);
      expect(`${error.name} ${error.message} ${error.stack}`).not.toContain(TOKEN);
    }
  });
});
```

- [x] **Step 3: Rodar o teste para ver falhar**

Run: `npx vitest run packages/core/test/claude.test.ts`
Expected: FAIL, "Failed to resolve import ../src/providers/claude/provider".

- [x] **Step 4: Implementar `parse.ts`**

`packages/core/src/providers/claude/parse.ts`:
```ts
import { SourceFormatError } from '../../errors';
import type { AgentSnapshot, Limit, LimitWindow } from '../../types';

export interface ClaudeCredentials {
  accessToken: string;
  expiresAt: Date;
}

export function parseCredentials(text: string): ClaudeCredentials {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new SourceFormatError('credenciais do claude');
  }
  const oauth = obj?.claudeAiOauth;
  if (typeof oauth?.accessToken !== 'string' || typeof oauth?.expiresAt !== 'number') {
    throw new SourceFormatError('credenciais do claude');
  }
  return { accessToken: oauth.accessToken, expiresAt: new Date(oauth.expiresAt) };
}

function parseWindow(raw: any, window: LimitWindow): Limit {
  const validReset = raw?.resets_at === null || typeof raw?.resets_at === 'string';
  if (typeof raw?.utilization !== 'number' || !validReset) throw new SourceFormatError(`claude ${window}`);
  return {
    agent: 'claude',
    window,
    usedPct: raw.utilization,
    resetsAt: raw.resets_at ? new Date(raw.resets_at) : null,
  };
}

export function parseClaudeUsage(json: unknown, fetchedAt: Date): AgentSnapshot {
  const body = json as any;
  return {
    agent: 'claude',
    status: 'live',
    fetchedAt,
    limits: [parseWindow(body?.five_hour, '5h'), parseWindow(body?.seven_day, 'weekly')],
  };
}
```

- [x] **Step 5: Implementar `provider.ts`**

`packages/core/src/providers/claude/provider.ts`:
```ts
import { HttpStatusError, StaleError, UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { parseClaudeUsage, parseCredentials } from './parse';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export interface ClaudeDeps {
  credentialsPath: string;
  readFile: (path: string) => Promise<string>;
  fetch: typeof fetch;
  now: () => Date;
}

/** Só lê o token do Claude Code. Nunca renova nem grava o arquivo de credenciais. */
export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const;

  constructor(private readonly deps: ClaudeDeps) {}

  async fetch(signal?: AbortSignal): Promise<AgentSnapshot> {
    let text: string;
    try {
      text = await this.deps.readFile(this.deps.credentialsPath);
    } catch {
      throw new UnavailableError('Claude Code sem login neste usuário');
    }
    const credentials = parseCredentials(text);
    if (credentials.expiresAt.getTime() <= this.deps.now().getTime()) {
      throw new StaleError('token expirado, abra o Claude Code');
    }
    const response = await this.deps.fetch(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new StaleError('token recusado, abra o Claude Code');
    }
    if (!response.ok) throw new HttpStatusError(response.status);
    return parseClaudeUsage(await response.json(), this.deps.now());
  }
}
```

- [x] **Step 6: Rodar testes e typecheck**

Run: `npx vitest run packages/core/test/claude.test.ts`
Expected: PASS (8 testes).

Run: `npm run typecheck`
Expected: sem erros.

- [x] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): provider do Claude Code via /api/oauth/usage

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Provider do Antigravity

**Files:**
- Create: `packages/core/src/providers/antigravity/parse.ts`, `packages/core/src/providers/antigravity/discover.ts`, `packages/core/src/providers/antigravity/provider.ts`
- Create: `packages/core/test/fixtures/antigravity-quota.json`
- Test: `packages/core/test/antigravity.test.ts`

**Interfaces:**
- Consumes: `AgentSnapshot`, `Limit`, `Provider`; `SourceFormatError`, `UnavailableError`, `HttpStatusError`.
- Produces:
  - `parse.ts`: `LanguageServer { pid: number; csrfToken: string; ports: number[] }`, `extractCsrfToken(commandLine: string): string | null`, `parseDiscoveryOutput(stdout: string): LanguageServer[]`, `parseQuotaSummary(json: unknown, fetchedAt: Date): AgentSnapshot`
  - `discover.ts`: `RunPowerShell = (script: string) => Promise<string>`, `DISCOVERY_SCRIPT`, `runPowerShell: RunPowerShell`, `discoverLanguageServers(run?: RunPowerShell): Promise<LanguageServer[]>`
  - `provider.ts`: `QUOTA_PATH`, `AntigravityDeps { discover: () => Promise<LanguageServer[]>; fetch: typeof fetch; now: () => Date }`, `class AntigravityProvider implements Provider` (`id = 'antigravity'`)

- [x] **Step 1: Criar a fixture**

`packages/core/test/fixtures/antigravity-quota.json` (resposta real de `RetrieveUserQuotaSummary`, sem dados pessoais):
```json
{
  "response": {
    "groups": [
      {
        "displayName": "Gemini Models",
        "description": "Models within this group: Gemini Flash, Gemini Pro",
        "buckets": [
          { "bucketId": "gemini-weekly", "displayName": "Weekly Limit Remaining", "window": "weekly", "remainingFraction": 0.50940806, "resetTime": "2026-09-23T03:24:57Z" },
          { "bucketId": "gemini-5h", "displayName": "Five Hour Limit Remaining", "window": "5h", "remainingFraction": 0.8898, "resetTime": "2026-09-21T22:37:35Z" }
        ]
      },
      {
        "displayName": "Claude and GPT models",
        "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
        "buckets": [
          { "bucketId": "3p-weekly", "displayName": "Weekly Limit Remaining", "window": "weekly", "remainingFraction": 1, "resetTime": "2026-09-28T18:09:21Z" },
          { "bucketId": "3p-5h", "displayName": "Five Hour Limit Remaining", "window": "5h", "remainingFraction": 1, "resetTime": "2026-09-21T23:09:21Z" }
        ]
      }
    ],
    "description": "Within each group, models share a weekly limit and a 5-hour limit."
  }
}
```

- [x] **Step 2: Escrever o teste (falhando)**

`packages/core/test/antigravity.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SourceFormatError, UnavailableError } from '../src/errors';
import {
  extractCsrfToken,
  parseDiscoveryOutput,
  parseQuotaSummary,
  type LanguageServer,
} from '../src/providers/antigravity/parse';
import { AntigravityProvider, QUOTA_PATH } from '../src/providers/antigravity/provider';

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/antigravity-quota.json', import.meta.url)), 'utf8'),
);
const NOW = new Date('2026-09-21T19:00:00Z');

describe('parseQuotaSummary', () => {
  it('converte buckets em limites por grupo', () => {
    const snap = parseQuotaSummary(FIXTURE, NOW);
    expect(snap.status).toBe('live');
    expect(snap.limits).toHaveLength(4);
    const gemini5h = snap.limits.find((l) => l.group === 'Gemini' && l.window === '5h')!;
    expect(gemini5h.usedPct).toBeCloseTo(11.02, 2);
    expect(gemini5h.resetsAt).toEqual(new Date('2026-09-21T22:37:35Z'));
    const thirdPartyWeekly = snap.limits.find((l) => l.group === 'Claude/GPT' && l.window === 'weekly')!;
    expect(thirdPartyWeekly.usedPct).toBe(0);
  });

  it('trata remainingFraction ausente como zero (proto3 omite zero)', () => {
    const body = {
      response: { groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', resetTime: '2026-09-21T22:00:00Z' }] }] },
    };
    expect(parseQuotaSummary(body, NOW).limits[0].usedPct).toBe(100);
  });

  it('rejeita formatos inesperados', () => {
    expect(() => parseQuotaSummary({ response: {} }, NOW)).toThrow(SourceFormatError);
    const noWindows = { response: { groups: [{ displayName: 'X', buckets: [{ window: 'daily' }] }] } };
    expect(() => parseQuotaSummary(noWindows, NOW)).toThrow(SourceFormatError);
  });
});

describe('extractCsrfToken', () => {
  it('lê --csrf_token com espaço ou =', () => {
    expect(extractCsrfToken('ls.exe --standalone --csrf_token abc-123 --app_data_dir antigravity')).toBe('abc-123');
    expect(extractCsrfToken('ls.exe --csrf_token=abc')).toBe('abc');
  });

  it('ignora outras flags de token', () => {
    expect(extractCsrfToken('ls.exe --extension_server_csrf_token zzz')).toBeNull();
    expect(extractCsrfToken('ls.exe --standalone')).toBeNull();
  });
});

describe('parseDiscoveryOutput', () => {
  it('lê objeto único ou lista e ordena portas da maior para a menor', () => {
    expect(parseDiscoveryOutput('')).toEqual([]);
    expect(parseDiscoveryOutput('{"pid":7,"cmd":"ls.exe --csrf_token t1","ports":[51395,51396]}')).toEqual([
      { pid: 7, csrfToken: 't1', ports: [51396, 51395] },
    ]);
    const list = '[{"pid":7,"cmd":"ls.exe","ports":[1]},{"pid":8,"cmd":"ls.exe --csrf_token t2","ports":51396}]';
    expect(parseDiscoveryOutput(list)).toEqual([{ pid: 8, csrfToken: 't2', ports: [51396] }]);
  });

  it('rejeita saída que não é JSON', () => {
    expect(() => parseDiscoveryOutput('erro')).toThrow(SourceFormatError);
  });
});

describe('AntigravityProvider', () => {
  const server: LanguageServer = { pid: 1, csrfToken: 't1', ports: [51396, 51395] };

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  it('fica indisponível sem language_server', async () => {
    const provider = new AntigravityProvider({
      discover: async () => [],
      fetch: vi.fn() as unknown as typeof globalThis.fetch,
      now: () => NOW,
    });
    await expect(provider.fetch()).rejects.toThrow(new UnavailableError('Antigravity fechado'));
  });

  it('tenta as portas até uma responder e reaproveita o alvo', async () => {
    const discover = vi.fn(async () => [server]);
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes(':51396') ? jsonResponse({ error: 'https' }, 400) : jsonResponse(FIXTURE),
    );
    const provider = new AntigravityProvider({ discover, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });

    const snap = await provider.fetch();
    expect(snap.limits).toHaveLength(4);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe(`http://127.0.0.1:51395${QUOTA_PATH}`);
    expect(init?.headers).toMatchObject({ 'x-codeium-csrf-token': 't1' });

    await provider.fetch();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('redescobre quando o alvo em cache para de responder', async () => {
    const discover = vi.fn(async () => [server]);
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      if (calls === 2) throw new TypeError('fetch failed');
      return jsonResponse(FIXTURE);
    });
    const provider = new AntigravityProvider({ discover, fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW });

    await provider.fetch();
    await provider.fetch();
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('propaga formato inesperado', async () => {
    const provider = new AntigravityProvider({
      discover: async () => [server],
      fetch: (async () => jsonResponse({ response: {} })) as unknown as typeof globalThis.fetch,
      now: () => NOW,
    });
    await expect(provider.fetch()).rejects.toBeInstanceOf(SourceFormatError);
  });
});
```

- [x] **Step 3: Rodar o teste para ver falhar**

Run: `npx vitest run packages/core/test/antigravity.test.ts`
Expected: FAIL, "Failed to resolve import ../src/providers/antigravity/parse".

- [x] **Step 4: Implementar `parse.ts`**

`packages/core/src/providers/antigravity/parse.ts`:
```ts
import { SourceFormatError } from '../../errors';
import type { AgentSnapshot, Limit } from '../../types';

export interface LanguageServer {
  pid: number;
  csrfToken: string;
  /** Portas em escuta no 127.0.0.1, da maior para a menor (a HTTP costuma ser a maior). */
  ports: number[];
}

const GROUP_NAMES: Record<string, string> = {
  'Gemini Models': 'Gemini',
  'Claude and GPT models': 'Claude/GPT',
};

export function extractCsrfToken(commandLine: string): string | null {
  const match = /(?:^|\s)--csrf_token[= ]+"?([^\s"]+)/.exec(commandLine);
  return match ? match[1] : null;
}

/** Recebe a saída JSON do DISCOVERY_SCRIPT. A linha de comando é descartada depois de extrair o token. */
export function parseDiscoveryOutput(stdout: string): LanguageServer[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new SourceFormatError('descoberta do antigravity');
  }
  const servers: LanguageServer[] = [];
  for (const entry of (Array.isArray(raw) ? raw : [raw]) as any[]) {
    const csrfToken = typeof entry?.cmd === 'string' ? extractCsrfToken(entry.cmd) : null;
    const rawPorts: unknown[] = Array.isArray(entry?.ports) ? entry.ports : [entry?.ports];
    const ports = rawPorts.filter((p): p is number => typeof p === 'number').sort((a, b) => b - a);
    if (typeof entry?.pid !== 'number' || !csrfToken || ports.length === 0) continue;
    servers.push({ pid: entry.pid, csrfToken, ports });
  }
  return servers;
}

export function parseQuotaSummary(json: unknown, fetchedAt: Date): AgentSnapshot {
  const groups = (json as any)?.response?.groups;
  if (!Array.isArray(groups)) throw new SourceFormatError('antigravity groups');
  const limits: Limit[] = [];
  for (const group of groups) {
    const name = GROUP_NAMES[group?.displayName] ?? String(group?.displayName ?? '?');
    for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
      if (bucket?.window !== '5h' && bucket?.window !== 'weekly') continue;
      const remaining = bucket.remainingFraction ?? 0; // proto3 JSON omite o valor zero
      if (typeof remaining !== 'number' || typeof bucket.resetTime !== 'string') {
        throw new SourceFormatError('antigravity bucket');
      }
      limits.push({
        agent: 'antigravity',
        group: name,
        window: bucket.window,
        usedPct: (1 - remaining) * 100,
        resetsAt: new Date(bucket.resetTime),
      });
    }
  }
  if (limits.length === 0) throw new SourceFormatError('antigravity sem janelas 5h/weekly');
  return { agent: 'antigravity', status: 'live', limits, fetchedAt };
}
```

- [x] **Step 5: Implementar `discover.ts`**

`packages/core/src/providers/antigravity/discover.ts`:
```ts
import { execFile } from 'node:child_process';
import { parseDiscoveryOutput, type LanguageServer } from './parse';

export type RunPowerShell = (script: string) => Promise<string>;

/** Lista language_server.exe com linha de comando e portas em escuta no 127.0.0.1, em JSON. */
export const DISCOVERY_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$list = @(Get-CimInstance Win32_Process -Filter "Name=\'language_server.exe\'" | ForEach-Object {',
  '  $procId = $_.ProcessId',
  '  [pscustomobject]@{',
  '    pid = $procId',
  '    cmd = $_.CommandLine',
  "    ports = @(Get-NetTCPConnection -OwningProcess $procId -State Listen | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort)",
  '  }',
  '})',
  'ConvertTo-Json -InputObject $list -Depth 3 -Compress',
].join('\n');

export const runPowerShell: RunPowerShell = (script) =>
  new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 4_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        // Mensagem genérica: a saída contém a linha de comando, que traz o token.
        if (error) reject(new Error('falha ao consultar processos do Antigravity'));
        else resolve(stdout);
      },
    );
  });

export async function discoverLanguageServers(run: RunPowerShell = runPowerShell): Promise<LanguageServer[]> {
  return parseDiscoveryOutput(await run(DISCOVERY_SCRIPT));
}
```

- [x] **Step 6: Implementar `provider.ts`**

`packages/core/src/providers/antigravity/provider.ts`:
```ts
import { HttpStatusError, SourceFormatError, UnavailableError } from '../../errors';
import type { AgentSnapshot, Provider } from '../../types';
import { parseQuotaSummary, type LanguageServer } from './parse';

export const QUOTA_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

export interface AntigravityDeps {
  discover: () => Promise<LanguageServer[]>;
  fetch: typeof fetch;
  now: () => Date;
}

interface Target {
  port: number;
  csrfToken: string;
}

export class AntigravityProvider implements Provider {
  readonly id = 'antigravity' as const;
  private target: Target | null = null;

  constructor(private readonly deps: AntigravityDeps) {}

  async fetch(signal?: AbortSignal): Promise<AgentSnapshot> {
    if (this.target) {
      try {
        return await this.query(this.target, signal);
      } catch (error) {
        if (error instanceof SourceFormatError) throw error;
        this.target = null; // IDE reiniciou: porta e token mudaram
      }
    }
    const servers = await this.deps.discover();
    if (servers.length === 0) throw new UnavailableError('Antigravity fechado');
    for (const server of servers) {
      for (const port of server.ports) {
        const candidate = { port, csrfToken: server.csrfToken };
        try {
          const snap = await this.query(candidate, signal);
          this.target = candidate;
          return snap;
        } catch (error) {
          if (error instanceof SourceFormatError) throw error;
        }
      }
    }
    throw new UnavailableError('Antigravity aberto, mas sem resposta de cota');
  }

  private async query(target: Target, signal?: AbortSignal): Promise<AgentSnapshot> {
    const response = await this.deps.fetch(`http://127.0.0.1:${target.port}${QUOTA_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': target.csrfToken,
      },
      body: '{}',
      signal,
    });
    if (!response.ok) throw new HttpStatusError(response.status);
    return parseQuotaSummary(await response.json(), this.deps.now());
  }
}
```

- [x] **Step 7: Rodar testes e typecheck**

Run: `npx vitest run packages/core/test/antigravity.test.ts`
Expected: PASS (11 testes).

Run: `npm run typecheck`
Expected: sem erros.

- [x] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): provider do Antigravity via language server local

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Cache em disco e coletor

**Files:**
- Create: `packages/core/src/cache.ts`, `packages/core/src/collector.ts`
- Test: `packages/core/test/cache.test.ts`, `packages/core/test/collector.test.ts`

**Interfaces:**
- Consumes: `AGENTS`, `AgentId`, `AgentSnapshot`, `Provider`; `HttpStatusError`, `SourceFormatError`, `StaleError`, `UnavailableError`.
- Produces:
  - `cache.ts`: `SnapshotCache { load(): Promise<AgentSnapshot[]>; save(snaps: AgentSnapshot[]): Promise<void> }`, `defaultCachePath(): string`, `serialize(snaps): string`, `deserialize(text): AgentSnapshot[]`, `fileCache(file?: string): SnapshotCache`
  - `collector.ts`: `DEFAULT_INTERVALS_MS`, `CollectorOptions`, `class Collector` com `start(): Promise<void>`, `stop(): void`, `subscribe(listener: (snaps: AgentSnapshot[]) => void): () => void`, `current(): AgentSnapshot[]`, `refreshNow(): Promise<void>`, `intervalOf(id: AgentId): number`

- [x] **Step 1: Escrever o teste do cache (falhando)**

`packages/core/test/cache.test.ts`:
```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileCache } from '../src/cache';
import type { AgentSnapshot } from '../src/types';

const SNAPS: AgentSnapshot[] = [
  {
    agent: 'antigravity',
    status: 'live',
    fetchedAt: new Date('2026-09-21T19:00:00Z'),
    limits: [{ agent: 'antigravity', group: 'Gemini', window: '5h', usedPct: 11, resetsAt: new Date('2026-09-21T22:37:35Z') }],
  },
  {
    agent: 'codex',
    status: 'stale',
    fetchedAt: new Date('2026-09-21T18:00:00Z'),
    note: 'janela reiniciada desde a última leitura',
    limits: [{ agent: 'codex', window: '5h', usedPct: 0, resetsAt: null }],
  },
];

describe('fileCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cache-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('grava e lê de volta com datas', async () => {
    const cache = fileCache(path.join(dir, 'sub', 'last.json'));
    await cache.save(SNAPS);
    expect(await cache.load()).toEqual(SNAPS);
  });

  it('devolve lista vazia sem arquivo ou com arquivo corrompido', async () => {
    const file = path.join(dir, 'last.json');
    expect(await fileCache(file).load()).toEqual([]);
    await writeFile(file, '{corrompido');
    expect(await fileCache(file).load()).toEqual([]);
  });

  it('grava só os campos conhecidos', async () => {
    const file = path.join(dir, 'last.json');
    const withExtra = [{ ...SNAPS[0], email: 'alguem@exemplo.com' } as AgentSnapshot];
    await fileCache(file).save(withExtra);
    expect(await readFile(file, 'utf8')).not.toContain('email');
  });
});
```

- [x] **Step 2: Rodar para ver falhar**

Run: `npx vitest run packages/core/test/cache.test.ts`
Expected: FAIL, "Failed to resolve import ../src/cache".

- [x] **Step 3: Implementar `cache.ts`**

`packages/core/src/cache.ts`:
```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AGENTS, type AgentSnapshot } from './types';

export interface SnapshotCache {
  load(): Promise<AgentSnapshot[]>;
  save(snaps: AgentSnapshot[]): Promise<void>;
}

export function defaultCachePath(): string {
  const base = process.env.APPDATA ?? path.join(os.homedir(), '.config');
  return path.join(base, 'agent-usage', 'last.json');
}

/** Copia campo a campo: nada fora do modelo (ex.: dados pessoais) vai para o disco. */
export function serialize(snaps: AgentSnapshot[]): string {
  return JSON.stringify(
    snaps.map((s) => ({
      agent: s.agent,
      status: s.status,
      fetchedAt: s.fetchedAt.toISOString(),
      note: s.note ?? null,
      limits: s.limits.map((l) => ({
        group: l.group ?? null,
        window: l.window,
        usedPct: l.usedPct,
        resetsAt: l.resetsAt ? l.resetsAt.toISOString() : null,
      })),
    })),
  );
}

export function deserialize(text: string): AgentSnapshot[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const snaps: AgentSnapshot[] = [];
  for (const s of raw as any[]) {
    if (!AGENTS.includes(s?.agent) || !Array.isArray(s?.limits)) continue;
    const snap: AgentSnapshot = {
      agent: s.agent,
      status: s.status,
      fetchedAt: new Date(s.fetchedAt),
      limits: s.limits.map((l: any) => {
        const limit = {
          agent: s.agent,
          window: l.window,
          usedPct: Number(l.usedPct),
          resetsAt: l.resetsAt ? new Date(l.resetsAt) : null,
        };
        return l.group ? { ...limit, group: l.group } : limit;
      }),
    };
    if (s.note) snap.note = s.note;
    snaps.push(snap);
  }
  return snaps;
}

export function fileCache(file: string = defaultCachePath()): SnapshotCache {
  return {
    async load() {
      try {
        return deserialize(await readFile(file, 'utf8'));
      } catch {
        return [];
      }
    },
    async save(snaps) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, serialize(snaps));
      await rename(tmp, file); // tray e extensão podem gravar ao mesmo tempo
    },
  };
}
```

- [x] **Step 4: Rodar o teste do cache**

Run: `npx vitest run packages/core/test/cache.test.ts`
Expected: PASS (3 testes).

- [x] **Step 5: Escrever o teste do coletor (falhando)**

`packages/core/test/collector.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotCache } from '../src/cache';
import { Collector } from '../src/collector';
import { HttpStatusError, SourceFormatError, StaleError, UnavailableError } from '../src/errors';
import type { AgentId, AgentSnapshot, Provider } from '../src/types';

const NOW = new Date('2026-09-21T19:00:00Z');

function snap(agent: AgentId, usedPct: number): AgentSnapshot {
  return {
    agent,
    status: 'live',
    fetchedAt: NOW,
    limits: [{ agent, window: '5h', usedPct, resetsAt: new Date('2026-09-21T22:00:00Z') }],
  };
}

type FakeProvider = Provider & { calls: number };

/** Devolve os resultados em ordem; o último se repete. */
function fake(id: AgentId, ...results: Array<AgentSnapshot | Error>): FakeProvider {
  const provider: FakeProvider = {
    id,
    calls: 0,
    async fetch() {
      const result = results[Math.min(provider.calls, results.length - 1)];
      provider.calls++;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return provider;
}

function memoryCache(initial: AgentSnapshot[] = []): SnapshotCache & { saved: AgentSnapshot[][] } {
  const cache = {
    saved: [] as AgentSnapshot[][],
    load: async () => initial,
    save: async (snaps: AgentSnapshot[]) => {
      cache.saved.push(snaps);
    },
  };
  return cache;
}

const byAgent = (c: Collector, id: AgentId) => c.current().find((s) => s.agent === id);

describe('Collector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('roda todos os providers no start e notifica', async () => {
    const c = new Collector({ providers: [fake('claude', snap('claude', 10)), fake('codex', snap('codex', 20))], now: () => NOW });
    const listener = vi.fn();
    c.subscribe(listener);
    await c.start();
    c.stop();
    expect(byAgent(c, 'claude')?.limits[0].usedPct).toBe(10);
    expect(byAgent(c, 'codex')?.status).toBe('live');
    expect(listener).toHaveBeenCalled();
  });

  it('isola a falha de um provider', async () => {
    const c = new Collector({
      providers: [fake('claude', new Error('fetch failed')), fake('codex', snap('codex', 20))],
      now: () => NOW,
    });
    await c.start();
    c.stop();
    expect(byAgent(c, 'claude')).toEqual({ agent: 'claude', status: 'unavailable', limits: [], fetchedAt: NOW, note: 'fetch failed' });
    expect(byAgent(c, 'codex')?.status).toBe('live');
  });

  it('mantém o último valor bom como stale após erro', async () => {
    const c = new Collector({ providers: [fake('claude', snap('claude', 10), new Error('fetch failed'))], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'stale', note: 'fetch failed', limits: [{ usedPct: 10 }] });
  });

  it('StaleError vira stale com o último valor', async () => {
    const error = new StaleError('token expirado, abra o Claude Code');
    const c = new Collector({ providers: [fake('claude', snap('claude', 10), error)], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'stale', note: 'token expirado, abra o Claude Code', limits: [{ usedPct: 10 }] });
  });

  it('UnavailableError vira unavailable mantendo o último valor', async () => {
    const error = new UnavailableError('Antigravity fechado');
    const c = new Collector({ providers: [fake('antigravity', snap('antigravity', 30), error)], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    expect(byAgent(c, 'antigravity')).toMatchObject({ status: 'unavailable', note: 'Antigravity fechado', limits: [{ usedPct: 30 }] });
  });

  it('SourceFormatError vira unavailable sem números', async () => {
    const c = new Collector({ providers: [fake('antigravity', snap('antigravity', 30), new SourceFormatError('x'))], now: () => NOW });
    await c.start();
    await c.refreshNow();
    c.stop();
    const result = byAgent(c, 'antigravity');
    expect(result?.status).toBe('unavailable');
    expect(result?.limits).toEqual([]);
    expect(result?.note).toContain('formato da fonte mudou');
  });

  it('aborta o provider no timeout', async () => {
    let captured: AbortSignal | undefined;
    const hanging: Provider = {
      id: 'claude',
      fetch: (signal) => {
        captured = signal;
        return new Promise(() => {});
      },
    };
    const c = new Collector({ providers: [hanging], now: () => NOW });
    const started = c.start();
    await vi.advanceTimersByTimeAsync(5_000);
    await started;
    c.stop();
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'unavailable', note: 'tempo esgotado' });
    expect(captured?.aborted).toBe(true);
  });

  it('dobra o intervalo no 429 até o teto e volta no sucesso', async () => {
    const tooMany = new HttpStatusError(429);
    const c = new Collector({ providers: [fake('claude', tooMany, tooMany, tooMany, snap('claude', 10))], now: () => NOW });
    await c.start();
    expect(c.intervalOf('claude')).toBe(600_000);
    await c.refreshNow();
    expect(c.intervalOf('claude')).toBe(1_200_000);
    await c.refreshNow();
    expect(c.intervalOf('claude')).toBe(1_800_000);
    await c.refreshNow();
    expect(c.intervalOf('claude')).toBe(300_000);
    c.stop();
  });

  it('agenda a próxima execução pelo intervalo e para no stop', async () => {
    const codex = fake('codex', snap('codex', 20));
    const c = new Collector({ providers: [codex], now: () => NOW });
    await c.start();
    expect(codex.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(codex.calls).toBe(2);
    c.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(codex.calls).toBe(2);
  });

  it('carrega o cache como stale e salva os últimos valores bons', async () => {
    const cache = memoryCache([snap('claude', 77)]);
    const listener = vi.fn();
    const c = new Collector({
      providers: [fake('claude', new StaleError('token expirado, abra o Claude Code')), fake('codex', snap('codex', 20))],
      now: () => NOW,
      cache,
    });
    c.subscribe(listener);
    await c.start();
    c.stop();
    expect(listener.mock.calls[0][0]).toEqual([{ ...snap('claude', 77), status: 'stale', note: 'último valor salvo' }]);
    expect(byAgent(c, 'claude')).toMatchObject({ status: 'stale', note: 'token expirado, abra o Claude Code', limits: [{ usedPct: 77 }] });
    expect(cache.saved.at(-1)?.map((s) => s.agent).sort()).toEqual(['claude', 'codex']);
  });
});
```

- [x] **Step 6: Rodar para ver falhar**

Run: `npx vitest run packages/core/test/collector.test.ts`
Expected: FAIL, "Failed to resolve import ../src/collector".

- [x] **Step 7: Implementar `collector.ts`**

`packages/core/src/collector.ts`:
```ts
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

  async refreshNow(): Promise<void> {
    await Promise.all(this.options.providers.map((p) => this.runOnce(p)));
  }

  intervalOf(id: AgentId): number {
    return this.interval[id];
  }

  private async cycle(provider: Provider): Promise<void> {
    await this.runOnce(provider);
    if (this.stopped) return;
    this.timers.set(
      provider.id,
      setTimeout(() => void this.cycle(provider), this.interval[provider.id]),
    );
  }

  private async runOnce(provider: Provider): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('tempo esgotado'));
      }, this.timeoutMs);
    });
    try {
      const snap = await Promise.race([provider.fetch(controller.signal), timeout]);
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
    const note = error instanceof Error ? error.message : String(error);
    const last = this.lastGood.get(agent);
    if (error instanceof SourceFormatError) {
      return { agent, status: 'unavailable', limits: [], fetchedAt: this.now(), note };
    }
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
```

- [x] **Step 8: Rodar a suíte inteira e o typecheck**

Run: `npm test`
Expected: PASS em todos os arquivos do core (format, codex, claude, antigravity, cache, collector).

Run: `npm run typecheck`
Expected: sem erros.

- [x] **Step 9: Commit**

```bash
git add packages/core
git commit -m "feat(core): coletor com timeout, fallback, backoff e cache em disco

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Montagem padrão, exports e smoke com dados reais

**Files:**
- Create: `packages/core/src/defaults.ts`, `packages/core/src/index.ts`, `packages/core/scripts/smoke.ts`

**Interfaces:**
- Consumes: todos os módulos do core.
- Produces:
  - `defaults.ts`: `createDefaultCollector(options?: { intervalsMs?: Partial<Record<AgentId, number>> }): Collector`
  - `index.ts`: reexporta `types`, `errors`, `format`, `cache`, `collector`, `defaults`. É a única superfície usada pelos frontends, via `@agent-usage/core`.

- [x] **Step 1: Implementar `defaults.ts`**

`packages/core/src/defaults.ts`:
```ts
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileCache } from './cache';
import { Collector } from './collector';
import { AntigravityProvider } from './providers/antigravity/provider';
import { discoverLanguageServers } from './providers/antigravity/discover';
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
      }),
      new CodexProvider({ sessionsDir: path.join(home, '.codex', 'sessions'), now }),
      new AntigravityProvider({ discover: () => discoverLanguageServers(), fetch: globalThis.fetch, now }),
    ],
    intervalsMs: options.intervalsMs,
    cache: fileCache(),
    now,
  });
}
```

- [x] **Step 2: Implementar `index.ts`**

`packages/core/src/index.ts`:
```ts
export * from './types';
export * from './errors';
export * from './format';
export * from './cache';
export * from './collector';
export * from './defaults';
```

- [x] **Step 3: Escrever o smoke**

`packages/core/scripts/smoke.ts`:
```ts
// Verificação manual com dados reais. Imprime só o view model (sem tokens).
import { buildViewModel, createDefaultCollector } from '../src/index';

const collector = createDefaultCollector();
await collector.start();
collector.stop();
console.log(JSON.stringify(buildViewModel(collector.current(), new Date()), null, 2));
```

- [x] **Step 4: Typecheck e testes**

Run: `npm run typecheck`
Expected: sem erros.

Run: `npm test`
Expected: PASS.

- [x] **Step 5: Rodar o smoke contra a máquina real**

Run (PowerShell):
```powershell
npx esbuild packages/core/scripts/smoke.ts --bundle --platform=node --format=esm --outfile="$env:TEMP\agent-usage-smoke.mjs"; node "$env:TEMP\agent-usage-smoke.mjs"
```
Expected: JSON com três views. Com o Claude Code logado, `claude` aparece com `statusText` "ao vivo" e os rótulos `5h`/`Semanal`. `codex` aparece "ao vivo" ou "lido há …". Com o Antigravity aberto, `antigravity` traz quatro limites (`Gemini · 5h`, `Gemini · Semanal`, `Claude/GPT · 5h`, `Claude/GPT · Semanal`). A saída não pode conter nenhum token. Se algum agente vier `indisponível`, leia o `note` antes de seguir. Não siga em frente com um provider quebrado.

- [x] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): montagem padrão, exports públicos e smoke manual

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Extensão VSCode

**Files:**
- Create: `packages/vscode/package.json`, `packages/vscode/.vscodeignore`, `packages/vscode/README.md`
- Create: `packages/vscode/src/tooltip.ts`, `packages/vscode/src/extension.ts`
- Test: `packages/vscode/test/tooltip.test.ts`

**Interfaces:**
- Consumes: de `@agent-usage/core`: `AgentView`, `AgentId`, `buildViewModel`, `createDefaultCollector`, `statusBarText`, `worstBand`.
- Produces: `tooltipMarkdown(views: AgentView[]): string`; comando `agentUsage.refresh`; configurações `agentUsage.claudeIntervalSeconds` e `agentUsage.localIntervalSeconds`.

- [x] **Step 1: Criar o manifest e arquivos de pacote**

`packages/vscode/package.json`:
```json
{
  "name": "agent-usage",
  "displayName": "Agent Usage",
  "description": "Limites de 5h e semanal de Claude Code, Codex e Antigravity na status bar",
  "version": "0.1.0",
  "publisher": "vnmartinez",
  "engines": { "vscode": "^1.100.0" },
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [{ "command": "agentUsage.refresh", "title": "Agent Usage: Atualizar agora" }],
    "configuration": {
      "title": "Agent Usage",
      "properties": {
        "agentUsage.claudeIntervalSeconds": {
          "type": "number",
          "default": 300,
          "minimum": 60,
          "description": "Intervalo de consulta do Claude Code, em segundos (recarregue a janela para aplicar)."
        },
        "agentUsage.localIntervalSeconds": {
          "type": "number",
          "default": 60,
          "minimum": 15,
          "description": "Intervalo de consulta de Codex e Antigravity, em segundos (recarregue a janela para aplicar)."
        }
      }
    }
  },
  "scripts": {
    "build": "esbuild src/extension.ts --bundle --platform=node --format=cjs --external:vscode --outfile=dist/extension.js",
    "package": "npm run build && vsce package --no-dependencies --allow-missing-repository --skip-license"
  },
  "devDependencies": {
    "@agent-usage/core": "*"
  }
}
```

`packages/vscode/.vscodeignore`:
```
**
!dist/**
!package.json
!README.md
```

`packages/vscode/README.md`:
```markdown
# Agent Usage

Mostra na status bar o % usado das janelas de 5h e semanal de Claude Code, Codex e Antigravity.
Clique no item para atualizar. Passe o mouse para ver resets e detalhes.
```

- [x] **Step 2: Instalar as dependências da extensão**

Run: `npm install -D -w packages/vscode @types/vscode@~1.100.0 @vscode/vsce`
Expected: sem erros; `node_modules/@agent-usage/core` passa a ser um link para `packages/core`.

- [x] **Step 3: Escrever o teste do tooltip (falhando)**

`packages/vscode/test/tooltip.test.ts`:
```ts
import type { AgentView } from '@agent-usage/core';
import { describe, expect, it } from 'vitest';
import { tooltipMarkdown } from '../src/tooltip';

const VIEWS: AgentView[] = [
  {
    agent: 'claude',
    name: 'Claude Code',
    status: 'live',
    statusText: 'ao vivo',
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
    expect(md).toContain('**Claude Code** · ao vivo');
    expect(md).toContain('5h: **12%** · reinicia em 3h56');
    expect(md).toContain('Semanal: **96%** ⛔ · reinicia em 3d 6h');
    expect(md).toContain('**Codex** · indisponível');
    expect(md).toContain('_nenhuma sessão do Codex nos últimos 7 dias_');
    expect(md.endsWith('_Clique para atualizar_')).toBe(true);
  });
});
```

- [x] **Step 4: Rodar para ver falhar**

Run: `npx vitest run packages/vscode/test/tooltip.test.ts`
Expected: FAIL, "Failed to resolve import ../src/tooltip".

- [x] **Step 5: Implementar `tooltip.ts` e `extension.ts`**

`packages/vscode/src/tooltip.ts`:
```ts
import type { AgentView, Band } from '@agent-usage/core';

const MARK: Record<Band, string> = { normal: '', warning: ' ⚠', critical: ' ⛔' };

export function tooltipMarkdown(views: AgentView[]): string {
  const blocks = views.map((view) => {
    const lines = [`**${view.name}** · ${view.statusText}`];
    if (view.note) lines.push(`_${view.note}_`);
    for (const limit of view.limits) {
      lines.push(`${limit.label}: **${limit.usedPct}%**${MARK[limit.band]} · ${limit.resetText}`);
    }
    return lines.join('  \n');
  });
  return `${blocks.join('\n\n---\n\n')}\n\n_Clique para atualizar_`;
}
```

`packages/vscode/src/extension.ts`:
```ts
import * as vscode from 'vscode';
import { buildViewModel, createDefaultCollector, statusBarText, worstBand, type AgentId } from '@agent-usage/core';
import { tooltipMarkdown } from './tooltip';

function intervals(): Partial<Record<AgentId, number>> {
  const config = vscode.workspace.getConfiguration('agentUsage');
  const local = config.get<number>('localIntervalSeconds', 60) * 1000;
  return { claude: config.get<number>('claudeIntervalSeconds', 300) * 1000, codex: local, antigravity: local };
}

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.name = 'Agent Usage';
  item.command = 'agentUsage.refresh';
  item.text = '$(pulse) …';
  item.show();

  const collector = createDefaultCollector({ intervalsMs: intervals() });

  const render = () => {
    const snaps = collector.current();
    item.text = statusBarText(snaps);
    item.tooltip = new vscode.MarkdownString(tooltipMarkdown(buildViewModel(snaps, new Date())));
    const band = worstBand(snaps);
    item.backgroundColor =
      band === 'critical'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : band === 'warning'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
  };

  const unsubscribe = collector.subscribe(render);
  const tick = setInterval(render, 30_000); // mantém as contagens regressivas atualizadas

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('agentUsage.refresh', () => collector.refreshNow()),
    {
      dispose: () => {
        unsubscribe();
        clearInterval(tick);
        collector.stop();
      },
    },
  );

  void collector.start();
}

export function deactivate(): void {}
```

- [x] **Step 6: Rodar testes, typecheck e build**

Run: `npx vitest run packages/vscode/test/tooltip.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: sem erros.

Run: `npm run build -w packages/vscode`
Expected: gera `packages/vscode/dist/extension.js`.

- [x] **Step 7: Empacotar, instalar e verificar à mão**

Run: `npm run package -w packages/vscode`
Expected: gera `packages/vscode/agent-usage-0.1.0.vsix`.

Run: `code --install-extension packages/vscode/agent-usage-0.1.0.vsix --force`
Expected: "Extension 'agent-usage-0.1.0.vsix' was successfully installed."

Verificação manual: recarregar a janela (`Developer: Reload Window`). Na status bar deve aparecer `$(pulse) CC x/y  CX x/y  AG x/y` com números coerentes com o smoke da Task 6. O tooltip mostra os três agentes com resets. Clicar no item atualiza. Com alguma janela ≥80%, o fundo fica amarelo.

- [x] **Step 8: Commit**

```bash
git add package-lock.json packages/vscode
git commit -m "feat(vscode): extensão com item na status bar e tooltip

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: App de bandeja (Electron) + registro no vault

**Files:**
- Create: `packages/tray/package.json`
- Create: `packages/tray/src/icon.ts`, `packages/tray/src/tooltip.ts`, `packages/tray/src/main.ts`, `packages/tray/src/preload.ts`, `packages/tray/src/popup.html`, `packages/tray/src/popup.ts`
- Test: `packages/tray/test/icon.test.ts`, `packages/tray/test/tooltip.test.ts`
- Modify (fora do repo): `C:\SegundoCerebro\Projetos\Pessoais\VsCodeLLMAgentUsage\VsCodeLLMAgentUsage.md`

**Interfaces:**
- Consumes: de `@agent-usage/core`: `AGENTS`, `AGENT_LABEL`, `AgentSnapshot`, `AgentView`, `Band`, `band`, `buildViewModel`, `createDefaultCollector`, `windowMax`, `worstPct`.
- Produces: `ICON_SIZE = 32`, `iconLabel(pct: number | null): string`, `renderIconBitmap(pct: number | null, band: Band | null): Buffer` (BGRA); `trayTooltip(snaps: AgentSnapshot[]): string`; canal IPC `model` (main → popup, `AgentView[]`) e `get-model` (invoke).

- [ ] **Step 1: Criar o `package.json` do tray**

`packages/tray/package.json`:
```json
{
  "name": "agent-usage-tray",
  "productName": "Agent Usage",
  "version": "0.1.0",
  "private": true,
  "description": "Limites de 5h e semanal de Claude Code, Codex e Antigravity na bandeja do Windows",
  "author": "Vinicius Martinez",
  "main": "dist/main.js",
  "scripts": {
    "build": "esbuild src/main.ts src/preload.ts --bundle --platform=node --format=cjs --external:electron --outdir=dist && esbuild src/popup.ts --bundle --platform=browser --outfile=dist/popup.js && node -e \"require('fs').copyFileSync('src/popup.html','dist/popup.html')\"",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --win nsis"
  },
  "build": {
    "appId": "com.vnmartinez.agentusage",
    "productName": "Agent Usage",
    "directories": { "output": "release" },
    "files": ["dist/**", "package.json"],
    "win": { "target": "nsis" },
    "nsis": { "oneClick": true, "perMachine": false }
  },
  "devDependencies": {
    "@agent-usage/core": "*"
  }
}
```

- [ ] **Step 2: Instalar Electron e electron-builder e fixar a versão do Electron**

Run: `npm install -D -w packages/tray electron electron-builder`
Expected: sem erros.

Run (PowerShell): `npm pkg set "build.electronVersion=$(node -p "require('electron/package.json').version")" -w packages/tray`
Expected: `packages/tray/package.json` ganha `build.electronVersion` com a versão instalada (necessário porque o Electron fica no `node_modules` da raiz do workspace).

- [ ] **Step 3: Escrever os testes (falhando)**

`packages/tray/test/icon.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ICON_SIZE, iconLabel, renderIconBitmap } from '../src/icon';

function pixel(buf: Buffer, x: number, y: number): number[] {
  const i = (y * ICON_SIZE + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; // B, G, R, A
}

const WHITE = [255, 255, 255, 255];

describe('iconLabel', () => {
  it('arredonda, limita a 0–100 e usa -- sem dado', () => {
    expect(iconLabel(57.6)).toBe('58');
    expect(iconLabel(130)).toBe('100');
    expect(iconLabel(null)).toBe('--');
  });
});

describe('renderIconBitmap', () => {
  it('gera BGRA 32x32 com o fundo na cor da faixa', () => {
    expect(renderIconBitmap(8, 'normal')).toHaveLength(ICON_SIZE * ICON_SIZE * 4);
    expect(pixel(renderIconBitmap(8, 'normal'), 0, 0)).toEqual([0x5b, 0x9e, 0x2e, 255]);
    expect(pixel(renderIconBitmap(85, 'warning'), 0, 0)).toEqual([0x00, 0xa4, 0xd9, 255]);
    expect(pixel(renderIconBitmap(99, 'critical'), 0, 0)).toEqual([0x3a, 0x3a, 0xd9, 255]);
    expect(pixel(renderIconBitmap(null, null), 0, 0)).toEqual([0x6b, 0x6b, 0x6b, 255]);
  });

  it('desenha um dígito centralizado em escala 3', () => {
    // "8": 9x15 px, começa em (11, 8); a primeira linha do glifo é cheia
    const buf = renderIconBitmap(8, 'normal');
    expect(pixel(buf, 11, 8)).toEqual(WHITE);
    expect(pixel(buf, 10, 8)).not.toEqual(WHITE);
  });

  it('desenha três dígitos em escala 2', () => {
    // "100": 22x10 px, começa em (5, 11); o "1" tem só a coluna do meio na primeira linha
    const buf = renderIconBitmap(100, 'critical');
    expect(pixel(buf, 7, 11)).toEqual(WHITE);
    expect(pixel(buf, 5, 11)).not.toEqual(WHITE);
  });
});
```

`packages/tray/test/tooltip.test.ts`:
```ts
import type { AgentSnapshot } from '@agent-usage/core';
import { describe, expect, it } from 'vitest';
import { trayTooltip } from '../src/tooltip';

const NOW = new Date('2026-09-21T19:00:00Z');

const claude: AgentSnapshot = {
  agent: 'claude',
  status: 'live',
  fetchedAt: NOW,
  limits: [
    { agent: 'claude', window: '5h', usedPct: 12.4, resetsAt: NOW },
    { agent: 'claude', window: 'weekly', usedPct: 46, resetsAt: NOW },
  ],
};

describe('trayTooltip', () => {
  it('mostra uma linha por agente na ordem fixa', () => {
    const codex: AgentSnapshot = { agent: 'codex', status: 'unavailable', fetchedAt: NOW, limits: [] };
    expect(trayTooltip([codex, claude])).toBe(
      'Claude Code: 12% 5h · 46% sem\nCodex: indisponível\nAntigravity: indisponível',
    );
  });

  it('respeita o limite de 127 caracteres do Windows', () => {
    expect(trayTooltip([claude]).length).toBeLessThanOrEqual(127);
  });
});
```

- [ ] **Step 4: Rodar para ver falhar**

Run: `npx vitest run packages/tray`
Expected: FAIL, "Failed to resolve import ../src/icon" e "../src/tooltip".

- [ ] **Step 5: Implementar `icon.ts` e `tooltip.ts`**

`packages/tray/src/icon.ts`:
```ts
import type { Band } from '@agent-usage/core';

export const ICON_SIZE = 32;

/** Fonte 3x5: '1' = pixel aceso. */
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '-': ['000', '000', '111', '000', '000'],
};

/** RGB por faixa; 'none' = sem dado. */
const COLORS: Record<Band | 'none', [number, number, number]> = {
  normal: [0x2e, 0x9e, 0x5b],
  warning: [0xd9, 0xa4, 0x00],
  critical: [0xd9, 0x3a, 0x3a],
  none: [0x6b, 0x6b, 0x6b],
};

export function iconLabel(pct: number | null): string {
  return pct === null ? '--' : String(Math.min(100, Math.max(0, Math.round(pct))));
}

/** Bitmap BGRA (formato do nativeImage.createFromBitmap no Windows). */
export function renderIconBitmap(pct: number | null, band: Band | null): Buffer {
  const buf = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  const fill = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    const i = (y * ICON_SIZE + x) * 4;
    buf[i] = b;
    buf[i + 1] = g;
    buf[i + 2] = r;
    buf[i + 3] = 255;
  };

  const background = COLORS[band ?? 'none'];
  for (let y = 0; y < ICON_SIZE; y++) for (let x = 0; x < ICON_SIZE; x++) fill(x, y, background);

  const text = iconLabel(pct);
  const scale = text.length >= 3 ? 2 : 3;
  const gap = scale;
  const width = text.length * 3 * scale + (text.length - 1) * gap;
  const x0 = Math.floor((ICON_SIZE - width) / 2);
  const y0 = Math.floor((ICON_SIZE - 5 * scale) / 2);

  [...text].forEach((char, index) => {
    const glyph = FONT[char];
    const gx = x0 + index * (3 * scale + gap);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) fill(gx + col * scale + dx, y0 + row * scale + dy, [255, 255, 255]);
        }
      }
    }
  });
  return buf;
}
```

`packages/tray/src/tooltip.ts`:
```ts
import { AGENTS, AGENT_LABEL, windowMax, type AgentSnapshot } from '@agent-usage/core';

const pct = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

/** Tooltip nativo da bandeja: uma linha por agente, até 127 caracteres. */
export function trayTooltip(snaps: AgentSnapshot[]): string {
  const lines = AGENTS.map((id) => {
    const snap = snaps.find((s) => s.agent === id);
    if (!snap || snap.status === 'unavailable') return `${AGENT_LABEL[id]}: indisponível`;
    return `${AGENT_LABEL[id]}: ${pct(windowMax(snap, '5h'))} 5h · ${pct(windowMax(snap, 'weekly'))} sem`;
  });
  return lines.join('\n').slice(0, 127);
}
```

- [ ] **Step 6: Rodar os testes do tray**

Run: `npx vitest run packages/tray`
Expected: PASS (6 testes).

- [ ] **Step 7: Implementar preload, popup e main**

`packages/tray/src/preload.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { AgentView } from '@agent-usage/core';

contextBridge.exposeInMainWorld('agentUsage', {
  onModel: (callback: (views: AgentView[]) => void) => {
    ipcRenderer.on('model', (_event, views: AgentView[]) => callback(views));
  },
  getModel: (): Promise<AgentView[]> => ipcRenderer.invoke('get-model'),
});
```

`packages/tray/src/popup.html`:
```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'">
  <title>Agent Usage</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #1f1f1f; --fg: #e6e6e6; --muted: #9a9a9a; --track: #3a3a3a;
      --normal: #2e9e5b; --warning: #d9a400; --critical: #d93a3a;
    }
    body { margin: 0; padding: 12px 14px; background: var(--bg); color: var(--fg); font: 13px 'Segoe UI', sans-serif; user-select: none; }
    .agent { margin-bottom: 14px; }
    .agent.unavailable { opacity: .55; }
    .head { display: flex; justify-content: space-between; font-weight: 600; }
    .status { font-weight: 400; color: var(--muted); font-size: 12px; }
    .note { color: var(--muted); font-size: 12px; font-style: italic; margin-top: 2px; }
    .limit { margin-top: 6px; }
    .row { display: flex; justify-content: space-between; font-size: 12px; }
    .reset { color: var(--muted); }
    .track { height: 6px; background: var(--track); border-radius: 3px; margin-top: 3px; overflow: hidden; }
    .fill { height: 100%; }
    .fill.normal { background: var(--normal); }
    .fill.warning { background: var(--warning); }
    .fill.critical { background: var(--critical); }
  </style>
</head>
<body>
  <main id="root">carregando…</main>
  <script src="popup.js"></script>
</body>
</html>
```

`packages/tray/src/popup.ts`:
```ts
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
```

`packages/tray/src/main.ts`:
```ts
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { band, buildViewModel, createDefaultCollector, worstPct } from '@agent-usage/core';
import { ICON_SIZE, renderIconBitmap } from './icon';
import { trayTooltip } from './tooltip';

const POPUP_WIDTH = 340;
const POPUP_HEIGHT = 460;

function iconFor(pct: number | null) {
  const bitmap = renderIconBitmap(pct, pct === null ? null : band(pct));
  return nativeImage.createFromBitmap(bitmap, { width: ICON_SIZE, height: ICON_SIZE, scaleFactor: 2 });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // App de bandeja: continua rodando sem janelas visíveis.
  app.on('window-all-closed', () => {});

  void app.whenReady().then(() => {
    const collector = createDefaultCollector();
    const tray = new Tray(iconFor(null));
    const popup = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#1f1f1f',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    void popup.loadFile(path.join(__dirname, 'popup.html'));

    const model = () => buildViewModel(collector.current(), new Date());
    ipcMain.handle('get-model', () => model());

    let hiddenAt = 0;
    popup.on('blur', () => {
      popup.hide();
      hiddenAt = Date.now();
    });

    const render = () => {
      const snaps = collector.current();
      tray.setImage(iconFor(worstPct(snaps)));
      tray.setToolTip(trayTooltip(snaps));
      if (popup.isVisible()) popup.webContents.send('model', model());
    };

    const togglePopup = () => {
      if (popup.isVisible()) {
        popup.hide();
        return;
      }
      if (Date.now() - hiddenAt < 250) return; // este clique acabou de fechar o popup via blur
      const bounds = tray.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const x = Math.min(
        Math.max(Math.round(bounds.x + bounds.width / 2 - POPUP_WIDTH / 2), area.x),
        area.x + area.width - POPUP_WIDTH,
      );
      const opensDown = bounds.y < area.y + area.height / 2;
      const y = opensDown ? bounds.y + bounds.height + 8 : bounds.y - POPUP_HEIGHT - 8;
      popup.setPosition(x, Math.min(Math.max(y, area.y), area.y + area.height - POPUP_HEIGHT));
      popup.webContents.send('model', model());
      popup.show();
      popup.focus();
    };

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Atualizar agora', click: () => void collector.refreshNow() },
        {
          label: 'Iniciar com o Windows',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { type: 'separator' },
        {
          label: 'Sair',
          click: () => {
            collector.stop();
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', togglePopup);

    collector.subscribe(render);
    setInterval(render, 30_000); // mantém as contagens regressivas atualizadas
    render();
    void collector.start();
  });
}
```

- [ ] **Step 8: Typecheck, testes e build**

Run: `npm run typecheck`
Expected: sem erros.

Run: `npm test`
Expected: PASS em core, vscode e tray.

Run: `npm run build -w packages/tray`
Expected: gera `packages/tray/dist/main.js`, `preload.js`, `popup.js` e `popup.html`.

- [ ] **Step 9: Verificar à mão em modo dev**

Run: `npm start -w packages/tray`
Expected, verificado à mão:
- aparece um ícone na bandeja com o maior % em números brancos sobre a cor da faixa (cinza com `--` até o primeiro dado);
- passar o mouse mostra três linhas ("Claude Code: 12% 5h · 46% sem" etc.);
- clique esquerdo abre o popup perto da bandeja com barras por agente/grupo/janela e resets; clicar fora fecha; clicar no ícone com o popup aberto fecha;
- clique direito mostra "Atualizar agora", "Iniciar com o Windows" e "Sair"; "Sair" encerra o processo.

- [ ] **Step 10: Gerar o instalador**

Run: `npm run dist -w packages/tray`
Expected: gera `packages/tray/release/Agent Usage Setup 0.1.0.exe`. Instale, abra pelo menu Iniciar, marque "Iniciar com o Windows" e confirme que o app aparece em Configurações → Aplicativos → Inicialização.

- [ ] **Step 11: Commit**

```bash
git add package-lock.json packages/tray
git commit -m "feat(tray): app de bandeja com ícone dinâmico, popup e menu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Atualizar o hub no vault**

Em `C:\SegundoCerebro\Projetos\Pessoais\VsCodeLLMAgentUsage\VsCodeLLMAgentUsage.md`:
- no frontmatter, trocar `status: ideia` por `status: ativo` e pôr em `commit_base:` a saída de `git -C C:\Fontes\VsCodeLLMAgentUsage rev-parse --short HEAD`;
- em `## Contexto rápido`, trocar a linha "Fase: …" por `- Fase: v0.1 implementada (monorepo TS: core + extensão VSCode + tray Electron).` e acrescentar:
  - `- Testar: \`npm test\` e \`npm run typecheck\` na raiz. Smoke com dados reais: ver Task 6 do plano em \`docs/superpowers/plans/\`.`
  - `- Extensão: \`npm run package -w packages/vscode\` e \`code --install-extension packages/vscode/agent-usage-0.1.0.vsix --force\`.`
  - `- Tray: \`npm start -w packages/tray\` (dev) ou \`npm run dist -w packages/tray\` (instalador em \`packages/tray/release/\`).`
- remover as linhas "Pendente: …" e "Próximo: plano de implementação.";
- substituir a tabela de `## Mapa do código` por:

```markdown
| Caminho | Responsabilidade |
|---|---|
| `packages/core/src/providers/` | um provider por agente: parse puro + I/O (arquivo, HTTP, PowerShell) |
| `packages/core/src/collector.ts` | intervalos, timeout, fallback stale/unavailable, backoff 429 |
| `packages/core/src/cache.ts` | `%APPDATA%\agent-usage\last.json` |
| `packages/core/src/format.ts` | faixas, contagens, texto da status bar, view model |
| `packages/vscode/` | extensão: status bar + tooltip |
| `packages/tray/` | Electron: ícone gerado, popup, menu, instalador NSIS |
```

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File C:\SegundoCerebro\scripts\vault-sync.ps1 push -Message "VsCodeLLMAgentUsage: v0.1 implementada, mapa do código e como rodar"`
Expected: "0 link(s) quebrado(s)" e push concluído.
