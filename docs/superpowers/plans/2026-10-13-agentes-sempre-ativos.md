# Agentes sempre ativos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude, Codex e Antigravity sempre "ativos"; refresh ao abrir o popup e no botão Atualizar tudo; release v0.2.0.

**Architecture:** Remove estados de inatividade na semântica/apresentação (parse do Codex, provider do Antigravity, `format.ts`). `refreshNow` ganha `force` repassado aos providers; o tray chama refresh ao abrir o popup.

**Tech Stack:** TypeScript, Vitest (`npm test`, `npm run typecheck` na raiz), Electron, esbuild, electron-builder, gh CLI.

**Spec:** `docs/superpowers/specs/2026-10-13-agentes-sempre-ativos-design.md`

## Global Constraints
- Textos removidos: `sem janela ativa`, `última atividade há`, `lido há`, `Antigravity fechado` (exibido).
- Texto novo: status `ativo`; contagem sem janela `janela livre`.
- Erros reais (429, token expirado/recusado, formato, sem login) continuam visíveis.
- Credenciais só leitura. Versão alvo `0.2.0`; tag `v0.2.0`.
- Textos em pt-BR, comentários curtos, como o código existente.

## Review Focus
- Antigravity fechado e **sem** último valor: continua `unavailable` com nota (sem números).
- Antigravity fechado **com** último valor: `live`, sem `note`, números preservados.
- `force` do Claude não ignora a janela de 429 (`rateLimitUntil`).
- Janela do Codex vencida: 0% / `janela livre`, status `live`.
- Cache carregado no start (`stale`) mostra `ativo`, não `lido há`.

---

### Task 1: Textos de status e contagem (`format.ts`)

**Files:** Modify `packages/core/src/format.ts`; Test `packages/core/test/format.test.ts`, `packages/vscode/test/tooltip.test.ts`

**Interfaces:** Produces: `statusText(snap, now): string` → `'ativo'` para `live`/`stale`; `formatCountdown(null, now)` → `'janela livre'`.

- [x] **Step 1: Atualizar testes (devem falhar)**
  - `format.test.ts`: `formatCountdown(null, NOW)` `toBe('janela livre')`; `statusText(claude, NOW)` `toBe('ativo')`; `statusText(codex, NOW)` (stale) `toBe('ativo')`; unavailable/not_installed inalterados; no teste do view model (~linhas 120-122) `views[1].statusText` `toBe('ativo')` e `limits[1]` com `resetText: 'janela livre'`.
  - `vscode/test/tooltip.test.ts`: fixture `statusText: 'ativo'`, expectativa `'**Claude Code** · ativo'`.
- [x] **Step 2:** `npx vitest run packages/core/test/format.test.ts packages/vscode/test/tooltip.test.ts` → FAIL.
- [x] **Step 3: Implementar** em `format.ts`: `statusText` retorna `'ativo'` se `live` ou `stale` (remove ramo de idade); `formatCountdown(null)` retorna `'janela livre'`.
- [x] **Step 4:** mesmo comando → PASS.
- [x] **Step 5:** `git add packages && git commit -m "feat(core): status sempre ativo e janela livre"`

### Task 2: Codex sempre ativo

**Files:** Modify `packages/core/src/providers/codex/parse.ts`; Test `packages/core/test/codex.test.ts`

**Interfaces:** Produces: `codexSnapshot(reading, now)` sempre com `status: 'live'`; `CODEX_LIVE_MS` removido.

- [x] **Step 1: Teste (falha)** — trocar `'fica stale com leitura de mais de 10 min'` por `'continua live com leitura antiga'`: `codexSnapshot(..., new Date('2026-09-21T16:00:00Z')).status` `toBe('live')`. No teste `'zera a janela que já reiniciou'` acrescentar `expect(snap.status).toBe('live')`.
- [x] **Step 2:** `npx vitest run packages/core/test/codex.test.ts` → FAIL.
- [x] **Step 3:** `codexSnapshot` usa `status: 'live'`; apagar `CODEX_LIVE_MS` e o cálculo de idade; `grep -rn CODEX_LIVE_MS packages` deve ficar vazio (checar `index.ts`).
- [x] **Step 4:** teste → PASS; `npm run typecheck` limpo.
- [x] **Step 5:** commit `feat(core): codex sempre live`.

### Task 3: Antigravity sempre ativo (erro `quiet` + coletor)

**Files:** Modify `packages/core/src/errors.ts`, `packages/core/src/providers/antigravity/provider.ts`, `packages/core/src/collector.ts`; Test `packages/core/test/antigravity.test.ts`, `packages/core/test/collector.test.ts`

**Interfaces:** Produces: `new UnavailableError(note: string, quiet = false)` com `readonly quiet: boolean`.

- [x] **Step 1: Testes (devem falhar)**
  - `antigravity.test.ts` (`'fica indisponível sem language_server'`): `rejects.toMatchObject({ name: 'UnavailableError', quiet: true })`; adicionar caso "aberto, sem resposta de cota" (`discover` devolve servidor cujo fetch responde 400) com o mesmo `toMatchObject`.
  - `collector.test.ts`: `'erro quiet mantém último valor como live sem nota'` — `fake('antigravity', snap('antigravity', 30), new UnavailableError('x', true))`, `start()` + `refreshNow()` → `toMatchObject({ status: 'live', limits: [{ usedPct: 30 }] })` e `note` `toBeUndefined()`. `'erro quiet sem último valor fica unavailable'` — só o erro quiet → `status: 'unavailable'`, `limits: []`. O teste existente de `UnavailableError` não-quiet (~linha 96) permanece inalterado.
- [x] **Step 2:** `npx vitest run packages/core/test/antigravity.test.ts packages/core/test/collector.test.ts` → FAIL.
- [x] **Step 3: Implementar** — `errors.ts`: construtor `(note: string, readonly quiet = false)`; `provider.ts`: os dois `throw new UnavailableError(...)` finais passam `true`; `collector.ts` `fromError`: antes do ramo genérico de `UnavailableError`, `if (error instanceof UnavailableError && error.quiet && last) return { ...last, status: 'live', note: undefined };`.
- [x] **Step 4:** testes → PASS; `npm test` completo verde.
- [x] **Step 5:** commit `feat(core): antigravity fechado mantém último valor como ativo`.

### Task 4: Refresh com `force` (core + Claude)

**Files:** Modify `packages/core/src/types.ts`, `packages/core/src/collector.ts`, `packages/core/src/providers/claude/provider.ts`; Test `packages/core/test/claude.test.ts`, `packages/core/test/collector.test.ts`

**Interfaces:** Produces: `Provider.fetch(signal?: AbortSignal, opts?: { force?: boolean }): Promise<AgentSnapshot>`; `Collector.refreshNow(opts?: { force?: boolean }): Promise<void>`.

- [x] **Step 1: Testes (devem falhar)**
  - `claude.test.ts` com `cooldownMs: 60_000`: `fetch()` duas vezes seguidas → rede chamada 1×; `fetch(undefined, { force: true })` depois → rede chamada 2×. Caso 429: após resposta 429 com `retry-after`, `fetch(undefined, { force: true })` devolve snapshot `stale` sem nova chamada de rede.
  - `collector.test.ts`: provider fake que grava o `opts` recebido; `refreshNow({ force: true })` → `opts.force === true`; `refreshNow()` → `force` falsy.
- [x] **Step 2:** `npx vitest run packages/core/test/claude.test.ts packages/core/test/collector.test.ts` → FAIL.
- [x] **Step 3: Implementar** — assinatura em `types.ts`; `collector.ts`: `refreshNow(opts)` → `runOnce(provider, opts)` → `provider.fetch(controller.signal, opts)`; `ClaudeProvider.fetch(signal, opts)`: cooldown só vale se `!opts?.force`; checagem de `rateLimitUntil` fica antes e intacta.
- [x] **Step 4:** testes → PASS; `npm run typecheck`.
- [x] **Step 5:** commit `feat(core): refreshNow com force`.

### Task 5: Refresh ao abrir o popup e no botão (tray + vscode)

**Files:** Create `packages/tray/src/refresh.ts`; Modify `packages/tray/src/main.ts`, `packages/vscode/src/extension.ts`; Test `packages/tray/test/refresh.test.ts`

**Interfaces:** Consumes: `Collector.refreshNow`. Produces: `refreshOnOpen(c: Refreshable | null): void` (chama `refreshNow()` sem argumentos, engole rejeição); `refreshForced(c: Refreshable | null): Promise<void> | undefined` (chama `refreshNow({ force: true })`), com `Refreshable = { refreshNow(o?: { force?: boolean }): Promise<void> }`.

- [x] **Step 1: Teste (falha)** `refresh.test.ts`: `refreshOnOpen(c)` → `refreshNow` chamado 1× sem argumentos; `refreshOnOpen(null)` não lança; `refreshNow` rejeitando não gera rejeição não tratada; `refreshForced(c)` → chamado com `{ force: true }`.
- [x] **Step 2:** `npx vitest run packages/tray/test/refresh.test.ts` → FAIL (módulo inexistente).
- [x] **Step 3: Implementar** `refresh.ts`; em `main.ts`: em `togglePopup`, antes de `popup.show()`, `refreshOnOpen(collector)`; `ipcMain.handle('refresh-now', () => refreshForced(collector))`; item de menu "Atualizar agora" → `void refreshForced(collector)`. Em `extension.ts`: comando `agentUsage.refresh` → `collector.refreshNow({ force: true })`. (O popup visível re-renderiza via `collector.subscribe(render)`.)
- [x] **Step 4:** `npx vitest run packages/tray/test/refresh.test.ts` → PASS; `npm test` e `npm run typecheck` verdes. Smoke manual: `npm run build -w packages/tray && npm start -w packages/tray`; abrir popup atualiza dados, nenhum texto de inatividade, botão atualiza.
- [x] **Step 5:** commit `feat(tray): atualiza ao abrir o painel e força no botão`.

### Task 6: Documentação e vault

**Files:** Modify `README.md` e `packages/vscode/README.md` (se citarem os estados antigos); hub do projeto no vault `C:\SegundoCerebro`.

- [ ] **Step 1:** `grep -n "ao vivo\|inativ\|última atividade" README.md packages/vscode/README.md`; ajustar os trechos encontrados e descrever "sempre ativo" + refresh ao abrir.
- [ ] **Step 2:** no hub do vault, trocar a linha "Codex status: quando inativo…" por "agentes sempre ativos; refresh ao abrir e forçado no botão"; depois do release atualizar `commit_base:`; subir com `powershell -NoProfile -ExecutionPolicy Bypass -File C:\SegundoCerebro\scripts\vault-sync.ps1 push -Message "agentes sempre ativos v0.2.0"`.
- [ ] **Step 3:** commit `docs: agentes sempre ativos`.

### Task 7: Release v0.2.0

**Files:** Modify `packages/core/package.json`, `packages/tray/package.json`, `packages/vscode/package.json`, `package-lock.json`, `README.md` (links `0.1.1` → `0.2.0`)

- [ ] **Step 1: Pré-condição:** `npm test` e `npm run typecheck` verdes; `git status` sem pendências (o `SKILL.md` não rastreado NÃO entra nos commits).
- [ ] **Step 2: Bump:** `npm version 0.2.0 --no-git-tag-version --workspaces`; `sed -i 's/0\.1\.1/0.2.0/g' README.md`. Verificar: `grep -rn "0\.1\.1" README.md packages/*/package.json package-lock.json` → vazio.
- [ ] **Step 3: Artefatos:** `npm run dist -w packages/tray` → instalador em `packages/tray/release/`; `npm run package -w packages/vscode` → `packages/vscode/agent-usage-0.2.0.vsix`. Garantir que o asset do instalador se chame `Agent.Usage.Setup.0.2.0.exe` (nome usado nos links do README).
- [ ] **Step 4: Commit e tag:** `git add package-lock.json README.md packages/*/package.json && git commit -m "chore: release v0.2.0"`; `git tag v0.2.0`.
- [ ] **Step 5: Publicar:** `git push origin main --tags`; `gh release create v0.2.0 <instalador.exe> packages/vscode/agent-usage-0.2.0.vsix --title "Agent Usage v0.2.0" --notes "Agentes sempre ativos; atualização ao abrir o painel e no botão Atualizar tudo."` (o push/release é ação externa: confirmar com o usuário se não houver autorização durável).
- [ ] **Step 6: Verificar:** `gh release view v0.2.0 --json tagName,assets` lista os 2 assets; `git tag` inclui `v0.2.0`.
