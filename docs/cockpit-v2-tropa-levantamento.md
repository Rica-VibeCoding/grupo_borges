# TROPA — levantamento contra o cockpit antigo (30/07/2026)

> Rica reprovou a primeira coluna TROPA de olho: *"essa parte dos agentes no cockpit
> antigo ainda é mais bonita"*, *"emoji feios"*, *"sem componentes"*, *"sem status
> line"*, *"não tem as mesmas informações que temos no cockpit"*, *"um visual que um
> LLM bem paradinho faria melhor"*.
>
> A régua desta rodada, dada pelo Pavan, é **a informação do antigo — não a minha**.
> Este documento é o levantamento honesto que veio antes de desenhar qualquer coisa,
> conforme §9.1 do `cockpit-v2-estetica.md`.

Fonte lida: `apps/web/components/agent-card.tsx`, `apps/web/components/agent-statusline.tsx`
e `packages/cockpit-core/src/cockpit-types.ts`. Foto dos dois lado a lado no iPhone
(393×852) antes de mexer em nada.

## 1. O que o antigo mostra por agente e a primeira TROPA não mostrava

| # | Informação | Cockpit antigo (:3007) | TROPA v1 (reprovada) |
|---|---|---|---|
| 1 | Retrato do agente | foto em `/avatars/<slug>.png`, 10 arquivos | emoji do `/api/fleet` |
| 2 | Reserva quando não há retrato | iniciais via `deriveInitials` | `•` — e 3 agentes caíam nele |
| 3 | Modelo em execução | `parseModelFromPane`, colorido por família | nada |
| 4 | Tempo de sessão | `formatDuration` | nada |
| 5 | Barra de contexto | sim, com faixa de severidade | só o número |
| 6 | Contexto lido do **pane** | `resolveContextPct` (pane ▸ campo) | campo cru `context_pct` |
| 7 | Tokens do Codex quando não há % | `codex_tokens_used` | nada — Tara ficava vazia |
| 8 | Tarefa corrente | `current_task_id` / `active_task_label` | parcial, misturada no detalhe |
| 9 | Subagentes ativos | badge com contagem | nada |
| 10 | SSE caído | ícone de wifi cortado | nada |
| 11 | Estado | chip com ponto + palavra | palavra solta |
| 12 | Peso visual de quem dorme | offline colapsa, sem telemetria | 9 linhas de peso idêntico |
| 13 | Visto pela última vez | `formatLastSeen` | nada |

O que a v1 tinha e o antigo não: **`aguardando` no topo**. Isso ficou.

## 2. As três descobertas que mudaram o desenho

**O antigo nunca usou emoji.** O campo `emoji` existe no `/api/fleet` e vem nulo em
`barsi`, `felipe` e `vinicius` — mas isso nunca foi problema lá, porque o antigo lê
`/avatars/<slug>.png` e cai em iniciais. O item 5 do despacho ("me diga se prefere que
eu peça os três emojis ao Rica") fica **sem objeto**: não é preciso pedir emoji nenhum.
Os dez retratos vieram pro `apps/cockpit/public/avatars/`.

**O `context_pct` do campo é a fonte SECUNDÁRIA, não a primária.** `resolveContextPct`
tenta primeiro `parseContextPct(pane_excerpt)` — o que o tmux está mostrando agora — e
só cai no campo se o pane não disser. A v1 lia o campo direto. Invertido agora.

**A `status_line` não é a "status line".** O campo `status_line` do `/api/fleet` vem
nulo em todos menos `tara`. O que o Rica chama de status line é a faixa
`modelo · tempo · contexto` do `agent-statusline.tsx`, que é **derivada**, não um campo.
Era por isso que "trazer a status line de volta" não saía de lugar nenhum sem este
levantamento.

## 3. O que mudei de propósito em relação ao antigo

**A barra do antigo mente sobre a régua do próprio Rica.** Ela vai de 0 a 100 sem marca
nenhuma, então mostra o Vinicius em 60% como "pouco mais da metade" — quando 60% é o
**dobro** do teto de 30% que ele mesmo cravou (`ze-shared/AGENTS.md`, ordem de 30/07).
Pus um traço no 30, atravessando a barra em cima e embaixo. A escala continua 0–100,
igual ao número ao lado; o que entra é o julgamento. Com o Pavan em 30% a barra encosta
exatamente no traço, e a leitura "está no limite" sai sem ler número.

**Fora o jargão de máquina.** A v1 mostrava `lifecycle_detail` cru: `tool_use`,
`mensagem do usuário`, `passou a bola`. É vocabulário de sistema numa tela de pessoa.
Saiu inteiro — quem está de pé mostra telemetria, quem dorme mostra há quanto tempo.

**Hierarquia por vida.** Quem está de pé ganha cartão de duas linhas com telemetria;
offline vira linha rasa sob um divisor que conta. Telemetria de sessão morta é ruído.

**Dois layouts, não um responsivo.** A coluna do desktop tem 260px (medida do esqueleto,
§10). Com o chip escrito, "Daniel Singh" virava "Daniel …" e "Opus 5" virava "C". No
modo coluna o estado vira ponto no retrato (`AvatarBadge`, com `aria-label` — cor
sozinha nunca carrega sentido) e o tempo de sessão sai.

## 4. Componentes de verdade

`shadcn` entrou no chrome, como o playbook autoriza no híbrido. `components.json`
criado à mão em vez de `shadcn init` — o `init` reescreve `globals.css` e teria
atropelado os tokens do contrato. Conferido por `diff`: o CSS não foi tocado.

- `@shadcn/avatar` → `Retrato`. O Radix só monta a reserva quando a carga falha; o
  `<img onError>` do antigo esconde a imagem **depois** de o browser já ter desenhado o
  ícone de quebrado — dá pra ver isso no Canário, que não tem retrato.
- `@shadcn/badge` (`variant="ghost"`, sem cor própria) → `ChipEstado`.
- `AvatarBadge` → ponto de estado no modo coluna.

Peso: os 10 retratos eram **19 MB** de PNG 1024². Viraram **25,4 KB** de WebP 128² —
quem abre isso abre no 4G.

## 5. O que ficou de fora, e é dívida declarada

- **Subagentes ativos, SSE caído e tarefa corrente** (itens 8, 9 e 10) dependem de
  contexto de cliente que o v2 ainda não tem (`useSubagentActiveCount`,
  `useFleet`). Não inventei indicador sem fonte.
- **A telemetria não é viva.** `agora` é carimbado no servidor a cada render
  (`force-dynamic`), então o relógio só anda quando a página recarrega. O antigo anda
  sozinho via SSE. É trabalho de esqueleto, não de pele.
- **`/avatars/canario.webp` dá 404** e cai na reserva "CC", que é o comportamento certo.
  Uma lista fixa de slugs com retrato tiraria o 404 mas apodrece quando entra agente
  novo — o certo é o `/api/fleet` dizer se há retrato. Fica pro Pavan.
