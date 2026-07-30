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
| histórico pré-carregado | **1.000 mensagens** |
| taxa de chunks | **50 por segundo** |
| duração | **60 segundos** |
| posição do scroll | dois cenários: colado no fim, e rolado para cima |
| composer | digitação contínua durante os últimos 20s |

A mesma carga roda contra o **painel antigo (3007)** para produzir baseline. Sem
baseline, "ficou melhor" é opinião — e o antigo é a régua honesta, porque é o que o
Rica usa hoje e aceita.

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

## 6. O que o Rica faz

Abre o link no iPhone, o teste roda 60 segundos duas vezes (antigo e novo), e o
overlay cospe os oito números. A decisão sai da tabela, não da impressão.

O gosto dele decide a **pele** — isso é o gate estético, separado, e a régua lá é ele
dizendo "amei". Aqui é só engasgo, e engasgo se mede.
