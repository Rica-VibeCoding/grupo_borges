# ESTADO.md — onde o Cockpit v2 parou, e como retomar com contexto zerado

> Escrito em 2026-07-30 08:30, a pedido do Rica: *"guarda tudo para retomarmos com
> contexto leve"*. Este arquivo é o **ponto de entrada** — quem retomar lê ele
> primeiro e só abre os outros conforme precisar.
>
> Ordem de leitura, se precisar de mais: `cockpit-v2-gate.md` (o que decide) →
> `cockpit-v2-ownership.md` (quem mexe onde) → `cockpit-v2-data-contract.md` →
> `cockpit-v2-stack.md` → `cockpit-v2-fusao.md` (por que as decisões são assim).

---

## 1. Em uma frase

A bancada de medição do passo 5 está **construída e já mediu uma vez no iPhone do
Rica**: o critério que testava a biblioteca **passou**, e os dois que reprovaram são
da nossa camada — um deles já corrigido e medido, o outro em andamento.

## 2. O resultado da rodada 1 (evidência guardada)

`fixtures/cockpit-v2/medicoes/2026-07-30-v2-iphone-rodada1.json` — iPhone real, 60,27 s,
489 frames, 1246 mensagens observadas.

| | resultado | corte | |
|---|---|---|---|
| **G1** cadência | p95 **361 ms**, pior 519, mediana 99 | 32 / 250 | 🔴 |
| **G2** eco | 3 amostras nos últimos 20 s (piso 30) | 100 ms | 🟡 indisponível |
| **G3** scroll | **20.273 px** de deslocamento | 0 px | 🔴 |
| **G4** repintura | **0** mutação em mensagem selada, de 1246 | ≤ 2 | 🟢 |

**A leitura, e ela é o ativo desta rodada:** G4 era o único critério que media a
*biblioteca* — a granularidade que quase foi motivo de descarte na fusão. Deu zero.
`assistant-ui` cumpriu a promessa. G1 e G3 apontam para código nosso.

⚠️ **Não executar "reprovou → cai para shadcn-only" com base nesta rodada.** O gate
mede a fatia vertical inteira; punir a biblioteca por defeito da nossa camada usa o
instrumento para a pergunta errada.

## 3. O que já foi consertado depois da medição

- **G1** — `f73ce35`: `lib/spike/render-items-incremental.ts`. A causa era
  `page.tsx:359-360` chamando `buildRenderItems` sobre a lista inteira a cada flush.
  Medido: **0,06 ms/flush contra 3,14 ms** do full rebuild em lista de 1050 = **48,4×**.
  Reprocessa 2 de 1041 mensagens por flush. Remove *uma* causa; não garante o G1.
- **Probe** — `a42845b`: 8 achados da auditoria do Hiro, incluindo o `touchend` que
  faria o instrumento reprovar o app bom, e a guarda que impede o G4 de "passar por
  vacuidade". Essa guarda **funcionou ao vivo** nas duas primeiras tentativas.

- **G3** — `5b8124c`: a causa era `estimateSize` **fixo em 72 px** no virtualizador.
  Estimativa errada faz o virtualizador corrigir a posição quando mede o tamanho real,
  e a correção desloca a âncora. Os dois números foram a ~zero depois do conserto.
- **Métrica do G3 trocada** (gate §4): o critério passa a ser o **deslocamento da
  âncora**, não o `scrollTop`. O Daniel mediu que dos 8.463 px escritos em `scrollTop`
  só 1.782 viraram movimento visível — o resto é a compensação que mantém o conteúdo
  parado. Aprovar por `scrollTop` seria reprovar o mecanismo que evita o arranco. Ele
  levantou e não trocou sozinho (certo); troquei agora porque **nenhum lado foi medido
  com os consertos**, então não há assimetria a criar.

## 4. Em voo — checkpoint de 30/07 11:45 (o de 06:35 está no histórico do git)

A rodada da madrugada rendeu 6 commits. O que mudou de fato desde a §2:

**Números do gate mudaram, e para pior — o §2 está desatualizado.**
`385fe2d`: medindo **só a fase de medição**, que é a janela que o gate define, o p95 do
G1 fica entre **500 e 867 ms** em 6 rodadas, mediana ~600 ms, contra corte de 32. O
266,6 ms de `19058ac` diluía a fase calma de preenchimento junto. O perfil de CPU atribui
o custo a coletor de lixo (13%) e a `useEffect`/`useMemo`/`useRef` do `@assistant-ui/tap`
(~6,8%). **A escala ficou sem resposta**: duas tentativas de variar o histórico não
moveram a variável independente (nem a hora de abrir a página nem `?historico=N`
governam o que o cliente carrega — o feed inicial ficou em 742 itens nas duas), e o
parâmetro foi revertido para não enganar quem medir depois. Responder exige mexer no
`use-canario-stream.ts`; **autorizei o Daniel a fazê-lo depois da rodada visual**.

**O item 5 do gate tem prova** (`ea99cc1`, relatório completo em
`cockpit-v2-paridade-relatorio.md`): v1 e v2 são cópias independentes e produzem saída
idêntica nas 52 famílias e nos 4 transcripts SSE (796 itens, comparados por kind,
posição, identidade e agrupamento). O número só vale porque o comparador foi provado por
4 mutantes — e o de ordem **passou batido nas famílias isoladas**, que produzem 0 ou 1
item. Lacunas que ficam: reconexão real e `sidechain-cluster`, que exigiriam rodar carga
contra o canário — parado no estado canônico esperando a medição do Rica.

**Regra nova, e ela manda em toda UI daqui pra frente** (`1d445a3`, §9.1 do
`cockpit-v2-estetica.md`): UI definitiva sai em **rodada dedicada, com contexto limpo**,
com a skill `frontend-design` carregada antes de desenhar, e a régua é *"isto vale largar
o cockpit antigo?"*. Veio depois de o Rica reprovar a primeira coluna TROPA — e a causa
foi erro meu de orquestração: despachei pele e instrumentação do gate no mesmo turno.

**Quem está com o quê agora:**

- **Daniel** — rodada visual **entregue** em `860068f` (TROPA v2), feita sob a §9.1 com
  contexto limpo. Conferido por mim: 36/36, `tsc` limpo, `/` e `/agente/daniel` em 200, e
  rota inexistente com 404 próprio. Trouxe `statusline.tsx`, `retrato.tsx` (fallback de
  identidade no lugar da bolinha), `tropa.tsx` reescrita sobre `avatar`/`badge` do shadcn,
  e a marca do teto de 30% na barra de contexto. Prints em `/tmp/cockpit-v2-prints/`,
  enviados ao Rica em 30/07 12:10.
- **OSC 8 — fechado** (`2d02a28`): a sequência vira link de verdade em `lib/pane.ts`, com
  teste próprio (41/41). Verificado no **HTML servido**, não no código: zero ocorrência de
  `]8;id=` e `]8;;`, e o `<a>` sai com `rel="noreferrer noopener"`.
- **Veredito estético da TROPA v2** — com o Rica, **não respondido ainda**. A TROPA só volta
  à bancada depois dele; mexer antes é retrabalho.
- **Frente atual do Daniel — a escala do G1** (despachada 30/07 ~16h, contexto limpo pós-compact).
  Revoguei a ordem de "esperar o veredito pra tocar o canário": ele estava parado por uma
  resposta que não depende dele, e `lib/spike/*` não colide com `components/shell/tropa.tsx`.
  O portão da frente é **provar que o parâmetro morde antes de medir** — se os três níveis
  abrirem com a mesma contagem inicial de novo, qualquer p95 dali é inválido, que é
  exatamente como as duas tentativas anteriores morreram. Arranjo headless pronto em
  `docs/cockpit-v2-medicao/escala_g1.py`; **não precisa do iPhone**, a pergunta é
  comparativa entre níveis, não o número absoluto do gate.
- ⚠️ **A rota `/agente/[slug]` ainda espelha o pane cru do tmux** — não é proposta de
  chat. O Rica apontou isso em 30/07 15:11 e está certo: o chat de verdade depende da
  decisão assistant-ui × shadcn, que espera a medição no iPhone dele. Não confundir stub
  com entrega.
- **Tara** — **renderer de markdown entregue** em `52a7946`, verificado por mim: 50/50 no
  `npm test`, `tsc` limpo, 14 tokens `--ck-*` e zero hex. `react-markdown` + `remark-gfm` nas
  **mesmas versões do v1**, decisão minha: trocar de parser criaria divergência de saída que o
  item 5 do gate obrigaria a provar de novo. Realce de sintaxe ficou **deliberadamente fora** —
  o `rehype-highlight` do v1 traz hex próprio, e cor definitiva é rodada dedicada (§9.1).
  Agora no **botão copiar**, que sai de uma divergência que ela mesma reportou (ver abaixo).
  Antes disso: `diff-viewer` em `05764f2` e quatro rodadas de auditoria sem tocar no repositório.
- ⚠️ **Divergências v1 × v2 no markdown, abertas** — reportadas por ela, o que é o
  comportamento certo: (a) **o botão "copiar" do bloco de código sumiu** — não é estética, é
  função que o Rica usa, e está sendo fechada agora; (b) sem `rehype-raw`, HTML cru não é
  interpretado; (c) blocos não recebem as classes do `rehype-highlight`. Nota de método: no v1
  o realce é aplicado **seletivamente** (só `chat-messages.tsx:711`; as outras quatro chamadas
  usam apenas `remarkPlugins`), então deixá-lo de fora não é regressão geral.
- **Hiro** — **desbloqueado 30/07 12:48, custo zero.** A causa era `CLAUDE_CODE_EFFORT_LEVEL=max`
  (confirmada lendo `/proc/<pid>/environ`, não pelo sintoma): `max` obriga Fable 5 e o Claude Code
  valida a política da conta **antes** de rotear pro Kimi, então nem o motor k3 salvava. Conserto:
  `PATCH /api/agents/hiro/effort` para `high` + relançar. Relançar exige extrair a função
  `subir_hiro` do `subir-frota.sh` — rodar o script inteiro chama `main`, que mexeria no cockpit.
  Não se toca na opção 1 do modal: é transação financeira de R$ 67,44 e é decisão do Rica.
- **Varredura de cor literal, Hiro, 30/07** — veredito: **a regra "zero hex" está de pé no app
  inteiro**, não só onde eu tinha conferido à mão. `app/`, `components/shell/`,
  `components/renderers/` e `lib/` limpos. Três achados, e a classificação dele está aceita:
  1. `app/layout.tsx:13` — `themeColor: '#18191d'`: exceção **inevitável**, a API Viewport do Next
     não aceita `var()`; o valor é amarrado por contrato ao `--ck-surface-canvas`.
  2. ⚠️ `components/ui/badge.tsx:16` — `text-white` no variant `destructive`, **e o agravante é
     outro**: nenhum dos tokens shadcn que o arquivo referencia (`bg-primary`, `bg-destructive`,
     `ring`, `accent`, `foreground`, `border`) existe no `@theme inline` do `globals.css`. Hoje é
     inerte (o único uso é `tropa.tsx:40` com `variant="ghost"` e style em `--ck-*`), mas quem usar
     `destructive` amanhã herda branco literal **mais** tokens que não resolvem. Despachado de volta
     pra ele consertar.
  3. `public/gate-probe.js` — 7 hex + 1 rgba: instrumento descartável, fora do bundle, roda no painel
     antigo por bookmarklet e por isso **precisa** de paleta própria. Fora do escopo da regra.
  Nota de método: ele descartou `#feed` como falso positivo (era seletor CSS em comentário). Um
  achado desses entrando na lista derrubaria a credibilidade do relatório inteiro.
- **Papel do Hiro mudou em 30/07**, por ordem do Rica (*"usa ele, vamos tirar o atrazado, coisa que
  o Daniel ia fazer"* / *"Hiro tb é fera na ui"*): ele **sai do read-only e implementa**. O que não
  muda é que ninguém audita o próprio trabalho — o que ele escrever agora é auditado por outro.
- **Ordem de custo, Rica 30/07** (*"poupe o cc um pouco, tara e hiro na dianteira, Daniel volta para
  embelezar"*): Tara (Codex) e Hiro (Kimi) rodam **fora da cota do Claude Code** e assumem a frente;
  o Daniel fica só na camada visual, que é o que exige o modelo caro.
- **Supervisão:** cron de 5 min (`CronCreate`, id `07e3864c`). ⚠️ **session-only** — morre
  com a minha sessão e a supervisão para sem avisar ninguém. Este §4 é o antídoto.

## 4.1 Escopo em duas fases — decisão do Rica, 30/07 16:11

Palavras dele: *"vamos fazer o novo em duas fases — chat com a tropa; kanban de tarefas
por último, depois de validar a cultura da ui no chat"*. Na mesma mensagem delegou o
resto: *"tome as decisões, blz"*.

- **Fase 1 — chat com a tropa.** É o que está em execução. Tudo o que estiver sendo
  construído agora pertence a ela.
- **Fase 2 — kanban de tarefas.** **Não existe nesta fase.** Só começa depois de a
  cultura visual do chat estar validada por ele.

A ordem não é cronograma, é dependência: o chat **funda** a gramática visual que o kanban
vai herdar. Cultura que nascer errada no chat se propaga para a fase 2 e fica cara de
desfazer. Por isso a peça despachada agora é a §7 do `cockpit-v2-estetica.md` — a linha de
ferramenta. Pelos números do baseline, 82% do tráfego é `tool_use` e só o Bash tem 738
chamadas por sessão: essa linha **é** a tela, não é um detalhe dela.

## 4.2 Defeito do cockpit antigo, diagnosticado 30/07 — mensagem que fica pendurada

Sintoma visto **três vezes em 30/07**: texto aparece no input de um agente sem ninguém da
frota ter mandado. Os três eram plausíveis e contextuais, o que fazia parecer ordem legítima
— *"veredito do Rica chegou: aprovou a TROPA"* (Daniel), *"anota o achado do badge como
pendência"* (Hiro), *"pode dar push"* (Hiro). Nenhum foi submetido.

**Origem, com evidência:** `POST /api/agents/{slug}/input` do próprio cockpit —
`/tmp/cockpit-api.log` registra 39 envios ao `daniel` e 7 ao `hiro`, vindos de
`100.68.36.6` (iphone-15-pro) e `100.126.55.11` (note-ricardo), ambos na conta
`conectamovelmar@`. É o Rica digitando no painel. Não há dispositivo estranho no tailnet.

**A causa do "pendurado"** está em `apps/api/services/tmux_driver.py:425`, e a sequência é:
`send-keys C-u → load-buffer → paste-buffer -d -p → sleep 150 ms → send-keys Enter`. Se o CC
estiver ocupado ou com **overlay aberto**, o Enter se perde e o texto fica no input, sem
enviar. Não é hipótese: **o mesmo overlay do `/rc` comeu duas colagens minhas** nesta mesma
sessão, e a correção foi Escape + recolar.

**Por que isto é pior que um envio falho:** a mensagem some da tela do Rica, não chega ao
agente, **e fica armada** — o próximo Enter que cair naquela pane submete um texto fora de
contexto. Foi o que quase aconteceu com o "aprovou a TROPA", que teria feito o Daniel tratar
como aprovada uma peça que o Rica nunca julgou.

**Requisito para a fase 1 do v2** (o Rica pediu *"vamos mitigar problemas que tínhamos no
cockpit antigo"*): o envio precisa **confirmar que entrou** — ou o painel devolve erro, ou
não diz que enviou. Silêncio otimista é o defeito.

## 4.3 Checkpoint 30/07 ~13:40 — as três frentes em voo

- **Daniel** — rodada visual dedicada da §7 (a linha de ferramenta), com contexto zerado e
  a skill `frontend-design` carregada, como a §9.1 exige. Recebeu a referência do Rica
  (ChatGPT) com a regra de uso do §10 do `cockpit-v2-estetica.md`: empresta vocabulário,
  não gramática. Bateu 29% e tem `/compact` enfileirado.
- **Tara** — entregou `9129528` (88/88, `tsc` limpo): `useMemo` no diff, largura de coluna
  dinâmica, e as duas bordas obrigatórias **travadas em teste no markdown** com as contagens
  reais (330 array / 87 string / 199 null). Agora no guard rail do LCS.
- **Hiro** — montando o **braço de controle** do G1: mesmo experimento sem `assistant-ui`.
  É o teste que decide a biblioteca, pela ressalva do gate (`3366d32`).

### A decisão do algoritmo do diff — não trocar, e o número é o motivo

A Tara levantou corretamente que o LCS é `O(n·m)` em memória e que arquivo grande poderia
custar centenas de MB no celular. **Medi o corpus antes de decidir:** 38 patches nos
transcripts reais, mediana **18 linhas**, p95 **70**, **máximo 90**. Uma matriz 90×90 são
8.100 células — trivial. O risco é real como propriedade do algoritmo e **inexistente nos
dados**.

Decisão: **mantém o LCS**. Trocar por Myers agora seria complexidade contra um problema que
os dados não mostram. No lugar entra um **guard rail** pela cauda que eu *não* medi — o
componente recebe `oldString`/`newString` crus (`diff-viewer.tsx:14-15`), sem teto
estrutural, então acima do limite ele não roda o LCS e diz na tela que omitiu, com o número
de linhas. Degradar em silêncio seria o mesmo pecado do "copiado" que não copiou.

## 5. Retomada — os passos, na ordem

1. **Trocar a chamada** em `apps/cockpit/app/spike/page.tsx:359-360`:
   `buildRenderItems(messages)` → `createIncrementalRenderItems()` (instância estável
   via `useRef`, não recriar por render). **Avisar o Daniel antes** — arquivo dele,
   regra de colisão do ownership §3.
2. **Remedir o v2** no iPhone. Sequência que funciona, e ela é assim porque a
   primeira tentativa falhou por sincronia manual:
   ```bash
   cd /home/clawd/repos/grupo_borges
   python3 fixtures/cockpit-v2/gerar-carga.py --reset --fase historico
   # Rica abre https://srv1061129.tailfe77db.ts.net:3444/spike e AVISA
   python3 fixtures/cockpit-v2/gerar-carga.py --fase preenchimento
   python3 fixtures/cockpit-v2/gerar-carga.py --fase medicao --medicao-segundos 300
   # Rica: Iniciar · rolar pra cima e ficar · digitar no campo · Copiar ao parar
   ```
   A carga longa é o que elimina o "instante certo": 5 min de carga, janela de 1 min.
3. **Baseline no painel antigo** (3443), mesma carga, mesma duração. Bookmarklet no
   Safari — o cabeçalho do `gate-probe.js` tem a linha pronta, já com `https` e porta
   3444 (mixed content bloqueia `http`). No antigo não há `data-gate-*`, então o alvo
   sai por heurística: conferir `alvo_origem` no JSON e usar o botão **Alvo** se vier
   errado.
4. **Decidir** pela régua do gate §4: não pior em nenhuma das quatro **e** melhor em
   pelo menos duas. Sem baseline não há decisão — `361 ms` sozinho não diz se é
   regressão ou herança, e o painel antigo tem o **mesmo** O(N)
   (`apps/web/lib/use-messages-stream.ts:317` comenta isso).
5. **Desmontar a bancada** — `cockpit-v2-gate.md` §7. O `canario` precisa sair do
   `agents.yaml`: ele aparece na lista de agentes do Rica desde 30/07 (9 onde eram 8).

## 6. O que só o Rica pode fazer

A medição é no aparelho dele, via Tailscale. Benchmark em notebook **não** é aceito
como evidência — está no gate §2, e o motivo é que o furo número um do plano era ser
desktop enquanto o usuário é celular.

## 7. Armadilhas já pagas — não repetir

- **Zero num gate é "não mediu" até prova em contrário.** Duas rodadas deram números
  verdes sem medir nada. Conferir sempre `duracao_s`, `mensagens_observadas` e os
  campos `indisponivel`.
- **A bancada subiu sem instrumento** (`53cfe01`): o probe existia, a página tinha os
  `data-attributes`, e nada carregava um no outro. Nenhum teste pega integração
  ausente.
- **Sincronia manual não funciona.** Botão no celular + comando no servidor
  coordenados por mensagem = medição inválida. Carga mais longa que a janela resolve.
- **`index.d.ts` de pacote bundlado é uma linha só** — grep nele despeja o arquivo
  inteiro no contexto. Ler o `.d.ts` específico por path.
- **`client/ExternalThread` não é o caminho** — é `Resource` de outro runtime
  (`@assistant-ui/tap` + `store`). O spike usa `useExternalStoreRuntime`. Ver
  `cockpit-v2-stack.md`.
