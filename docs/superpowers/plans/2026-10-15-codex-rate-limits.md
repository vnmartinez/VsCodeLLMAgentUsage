# Codex rate_limits multi-bucket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bucket de `rate_limits` sem janela (ex.: `premium` com `primary`/`secondary` `null`) deixa de derrubar a leitura do Codex; a busca continua até a linha `codex` válida.

**Architecture:** Uma linha em `parseCodexLine`: se `primary` e `secondary` forem ambos `null`/ausentes, retorna `null` (não é leitura). `findLatestReading`, `codexSnapshot` e `provider.ts` não mudam.

**Tech Stack:** TypeScript, Vitest (`npm test`, `npm run typecheck` na raiz).

**Spec:** `docs/superpowers/specs/2026-10-15-codex-rate-limits-design.md`

## Global Constraints
- Branch: `fix/codex-rate-limits`.
- Escopo mínimo: sem abstração, sem opção de config, sem refactor extra; não filtrar por `limit_id`.
- `SourceFormatError('codex rate_limits')` mantido para janela presente mas inválida ou só uma janela presente.
- Fixture `packages/core/test/fixtures/codex-rollout.jsonl` não muda.
- Testes e comentários em pt-BR, curtos, como o código existente.

## Review Focus
- Só uma janela `null` (`primary` incompleta, `secondary: null`): continua `SourceFormatError` — coberto pelo teste existente `rejeita rate_limits com formato inesperado`.
- Campos `primary`/`secondary` ausentes (não só `null`) no bucket: tratado como sem janela (`== null`) — teste na Task 1.
- Trecho lido só com linhas premium: `findLatestReading` retorna `null` (provider cai para `UnavailableError`, não `SourceFormatError`) — teste na Task 1.

---

### Task 1: Ignorar bucket sem janela em `parseCodexLine`

**Files:**
- Modify: `packages/core/src/providers/codex/parse.ts:38` (após `const { primary, secondary } = payload.rate_limits;`)
- Test: `packages/core/test/codex.test.ts` (describe `parseCodexLine` e novo describe `findLatestReading`)

**Interfaces:**
- Consumes: `parseCodexLine(line: string): CodexReading | null`, `findLatestReading(text: string): CodexReading | null`, helper de teste `fixtureText()`.
- Produces: mesmas assinaturas; `parseCodexLine` passa a retornar `null` para bucket sem janela.

- [ ] **Step 1: Write the failing tests** em `packages/core/test/codex.test.ts`

Constante no topo do arquivo (perto de `LIVE_NOW`):

```ts
const PREMIUM_LINE = '{"timestamp":"2026-09-21T15:33:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"premium","primary":null,"secondary":null,"credits":{"has_credits":false},"plan_type":"plus"}}}';
```

No describe `parseCodexLine`:

```ts
it('ignora bucket sem janela (premium)', () => {
  expect(parseCodexLine(PREMIUM_LINE)).toBeNull();
  expect(parseCodexLine('{"timestamp":"2026-09-21T15:33:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"premium"}}}')).toBeNull();
});
```

Novo describe:

```ts
describe('findLatestReading', () => {
  it('pula linha premium no fim e usa o bucket codex acima', async () => {
    const text = (await fixtureText()).trimEnd() + '\n' + PREMIUM_LINE + '\n';
    const reading = findLatestReading(text);
    expect(reading?.timestamp.toISOString()).toBe('2026-09-21T15:32:42.157Z');
    expect(reading?.windows).toHaveLength(2);
  });

  it('retorna null quando só há buckets sem janela', () => {
    expect(findLatestReading(PREMIUM_LINE + '\n')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test/codex.test.ts`
Expected: FAIL nos 3 testes novos com `SourceFormatError: ... codex rate_limits`.

- [ ] **Step 3: Implement** em `parse.ts`, logo após a desestruturação:

```ts
if (primary == null && secondary == null) return null; // bucket sem janela (ex.: premium)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/codex.test.ts`
Expected: PASS em todos, incluindo `rejeita rate_limits com formato inesperado`.

- [ ] **Step 5: Run full suite and typecheck**

Run: `npm test` e `npm run typecheck` na raiz.
Expected: todos passam (92 anteriores + 3 novos), typecheck sem erros.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/providers/codex/parse.ts packages/core/test/codex.test.ts
git commit -m "fix(codex): ignora bucket rate_limits sem janela"
```
