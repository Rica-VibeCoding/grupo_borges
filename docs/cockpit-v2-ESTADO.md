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

- **Daniel** — rodada visual em curso sob a §9.1, começada com contexto em 1%. Escopo:
  levantamento `:3007` × `:3008`, status line de volta, TROPA recomposta com shadcn no
  chrome, fallback de emoji (Felipe/Barsi/Vinicius vêm com `emoji: null` da API). O resto
  da pele de `526aba7` fica.
- **Tara** — livre. Quatro rodadas de auditoria entregues, todas sem tocar no repositório;
  o `diff-viewer` dela está em `05764f2`, verificado por mim (36/36, `tsc` limpo).
- **Hiro** — **bloqueado**, não conta como frente: todo envio cai no modal *"Fable 5 now
  uses usage credits — R$ 67,44 in credits"*, que come o prompt. Não é quota Kimi (49/100,
  reset 02/08) nem env var errada. Opção 1 é transação financeira → decisão do Rica.
- **Supervisão:** cron de 5 min (`CronCreate`, id `07e3864c`). ⚠️ **session-only** — morre
  com a minha sessão e a supervisão para sem avisar ninguém. Este §4 é o antídoto.

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
