# Agentes sempre ativos — design

Data: 2026-10-13 · Base: v0.1.1 (commit 53785fc) · Alvo: v0.2.0

## Intenção
Claude Code, Codex e Antigravity devem constar **sempre como ativos e atualizados**, qualquer que seja a forma de acesso (TUI, Orca ADE, app instalado como Claude Cowork). Hoje o painel mostra estados de inatividade que sugerem que o monitor parou.

## Estado atual (achados da exploração)
- O coletor (`packages/core/src/collector.ts`) já roda em segundo plano enquanto o tray existe; a fonte de dados é independente do front-end usado pelo agente:
  - Claude: API OAuth com o token de `~/.claude/.credentials.json`.
  - Codex: último `token_count` nos rollouts `~/.codex/sessions` (qualquer cliente que usa o Codex grava ali).
  - Antigravity: language server local descoberto por PowerShell.
- O que parece "inativo" vem só da semântica/apresentação do status:
  1. `codexSnapshot` (`providers/codex/parse.ts`) marca `stale` se a leitura tem >10 min (`CODEX_LIVE_MS`) → `statusText` mostra "última atividade há X".
  2. `AntigravityProvider.fetch` lança `UnavailableError('Antigravity fechado')` sem language server → coletor marca `unavailable` ("indisponível" + nota).
  3. `formatCountdown(null)` devolve "sem janela ativa".
  4. `statusText` devolve "ao vivo"/"lido há X" conforme `live`/`stale`.
- Atualização: `refreshNow()` existe (botão "Atualizar tudo", menu "Atualizar agora", comando da extensão), mas abrir o popup só reenvia o modelo em cache (`togglePopup`, `main.ts`) — não coleta. O `ClaudeProvider` ainda tem cooldown de 60 s, então o botão pode devolver o valor antigo.

## Metas
- Nenhum texto de inatividade: remover "sem janela ativa", "última atividade há X", "lido há X", "Antigravity fechado".
- Agente instalado com dados conhecidos sempre aparece com status textual **"ativo"**.
- Atualizar todos os agentes ao **abrir** o popup do Agent Usage.
- O botão **Atualizar tudo** (e o menu "Atualizar agora" / comando da extensão) força coleta real, inclusive ignorando o cooldown do Claude.
- Release v0.2.0 publicada no GitHub.

## Não-metas / anti-metas
- Não ler/gravar tokens além do que já é feito (regra: só leitura de credenciais).
- Não monitorar o Claude Cowork por outra fonte: o uso já é refletido pela API de uso da conta.
- Não esconder erros reais: 429, token expirado/recusado, formato inesperado e "sem login" continuam como `note`/`unavailable`. Só o estado "agente ocioso/fechado" some.
- A extensão VS Code só coleta com o VS Code aberto; "sempre ativo" é garantido pelo tray (inicia com o Windows).

## Decisões (minhas — revisar)
1. `statusText`: `live` e `stale` → `'ativo'` (idade do dado some). `unavailable` → `'indisponível'`, `not_installed` → `'não instalado'`, inalterados.
2. `formatCountdown(null)` → `'janela livre'` (janela sem uso/reiniciada).
3. Codex: `codexSnapshot` sempre `status: 'live'`; remover `CODEX_LIVE_MS`. A leitura mais recente continua válida; janela vencida já vira 0%/`resetsAt: null`.
4. Antigravity fechado: `UnavailableError` ganha flag `quiet` (2º argumento do construtor, `readonly quiet: boolean`, padrão `false`). Provider lança com `quiet = true`. Coletor, ao receber erro `quiet` com último valor bom, devolve `{...last, status: 'live', note: undefined}`; sem último valor, cai no `unavailable` normal.
5. Refresh: `Provider.fetch(signal?, opts?: { force?: boolean })`; `Collector.refreshNow(opts?: { force?: boolean })` repassa. Só o `ClaudeProvider` usa `force` (ignora `cooldownMs`; **não** ignora `rateLimitUntil` do 429).
   - Abrir popup → `refreshNow()` sem force (respeita cooldown, protege contra 429).
   - Botão "Atualizar tudo", menu "Atualizar agora", comando `agentUsage.refresh` → `refreshNow({ force: true })`.
6. `packages/tray/src/refresh.ts` guarda duas funções finas e testáveis (`refreshOnOpen`, `refreshForced`) usadas por `main.ts`.
7. Versão **0.2.0** (muda comportamento visível): `packages/{core,tray,vscode}/package.json`, `package-lock.json` e links do `README.md`.

## Riscos
- Antigravity fechado por muito tempo mostra % e contagem antigos como "ativo" (`resetsAt` vencido vira "reinicia agora"). Aceito por requisito.
- Abertura do popup + clique no botão podem disparar coletas concorrentes; inofensivo, sem dedupe (YAGNI).
- Release exige `gh` autenticado e build do instalador NSIS no Windows.

## Testes
Vitest na raiz (`npm test`, `npm run typecheck`); os 82 testes atuais devem continuar verdes após ajustar os que afirmam o texto antigo.
