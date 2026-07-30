# O feed real na bancada do G1 — quanto custou trocar DOM feio por renderers

> 30/07. Rodado por mim (Daniel) a pedido do Pavan, com a régua dele: "número
> que piora e é reportado vale mais que número bonito".

## Veredito em uma linha

**O feed real NÃO segurou o p95 do esqueleto.** Está 1,67× a 2,0× pior contra o
braço de controle medido na mesma janela, e ainda tem escala residual (1,20×)
onde o controle é plano (1,00×). Por isso o `FeedAoVivo` **não foi plugado** em
`app/agente/[slug]/page.tsx` — a rota que o Rica usa continua no que estava.

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
2. Se `initiallyExpanded` vier ligado, cada bloco arrasta o parser de markdown
   com 6,6 mil caracteres de primeira.

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
