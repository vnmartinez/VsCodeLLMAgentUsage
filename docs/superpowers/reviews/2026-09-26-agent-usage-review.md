# Revisão de código — feat/agent-usage vs main

Data: 2026-09-26
Branch: `feat/agent-usage` (9 commits, `86b5163..235cdc5`)
Escopo: qualidade de código e risco de regressão no `git diff main...HEAD` (46 arquivos, +9241/−65).

## Veredito: REPROVADO

2 achados **Importantes** (um deles com caminho de crash comprovado). As 4 pont suspicions levantadas na
auditoria anterior foram verificadas uma a uma; 1 é real e importante, 1 é importante, 2 são
observações menores (uma delas não é problema).

## Verificação reproducida nesta execução

| Comando | Resultado |
|---|---|
| `npm test` | `Test Files 9 passed (9)` / `Tests 58 passed (58)` — exit 0 |
| `npm run typecheck` | exit 0 |
| `git status --short` | vazio (árvore limpa) |

Achados de runtime foram obtidos com sondas temporárias (`packages/core/test/zz-audit-*.test.ts`),
removidas depois; a suíte foi reexecutada após a limpeza e voltou a 58/58 com a árvore limpa.

## Importantes

### I1. `CodexProvider.fetch` ignora o `AbortSignal` — o timeout de 5 s não cancela nada

`packages/core/src/providers/codex/provider.ts:57`

```ts
async fetch(): Promise<AgentSnapshot> {   // sem parâmetro
```

A interface `Provider` declara `fetch(signal?: AbortSignal)` (`types.ts:28`). Claude e Antigravity
respeitam o sinal; o Codex não.

Evidência (classe real, não fake):

- `CodexProvider.prototype.fetch.toString()` não contém `"signal"`; `fetch.length === 0`.
- Sinal **já abortado** → `fetch()` mesmo assim resolve com dados válidos:
  `S1 sinal ja abortado -> resolveu | usedPct=42 | signal.aborted=true`.

Impacto, no `Collector.runOnce` (`collector.ts:85-107`):

1. `controller.abort()` no timeout não cancela a leitura de arquivo: o trabalho continua até o fim.
2. `Promise.race` já rejeitou, então **um `fetch` que termina com sucesso 1 ms depois do timeout tem o
   resultado descartado**. O usuário vê "tempo esgotado" mesmo com o dado em mãos.
3. O intervalo do codex é 60 s (`DEFAULT_INTERVALS_MS`), então o ciclo se repete: leitura completa
   inútil a cada minuto enquanto o disco estiver lento ou o antivírus estiver segurando o arquivo.

Cobertura de teste insuficiente: `collector.test.ts:116` ("aborta o provider no timeout") usa um
provider **fake** que só captura o sinal e nunca resolve — comprova que o *coletor* chama `abort()`,
não que qualquer provider real honre o cancelamento. Nenhum teste cobre cancelamento real.

Correção sugerida: aceitar `signal?: AbortSignal` e chamar `signal?.throwIfAborted()` no início de
cada iteração de `recentRollouts` e antes de cada `readTail`/fallback, para o scan abortar na
fronteira de arquivo (o `fs.read` do Node não recebe `AbortSignal`). Com isso, um timeout de 5 s
deixa de desperdiçar o trabalho.

### I2. `deserialize` não valida campos; o `NaN` resultante derruba a tray

`packages/core/src/cache.ts:34-63` → `packages/tray/src/icon.ts:53-64` → `packages/tray/src/main.ts:95-96`

Só `agent` e `limits` (array) são checados. `status`, `window`, `usedPct`, `resetsAt` e `fetchedAt`
passam sem validação. Comportamento medido, campo a campo:

| Entrada no cache | Resultado medido |
|---|---|
| `status: "banana"` | aceito; `status` fica `"banana"` fora de `SnapshotStatus` |
| `usedPct: "abc"` | `NaN`; status bar renderiza `$(pulse) CC --  CX NaN/--  AG --` (`format.ts:52`) |
| `window: "diario"` | aceito; `WINDOW_LABEL[l.window]` → label `undefined` (`format.ts:96`) |
| `resetsAt: "ontem"` | Invalid Date; `resetText: "reinicia em NaNd NaNh"` (`format.ts:24`) |
| `fetchedAt` ausente | Invalid Date → `serialize()` lança `RangeError: Invalid time value` |
| `limits: [null]` | `TypeError: Cannot read properties of null (reading 'window')` dentro do `deserialize` |
| `usedPct: 9999` | aceito sem clamp; `band` = `critical` |

Encadeamento de crash comprovado:

```
cache malformado → usedPct "abc"
  → Number("abc") = NaN                       (cache.ts:53)
  → worstPct(snaps) = NaN                     (format.ts:42)
  → iconLabel(NaN) = "NaN"                    (icon.ts:29 — Math.min/max não corrigem NaN)
  → FONT["N"] === undefined
  → renderIconBitmap lança TypeError: Cannot read properties of undefined (reading '0')   (icon.ts:56)
```

`render()` é chamado **sem proteção** em `main.ts:95` (`setInterval(render, 30_000)`) e em
`main.ts:96`. O `try/catch` do `Collector.emit` (`collector.ts:127`) só protege a via
`collector.subscribe(render)`; a exceção nos outros dois caminhos é não capturada no processo main
do Electron.

Efeito colateral do `fetchedAt` inválido: `collector.ts:107` engole o erro de gravação
(`.catch(() => undefined)`), então o cache **para de ser gravado silenciosamente** enquanto aquele
snapshot corrompido estiver no `lastGood`. O `limits: [null]` é mitigado por `fileCache.load`
(cache.ts:68-72 envolve o `deserialize` em try/catch e devolve `[]`).

Por que é Importante e não Crítico: o `%APPDATA%\agent-usage\last.json` é gravado só pelo app e de
forma atômica (tmp + `rename`, `cache.ts:76-78`), então JSON truncado por falha de escrita não
acontece. O gatilho real é um escritor externo/edição manual/mudança de schema futura — o que torna
isto uma falha de robustez com caminho de crash comprovado, não um bug do fluxo feliz.

Nenhum teste cobre validação de campo: `cache.test.ts` só cobre round-trip, JSON não parseável e a
lista branca de campos gravados.

Correção sugerida (barata, em `deserialize`): descartar o snapshot salvo que não tenha
`status` ∈ `SnapshotStatus`, `fetchedAt` com data válida, e cada limit com `window` ∈ `LimitWindow` e
`Number.isFinite(usedPct)`; aplicar `clamp(usedPct, 0, 100)`. Em `iconLabel`, tratar não-finite como
`'--'`. Com isso a cadeia inteira morre na origem e o `main` deixa de depender de sanitização do
renderizador.

## Observações menores (não bloqueiam o merge)

- **`readTail` sem teto de tamanho** (`codex/provider.ts:64`). O fallback
  `readTail(file, Number.MAX_SAFE_INTEGER)` lê o arquivo inteiro, sem limite. Medido com um rollout
  sintético de 256 MB: `external delta = 512 MB`, `rss = 578 MB` (a duplicação vem de
  `buffer.toString('utf8')`). Não há crash: `Buffer.alloc(Number.MAX_SAFE_INTEGER)` nunca é
  alcançado, porque a aritmética resolve para o tamanho real (e, se fosse alcançado, lançaria
  `RangeError: Array buffer allocation failed`). O risco é baixo na prática — o maior rollout desta
  máquina tem 20,2 MB e o maior dentro da janela de 7 dias tem 1,6 MB. Sugestão: teto de ~32 MB no
  fallback e log quando ele dispara, para o comportamento não ser silencioso.
- **`MarkdownString` na extensão não é vulnerabilidade.** `isTrusted` é opcional e **default `false`**
  (confirmado em `node_modules/@types/vscode/index.d.ts:2991`), então `command:` no tooltip não
  executa. Resta apenas o `view.note` interpolado sem escape em markdown
  (`vscode/src/tooltip.ts:8,11`): uma nota com `![](…)` ou link é renderizada. A origem é local
  (arquivo de cache / mensagens de erro) e o popup da tray usa só `textContent`
  (`tray/src/popup.ts:15`) — é cosmético. Dar `isTrusted: false` explícito e/ou escapar `note`
  deixaria a postura de segurança evidente no código.
- **`claude/parse.ts:20`**: `new Date(oauth.expiresAt)` não é validado, ao contrário de
  `codex/parse.ts:42`. Data inválida faz `NaN <= now` ser `false`, então um token com `expiresAt`
  inválido é usado na requisição em vez de falhar logo.
- **`codex/provider.ts:46`**: o `stat(file)` está fora do try/catch que protege o `readdir`. Se o
  arquivo sumir entre `readdir` e `stat` (Codex rotaciona/limpa sessões), `fetch()` lança ENOENT cru
  em vez de `UnavailableError` e o coletor mostra o erro cru em vez do fallback stale.
- **`format.ts:51`**: `pctText` não trata não-finite (`String(Math.round(NaN))` → `"NaN"`). Com I2
  corrigido na origem, isto fica sem risco; como defesa, é o lugar natural para o clamp.
- **`tray/main.ts:95`**: o `setInterval` de 30 s nunca é limpo. Inofensivo com `app.quit()`, mas
  mantém a event loop referenciada.
- **`antigravity/parse.ts:57-59`**: `(1 - remaining) * 100` não é limitado a 0–100. Só trusted
  local (`127.0.0.1`) com token CSRF do próprio processo, então não é problema de segurança; ainda
  assim, um `remainingFraction` fora de faixa renderiza barra/percentual estranho.
- **Segurança — aprovado**: o tratamento de token está limpo. `Authorization` e `x-codeium-csrf-token`
  só vão em cabeçalhos de requisição; a linha de comando do language server (que traz o token) é
  descartada logo após a extração (`antigravity/parse.ts:21,33`) e o erro do PowerShell é genérico
  de propósito (`discover.ts:27-28`). Nenhum token em logs, `note` ou mensagem de erro.

## O que está bem

- Atomicidade do cache (tmp + `rename`) com PID no nome, comentário explicando a concorrência
  tray/extensão.
- `Collector` trata timeout, fallback stale/unavailable, backoff 429 com teto e `reset` no sucesso;
  `emit()` isola falha de frontend.
- `AntigravityProvider` re-descobre servidor/porta/token quando o IDE reinicia, e distingue
  `SourceFormatError` (não mostra números) de falha de transporte.
- Providers de rede recebem `fetch` por injeção: nenhum teste toca a rede.
- Popup da tray sem `innerHTML`; `contextIsolation: true` e `sandbox: true` no `BrowserWindow`.
- Commits atômicos por camada, 65/65 checkboxes do plano marcadas, 58 testes cobrindo parse, I/O,
  timeout, backoff, cache e view model.
