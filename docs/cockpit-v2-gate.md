# GATE.md — o número que decide o spike do passo 5

> Escrito **antes** do spike, de propósito. A fusão registrou o furo:
> *"resolvido por construção" não é critério — falta o número.* Este arquivo é o
> número.
>
> Escopo: **só os itens 1 e 2** do comportamento observável (`cockpit-v2-fusao.md`),
> que são os que decidem `assistant-ui` × shadcn-only. Os outros dez itens são gate
> da virada, não do spike, e entram aqui quando chegar a vez deles.

---

## 1. O que está sendo julgado

Uma fatia vertical: SSE real → coalescedor → thread da biblioteca, rodando em
`apps/cockpit` (porta 3008), em branch descartável.

**Passou:** `assistant-ui` fica como esqueleto do chat.
**Falhou:** cai para shadcn-only sobre `packages/cockpit-core/src/render-items.ts` —
as 528 linhas que já sabem linearizar payload do Claude Code — minerando
`ai-elements` / `prompt-kit` só como referência visual.

Não existe terceira saída, e não existe "passou quase". Um item reprovado reprova o
spike inteiro.

---

## 2. Onde se mede — e por que isso não é detalhe

**No iPhone do Rica, via Tailscale, no hostname `.ts.net`.** Benchmark em notebook
não é aceito como evidência, em nenhuma das medidas.

O motivo é que o furo mais grave do plano é justamente este: o plano nasceu desktop
e o usuário é celular. Um Safari de iPhone com o teclado aberto, viewport
redimensionado e a aba competindo por CPU é o ambiente real — e é onde o
`assistant-ui` tem de provar a granularidade que a leitura do código dele promete.

Segunda regra da medição: **agente-canário, nunca sessão viva.** A carga entra por
um JSONL sintético ingerido pelo watcher, num slug de teste. Ninguém mede
performance em cima de trabalho produtivo de outro agente.

---

## 3. A carga — idêntica nos dois lados

| parâmetro | valor |
|---|---|
| histórico pré-carregado | **1.000 mensagens** — em duas etapas, ver abaixo |
| taxa de chunks | **50 por segundo** |
| duração | **60 segundos** |
| posição do scroll | dois cenários: colado no fim, e rolado para cima |
| composer | digitação contínua durante os últimos 20s |

A mesma carga roda contra o **painel antigo (3007)** para produzir baseline. Sem
baseline, "ficou melhor" é opinião — e o antigo é a régua honesta, porque é o que o
Rica usa hoje e aceita.

### As 1.000 mensagens chegam em duas etapas — e por que não mexo no back

O SSE canônico limita o replay a **500** (`_MESSAGES_STREAM_LIMIT_MAX`,
`apps/api/routers/agents.py:1529`). Achado pela Tara ao construir o gerador, e
confirmado no código.

Levantar esse teto seria uma linha, e é justamente o tipo de linha que a fusão
recusou: **o back não sai do lugar durante a migração**, porque um ajuste no
endpoint que o painel em produção consome coloca o cockpit do Rica em risco para
resolver um problema de bancada.

Então o histórico chega em duas etapas, e o requisito real fica intacto — o que o
gate mede é **1.000 mensagens montadas na tela**, não 1.000 num único replay:

1. **replay** — 500 mensagens já no banco, entregues na conexão;
2. **preenchimento** — outras 500 injetadas em cadência alta, ao vivo, com o
   cronômetro **parado**;
3. **medição** — só então os 60 segundos a 50 eventos/s.

Efeito colateral bem-vindo: a etapa 2 exercita o caminho live com o DOM já cheio,
que é o pior caso do coalescedor.

---

## 4. As quatro medidas, com o número de corte

Instrumento único: overlay de métricas na própria página, porque devtools em iPhone
não é operável no meio de um teste. Tudo derivado de `requestAnimationFrame` e de
eventos de input — **nada que dependa de `PerformanceLongTaskTiming` ou
`performance.memory`, que o Safari não implementa.** Medir com instrumento que não
existe no aparelho alvo é como não medir.

### O instrumento não pode ser um componente React — e o motivo é o baseline

Um overlay React dentro de `apps/cockpit` mede só o app novo. Mas o gate exige a
mesma medida no painel antigo, que está **congelado e não recebe commit** — e iframe
não resolve, porque 3007 e 3008 são origens diferentes e o acesso ao interior fica
bloqueado.

Então o probe é **um arquivo JS standalone e auto-instalável**, servido em
`apps/cockpit/public/`. No app novo, ele é carregado em desenvolvimento; no painel
antigo, entra uma vez por bookmarklet no Safari do Rica, sem uma linha tocada em
`apps/web`.

Consequência para **G4**: contador de render de React não existe no lado antigo.
Mede-se, nos dois lados, por `MutationObserver` sobre o container de mensagens,
atribuindo cada mutação ao nó de mensagem que a contém. É observável de fora,
idêntico nas duas medições, e não pede instrumentação de framework — que é
exatamente o que o item 2 do comportamento observável pede ("verificável por
gravação de tela ou devtools", nunca por leitura de código).

| # | medida | como se obtém | corte |
|---|---|---|---|
| **G1** | cadência de frame sob carga | p95 do delta entre frames consecutivos, nos 60s | **p95 ≤ 32 ms** e **nenhum frame > 250 ms** |
| **G2** | eco da digitação | `keydown` → caractere pintado no frame seguinte, durante os últimos 20s | **p95 ≤ 100 ms** |
| **G3** | scroll não é arrancado | deslocamento vertical acumulado da viewport com o usuário rolado para cima | **0 px**, e indicador de mensagem nova visível |
| **G4** | repintura cirúrgica | contador de render por bolha; soma dos renders das mensagens que **não** são a última | **≤ 2 por mensagem** na janela (tolera a montagem e um reflow de entrada); **zero** é o alvo |

`p95` porque média esconde travada: 59 segundos lisos com um engasgo de 400 ms é
exatamente a experiência que faz o Rica dizer que o painel está ruim, e a média não
enxerga isso.

### Regra de comparação contra o baseline

Passar os quatro cortes não basta. Contra o painel antigo, na mesma carga:

- **não pode ser pior em nenhuma** das quatro; e
- tem de ser **melhor em pelo menos duas**.

Uma biblioteca de um dia de idade só se justifica se ganhar. Empatar com o que já
existe é argumento para ficar com o que já existe.

---

## 5. Os dois instrumentos — e quem os constrói

Nenhum dos dois é meu, de propósito. Eu escrevo o gate e conduzo a medição no
aparelho do Rica; construir instrumento é trabalho distribuível.

| instrumento | dono | o que é |
|---|---|---|
| **gerador de carga** | **Tara** | JSONL sintético a 50 eventos/s por 60s + 1.000 de histórico, ingerido pelo watcher num slug canário. Determinístico, sem React, com semente fixa para o teste ser repetível |
| **probe de métricas** | **Daniel** | `apps/cockpit/public/gate-probe.js` — standalone, auto-instalável, mostra e exporta G1–G4 em JSON, roda em Safari iOS e também no painel antigo por bookmarklet, sem dependência nova |

O probe é **descartável por contrato**: não entra no bundle de produção, não é
importado por componente nenhum e ninguém constrói feature em cima dele.

---

## 5.1 O instrumento contaminando a medição — dois defeitos que só apareceram dirigindo

Achados pelo Daniel operando o probe na própria bancada, depois de a auditoria de
código do Hiro já ter passado por ele. Ficam escritos porque a lição vale além deste
instrumento:

1. **O overlay nascia embaixo e cobria o composer.** No iPhone o Rica não conseguiria
   digitar — e sem digitar **não existe G2**. Um instrumento que impede o gesto que
   ele mede não falha: ele mente por omissão.
2. **Movido para o topo, com o textarea de JSON aberto, passava de 500 px e comia o
   scroll do feed.** Resultado: uma rodada com **G3 e G4 zerados**, que ele quase
   reportou como defeito da página. Zero ali não era "passou perfeito", era "não
   mediu".

Agora o overlay nasce no topo, tem botão `⇅` para trocar de lado, e o JSON só aparece
ao parar a medição.

**A lição:** nenhum dos dois sairia de leitura de código — os dois exigiram dirigir a
coisa. Auditoria estática e operação real pegam classes diferentes de defeito, e num
instrumento de gate a segunda é obrigatória, porque o modo de falha mais perigoso não
é o número errado: é o **zero que parece aprovação**. Vale para o probe e vale para o
painel — é a mesma razão pela qual o gate é medido no aparelho do Rica e não em
notebook.

---

## 6. O que o Rica faz

Abre o link no iPhone, o teste roda 60 segundos duas vezes (antigo e novo), e o
overlay cospe os oito números. A decisão sai da tabela, não da impressão.

O gosto dele decide a **pele** — isso é o gate estético, separado, e a régua lá é ele
dizendo "amei". Aqui é só engasgo, e engasgo se mede.

---

## 7. Depois de medir: desmontar a bancada

Escrito aqui porque coisa descartável que ninguém anota é coisa que fica. Depois de
o gate decidir, nesta ordem:

1. **Remover o `canario` do `agents.yaml`.** Ele aparece na lista de agentes do
   painel do Rica desde 30/07 — hoje são 9 onde eram 8, e ele foi avisado. É registro
   de bancada, não agente.
2. **Limpar os eventos do canário do banco** (`gerar-carga.py --reset` faz isso).
3. **O `gate-probe.js` fica**, mas segue descartável por contrato: não entra no
   bundle de produção e nenhum componente o importa. Ele é o instrumento de
   regressão — quando alguém disser "ficou lento", o número vem dele, não de
   impressão.
4. **A rota `/spike` morre** junto com a decisão, seja qual for. O que sobrevive dela
   é o que já está fora dela de propósito: coalescedor em `cockpit-core`, transporte
   e ponte em `lib/spike/` — e a ponte só sobrevive se o `assistant-ui` ficar.
