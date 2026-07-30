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
| **G3** | scroll não é arrancado | **deslocamento da âncora** com o usuário rolado para cima (o `scrollTop` escrito vira diagnóstico, ver abaixo) | **0 px**, e indicador de mensagem nova visível |
| **G4** | repintura cirúrgica | contador de render por bolha; soma dos renders das mensagens que **não** são a última | **≤ 2 por mensagem** na janela (tolera a montagem e um reflow de entrada); **zero** é o alvo |

`p95` porque média esconde travada: 59 segundos lisos com um engasgo de 400 ms é
exatamente a experiência que faz o Rica dizer que o painel está ruim, e a média não
enxerga isso.

### Por que o G3 mede a âncora, e não o `scrollTop` (decidido 30/07)

O Daniel mediu os dois lados juntos ao consertar o G3: dos **8.463 px** que o
virtualizador escreveu em `scrollTop`, só **1.782** viraram movimento que o olho vê
— fator de ~4,7×. O resto é **compensação que existe justamente para manter o
conteúdo parado** quando uma linha entra acima da viewport.

Ou seja: em feed virtualizado, `scrollTop` **não é evidência de arranco**. Aprovar ou
reprovar por ele é reprovar o mecanismo que impede o arranco.

Ele levantou a questão e **não** trocou a métrica sozinho, pelo mesmo argumento que
usou no M2 do probe: mudar a régua no meio invalidaria a comparação. Está certo — e é
exatamente por isso que a troca acontece **agora**: nenhum lado foi medido ainda com
os consertos, então não há assimetria a criar. Se eu esperasse o baseline, a decisão
ficaria travada.

Os dois números continuam no JSON. `por_deslocamento_de_ancora_px` decide;
`por_scrolltop_px` fica como diagnóstico — útil justamente para ver a compensação
trabalhando.

### O G1 depois dos dois consertos — continua reprovando, e o custo não é nosso (medido 30/07)

Contexto: o G1 reprovou no iPhone do Rica com **p95 361 ms** contra corte de 32. Vieram
dois consertos no caminho quente — o classificador incremental da Tara (48× medido em
banco de teste) e a troca da chamada no `spike/page.tsx` pela instância estável. Depois
dos dois, **o G1 continua reprovando**. Fica registrado aqui porque é a evidência mais
forte que o gate tem contra a biblioteca, e ela não vive em lugar nenhum além disto.

**Protocolo** (reprodutível, Chromium com viewport e UA de iPhone, bancada em `:3008`):

1. `gerar-carga.py --reset --fase historico` → canário em 500 eventos / 242 itens
2. página aberta e `__GATE_PROBE__` instalado **antes** do preenchimento — o gerador
   exige o SSE aberto, e foi essa ordem que invalidou a primeira tentativa
3. `--fase preenchimento`, depois `--fase medicao --medicao-segundos 25`
4. probe ligado durante as duas fases; feed conferido no cabeçalho antes e depois

Duas rodadas, uma limpa e uma com o profiler do V8 ligado (o sampler cobra caro e
**baixa** o p95 ao roubar tempo do main thread, por isso a limpa é a que vale):

| rodada | frames | p95 | pior frame | mediana | feed |
|---|---|---|---|---|---|
| limpa | 1.011 | **266,6 ms** | 1.049,9 ms | 16,7 ms | 242 → 1.992 itens |
| com profiler | 1.155 | 199,9 ms | 1.100 ms | 16,7 ms | 242 → 1.992 itens |

**A mediana em 16,7 ms é o dado que muda a leitura.** Metade dos frames sai no orçamento
de 60 fps: não é lentidão uniforme, é rajada. O p95 estourado e a mediana perfeita, juntos,
descrevem trabalho que se acumula e desaba de uma vez — não trabalho espalhado por frame.

**Perfil de CPU** (`Profiler` do CDP, amostragem de 200 µs, atribuição por *self time*,
top 20 sem ocioso):

```
5332 ms  11,8%  (garbage collector)          nativo
1301 ms   2,9%  useEffect                    @assistant-ui/tap:876
 793 ms   1,8%  jsxDEV                       react (build de desenvolvimento)
 765 ms   1,7%  useRef                       @assistant-ui/tap:873
 731 ms   1,6%  useMemo                      @assistant-ui/tap:874
 710 ms   1,6%  useMemo                      @assistant-ui/tap:528
 657 ms   1,5%  hasContextDepsChanged        @assistant-ui/tap:162
 573 ms   1,3%  depsShallowEqual             @assistant-ui/tap:492
 531 ms   1,2%  useMessageClient             @assistant-ui/core:476
 482 ms   1,1%  useRenderMemo                @assistant-ui/tap:1296
 463 ms   1,0%  withReactDispatcher          @assistant-ui/tap:1057
 455 ms   1,0%  commitAllCallbacks           @assistant-ui/tap:196
 443 ms   1,0%  useComposerClient            @assistant-ui/core:116
 379 ms   0,8%  peekResourceFiber            @assistant-ui/tap:32
```

Somando só as entradas de `tap` + `core` que aparecem no top 20: **~21% do self time
não-ocioso**. Mais 11,8% de coletor de lixo, que é a mesma alocação vista pelo outro lado.

**Nenhuma função nossa aparece no top 20.** Nem `buildRenderItems`, nem
`toThreadMessages`, nem `buildToolResultLookup`. O trabalho da Tara está correto e o 48×
dela é real — o classificador só nunca foi o custo dominante.

**Hipótese do mecanismo, ainda não confirmada:** a biblioteca instancia recurso por
mensagem para **todas** as mensagens, não só para as ~37 que a virtualização monta. Se
for isso, virtualizar não resolve por construção, e é coerente com o custo ter subido com
o feed indo a 1.992 itens. **A medição que decide** é p95 sob a mesma carga com o feed em
500 contra 2.500: se o custo escalar com o total e não com o renderizado, a hipótese passa
de plausível a verificada. Não rodei — a decisão que ela alimenta não é minha.

**Dois limites honestos desta evidência**, porque quem ler tem de saber onde ela para:

- **É build de desenvolvimento.** `jsxDEV` no perfil prova. Build de produção corta
  overhead de React e provavelmente melhora o número absoluto. O que *não* muda é a
  proporção entre nós e a biblioteca — e a proporção é o achado.
- **É Chromium, não Safari.** Serve como sanidade do conserto e como diagnóstico de
  atribuição. O gate continua sendo o iPhone do Rica.

**Armadilha achada no caminho, registrada para não ser reintroduzida:** `update()` do
classificador incremental devolve **sempre o mesmo array**, mutado no lugar. E
`external-store-thread-runtime-core.js:122` curto-circuita em
`oldStore.messages === store.messages`, retornando antes de reconstruir. Sem uma cópia
rasa no ponto de entrega, mensagem nova **não aparece** e nada acusa: sem erro, sem aviso,
feed congelado com aparência de saudável. Por isso o "feed andou?" virou asserção do
arranjo de medição, e não conferência de olho — p95 de página congelada mede o nada.

Arranjos versionados em `docs/cockpit-v2-medicao/`: `remede_g1.py` (rodada limpa) e
`perfila_g1b.py` (com perfil de CPU). Ambos pedem a bancada de pé em `:3008` e o
gerador de carga em `fixtures/cockpit-v2/`.

### O G1 escala com o histórico acumulado? — SIM (30/07)

**Resposta: escala.** Com 10× mais histórico carregado, o p95 da mesma janela de
medição fica **1,8× pior**. O custo cresce com o que o Rica **acumula**, não só
com o que **chega**: virtualizar não resolve por construção, porque o gasto não
está em desenhar as linhas visíveis, está no que acontece por flush sobre a
lista inteira.

> ⚠️ **Ressalva do Pavan — isto ainda NÃO é o argumento definitivo contra a
> biblioteca, e a diferença decide o próximo trabalho.** A medição roda na fatia
> vertical inteira (nossa camada + `assistant-ui`), e o painel antigo tem o
> **mesmo O(N)**: `apps/web/lib/use-messages-stream.ts:317` comenta com todas as
> letras *"reconstrução O(N) de useMemo no ChatMessages"*. Se o joelho for
> herança da nossa arquitetura, trocar de biblioteca não resolve nada — e o gate
> §2 já registra a mesma armadilha para o G1 e o G3, que reprovaram por código
> nosso enquanto o G4 (o único que media a biblioteca) passou com zero.
>
> **O experimento que decide não é medir o v1.** O `apps/web` está congelado por
> decisão do Rica e não há como controlar o histórico dele sem tocar no que foi
> congelado — mesmo beco das duas primeiras tentativas. O teste certo é medir o
> **v2 sem a biblioteca**: mesmo canário, mesma carga, mesmo portão, render
> simples no lugar do runtime da `assistant-ui`. Joelho some ⇒ é dela. Joelho
> persiste ⇒ é nosso, e a decisão do gate deixa de ser "trocar de biblioteca"
> para virar "consertar a nossa camada", que é outro trabalho inteiro.
>
> O plano de fuga já está pago: o `data-contract` §5 registra que cada `data-x`
> é componente nosso recebendo objeto nosso, então o render simples não precisa
> ser escrito do zero.

Seis rodadas por nível (duas passagens de três), mesma janela de 25 s a 50 Hz,
mesmo banco, mesma semente. A única variável é quanto histórico o cliente já
tinha quando a medição começou:

| histórico | n | p95 mediana | p95 mín–máx | frames na janela |
|---|---|---|---|---|
| 50 | 6 | **400,0 ms** | 283–1033 | 238–484 |
| 200 | 6 | **400,0 ms** | 350–733 | 140–384 |
| 500 | 6 | **724,9 ms** | 567–1083 | 106–196 |

**Não é linear, e o formato importa mais que o fator.** De 50 para 200 (4× de
histórico) o p95 não se move: 400 ms nos dois. De 200 para 500 (2,5×) ele salta
1,81×. Há um joelho entre 200 e 500 itens, não uma rampa — o que aponta para
custo por flush sobre a lista inteira passando a dominar a partir de um tamanho,
e não para um O(N) puro desde o primeiro item.

A **contagem de frames** confirma por um caminho independente: na mesma janela de
25 s, o nível 50 rende 238–484 frames e o nível 500 rende 106–196. Menos frames
no mesmo tempo é a mesma informação que o p95, medida sem passar pelo percentil.

#### A prova de que o instrumento mordeu — que é o que faltava nas duas tentativas

| histórico pedido | msg no início da janela | itens no início |
|---|---|---|
| 50 | 50 | 50 |
| 200 | 200 | 200 |
| 500 | 500 | 500 |

Exato, nos três, em todas as rodadas. Antes disso os três níveis abriam com 742
itens — a mesma condição medida com três rótulos.

**Por que não mordia, e por que não era corrigível pelo cliente:** o `limit` do
SSE dimensionava o **primeiro lote do replay**, e o replay entregava os N eventos
mais **antigos** (`ORDER BY id ASC`). O cursor parava no N-ésimo, e o loop live
puxava todo o resto do banco logo em seguida, em ciclos de 500 — como se fosse
novidade. Qualquer `limit` que o cliente pedisse era engolido segundos depois.
Conserto em `recentes=1` (aditivo, default-off): o replay passa a entregar a
**cauda** e o cursor já sai no topo. Ver `portao_historico.py`, que é o portão a
rodar antes de qualquer medição de escala.

#### Três armadilhas de bancada que custaram rodada, para quem repetir

1. **Ordem fixa vira "escala" falsa.** A bancada degrada dentro de uma sequência.
   Com a ordem fixa 50/200/500, o nível 500 cai sempre em terceiro e leva a
   degradação inteira na conta dele. A primeira passagem produziu exatamente
   isso. Com a ordem **rotacionada** — cada nível ocupando cada posição uma vez —
   o efeito não só persistiu como cresceu: na rodada em que o nível 500 foi o
   **primeiro** da sequência, ele deu o pior p95 de todos (1083 ms). É isso que
   separa achado de artefato.
2. **JSONL órfão com a mesma `sessionId`.** O `--reset` apaga só o arquivo
   apontado por `.cockpit-v2-active`. Sobrou de um run antigo um arquivo sem
   sufixo de timestamp, idêntico byte a byte ao ativo, que o watcher reimportava
   a cada limpeza: o banco de "1000 eventos" era 500 reais e 500 duplicados, com
   uuid repetido. Conferir `COUNT(*)` contra `COUNT(DISTINCT uuid)`.
3. **Dois uvicorn no mesmo SQLite duplicam a ingestão.** Subir um backend só da
   medição para escapar do teto de replay parece inofensivo e não é: cada
   processo traz o próprio watcher de JSONL, os dois importam o mesmo arquivo, e
   cada evento entra duas vezes (a biblioteca acusa `duplicate message id` no
   console). Medir contra um backend só.

Arranjo em `docs/cockpit-v2-medicao/escala_g1.py`; portão em
`docs/cockpit-v2-medicao/portao_historico.py`.

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

---

## O braço de controle respondeu — o custo É da biblioteca (30/07, Hiro, `2bccafe`)

A ressalva que eu inseri em `3366d32` segurava a condenação da `assistant-ui` por um motivo
metodológico: a medição rodava na **fatia vertical inteira** (nossa camada *mais* a
biblioteca), e o painel antigo declara o mesmo `O(N)` em
`apps/web/lib/use-messages-stream.ts:317`. Se o joelho fosse herança da nossa arquitetura,
trocar de biblioteca jogaria fora trabalho bom por diagnóstico errado.

**O experimento que decide foi construído e rodado.** `app/spike/sem-lib` é a **mesma
bancada** do `/spike`: mesmo SSE do canário, mesmo `?historico=N&recentes=1`, mesmo
coalescedor, mesmo classificador incremental, **mesmo virtualizador `@tanstack`** (ele não é
da biblioteca; tirá-lo mudaria duas variáveis), mesmos seletores de probe, mesma janela de
25 s a 50 Hz. A única variável que muda é o runtime — sem `AssistantRuntimeProvider`, sem
`useExternalStoreRuntime`, sem `MessagePrimitive`/`ThreadPrimitive`.

Portão provado antes de medir, como manda a régua: 50 → 50, 200 → 200, 500 → 500.

| histórico | **com** a biblioteca (`b5aa7a2`) | **sem** a biblioteca (`2bccafe`) |
|---|---|---|
| 50 | 400,0 ms | 33,3 ms |
| 200 | 400,0 ms | 33,4 ms |
| 500 | **724,9 ms** | 33,4 ms |
| escala (10× de feed) | **1,81×** | **1,00×** |
| frames na janela de 25 s | 106–484 | 1.277–1.486 |

**O joelho não encolheu: desapareceu.** E a contagem de frames confirma por um caminho que
não passa pelo percentil — 1.480 frames em 25 s é ~59 fps, contra ~9,5 fps do pior nível com
a biblioteca.

**Veredito: a ressalva está respondida e retirada.** O custo que escala com o histórico
acumulado é da biblioteca. A nossa camada — SSE, coalescedor, classificador incremental,
virtualizador — segura p95 plano com 10× de feed. O gate pode condenar pela razão certa, e o
trabalho seguinte é o **plano de fuga** (shadcn-only consumindo `RenderItem`), não "consertar
a nossa camada".

### ⚠️ Ressalva de leitura — 33,4 ms NÃO é "quase reprovou"

O p95 sem a biblioteca é **quantizado**, e quem for calibrar o corte precisa saber disso.

A bancada mede o delta entre frames **reais**. Num display a 60 Hz o delta mínimo é
**16,67 ms**, e os valores possíveis são múltiplos dele: 16,7 · 33,3 · 50 · 66,7… A mediana
sem a biblioteca é **16,7 ms** — um frame, perfeito — e o p95 é **33,3 ms**, que é o
**degrau imediatamente seguinte**. Traduzindo: em 5% das amostras um único frame pulou.

Consequência para o corte do G1: **32 ms cai no vão entre dois degraus** (16,7 e 33,3). Do
jeito que está escrito, o G1 só passa com p95 = 16,7 ms, isto é, **menos de 5% de frames
pulados** — perfeição quase absoluta. Não é o que a intenção original ("um frame a 30 fps")
sugere ao leitor.

Isso **não afeta em nada a conclusão acima**: a comparação é 33,4 contra 724,9, que são 2
degraus contra 43. Mas afeta duas outras coisas, e ficam registradas:

1. **Não se deve dizer que o braço sem biblioteca "reprovou por 1,4 ms".** Ele está no piso
   prático do instrumento.
2. **O corte de 32 ms merece revisão** antes de virar critério de aprovação de qualquer peça
   — ou o corte sobe para o degrau seguinte (33,4, "no máximo um frame pulado"), ou a métrica
   passa a contar frames perdidos em vez de medir delta em milissegundos, que é a mesma
   informação sem a armadilha da quantização. **Decisão minha, e ela é do Rica em última
   instância**, porque muda a régua de aprovação — fica anotada, não aplicada.

Nada disso vale para a medição no **iPhone**, que continua sendo o número que manda: lá o
alvo é o hardware real do Rica, e o p95 de 361 ms que abriu esta investigação foi medido no
aparelho dele, não nesta bancada.
