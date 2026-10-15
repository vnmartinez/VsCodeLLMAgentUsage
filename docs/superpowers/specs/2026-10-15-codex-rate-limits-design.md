# Codex: bucket de rate_limits sem janela — Design

## Intenção
O painel mostra o Codex como indisponível com a nota `formato da fonte mudou (codex rate_limits)`, embora o rollout tenha leituras válidas. A leitura deve voltar a usar o último bucket com janelas válidas.

## Causa (diagnosticada)
A CLI do Codex grava mais de um bucket de `rate_limits` no mesmo rollout (`~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl`):

- `limit_id: "codex"` — `primary`/`secondary` válidos (`used_percent`, `window_minutes`, `resets_at`).
- `limit_id: "premium"` — `primary: null`, `secondary: null`, mais `credits` e `plan_type`.

`findLatestReading` (`packages/core/src/providers/codex/parse.ts`) varre o arquivo de baixo para cima e chama `parseCodexLine`. Na linha `premium`, `parseCodexLine` lança `SourceFormatError('codex rate_limits')`, que aborta a busca e descarta as linhas `codex` válidas acima. Evidência: rollout de 15/10 16:22 com 374 linhas `codex` (última: 5h 100%, semanal 31%) e a última linha `rate_limits` do arquivo é `premium` com janelas `null`.

## Objetivos
- Bucket sem janela nenhuma (`primary` e `secondary` ambos `null`/ausentes) não é leitura: `parseCodexLine` retorna `null` e a busca continua para cima.
- `SourceFormatError('codex rate_limits')` continua para formato realmente inesperado: janela presente mas incompleta/inválida, ou só uma das duas janelas presente.
- Teste cobrindo a linha `premium` com janelas `null` no fim do arquivo.

## Não-objetivos
- Não filtrar por `limit_id`, não exibir `credits`/`plan_type`/bucket premium.
- Sem abstração nova, opção de config ou refactor extra. `provider.ts` e `codexSnapshot` não mudam.

## Anti-objetivos
- Engolir erros de formato reais (ex.: `primary` com campos faltando) — isso esconderia mudanças futuras do formato.

## Decisão de implementação
Em `parseCodexLine`, logo após desestruturar `primary`/`secondary`:

```ts
if (primary == null && secondary == null) return null; // bucket sem janela (ex.: premium)
```

`== null` cobre `null` e ausência do campo. As checagens `isRawWindow` seguintes ficam como estão.

## Comportamento resultante
| Última linha rate_limits | Antes | Depois |
|---|---|---|
| `codex` válida | leitura | leitura |
| `premium` com ambas `null`, `codex` válida acima | `SourceFormatError` | leitura da `codex` acima |
| só linhas `premium` no trecho lido | `SourceFormatError` | `null` → provider tenta trecho maior / próximo arquivo → `UnavailableError('sem dados de limite…')` se nada |
| `primary` incompleta, `secondary` `null` | `SourceFormatError` | `SourceFormatError` (inalterado) |

## Testes
Em `packages/core/test/codex.test.ts` (Vitest), sem alterar a fixture:
- `parseCodexLine` retorna `null` para linha `token_count` com `limit_id: "premium"`, `primary: null`, `secondary: null`.
- `findLatestReading` com a fixture + linha premium anexada no fim retorna a leitura `codex` (timestamp `2026-09-21T15:32:42.157Z`, 2 janelas).
- Teste existente `rejeita rate_limits com formato inesperado` segue passando.

## Calls do planner
- Revisão por subagente (builder check) dispensada: mudança de uma linha com causa e correção já especificadas pelo requisito.
