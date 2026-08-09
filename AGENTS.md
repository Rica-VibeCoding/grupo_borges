# AGENTS.md — manual de implementação do `grupo_borges`

Lido pelo Codex CLI e pelos Claude Codes que mexem neste repo. Só entra aqui o que evita erro recorrente — detalhe vai pro doc específico, listado abaixo.

## O que este repo é

Cockpit web multi-agente que dirige a frota do Grupo Borges por tmux. Backend FastAPI + SQLite WAL, front Next.js, SSE pra streaming, autenticação por identity header do Tailscale (sem senha própria). **Roda só na VPS** — não há deploy em Vercel: serverless não comanda tmux, e a Vercel não alcança a VPS pela tailnet.

**Três aplicações, três portas — confundir derruba coisa que o Rica usa:**

- `apps/web` — cockpit **v1**, porta **3007**, servido pela unit `cockpit-web.service`. **Congelado**: não recebe commit, e o Rica usa todo dia.
- `apps/cockpit` — cockpit **v2**, o trabalho vivo. Produção na **3008** (`cockpit-v2.service`), dev na **3009**.
- `apps/api` — backend FastAPI na **8000**, unit `cockpit-api.service`. Serve os dois fronts.

Rotas HTTPS do `tailscale serve`: `:3443` → v1 · `:3445` → API · **`:3446` → produção do v2, a única que o Rica abre**. A `:3444` (dev, 3009) saiu do ar em 08/08 a pedido dele: trabalho em andamento não vai mais pra tailnet.

⚠️ `pkill next`, `pkill node` ou `next dev` sem porta derrubam o cockpit do Rica. Use a skill `subir-cockpit` (`apps/cockpit/.claude/skills/`).

## Antes de codar

1. `git pull --rebase`
2. Se for tocar `apps/cockpit`, ler `apps/cockpit/CLAUDE.md` — é curto e tem cinco regras que não se negociam
3. Context7 antes de usar API de lib externa. Comportamento de biblioteca se lê, não se chuta

## Onde a verdade mora

`PLANO.md` e este arquivo descrevem intenção. Para estado real, o código é a fonte — e depois dele, estes docs, que são mantidos:

- `docs/cockpit-v2-stack.md` — versão, porta, build, o contrato de dev remoto
- `docs/cockpit-v2-data-contract.md` — payload, feed, envio, SSE
- `docs/cockpit-v2-estetica.md` — cor, espaço, tipografia, estado visual
- `docs/cockpit-v2-ownership.md` — de quem é cada arquivo, e o teto de processos da máquina
- `packages/cockpit-core/CIRURGIAS.md` — antes de mexer no core

Lista de endpoints não mora em documento: ela desatualiza em dias. Leia `apps/api/main.py` (routers montados) e o router específico.

## Stack — versões medidas em 04/08/2026, não copiadas de plano

- Node 22 · pnpm 10 · Next 16.2.6 · React 19.2.6 · TypeScript 5.7.3 · Tailwind 4.3
- Python 3.12.3 · FastAPI 0.136.1 · sse-starlette 3.4.2 · libtmux 0.55.1 · watchfiles 1.1.1
- Tailwind 4 não tem `tailwind.config.js` — tema em CSS. Sem `@tailwindcss/postcss` as utilitárias somem caladas
- shadcn é `shadcn@latest`, nunca `shadcn-ui`

## Padrões

**Front (Next 16 / React 19)**

- App Router com server components. Nunca `pages/api/*`
- `params` e `searchParams` são `Promise` — sempre `await`. `cookies()` idem
- `useActionState`, nunca `useFormState`
- Cor só em `app/globals.css`, em token `--ck-*`. Nenhum hex, `rgb()`, `oklch()` ou `bg-[#...]` em componente — é o que permite "põe no verde" mudar um lugar só
- `compress: false` no `next.config.ts` **fica**: sem ela o SSE morre em silêncio, com replay em rajada e nenhum heartbeat. Parece bug de protocolo, é gzip
- Campo de entrada nunca abaixo de 16px — o Safari dá zoom ao focar e o layout salta

**Back (FastAPI)**

- Tudo `async def`. SSE por `EventSourceResponse` do sse-starlette
- SQLite: um thread escritor por fila, leitura paralela com conexão própria (`check_same_thread=False`). Pragmas `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`
- libtmux: `capture_pane(escape_sequences=True, join_wrapped=True)`; `send_keys(enter=False)` e o `enter()` **em chamada separada** — texto e Enter juntos não submetem
- `tmux_delivered` e a família de campos otimistas **mentem**: respondem `true` antes da entrega ser confirmada. Quem consome trata como promessa, não como fato

**Nomes:** arquivos e pastas em kebab-case; módulos Python em snake_case; TS com camelCase pra função e PascalCase pra tipo; tabelas e colunas em snake_case.

## Proibido

- Deploy em Vercel, ou qualquer arranjo que precise do backend fora da VPS
- Chave de API da Anthropic/OpenAI no backend — a autenticação é o OAuth do Claude Code
- Expor o backend fora da tailnet
- Trocar SQLite por Supabase
- Polling pra saber estado de agente — o caminho é watchfiles no JSONL + heartbeat
- `git add -A` na raiz: outro agente pode estar editando em paralelo. Path explícito
- `--force push`

## Git

Conventional commits (`feat(scope)`, `fix(scope)`, `docs(scope)`, `chore:`). `git pull --rebase` antes de edição longa. Push aqui **não publica**: quem serve produção são as units, que rodam build próprio.

## Tara Kaur — a parceira Codex

Codex CLI, modelo da família `gpt-5.6`. Ela lê **este arquivo**, não `CLAUDE.md` — o que ela precisa pra codar bem tem que estar aqui.

- Prompt curto vence prompt empilhado. Instrução amontoada degrada o resultado
- Paralelismo com outro agente só com território disjunto. Dois editando o mesmo arquivo, não
- Trabalho dela é revisado antes do commit

## Falando com o Rica

Conclusão primeiro, sem preâmbulo. Lista curta, nunca tabela — ele lê quase tudo pelo celular, onde tabela fica ilegível. Separar o que está feito, o que está pendente e qual o próximo passo. Relatório prolixo é falha de entrega, não zelo.
