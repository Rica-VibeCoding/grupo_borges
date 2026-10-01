# TROPA — levantamento contra o cockpit antigo (30/07/2026)

> Rica reprovou a primeira coluna TROPA de olho: *"essa parte dos agentes no cockpit
> antigo ainda é mais bonita"*, *"emoji feios"*, *"sem componentes"*, *"sem status
> line"*, *"não tem as mesmas informações que temos no cockpit"*, *"um visual que um
> LLM bem paradinho faria melhor"*.
>
> A régua desta rodada, dada pelo Pavan, é **a informação do antigo — não a minha**.
> Este documento é o levantamento honesto que veio antes de desenhar qualquer coisa,
> conforme §1 (princípio 7) do `cockpit-v2-estetica.md`.

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

## Histórico das versões da tropa

Movido do comentário do topo de `apps/cockpit/components/shell/tropa.tsx` em
28/09 (o arquivo passava do teto de 300 linhas). A primeira versão foi
reprovada de olho pelo Rica; o levantamento acima é o que gerou a segunda.

### SEGUNDA VERSÃO

A primeira o Rica reprovou de olho, e com razão: nove linhas
de peso idêntico, emoji de família visual diferente cada um (três deles nulos,
virando bolinha), e nenhuma telemetria. O levantamento contra o cockpit antigo
está nas seções acima deste documento. As três decisões que saíram
dele:

1. RETRATO NO LUGAR DE EMOJI. O antigo nunca usou emoji — usa foto por slug com
   inicial de reserva, e é daí que vem o "mais bonito". Detalhe em `retrato.tsx`.
2. TELEMETRIA DE VOLTA. Modelo, tempo de sessão e contexto — a statusline é o
   que ele mais olha. Sessão morta mostra só o CONTEXTO (ordem do Rica, 03/08:
   "tipo 30% de um milhão de tokens", é o número que decide o /compact na
   volta); modelo, tempo de sessão, pasta e "há 20h" somem — telemetria de
   sessão morta é ruído, e o relógio ele disse que não lê.
3. HIERARQUIA POR VIDA. Quem está de pé ganha cartão de duas linhas; quem está
   offline vira uma linha rasa sob um divisor que conta quantos são. A lista
   plana era o que fazia sete agentes dormindo pesarem igual ao que trabalha.

O que ficou da primeira versão porque estava certo: `aguardando` sobe pro topo.
O único estado quente é o único que chama o Rica.

### TERCEIRA VERSÃO (09/08)

Ordem do Rica: *"tem que deixar uma tela bonita,
como se fosse pintar as paredes da casa nova"*. Nada aqui é gosto; as quatro
mudanças saíram de olhar a coluna renderizada e perguntar o que cada pixel
informa:

4. O ESTADO VIRA SEÇÃO. A lista já ordenava por estado desde a v2, mas a tela
   não contava isso: na coluna de 260px o único sinal era um ponto de 9px no
   canto do retrato, e a ordem lia como alfabética quebrada. Agora cada estado
   é um grupo com título contado e GRUDADO no topo enquanto se rola — a
   palavra que diz em que estado você está lendo nunca sai da tela. Com isso o
   chip por linha saiu: repetia nove vezes, três pixels abaixo, a palavra que
   o título já diz.
5. A PASTA VIRA EXCEÇÃO. `ze_claude/<slug>` é o endereço-casa de quem mora no
   próprio workspace, e era o que seis das nove linhas diziam — uma linha
   inteira repetindo o nome logo acima. Some quando é a casa, aparece quando
   não é. Deixou de ser rótulo e virou informação: quem exibe pasta está fora
   de casa.
6. COR SÓ ONDE HÁ JULGAMENTO. Detalhe na `BarraDeContexto`.
7. O PULSO DE 24H. O `/api/fleet` sempre entregou `sparkline` — 24 baldes de
   token por hora, por agente — e nenhuma tela do v2 lia. Sem ele, quem não
   gastou um token hoje pesa igual a quem gastou um milhão. Entra como marca
   d'água na base do cartão: não pede linha, não compete com texto nenhum, e
   quem não trabalhou simplesmente não desenha nada. A ausência é a
   informação.

### QUARTA VERSÃO (10/08)

A COLUNA GANHA UMA VERTICAL. A ordem do Rica foi
"melhore a UI da sidebar"; o que a medição mostrou é que a lista não tinha
grade nenhuma. Cada linha se arranjava sozinha por flex, então barra e
percentual pousavam onde o texto à esquerda tivesse terminado — medido no
browser, o `%` caía em cinco `x` diferentes, com **72px** de dança na coluna
de 260px e **84px** na tela cheia. É o que fazia a coluna serrilhar, e é o
mesmo defeito que o Rica reprovou de olho no print de 09/08.

A pesquisa do Canário (`docs/pesquisa-sidebar-tropa-canario.md`) chegou nisso
por outro caminho, citando a Linear: *"alinhar labels, ícones e botões
vertical e horizontalmente na sidebar"* é descrito lá como o trabalho que o
usuário só sente depois de alguns minutos — nunca na primeira olhada. As
quatro mudanças, todas a mesma tese:

8. O CONTEXTO ENCOSTA NA DIREITA e o número é a última coluna da linha, com
   largura reservada (`ValorDoContexto`). Depois: dança **zero** nos dois
   tamanhos. De quebra o modelo herda todo o espaço à esquerda e para de ser
   cortado no meio da palavra.
9. A AUSÊNCIA VIRA TRAÇO. `sem contexto` tinha doze caracteres na coluna onde
   os outros têm dois, e quem cedia era o nome do agente: `Lucas Marchetti`
   precisava de 95px, tinha 80, e saía `Lucas Marc…`. O dado sumia para caber
   a falta dele. Detalhe em `SemContexto`.
10. O RETRATO TEM COLUNA. O de quem dorme é menor (28 contra 34/40), e sem um
   slot de largura fixa o nome dele começava 6px (coluna) e 12px (tela cheia)
   à esquerda do nome de quem trabalha — a lista descia em ziguezague.
11. O PERCENTUAL É INTEIRO. Só a Tara vinha com casa decimal (`14.5%`) e ela
   sozinha quebrava a coluna tabular. Detalhe em `ValorDoContexto`.

### QUINTA VERSÃO (11/08)

A POSIÇÃO PARA DE CARREGAR O ESTADO. Ordem do Rica:
a coluna dançava — cada flip trabalhando↔ocioso movia a linha de seção, e a
seção que esvaziava sumia junto com o título, empurrando todo mundo abaixo.
Ele reprovou a experiência, e a correção saiu da boca dele: SÓ COMPORTAMENTO.
Nada de chip, nada de componente novo, nada de pixel redesenhado. As seções
morrem e a lista vira UMA ordem só (`ordenaTropa` em `lib/ordena-tropa.ts`);
a palavra do estado sai da tela junto com os títulos — o ponto do retrato
fica. O visual de cada linha fica intocado — quem dorme continua linha rasa,
porque isso é decisão POR LINHA, não por seção.

### SEXTA VERSÃO (11/08)

A ORDEM VIRA DITADA. O alfabeto matou a dança mas
embaralhava a leitura: quem estava de pé ficava separado por quem dorme. O
Rica ditou a sequência agente a agente e ela vale sempre, viva ou morta a
sessão. `aguardando` deixou de subir junto — ordem fixa não tem exceção.

### SÉTIMA VERSÃO (17/08)

A ORDEM DITADA VIRA ORDEM ARRASTADA. Ordem do Rica:
*"eu quero poder arrastar eles como se fosse um kanban, para cima, para
baixo"*. A sequência da v6 não morre: ela vira a ordem de fábrica, e vale até
o primeiro arrasto (`lib/ordena-tropa.ts`). O que muda de dono é a posição —
era do arquivo, passa a ser dele, gravada em `agent_state.ordem`.

O gesto entra pela LINHA INTEIRA. A primeira tentativa punha o arrasto numa
alça de pontinhos à direita; o teste no iPhone do Rica mostrou que ele não
achava a alça e que o pedido dele era o oposto — *"clicar direto no card sem
ter esses pontinhos"*. Toque curto abre o agente, toque-e-segure carrega a
linha, deslize rola a coluna: a separação é do iOS, não nossa. O porquê
detalhado, com fonte de cada decisão, está em `arrasto-da-tropa.tsx`.

### OITAVA VERSÃO (28/09)

O ESTADO MORA NA FOTO. Ordem do Rica: *"faça uma
releitura da sidebar… mais bonita, na UX melhor"*. O print do celular mostrou
que a pergunta nº 1 de quem abre a tropa — quem está trabalhando? — não se
lia: era um ponto de 9px no canto do retrato. A ousadia foi gasta num lugar só
e o resto ficou quieto:

12. O ANEL. `trabalhando` ganha um anel na cor de execução em volta da foto,
   respirando devagar; `aguardando`, anel de atenção num ritmo curto e a
   segunda linha dizendo "aguarda você". Ocioso e offline, sem anel. Com
   `prefers-reduced-motion`, o anel fica parado. O ponto saiu — o estado
   segue no `title` e no nome acessível do link. CSS em `.ck-anel`.
13. UM TEXTO PRIMÁRIO POR LINHA. O nome. "Opus 5.5" saía na cor primária, do
   tamanho do nome, e competia com ele em toda linha viva: virou metadado
   menor, junto do relógio. Relógio e percentual saíram da mono (sans
   tabular não dança igual); a mono ficou só na pasta, que é endereço.
14. O PERCENTUAL SOBE PARA A LINHA DO NOME, vivo ou dormindo: uma vertical
   só, na altura do nome. A barra saiu da lista — o número já é o dado e o
   âmbar acima do teto já é o julgamento; o desenho continua na gaveta.
15. O PULSO ENTRA NO FLUXO. Era marca d'água absoluta e, no celular,
   encavalava no percentual. Agora é caixa própria na segunda linha, nos
   dois layouts, com o lugar reservado mesmo quando não há o que desenhar.
16. QUEM DORME PERDE O CHIP. Sete "off" com borda e sete trilhos vazios
   repetiam o que a linha rasa e a foto esmaecida já dizem — era o chip por
   linha repetindo estado que a v3 já tinha matado. A palavra "desligado"
   segue para o leitor de tela.
17. A SEGUNDA LINHA NÃO FICA OCA. Quem está de pé sem modelo (Canário,
   Fluyt) sobe a pasta para ela, em vez de deixar um buraco.
18. A VPS VIRA RELANCE. Quatro números numa faixa, cor só acima do teto, e a
   lista de processos recolhida atrás de "ver processos". Em `bloco-da-vps.tsx`.

As linhas moram em `linha-da-tropa.tsx` desde esta versão: com elas aqui o
arquivo passava de 670 linhas fazendo duas coisas.
