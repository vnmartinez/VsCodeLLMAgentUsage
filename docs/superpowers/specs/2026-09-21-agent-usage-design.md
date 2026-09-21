# Agent Usage: design

Data: 2026-09-21 · Status: aprovado em brainstorming, aguardando revisão da spec

## Objetivo

Mostrar num lugar só quanto já foi usado das **janelas de 5h e semanal** de três agentes de código (Claude Code, Codex e Antigravity) e quando cada janela reinicia. Vale para os agentes na CLI e na IDE.

Duas superfícies, alimentadas por um núcleo comum:

- ícone na bandeja do Windows (app Electron);
- item na status bar do VSCode (extensão).

Uso pessoal, só Windows 11.

### Fora do escopo

Tokens e custo, histórico e gráficos, notificações ao passar de um limite, macOS e Linux, publicação no Marketplace.

## Fontes de dados (validadas em spike em 2026-09-21)

Nenhuma é API documentada. Todas podem mudar sem aviso, e o design isola cada uma num provider.

| Agente | Fonte | Campos usados | Limitação |
|---|---|---|---|
| Codex | `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl`, último evento com `payload.type = "token_count"` | `payload.rate_limits.primary` (`window_minutes = 300`) e `.secondary` (`window_minutes = 10080`): `used_percent`, `resets_at` (epoch em segundos) | Só atualiza quando o Codex é usado |
| Claude Code | `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <claudeAiOauth.accessToken>` (de `~/.claude/.credentials.json`) e `anthropic-beta: oauth-2025-04-20` | `five_hour` e `seven_day`: `utilization` (% usado), `resets_at` (ISO 8601) | O token dura poucas horas e só o Claude Code o renova |
| Antigravity | `POST http://127.0.0.1:<porta HTTP>/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`, corpo `{}`, headers `Content-Type: application/json` e `x-codeium-csrf-token: <--csrf_token do processo>` | `response.groups[].displayName`, `.buckets[]`: `window` (`5h` ou `weekly`), `remainingFraction` (0–1), `resetTime` (ISO 8601) | Só funciona com a IDE ou a CLI do Antigravity abertas |

Detalhes do Antigravity: o processo é `language_server.exe`, com dois sockets em escuta no `127.0.0.1`. A porta HTTP é a que aceita texto puro (na observação, a maior das duas). O CSRF token vem do argumento `--csrf_token` na linha de comando e muda a cada vez que a IDE abre. São dois grupos com limites independentes: "Gemini Models" e "Claude and GPT models".

## Arquitetura

Monorepo com npm workspaces, TypeScript em tudo:

```
packages/
  core/     providers + coletor. Não depende de VSCode nem de Electron.
  vscode/   extensão: item na status bar + tooltip. Importa core.
  tray/     Electron: ícone na bandeja + popup. Importa core.
```

Cada frontend roda o próprio coletor e funciona sem o outro. Com os dois abertos, a API da Anthropic recebe duas chamadas a cada 5 min, o que é aceitável.

### Modelo

```ts
type AgentId = 'claude' | 'codex' | 'antigravity';
type LimitWindow = '5h' | 'weekly';

interface Limit {
  agent: AgentId;
  group?: string;       // só Antigravity: "Gemini" | "Claude/GPT"
  window: LimitWindow;
  usedPct: number;      // 0–100, sempre % usado
  resetsAt: Date;
}

interface AgentSnapshot {
  agent: AgentId;
  status: 'live' | 'stale' | 'unavailable';
  limits: Limit[];
  fetchedAt: Date;      // quando o dado foi produzido na origem
  note?: string;        // motivo de stale/unavailable, mostrado ao usuário
}

interface Provider {
  id: AgentId;
  fetch(): Promise<AgentSnapshot>;
}
```

Normalização:

- Codex: `usedPct = used_percent`.
- Claude: `usedPct = utilization`.
- Antigravity: `usedPct = (1 - remainingFraction) * 100`. Os nomes de grupo viram "Gemini" e "Claude/GPT".

### Providers

Cada provider separa o I/O (ler arquivo, rodar processo, HTTP), que é injetado, do parse, que é uma função pura e testável.

- **CodexProvider:** acha o rollout mais recente, procurando de hoje para trás até 7 dias. Lê o arquivo do fim para o começo até achar o último `token_count` com `rate_limits`. `status` é `live` se o evento tem menos de 10 min e `stale` se é mais antigo. Se o `resetsAt` de uma janela já passou, ela vira `usedPct = 0` com a nota "janela reiniciada desde a última leitura".
- **ClaudeProvider:** lê `~/.claude/.credentials.json`. Se o `expiresAt` já passou, devolve `stale` com os limites do cache e a nota "token expirado, abra o Claude Code". Se não passou, chama a API. Nunca renova o token nem escreve no arquivo.
- **AntigravityProvider:** descobre os `language_server.exe` via `Get-CimInstance Win32_Process` (child_process + PowerShell), extrai `--csrf_token` e lista as portas em escuta com `Get-NetTCPConnection`. Tenta cada processo e porta até um responder `200`. Guarda pid, porta e token em memória e só redescobre quando uma chamada falha. Sem processo, devolve `unavailable` com o último valor em cache e a nota "Antigravity fechado".

### Coletor

- Roda cada provider no seu intervalo (padrões configuráveis): Claude a cada 300 s, Codex e Antigravity a cada 60 s.
- Cada execução tem timeout de 5 s e try/catch próprio. A falha de um provider não afeta os outros.
- Mantém o último snapshot bom por agente. Em caso de erro, publica esse snapshot como `stale` com o motivo em `note`.
- Resposta `429` da API do Claude dobra o intervalo dele, até no máximo 1800 s. O intervalo volta ao padrão no primeiro sucesso.
- Expõe `subscribe(listener)`, `refreshNow()` e `current(): AgentSnapshot[]`.
- Persiste os últimos snapshots em `%APPDATA%\agent-usage\last.json`, só com percentuais, horários e status, e os carrega na inicialização como `stale`.

## Interface

Regras comuns:

- Sempre mostrar % usado.
- Faixas de cor: normal abaixo de 80, aviso de 80 a 94, crítico de 95 em diante.
- Reset em contagem regressiva ("reinicia em 2h13", "reinicia em 3d 6h").
- Idade do dado: "ao vivo" ou "lido há 25 min".

### Extensão VSCode

Um item na status bar à direita:

```
$(pulse) CC 12/46  CX 58/41  AG 11/49
```

- Cada par é 5h/semanal. No Antigravity aparece o grupo com o maior % em cada janela.
- Agente `unavailable` aparece como `--`.
- O fundo do item usa `statusBarItem.warningBackground` na faixa de aviso e `errorBackground` na crítica, conforme a pior janela.
- Tooltip em `MarkdownString` com todos os agentes, janelas, grupos, resets, status e notas.
- Clicar no item executa `refreshNow()`.

### Tray (Electron)

- **Ícone:** gerado em tempo de execução com o maior `usedPct` entre todas as janelas de todos os agentes, na cor da faixa.
- **Tooltip nativo:** uma linha por agente, respeitando o limite de ~127 caracteres do Windows.
- **Clique esquerdo:** abre um popup sem moldura, ancorado perto da bandeja, com barras de progresso por agente, grupo e janela, com o mesmo conteúdo do tooltip da extensão. Fecha ao perder o foco.
- **Clique direito:** menu com "Atualizar agora", "Iniciar com o Windows" (`app.setLoginItemSettings`) e "Sair".
- Sem janela principal e sem ícone na barra de tarefas.

## Segurança

- Os tokens (OAuth do Claude e CSRF do Antigravity) ficam só na memória, durante a chamada. Nunca vão para log, cache ou mensagem de erro.
- Cada token só vai para a própria origem: o OAuth para `api.anthropic.com`, o CSRF para `127.0.0.1`.
- O app só lê `~/.claude`, `~/.codex` e `~/.gemini`, nunca escreve neles.
- O cache em disco não guarda dados pessoais (nome e e-mail vindos de qualquer fonte são descartados).

## Testes

- vitest em todos os pacotes. Nenhum teste acessa a rede nem lê os diretórios reais dos agentes.
- **Núcleo:** parse de cada provider com fixtures sanitizadas das respostas reais. Casos cobertos com I/O e relógio injetados:
  - leitura normal;
  - janela já reiniciada;
  - evento Codex antigo (`stale`);
  - token Claude expirado;
  - Claude `401` e `429` (backoff);
  - Antigravity sem processo, com mais de um processo e com porta errada;
  - formato inesperado (`unavailable` com a nota "formato da fonte mudou").
- **Coletor:** isolamento de falha entre providers, timeout, fallback para o último snapshot bom, persistência e carga de `last.json`.
- **Frontends:** funções puras de formatação testadas (texto da status bar, tooltip, faixa de cor, contagem regressiva, texto do ícone). A interface é verificada com um teste manual rápido.

## Empacotamento

- Extensão: `vsce package` gera um `.vsix`, instalado localmente.
- Tray: `electron-builder` gera um `.exe` para Windows.

## Premissas

- Identificadores de código em inglês e documentação em português, até que Vinicius defina o idioma do código (pendente no vault).
- Node LTS atual e Electron estável atual no momento da implementação.
