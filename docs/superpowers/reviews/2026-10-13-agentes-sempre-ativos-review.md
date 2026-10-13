# Revisão de código — Agentes sempre ativos (v0.2.0)

Data: 2026-10-13
Commits avaliados: `347ecc7..f44bb85` (base: `bc8c60c`, alvo: `main` / tag `v0.2.0`)
Spec: `docs/superpowers/specs/2026-10-13-agentes-sempre-ativos-design.md`
Plano: `docs/superpowers/plans/2026-10-13-agentes-sempre-ativos.md`

## Veredito: APROVADO (Ready to merge)

Nenhum problema crítico ou importante encontrado. Implementação segue estritamente as decisões de design, sem regressões observadas e com cobertura de testes ampliada (de 82 para 92 testes unitários).

---

## Verificação reproducida nesta execução

| Comando | Resultado |
|---|---|
| `npm test` | `Test Files 13 passed (13)` / `Tests 92 passed (92)` — exit 0 |
| `npm run typecheck` | `tsc -p tsconfig.json` — exit 0 |
| `gh release view v0.2.0` | Release publicada com `Agent.Usage.Setup.0.2.0.exe` e `agent-usage-0.2.0.vsix` |

---

## Verificação dos Pontos de Foco do Plano

1. **Antigravity fechado sem último valor continua `unavailable`:**
   - Em `packages/core/src/collector.ts`, `fromError` avalia `if (error instanceof UnavailableError && error.quiet && last) return { ...last, status: 'live', note: undefined };`.
   - Se `last` não existe (primeira execução ou sem leitura prévia bem-sucedida), cai no handler de `UnavailableError`, retornando `status: 'unavailable'`, `limits: []` e a nota de erro.
   - Coberto por teste unitário em `packages/core/test/collector.test.ts:115` (`'erro quiet sem último valor fica unavailable'`).

2. **`force` do Claude não ignora `rateLimitUntil`:**
   - Em `packages/core/src/providers/claude/provider.ts`, a verificação `this.rateLimitUntil > nowTime && this.lastSnapshot` precede a checagem de `!opts?.force`.
   - Mesmo com `{ force: true }`, se a janela de 429 estiver ativa, o snapshot `stale` é retornado sem disparo de nova chamada HTTP.
   - Coberto por teste unitário em `packages/core/test/claude.test.ts:85` (`'force não ignora a janela de 429'`).

3. **Janela vencida do Codex zera com status `live`:**
   - Em `packages/core/src/providers/codex/parse.ts`, a remoção de `CODEX_LIVE_MS` garante que o snapshot é sempre emitido como `status: 'live'`.
   - Janelas cujo `resets_at <= now` têm `usedPct: 0` e `resetsAt: null`. Em `formatCountdown(null)` o texto exibido é `'janela livre'`.
   - Coberto por teste unitário em `packages/core/test/codex.test.ts:72` (`'zera a janela que já reiniciou'`).

4. **Cache stale do start mostra `ativo`:**
   - No coletor (`packages/core/src/collector.ts`), dados carregados do cache entram no estado transitório `status: 'stale'`.
   - Em `packages/core/src/format.ts`, `statusText` retorna `'ativo'` para ambos `live` e `stale`.
   - O usuário não vê mensagens antigas como `lido há X min` durante o carregamento inicial.

5. **Textos de inatividade removidos de todos os frontends:**
   - Varredura de código confirma a eliminação completa dos textos `'sem janela ativa'`, `'última atividade há'`, `'lido há'` e `'ao vivo'` em `packages/core`, `packages/tray` e `packages/vscode`.
   - Frontends exibem `view.statusText` ('ativo' / 'indisponível' / 'não instalado') e `resetText` ('janela livre' / 'reinicia em ...' / 'reinicia agora').

---

## Qualidade de Código e Padrões

- **Padrão de arquitetura:** Coletor isolado de frontends, repasse limpo do parâmetro `opts?: { force?: boolean }` via interface `Provider`.
- **Tratamento de exceções:** `refreshOnOpen` em `packages/tray/src/refresh.ts` absorve rejeições assíncronas (`catch(() => undefined)`), evitando unhandled rejections no ciclo de abertura da janela do Electron.
- **Robustez:** Manutenção da proteção contra 429 e preservação da detecção dinâmica de agentes instalados.
- **Documentação e Vault:** `README.md` e o hub do Segundo Cérebro (`C:\SegundoCerebro\Projetos\Pessoais\VsCodeLLMAgentUsage\VsCodeLLMAgentUsage.md`) atualizados e sincronizados no commit `f44bb85`.
