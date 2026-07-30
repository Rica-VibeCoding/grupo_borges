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

## 4. Em voo quando a sessão fechou

- **Daniel** — o G3 (20.273 px de deslocamento com o Rica rolado para cima). Contexto
  em 19%. A metade do indicador de mensagem nova já está fechada (`verificada: true`).
- **Ninguém** está no `page.tsx` além dele. A troca da chamada para o incremental é
  **minha** e ainda não foi feita — ver passo 1 abaixo.

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
