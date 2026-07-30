# O feed real na bancada do G1 — quanto custou trocar DOM feio por renderers

> 30/07. Rodado por mim (Daniel) a pedido do Pavan, com a régua dele: "número
> que piora e é reportado vale mais que número bonito".

## Veredito em uma linha

**O feed real NÃO segurou o p95 do esqueleto.** Está 1,67× a 2,0× pior contra o
braço de controle medido na mesma janela, e ainda tem escala residual (1,20×)
onde o controle é plano (1,00×). Por isso o `FeedAoVivo` **não foi plugado** em
`app/agente/[slug]/page.tsx` — a rota que o Rica usa continua no que estava.

> ⚠️ **Este veredito foi CORRIGIDO horas depois, pelo autor.** A magnitude
> "1,67× a 2,0×" não sobreviveu à repetição — ver §"Os três braços" e §"O p95
> mentiu por quantização". O feed é pior que o controle, mas menos do que este
> parágrafo afirma, e a decisão de não plugar continua válida por outra conta.
> O texto original fica de pé de propósito: apagar o erro esconderia como ele
> passou.

## Os números

Bancada idêntica nas duas rotas: canário, `?historico=N&recentes=1`, janela de
25 s a 50 Hz, 3 repetições em ordem rotacionada, iPhone 393×695 @3x. Portão
provado antes de medir nas duas: 50 → 50, 200 → 200, 500 → 500, sem empate.

| histórico | `/spike/sem-lib` (esqueleto) | `/spike/feed` (renderers reais) |
|---|---|---|
| 50 | 50,0 ms | 83,3 ms |
| 200 | 49,9 ms | 100,0 ms |
| 500 | 49,9 ms | 100,1 ms |
| escala (10× de feed) | **1,00×** | **1,20×** |
| mediana | 16,7 ms | 16,7 ms |

Em degraus de frame (o instrumento é quantizado em 16,67 ms — ver a ressalva no
`cockpit-v2-gate.md`): o controle pula **3 frames** no p95, o feed pula **5 a
6**. A mediana é 16,7 ms nos dois: no caso comum o feed real está a 60 fps, e o
custo aparece na cauda.

## ⚠️ Por que a comparação teve de ser PAREADA

O braço de controle mediu **33,3–33,4 ms** na rodada histórica (`2bccafe`) e
mede **49,9–50,0 ms** hoje, no mesmo código. **O piso da máquina subiu ~1,5×.**

Comparar o feed real (83–100 ms) contra os 33,4 ms de arquivo teria acusado uma
piora de 3× onde a real é de 2×. Metade do buraco seria da máquina, não do
código. Quem repetir esta medição: **rode o controle na mesma sessão**, não
compare com número de outro dia. É barato e é a diferença entre um veredito e
um palpite.

## Os três braços na mesma sessão — a dívida que este documento criou

Pedido pelo Pavan em 30/07, e o furo é honesto: a régua acima ("rode o controle
na mesma sessão") condenava a nossa própria conclusão sobre a assistant-ui. Os
400 / 400 / 724,9 ms dela eram da rodada 1, medidos ANTES de o piso da máquina
subir, e nunca tinham sido remedidos. Script: `escala_g1_tres_bracos.py`.

Os três braços rodados juntos, rotacionados, com os três braços de um mesmo
nível ADJACENTES na sequência (encadear um braço inteiro depois do outro daria a
degradação da sessão de presente ao último):

| histórico | `/spike` (assistant-ui) | `/spike/sem-lib` | `/spike/feed` |
|---|---|---|---|
| 50 | 433,4 ms | 50,1 ms | 83,3 ms |
| 200 | 466,7 ms | 33,4 ms | 100,0 ms |
| 500 | **966,5 ms** | 50,0 ms | 50,0 ms |
| escala (10×) | **2,23× — ESCALA** | 1,00× | 0,60× |
| frames entregues (500) | **131** | 1.365 | 1.264 |
| pior frame (500) | **56.681 ms** | 233 ms | 633 ms |

**A biblioteca fica condenada, e por mais do que antes.** Remedida hoje ela está
PIOR que o arquivo (724,9 → 966,5 no nível 500), a escala com o histórico
apareceu mais forte que no gate (1,81× → 2,23×), ela está a **19,33× o
controle** e entrega **um décimo** dos frames. O pior frame dela no nível 500
foi de 56 segundos de tela parada. Nenhuma conversa muda.

## O p95 mentiu por quantização — e eu reportei a mentira

Na tabela acima o feed empata com o controle no nível 500 (50,0 contra 50,0),
mas dá 2,99× dele no nível 200. Não há tendência nisso: **é ruído**. O
instrumento é quantizado em degraus de 16,67 ms, e a mediana de 3 rodadas pula
um degrau inteiro sozinha — o mesmo feed, sem uma linha alterada, deu 100,1 ms
numa série e 50 ms na seguinte.

Foi assim que o "1,67× a 2,0× pior" do topo deste documento nasceu: dentro do
ruído, reportado como se estivesse fora dele.

**A métrica que não tem esse defeito é `frames`** — frames entregues na janela
de 25 s. É contínua, não tem degrau, e mede exatamente o que importa: quanta
tela o Rica recebeu enquanto o feed trabalhava. Por ela, o feed entrega **~78%**
dos frames do controle (0,77 / 0,65 / 0,93 nos três níveis) — pior, sim, mas
~1,3× em fluidez, não 2×. **Daqui em diante, relatar por frames; usar o p95 só
como referência grossa.**

## O que o cache já resolveu — e o que não

A primeira passagem do feed real deu escala **1,40×**, pior que a de hoje. A
causa era minha: `estimateSize` é chamada para todo índice ainda não medido a
cada recálculo, e eu tinha posto trabalho por item (percorrer o texto contando
linhas) onde o esqueleto tinha leitura de variável, O(1). Trabalho por item × N
itens — escala de volta, logo depois de o G1 tê-la matado. Cache por identidade
em `WeakMap` (`2658fc6`) levou 1,40× → 1,20×.

O que sobrou (1,20× de escala e ~2× de p95) **não é mais estrutura de
virtualização**: é o custo de render por item. A única variável entre as duas
rotas é o miolo — `LinhaExecucao`, `Thinking` e `AssistantMarkdown` no lugar de
`<p>` e `<div>`.

## A doc da biblioteca condenou a nossa estimativa — e a troca NÃO moveu o número

Régua nova do Pavan, 30/07, e ela nasceu de uma cobrança do Rica: *antes de
inventar otimização, ler a doc da biblioteca que já está no projeto.* A doc do
`@tanstack/react-virtual` diz, sobre `estimateSize`:

> "If you are dynamically measuring your elements, it's recommended to estimate
> the largest possible size (within comfort) of your items."

E este feed passa `measureElement` no envelope. Ou seja: **a estimativa é
descartada no primeiro render de cada item**, e todo trabalho para produzi-la é
trabalho jogado fora. O mecanismo, conferido na fonte instalada (virtual-core
3.17.7, mais duro que a doc): `getMeasurements` percorre de `pendingMin` até
`count` chamando `estimateSize` em cada item não medido (linha 632);
`getMeasurementOptions` **zera** `pendingMin` (linha 555) sempre que uma opção
de medição muda de identidade — e `count` é uma delas, então durante streaming
a varredura completa acontece a cada flush. ~1.280 chamadas por flush.

Trocamos por `ALTURA_ITEM = 44`, constante. O número saiu de medição
(`alturas_reais.py`): os 500 itens da carga do canário medem **36 px, todos**;
44 é o item colapsado, cobre a carga com folga e é o caminho quente da tese do
v2. `getItemKey` foi memoizado por ref, como a doc pede — com a ressalva de que
isso não economiza durante streaming, porque `count` muda sozinho.

**Resultado: nada.** Frames entregues pelo feed, como fração do controle:

| histórico | antes (estimativa por item + WeakMap) | depois (constante) |
|---|---|---|
| 50 | 77,2% | 78,6% |
| 200 | 65,2% | 71,5% |
| 500 | 92,6% | 85,3% |
| média | ~78% | ~78% |

Idêntico dentro do ruído. A leitura honesta: **o cache em WeakMap (`2658fc6`) já
tinha colhido o ganho disponível** — ele levou a escala de 1,40× para 1,20×, e a
constante só removeu o resíduo. O trabalho por item já estava barato demais para
aparecer.

A troca fica, e não por causa do número: manter 115 linhas de função, cache e
teste para produzir um valor que a biblioteca descarta é errado com ou sem p95.
Mas quem procurar aqui um ganho de desempenho não vai achar.

**O que isso ELIMINA, e esse é o valor da rodada:** o virtualizador e a
estimativa saem da lista de suspeitos com prova, não com argumento. O custo
residual de ~22% dos frames é dos renderers.

## Onde olhar na próxima rodada

**No `Thinking`, não no markdown.** Ver
[`composicao-da-carga-canario.md`](composicao-da-carga-canario.md): a carga tem
11.880 caracteres de `text` contra **503.272 de `thinking`**. O markdown é o
renderer mais caro por caractere, mas processa 42× menos volume — perfilá-lo
primeiro é gastar hora no lugar errado.

Dois pontos concretos a medir lá:

1. `buildThinkingRenderModel(content)` roda a cada render e percorre blocos de
   ~6,6 mil caracteres para contar linhas. Candidato a memoização por
   identidade — o mesmo remédio que funcionou na estimativa.
2. ~~Se `initiallyExpanded` vier ligado, cada bloco arrasta o parser de markdown
   com 6,6 mil caracteres de primeira.~~ **DESCARTADO em 30/07 sem custar
   rodada:** `initiallyExpanded` não é bandeira configurável, é `false` literal
   no tipo (`lib/thinking.ts:7`). O corpo só monta `AssistantMarkdown` quando
   `open` é verdadeiro, e `open` nasce daquele literal. O markdown do raciocínio
   nunca roda no primeiro render.

O candidato 1 é mais gordo do que este documento dizia. Por bloco visível, por
flush: `trim()` em `normalizeThinkingContent`, `trim()` de novo em `countLines`,
`replace(/\r\n?/g)`, `replace(/\n+$/)` e um `split('\n')` que aloca uma string
por linha — **para usar só o `.length`**. Cinco varreduras e ~cinco cópias de
6,6 KB, e o resultado é um inteiro. `Thinking` também não é memoizado.

**O que NÃO é o gargalo, e já está descartado:** o `buildToolResultLookup(messages)`
O(N) por flush é idêntico nas duas rotas, então não explica a diferença. O
virtualizador é o mesmo (`@tanstack/react-virtual`), a estimativa está em cache,
e o classificador incremental é o mesmo objeto nos dois braços.

## Como reproduzir

```bash
cd docs/cockpit-v2-medicao
python3 escala_g1_feed.py      # /spike/feed
python3 escala_g1_sem_lib.py   # /spike/sem-lib — SEMPRE na mesma sessão
```

Os dois resetam a carga do canário e **não podem rodar em paralelo**: cada um
chama `gerar-carga.py --reset` no mesmo SQLite e um destrói a fase do outro.

**Modo de falha visto:** `banco não estabilizou em 1000: 1001 eventos` — um
evento a mais entrou durante a espera e o script abortou a rodada inteira
(perdi 8 rodadas boas por causa da nona). Se acontecer, os parciais já impressos
continuam válidos; é o resumo final que não sai.
