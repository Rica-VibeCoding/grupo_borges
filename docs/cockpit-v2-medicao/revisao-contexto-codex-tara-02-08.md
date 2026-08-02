# Revisão — contexto e cota do Codex no cockpit (Tara, 02/08)

> Revisor: Daniel. Diff local, **nada commitado**. Escopo pedido: barra de contexto no
> card da frota, contexto da sessão via `codex.event_msg` `token_count`, cota usada no
> painel, não repetir o 100% velho do banco, e reaproveitar a última
> `model_context_window` conhecida.
>
> Validações da Tara (pytest dos 4 arquivos, `py_compile`, `type-check` e `pnpm test`
> do `apps/web`) passam todas — e é justamente esse o problema do achado 1.

## 1 · BLOQUEIA — `model_context_window` é lido um nível acima do real

`apps/api/services/codex_reader.py:249` (e o espelho em `:282`)

O código lê `payload["model_context_window"]`. No evento real do Codex esse campo mora
**dentro de `info`**. Rollout de 02/08 (`rollout-2026-08-02T13-41-36-019fc35a`), chaves do
payload `token_count`: `['type', 'info', 'rate_limits']` — `model_context_window` só em
`info` (258400). `rate_limits` é de topo, e aí o código acerta.

`normalize_token_count_payload` contra o payload real devolve `model_context_window: None`
e `context_pct: None`.

**Por que a suíte fica verde.** As fixtures (`test_codex_reader.py:95-97` e
`test_agent_painel.py:226`) escrevem o campo no topo — formato que o Codex não emite. O
teste valida o código contra si mesmo.

**Por que a barra da frota funciona assim mesmo.** Por acidente: eventos `task_started`
(13 no arquivo aberto) trazem `model_context_window` no topo, e o laço de
`read_latest_token_count` guarda o último visto. É esse cache que preenche o buraco.

**Estrago real:**

1. `codex_events.py:180` chama `normalize_token_count_payload` **sem** o laço de arquivo —
   nunca terá janela, nunca grava `context_pct`. O item "contexto via `codex.event_msg`"
   do escopo não funciona.
2. Pior que não ajudar: quando o webhook grava, `agents.py:602-618` **prefere** o payload
   do banco ao arquivo. O painel passa a mostrar janela e pct nulos onde a leitura do
   arquivo daria 43%.
3. Sessão cujo primeiro `token_count` venha antes de qualquer `task_started` fica sem barra.

**Correção:** uma linha — `info.get("model_context_window")` com fallback pro topo — e as
duas fixtures no formato real. Sem as fixtures, o bug volta verde.

## 2 · MÉDIO — cota com janelas fixas em 300/10080

`apps/api/routers/agents.py:962-964` · não bloqueia

Só reconhece 5h e 7d. Qualquer outra `window_minutes` cai fora e o retorno vira
`status="available"` com os dois campos nulos — o bloco "Cota usada" renderiza vazio, que
é pior que dizer "indisponível". Ou devolve `missing`, ou mostra a `primary` seja qual for
a janela.

## 3 · MÉDIO — o card do Codex perdeu o "tk"

`apps/web/components/agent-statusline.tsx:83-94` e as outras duas variantes · não bloqueia

O fallback `codex_tokens_used` saiu das três. Com pct nulo o card mostrava `13.5k tk`;
agora mostra `—%` e barra vazia. Somado ao achado 1, o caso de falha ficou mais pobre que
antes. O dado continua calculado no `fleet.py` e ainda é usado no `chat-panel.tsx:295` e na
statusline do v2.

## 4 · BAIXO — arquivo inteiro lido no event loop, duas vezes por request

`apps/api/routers/agents.py:618` · não bloqueia

`read_latest_token_count` é I/O síncrono sobre o JSONL inteiro (2,4 MB → 23 ms hoje) dentro
de endpoint `async`, e roda **duas vezes** por request (contexto em `:567`, cota em `:947`),
cada uma relendo. O `fleet.py:169` fez certo, com `asyncio.to_thread`. Ler uma vez no
endpoint e passar o payload pros dois builders resolve os dois de uma vez.

## 5 · BAIXO — comentário virou mentira

`apps/web/components/painel-panel.tsx:131-132` · não bloqueia

Diz *"Quotas e Subagents não têm equivalente e ficam ocultos"* — Quotas passou a ser
renderizado na linha 137. Os dois ramos não duplicam o bloco (137 é Codex-nativo, 150 é
CC); só o comentário ficou para trás.

## 6 · BAIXO — pct nulo do arquivo apaga o valor do banco

`apps/api/routers/fleet.py:171` · não bloqueia

Se o snapshot existe mas vem sem pct, grava `None` e sai antes do fallback do banco logo
abaixo. É o requisito "evitar 100% antigo" funcionando, mas leva valor válido junto.

---

**Veredito:** um bloqueador e cinco itens que cabem na mesma leva. O bloqueador é de uma
linha, mas as fixtures têm de ir junto.

**Nota de escopo.** O diff deste working tree também carrega quatro arquivos meus, alheios
a esta revisão: `apps/cockpit/components/shell/tropa.tsx`, `apps/web/app/globals.css`,
`apps/web/components/agent-modal.tsx` e o `formatWorkspaceShort` do
`apps/web/lib/cockpit-types.ts` (a pasta do agente na tela — `cockpit-v2-ownership.md` §6).
