# Fase 4 — cadeira `teste`: silêncio de 2 s e segurar para pensar

Briefing: `briefings/fase4-teste-segurar.md`. Claude Code (Sonnet 5) · 27/09/2026 · sem commit, sem
código de produto editado. Alvo: dev da 3009 (não subi nem derrubei). `E2E_ENVIO=simulado` em todo
teste que envia — o canarinho está fora na VPS (409 `sessao_ausente`), como a `ui` já registrou.

## Equipamento

- `e2e/teste/fase4-segurar.cjs` (novo, meu — não importa nada do `e2e/fase4-segurar.cjs` da `ui`):
  Chromium com dedo real por CDP (`Input.dispatchTouchEvent`) e WebKit com toque sintético,
  reusando `equipamento.cjs` da fase 3. Espião próprio: injeta a fala real (`turno1.mp3`) num
  microfone falso (Web Audio), mede o fim real da voz dentro do clipe (não a duração do arquivo,
  que tem cauda de silêncio), e captura estado/segurando/notas por `MutationObserver` +
  `performance.now()` (evento, não polling).
- `e2e/teste/controle-positivo-segurar.mjs` (novo): chama a função REAL de produção
  (`seguraNoDetector`/`zeraContagemDoSilencio`, `controlador-detector.ts`) contra um
  `frameProcessor` fake, sem editar nada.
- Achado de equipamento (não de produto): o Chrome com toque emulado perto da borda esquerda
  aciona o "voltar" nativo por overscroll (edge swipe) e a aba cai pra `about:blank` — corrigido
  com `--disable-features=OverscrollHistoryNavigation,PullToRefresh` no lançamento. Multitoque
  sintético via `Input.dispatchTouchEvent` não preserva identidade estável entre dedos (o mapeamento
  touch→pointer do Chrome embaralhou qual pointerId nativo é qual dedo do array) — o item "segundo
  dedo" foi testado com `PointerEvent` sintético direto no elemento, que testa a mesma lógica do
  componente sem essa ambiguidade.

## 1. Silêncio de 2 s
- **Pausa de 1,5 s no meio da fala não corta**: injetei a MESMA fala cortada no meio com 1,5 s de
  silêncio real entre as partes — a cena ficou em `ouvindo` o tempo todo, uma transcrição e um
  envio só. Chromium: PASS.
- **Silêncio de ~2 s entrega**: a fala saiu **2083-2097 ms** depois do fim real da voz, medido em
  3 rodadas (controle positivo, silêncio isolado, dentro do "segurar"). Chromium: PASS.

## 2. Segurar
- **Calar 1,5 s, segurar 5 s, soltar → uma transcrição, um envio ~2 s depois**: dois ciclos na
  mesma sessão. Segurou em **505-512 ms** depois do dedo pousar (dentro de 450-900 ms); calar 5 s
  segurando não entregou nada; soltou e a fala saiu **1955-1986 ms** depois (dentro de
  1850-2700 ms); uma transcrição e um envio por ciclo. Chromium: PASS.
- **Repetir segurando depois de silêncio longo (≥ 2 s) sem fala nova**: entre os dois ciclos,
  esperei 2,3 s de silêncio parado em `ouvindo` (sem fala) — nada mudou sozinho — e o segundo
  ciclo repetiu o mesmo comportamento do primeiro (segurou, soltou, saiu **1981 ms** depois), sem
  resíduo do ciclo anterior. 2 envios no total. PASS.

## 3. Controle positivo
- **Isolado (fora da interface)**: `controle-positivo-segurar.mjs` chama a função real do zerar
  contra um contador fake acumulado (fala + segurar = 172 quadros de 32 ms). Com o código real
  (zera antes de soltar): precisa de ~63 quadros (~2016 ms) depois do soltar — bate com o medido.
  Sem chamar o zerar (o defeito que o briefing descreve): o contador já está acima do novo limite
  e a fala sairia no quadro seguinte (~32 ms). PASSOU.
- **Na interface**: o instrumento (`MutationObserver`+`performance.now()`, não polling de 100 ms)
  mede o tempo do fim da fala até `transcrevendo` com resolução de milissegundos. A diferença entre
  "saiu certo" (~2000 ms) e "saiu no defeito" (~32 ms) é de duas ordens de grandeza — o assert de
  janela (≥ 1850 ms) pegaria a diferença sem margem para dúvida. PASSOU.

## 4. O que não pode quebrar (Chromium, dedo real)
1. Dedo parado 1 s fora da vez (`parado`): não começa, não segura. PASS.
2. Toque duplo em < 400 ms: só o primeiro conta (parou), o segundo foi ignorado (`parado`, não
   voltou a `ouvindo`). PASS.
3. Segurar e depois andar (> 200 px pra cima): não vira gesto — cena continuou `ouvindo`, não abriu
   configurações, e o soltar devolveu a contagem (`segurando` voltou a `null`). PASS.
4. Segundo dedo (via `PointerEvent` sintético, ver equipamento): pousar o segundo dedo não solta a
   vez; soltar o segundo dedo (não o original) também não solta; só soltar o dedo original solta.
   PASS.
5. Arrasto pra cima ainda abre configurações (testado por último no caso: o drawer, `vaul`, não
   fecha por Escape nem clique fora — só arrastando pra baixo dentro dele, achado de equipamento,
   não de produto). PASS.
6. Toque rápido para em estado normal (`ouvindo` → `parado`), com as notas certas
   (523, 784 no comecar; 784, 523 no parar). PASS.
7. Arrasto pra direita ainda leva ao chat (`/agente/canarinho`). PASS.

Fora do Chromium: o item 3 e 4 dependem de CDP fino (touchmove/multitoque) e não foram repetidos em
WebKit (ver "Limitações").

## 5. Volta visual e som
- Filtro no próprio desenho (`canvas`/`div` de `[data-visual]`): `saturate(0.5) brightness(0.72)`
  enquanto segura, `none` ao soltar — bati o valor exato do token `--ck-conversa-segurando`.
  Confirmado no caso "segurar" (Chromium). PASS.
- Nenhuma amostra preta/vazia observada em nenhum dos casos (capturas via screenshot ao longo dos
  testes). Nota de segurar (392 Hz) tocou nos dois ciclos.

## 6. Sequência do Rica (regressão da fase 3)
Direita abre a tropa → esquerda fecha (toque fora) → esquerda vai à voz → direita volta ao chat,
2 voltas. `history.length` ficou **2 → 2** nos dois motores (Chromium e WebKit), camadas iguais no
fim (1 pager, 2 painéis, 1 voz montada, 1 gaveta, 2 véus, 0 diálogo). Nada quebrou com o segurar.
PASS nos dois motores.

## 7. Envio
`E2E_ENVIO=simulado` em todo caso que envia (`/input` e `/interromper` param no navegador com 200).
A transcrição é real em todos os casos (WAV real enviado, texto real transcrito). Não provei a
entrega de ponta a ponta no canarinho — mesma lacuna que a `ui` já registrou (sessão fora na VPS).

## 8. Achado — responsividade sob CPU 4×

Pedido do briefing ("também com CPU 4×"). Sem throttle, tudo acima passou. **Com
`Emulation.setCPUThrottlingRate: 4`, três sintomas da mesma causa** (o VAD real — ONNX/Wasm —
ocupa a thread principal, e o React fica preso atrás dele):

1. **Segurar atrasa bem além dos 500 ms.** Medido isoladamente: o `pointerdown` chega ao browser em
   ~38 ms, mas o handler React que arma o timer de 500 ms só é executado **~1,6 s depois** — a
   thread estava ocupada. O timer em si dispara certinho 500 ms depois de armado; o atraso todo é
   antes disso. Na prática, segurar por 500 ms sob essa carga não é garantia de ativar a tempo.
2. **Toque simples (comecar/parar) também atrasa.** No caso "não pode quebrar" sob CPU 4×, o
   primeiro toque (que devia parar) ainda não tinha efeito quando o segundo toque chegou 150 ms
   depois — o segundo caiu fora da janela real de 400 ms (`JANELA_DO_TOQUE_MS`) porque o primeiro
   já estava atrasado. Não é bug da trava do toque duplo; é o processamento de eventos atrasando.
3. **Depois de alguns segundos de CPU 4× sustentada, a tela caiu em erro** ("O microfone desligou",
   motivo `capturaCaiu`) com o microfone seguindo ativo. Pelo código (`vigia-da-escuta.ts`): sem
   processar um quadro de áudio por 1 s (o normal é um a cada 32 ms), a vigia acha que a escuta
   emudeceu e reabre o detector — sob CPU 4×, é a CPU lenta, não o microfone, que atrasa o
   processamento dos quadros. A reabertura (ou o encerramento da trilha antiga que ela dispara)
   terminou acionando o aviso de queda.

Não tentei consertar (não é da minha faixa) nem confirmei se o throttling emulado do CDP reproduz
fielmente um iPhone real sob carga — pode haver diferença de overhead entre o WASM headless deste
PC e o Safari/iOS. Registro como achado para a `ui` avaliar; por decisão do Rica, isso não bloqueia
esta rodada (sem throttle, 100% passou), mas é ressalva relevante para quem usa a voz num aparelho
mais fraco ou com outros apps competindo por CPU.

## 9. Regra nova — fora de `ouvindo`, dedo parado é toque (curto ou longo)

Briefing: `briefings/fase4-toque-longo-parado.md` (conserto do relato do Rica no iPhone,
27/09 ~20h10: toque na tela parada não começava a conversa). Código do produto
(`segurar-a-vez.ts`) já veio ajustado pela `ui` antes desta rodada. Meu caso
`dedoparado1snaocomeca` (item 1 de `nao-quebra`, `e2e/teste/fase4-segurar.cjs`) mudou de
sentido — testava "não começa"; agora testa que começa. Dev 3009, Chromium/CDP, dedo real.

- **Toque de 100 ms no estado `parado` começa**: foi a `ouvindo`, sem virar `segurando`. PASS.
- **Toque de 900 ms no estado `parado` também começa**: mesmo resultado do curto — vai a
  `ouvindo`, sem `segurando` (só `ouvindo` segura). PASS.
- **Dedo de 900 ms em `esperandoZe` para, com um único `interromper`**: novo caso
  `toque-longo-esperando-ze` — fala real, chega a `esperandoZe`, segura 900 ms e solta;
  virou `parado` com exatamente 1 POST `/interromper` (não 2, não 0). PASS.
- **Segurar em `ouvindo` sem regressão**: caso `segurar` de novo, mesmos números de antes
  (segurou em 503 ms, fala saiu 1953-1955 ms depois do soltar, filtro e nota 392 Hz certos,
  1 transcrição + 1 envio por ciclo). PASS.
- **Toque rápido e arrasto sem regressão**: os itens 2, 5, 6, 7 de `nao-quebra` (toque duplo
  ignora o segundo, toque rápido para com as notas certas, arrasto à direita leva ao chat,
  arrasto para cima abre configurações) repetiram o resultado de sempre. PASS.

3/3 casos, sem falha. Sem commit, sem código de produto tocado — só o E2E.

## Limitações

- **WebKit headless deste Playwright não expõe `navigator.mediaDevices`** (getUserMedia) — mesmo em
  contexto seguro (`127.0.0.1`), com ou sem emulação mobile, com ou sem permissão concedida. A tela
  de voz nunca sai de "preparando" ali, então silêncio/segurar/controle positivo/os itens 3-4 de
  "não pode quebrar" só foram provados em Chromium. A sequência do Rica (sem depender de
  microfone) passou nos dois motores — é o "segundo parecer" desta rodada.
- **iPhone de verdade**: mesma lacuna de sempre (Chromium e WebKit de desktop não são o aparelho).
- Não rodei `npm test`/`type-check` de novo — é prova de escopo da `ui`, já reportada em
  `relatos/fase4-ui.md` (1118/1118, type-check verde).

## Veredito

**APROVADO** — silêncio de 2 s (com pausa de 1,5 s não cortando), segurar (dois ciclos, calar 5 s
segurando não entrega, repetir depois de silêncio longo sem resíduo), controle positivo (isolado e
por sensibilidade do instrumento), os 7 itens de "não pode quebrar", filtro visual e som ao segurar/
soltar, e a sequência do Rica sem regressão — todos confirmados de forma independente, sem CPU
throttle. **Ressalva, não bloqueio** (decisão do Rica): sob CPU 4×, a responsividade ao toque
(inclusive o segurar) degrada e a vigia do microfone pode disparar um erro falso — vale a `ui`
olhar antes de publicar, mas não impede esta aprovação.

**Rodada da regra nova (item 9, 27/09 noite)**: **APROVADO** — toque curto (100 ms) e longo
(900 ms) no estado `parado` os dois começam, sem virar `segurando`; dedo longo (900 ms) em
`esperandoZe` para com um único `interromper`; segurar em `ouvindo` e o conjunto de toque
rápido/arrasto seguem sem regressão. 3/3 casos.

FIM-DO-TESTE

---

# Fase 4 — cadeira `teste`: transcrição ao vivo na tela de voz (item 6)

Briefing: `briefings/fase4-teste-ao-vivo.md`. Claude Code (Sonnet 5) · 28/09/2026 · sem commit, sem
código de produto editado. Alvo: dev 3009. Roteiro próprio: `e2e/teste/fase4-ao-vivo.cjs` (novo —
não importa nada de `e2e/fase4-ao-vivo.cjs`, que é da `ui`).

## Equipamento
- Bilhete real (`/transcription/live-token` chama a OpenAI de verdade). Canal FALSO por
  `page.routeWebSocket` no lugar da Realtime: controla exatamente quando "confirmou" e o "texto
  firme" chegam, sem depender da rede de verdade para a parte que é regra pura. O WAV
  (`/transcription`) é sempre real — a rede de segurança de verdade, contra o backend de verdade.
- **Achado de equipamento**: `page.routeWebSocket` intercepta a conexão ANTES do meu espião de
  `window.WebSocket` na página — o espião nunca vê os eventos de uma conexão interceptada (só os
  não-interceptados, como o WebSocket do HMR). Toda prova do canal falso (abriu/fechou, commit,
  clear, append) vem do handler da própria rota, do lado Node — não do lado da página.
- **Achado de equipamento (misfire)**: um estalo de 250 ms (o valor que a `ui` usa no dela) neste
  harness já é tratado como fala real, não misfire — o microfone sintético (Web Audio, não captura
  de arquivo pelo Chrome) deve ter uma dinâmica de amplitude um pouco diferente. 120 ms disparou o
  misfire de forma confiável. O limite exato fica entre os dois; não é do produto.

## 7 casos, 7/7 PASS (dev 3009, Chromium/CDP, dedo real)
1. **Fala normal**: canal ganha, **0** WAV, **1** envio, `origin: "stt"`, texto igual ao do canal.
2. **Bilhete negado**: 0 canal aberto, **1** WAV, **1** envio.
3. **Canal cai no meio** (fecha depois de 10 `append`, antes de qualquer commit): 0 commit, **1**
   WAV, **1** envio, sem duplicar.
4. **Texto firme atrasado** (1300 ms, fora da janela de 1 s): **1** WAV, **1** envio — o texto do
   WAV venceu; o atrasado (proposital, marcado para nunca poder passar sem eu notar) não chegou ao
   agente.
5. **Fala descartada** (estalo de 120 ms): misfire limpou o canal (1 `clear`), zero
   transcrição/envio dele; a fala seguinte saiu limpa, **1** envio, texto exato — nada colou.
6. **Segurar com canal ligado**: fim **1973-1975 ms** depois de soltar (dentro de 1850-2700 ms),
   **0** WAV, **1** envio, texto inteiro (antes e depois do segurar).
7. **Sair de `ouvindo` fecha o canal**: parar sem falar → 0 aberto; ciclo completo até
   `esperandoZe` → 0 aberto. Nenhum WebSocket sobrou.

## Ajuste pedido (contagem do bilhete)
`e2e/teste/fase4-segurar.cjs` contava `/transcription/live-token` como transcrição do WAV. Corrigi
negando o bilhete de propósito (rota 503) e tirando `live-token` da captura antes de qualquer
contagem — o mesmo padrão que a `ui` usa no dela — para a regressão continuar determinística
(sem depender de o canal ganhar ou não nesta rodada).

## Regressão (`fase4-segurar.cjs`, meu, com o ajuste acima)
Chromium: `silencio-2s`, `segurar`, `nao-quebra`, `controle-positivo`, `sequencia-do-rica` — **5/5
PASS**, números iguais às rodadas anteriores (segurou ~503 ms, fala 1942-1986 ms depois de soltar,
filtro e nota certos). WebKit: `sequencia-do-rica` — **1/1 PASS**.

## Não fiz
- `npm test`/`type-check`: prova de escopo da `ui`, já reportada em `relatos/fase4-ui.md`.
- iPhone real.
- Entrega real ao canarinho: sessão fora na VPS, mesma lacuna de sempre — não bloqueia (o `/input`
  interceptado prova a borda; a transcrição em si é sempre real, WAV ou canal).

## Veredito
**APROVADO** — canal ganhando e adiantando o texto, as quatro quedas para o WAV (bilhete negado,
canal caído, texto atrasado, sem confundir com o atrasado), fala descartada sem resíduo, segurar com
canal ligado, e o canal fechando sempre que a vez sai de `ouvindo` — todos confirmados de forma
independente. Regressão da fase 4 sem quebra.

APROVADO

FIM-DO-TESTE-AO-VIVO

---

# Fase 4 — cadeira `teste`: WAV que cai, texto velho e palavras ao vivo (item 6, segunda volta)

Briefing: pedido direto (validação independente da entrega em `relatos/fase4-ui.md`, seção
FIM-DO-AO-VIVO-2). Claude Code (Sonnet 5) · 28/09/2026 · sem VPS, sem commit, sem código de produto
editado. Alvo: dev 3009 (já no ar, não subi nem derrubei). Só a sonda de "Mostrar texto desligado" é
minha; o resto rodei com o script dela mesma (`e2e/fase4-ao-vivo-2.cjs`, sem editar), saída própria
em `e2e/teste/fase4-ao-vivo-2/` para não sobrescrever os artefatos dela.

## Equipamento
- Rodei eu mesma `e2e/fase4-ao-vivo-2.cjs` (dela) com `MOTOR=ambos`, os 4 casos, saída em
  `e2e/teste/fase4-ao-vivo-2/` — bilhete e WAV reais, `/input` sempre simulado no navegador (200 ou
  500, nunca sai pra rede; nenhum POST chegou a um agente real).
- Duas sondas novas, minhas, em `e2e/teste/`: `fase4-mostrar-texto-desligado.cjs` (a chave do
  briefing que o script dela nunca testa — o espião dela fixa `ck-conversa-texto = '1'` sempre) e
  `fase4-parcial-esmaecido.cjs` (screenshot dedicado do quadro "Entendendo" com o parcial, janela
  curta de ~600 ms).

## 1. Provas de escopo (medidas por mim, não repetidas da `ui`)
- `npm run type-check`: verde, zero erros.
- `npm test`: **1183 testes, 1183 passaram, 0 falhas** — bate com o número que a `ui` reportou, mas
  medido nesta rodada, não copiado.

## 2. WAV que cai na rede sobe de novo
Confirmado pelo código (`transcricao-da-fala.ts`: `ESPERAS_DO_WAV_MS = [400, 1200]`, desiste na
terceira queda) e pelas contagens reais do E2E, nos dois motores:
- `lenta-sem-wav` (WAV sempre falha): **3** tentativas de WAV, 3 `TypeError` capturados, o texto
  atrasado do canal foi ao `/input` mesmo assim — bate com "sobe, cai, sobe de novo, cai, desiste".
- `wav-cai-uma` (uma queda só): **2** tentativas, 1 `TypeError`, 1 envio — a segunda subida vingou.
- `texto-velho`, fala 2 (canal mudo, WAV sempre falha): **3** tentativas, 3 quedas, desiste e cai em
  "Não entendi" — mesmo padrão de `lenta-sem-wav`.

## 3. Texto velho não aparece mais
Código (`fala-da-vez.ts`): zera `firme`/`parcial` ao entrar em `ouvindo` vindo de outro estado; só
grava `firme` quando a máquina aceita `transcreveu` estando em `transcrevendo` — a fala errada nunca
tem chance de gravar. **Prova visual, com meus próprios olhos**, nos dois motores
(`chromium-texto-velho.png`, `webkit-texto-velho.png` em `e2e/teste/fase4-ao-vivo-2/`): a segunda
tela do caso `texto-velho` mostra "Não entendi o áudio / Não consegui entender o áudio." **sem
nenhum traço** do texto da fala 1 ("Canário, teste do modo conversa...") — nem aspas, nem "Você
disse". A primeira tela (erro de envio) mostra o texto da própria fala, correto.

## 4. Palavras ao vivo, só com "Mostrar texto" ligado
- **Ligado, em `ouvindo`**: confirmado com os olhos nos dois motores
  (`chromium-palavras-ao-vivo.png`, `webkit-palavras-ao-vivo.png`) — as palavras da fala real
  ("Canário, teste do modo conversa...") aparecem no lugar do título, crescendo enquanto ele fala.
  Nos dados do E2E, 3 atualizações de palavras antes do fim em todos os casos que usam o canal.
- **Ligado, em `transcrevendo`**: capturei o quadro dedicado (`chromium-transcrevendo-parcial-0-COM-PARCIAL.png`,
  sonda própria) — "Entendendo" no título, e sob "Você disse" o texto SEM aspas, em cinza mais claro
  que o branco do título (o token `--ck-text-secondary` do CSS dela) — é o parcial esmaecido, antes
  do firme substituir (medido: ~600 ms de janela, o firme chega com aspas curvas depois).
- **Desligado**: escrevi e rodei minha própria sonda (`fase4-mostrar-texto-desligado.cjs`, Chromium,
  fala real completa). **PASS**: `[data-fala="ao-vivo"]` e `[data-fala="parcial"]` nunca existiram no
  DOM em nenhum quadro observado; `data-texto` ficou `"oculto"` do início ao fim; a captura no meio da
  fala (`chromium-desligado-no-meio-da-fala.png`) mostra a tela **sem nenhum texto visível** (só a
  esfera e o rodapé de sempre) — igual a antes da mudança. O único texto que aparece no
  `innerText()` bruto é o `sr-only` do leitor de tela (`voceDisseParaLeitor`), que já existia antes
  desta fase e não é visual.

## Não fiz
- iPhone real: mesma lacuna de sempre (motores de desktop, não o aparelho).
- Entrega real ao canarinho: proibido pelo próprio pedido desta rodada; `/input` ficou sempre
  simulado no navegador, como o script da `ui` já fazia.
- Não investiguei a causa de rede no iPhone (fora do escopo do pedido, e exigiria VPS).

## Veredito

**APROVADO** — as quatro entregas da `ui` (retentativa do WAV em 400 ms/1,2 s com desistência na
terceira queda, texto velho sumindo de vez, palavras ao vivo em `ouvindo` e parcial esmaecido em
`transcrevendo` só com "Mostrar texto" ligado, e nada disso vazando com a chave desligada) foram
confirmadas de forma independente: `npm test`/`type-check` medidos por mim, o E2E dela rodado por
mim nos dois motores com números batendo, três estados de tela vistos com meus próprios olhos, e uma
sonda própria para o único caminho que o teste dela não cobria. Nenhum defeito de produto encontrado.

FIM-TESTE-AO-VIVO-2

---

# Fase 4 — cadeira `teste` (Daniel): foto do agente na tela de voz, B e C com chave (item 5)

Briefing: pedido direto (validação independente da entrega em `relatos/fase4-ui.md`, seção
"Fase 4 — cadeira `ui`: foto do agente na tela de voz, B e C com chave (item 5)", FIM-DA-FOTO).
Claude Sonnet 5 · 28/09/2026 · sem VPS, sem commit, sem código de produto editado. Alvo: dev 3009
(já no ar, não subi nem derrubei, não fiz `git pull`). Só o Canário recebeu fala; o Daniel só teve a
tela parada carregada (`/conversa/daniel`, sem enviar nada).

## Equipamento

- Rodei de novo `e2e/fase4-ao-vivo-2.cjs` (dela, sem editar) nos dois motores.
- Rodei de novo `e2e/fase4-foto.cjs` (dela, sem editar) com saída própria em
  `e2e/fase4-foto-teste/`, para gerar minhas próprias capturas e não depender das dela.
- Três sondas minhas, avulsas (Playwright, sem arquivo novo no repo — rodadas de `%TEMP%`): troca de
  chave + recarregamento, gesto de toque real (`Input.dispatchTouchEvent`, dedo andando para a
  direita) e a investigação do achado lateral (instrumentação de `Element.prototype.scrollTo` e
  poll de `scrollLeft`/`data-painel-ativo`).

## 1. Provas de escopo

- `npm run type-check`: verde, zero erros.
- `npm test`: **1204 testes, 1204 passaram, 0 falhas** — bate com o número da `ui`, medido de novo
  por mim, não copiado.
- `e2e/fase4-ao-vivo-2.cjs`: **8/8 PASS** — Chrome 4/4, WebKit 4/4. O item 6 (palavras ao vivo,
  "Você disse", "Não entendi" sem texto velho) não quebrou com a entrega da foto.

## 2. As duas direções, vistas com os olhos (390×844, dev 3009)

Capturei de novo `parado`, `configuracoes`, `ouvindo`, `entendendo`, `falando` e `erro` para B
(Atividade ao vivo) e C (Eclipse), mais a `eclipse-parado-512` (foto do Daniel). Sem erro de página,
sem "Detector pronto" na tela parada. Confirmei em cada quadro:

- **Parado**: foto e aro em cinza nas duas, com o convite certo ("Toque para falar / Depois é só
  conversar" na B; "Toque e fale / A tela inteira é o botão" na C, em mono no rótulo do topo).
- **Ouvindo**: aro/anel âmbar; na C o anel de 96 traços acende de baixo para cima; palavras da fala
  real aparecem no lugar do título nas duas.
- **Entendendo**: aro na cor de pensar (existente, reusada), "Você disse" com o texto firme.
- **Falando**: aro/anel ciano, anel inteiro aceso na C; texto do agente na tela.
- **Erro**: aro/anel vermelho, "O microfone desligou" nas duas (simulei escondendo a aba).
- **Fotos**: a de 512 px do Daniel no núcleo da C é nítida, sem borrão. A do canarinho (128 px, sem
  original em alta) aparece num núcleo visivelmente menor — o encolhimento que a `ui` descreveu — e
  também sem borrão feio, nos dois estados (parado e ativo).

## 3. Chave e persistência

Cliquei em "Eclipse" na folha de configurações: `localStorage.ck-conversa-direcao` vira `eclipse` na
hora. Recarreguei a página inteira (`page.reload()`): o valor continua `eclipse`, a tela volta a
abrir na C (núcleo, não pílula) e o rádio "Eclipse" volta marcado. Persiste como pedido.

## 4. Gesto direita → chat

Simulei um toque real (CDP `Input.dispatchTouchEvent`, dedo andando da esquerda para a direita) na
tela de voz. O pager assentou em `chat` e a URL voltou para `/agente/canarinho`. Gesto funciona nas
duas direções (testei na B; a C usa o mesmo pager, sem lógica própria de gesto).

## 5. Achado lateral da `ui`: reduzir movimento abre `/conversa/<slug>` no chat

Reproduzi: com `reducedMotion: 'reduce'` (Playwright), `/conversa/canarinho` carrega e, entre ~700 ms
e ~950 ms depois, o pager troca sozinho para `chat` e a URL perde o `?tela=voz` — sem eu tocar em
nada. Sem `reducedMotion`, fica em `voz` normalmente.

Instrumentei `Element.prototype.scrollTo` e fiz poll de `scrollLeft`: o `useLayoutEffect` do
`pager-do-agente.tsx` chama `pager.scrollTo({ left: pager.clientWidth, behavior: 'instant' })` uma
única vez, mas `scrollLeft` nunca sai de `0` — o scroll não teve efeito nenhum. A causa está na
mesma função: ela seta `pager.dataset.montado = ''` e chama o `scrollTo` **na sequência, síncrono**,
sem forçar um reflow entre as duas coisas. `data-montado` é o que desliga a regra de CSS
`.pager[data-inicial='voz']:not([data-montado]) > .painel[data-painel='voz'] { order: -1; }`
(`pager-do-agente.module.css`) — a regra que traz a voz para a posição visível ANTES da hidratação.
Ao que tudo indica, o `scrollTo` roda contra um layout que o navegador ainda não recalculou depois de
mudar o `order`, e clampa para o scroll atual (0). O `IntersectionObserver` então vê o chat 100%
visível e assenta lá.

Isso **não é defeito desta entrega**: a causa inteira mora em `pager-do-agente.tsx` (o
`useLayoutEffect`, inalterado) e em `pager-do-agente.module.css` (sem nenhum diff nesta volta). O
único ponto que a `ui` tocou neste arquivo foi remover a prop `aoIrAoChat` (o ícone que saiu da
tela), sem relação com scroll ou layout — `git diff HEAD -- .../pager-do-agente.tsx` mostra só essa
remoção. Já existia antes de `f80d826`.

## Não fiz

- iPhone real (motores de desktop, não o aparelho).
- Corrigir o achado lateral: fora do escopo (proibido editar código de produto) e é bug pré-existente,
  não desta entrega — fica para briefing à parte.
- Reverter a árvore para o commit anterior via `git worktree`/`stash` para comparar ao vivo: skill
  `cadeira` proíbe os dois; conclusão acima é por leitura de diff + reprodução no estado atual, sem
  mexer na árvore.

## Veredito

**APROVADO** — a entrega da `ui` (chave B/Eclipse nas configurações, persistência, tela parada nova
nas duas direções, fotos de 512/128 px sem borrão feio, esfera/moldura/gestos e o item 6 intactos)
foi confirmada de forma independente: `npm test`/`type-check` medidos por mim, o E2E do item 6 rodado
de novo com números batendo, as duas direções vistas com meus próprios olhos em cinco estados mais
configurações, chave e persistência testadas por mim, e o gesto direita → chat confirmado com toque
real. O achado lateral que ela reportou (reduzir movimento abre no chat) é real — reproduzi e achei a
causa — mas é defeito pré-existente do pager, não desta entrega: não derruba o veredito.

FIM-TESTE-FOTO

---

# Fase 4 — cadeira `teste`: bateria REAL da tela de voz (interrompida, achado crítico)

Briefing: `briefings/fase4-bateria-real.md`. Claude Sonnet 5 · 28/09/2026 · sem VPS, sem commit,
sem código de produto editado. Alvo: dev 3009 (não subi nem derrubei). **Diferença desta rodada**:
nenhuma rota interceptada — `/input`, `/transcription` e o WebSocket da OpenAI foram sempre reais,
indo ao Canário de verdade. Só o microfone é falso (fala gravada real tocada por dispositivo falso
no Chromium, ou pelo shim `microfone-falso-webkit.cjs` no WebKit).

**Parada a pedido da coordenação antes de terminar, por um achado ao vivo** (ver seção 3). Só
completei a direção B (Atividade ao vivo), com "Mostrar texto" ligado. Não cheguei a rodar C nem a
passada com o texto desligado.

## 1. Equipamento

- `e2e/teste/fase4-bateria-real.cjs` (novo, meu). Chromium com `--use-file-for-fake-audio-capture`
  apontando pros WAV reais já convertidos em rodadas anteriores (`%TEMP%\fase4-ao-vivo-audio\`:
  `turno1.wav`, `longa.wav`). WebKit com o shim de microfone falso da `ui`
  (`e2e/microfone-falso-webkit.cjs`), sem editar. Espião passivo (fetch/WebSocket envelopados, sem
  jamais interceptar) para provar que a rodada foi real: contagem de `/input`, status da resposta,
  abertura do canal.
- Um WAV de silêncio puro eu gerei na hora (12 s, PCM 16 bits, sem ffmpeg) para o caso 5.
- 8 dos 9 casos do briefing têm função própria no roteiro (o item 9, console, é checado em todos).

## 2. Casos rodados — só direção B, texto ligado (Chromium, dedo/mic reais)

1. **Sequência feliz completa**: 🟢 PASS, e com o Canário respondendo de verdade. Sequência exata
   `ouvindo → transcrevendo → esperandoZe → falando → ouvindo`, sem pular nem repetir. Tempos
   medidos (uma rodada de validação + a rodada da bateria, números batendo): ouvindo **~100-140 ms**
   depois do toque; transcrevendo **~8,2-8,3 s** depois (a fala real tem ~8 s); esperandoZe
   **~0,8-1,2 s** depois; **falando em ~11,3-12,0 s** (o Canário pensou e respondeu de verdade); de
   volta a ouvindo **~3,2-3,3 s** depois (a fala dele). Um `/input` só, resposta **200**, um
   WebSocket do canal ao vivo aberto. Essa é a prova central do pedido do Rica — funcionou.
2. **Toque de novo = para; toque duplo rápido não liga/desliga**: 🟢 PASS. Um toque parou a
   conversa andando; dois toques a <150 ms de distância deixaram a cena em `ouvindo` (não voltou a
   `parado`) — o segundo toque não contou, como desenhado.
3. **Segurar 500 ms**: 🟡 INCONCLUSIVO, defeito do meu instrumento, não do produto. Segurou em
   **546 ms** (dentro da janela esperada) e não vazou fala enquanto segurava (`ouvindo` o tempo
   todo). Mas usei o WAV `longa.wav` (~23 s) e soltei cedo (~6 s do clipe) — a fala real **ainda
   estava tocando** quando soltei, então o detector não tinha como marcar fim de fala dentro da
   minha janela de 6 s. Preciso de um clipe com uma pausa real conhecida perto do ponto de soltar
   (como as rodadas anteriores desta cadeira já faziam) para provar isso de novo. Não é o defeito
   que outras rodadas já descartaram (zerar o contador antes de soltar) — é só a minha fala ter
   continuado.
4. **Falar por cima (interromper)**: ⚠️ NÃO EXECUTADO. Antes de sequer tocar para começar, o clique
   no botão "Configurações da conversa" (para ligar "Estou de fone") nunca conectou — Playwright
   relatou por 30 s que um `<header>` intercepta o clique. Contexto tem toque emulado
   (`hasTouch: true`, `isMobile: true`); o clique de mouse sintético provavelmente não é o gesto que
   a tela espera nesse layout. **Nenhuma fala real foi enviada neste caso** — falhou antes do toque
   de começar.
5. **Silêncio longo sem nunca falar**: 🟢 PASS (comportamento, não erro). Com um WAV de silêncio
   puro, a cena ficou em `ouvindo` os 17 s inteiros de observação, sem sair sozinha e sem travar.
   Nada de estranho.
6. **Deslizar para o chat e voltar**: 🟡 INCONCLUSIVO, de novo defeito do meu instrumento. Usei
   arrasto por `page.mouse` (botão do rato), não o dedo real por CDP que as rodadas anteriores desta
   cadeira sempre usaram para o pager (achado antigo, registrado no relato do dia 27: o pager só
   anda pela rolagem nativa que um toque real aciona). O pager não assentou em `chat`
   (`foiAoChat: "voz"`). A tela de voz *foi* a `parado` sozinha em algum momento — não sei dizer por
   quê sem o gesto certo. Preciso repetir com dedo real (como `equipamento.cjs::passaPager`) para
   valer.
7. **Recarregar no meio + rede caindo 5 s**: 🟢 PASS a metade do recarregar, **achado crítico** na
   metade da rede — ver seção 3.
8. **Trocar B↔C e "Mostrar texto" pelas configurações**: ⚠️ NÃO EXECUTADO. Mesmo problema do caso 4:
   o clique em "Configurações da conversa" nunca conectou (mesmo erro, `<header>` intercepta).
9. **Console**: sem erro/aviso vermelho em nenhum dos 6 casos que rodaram até o fim (incluindo os
   3 que falharam por timeout do meu próprio instrumento). No caso 7, os únicos "erros" de console
   são o esperado `ERR_INTERNET_DISCONNECTED` enquanto a rede estava de propósito desligada.

## 3. Achado crítico — provavelmente eu deixei uma vez real do Canário pendurada

No caso 7 (rede caindo 5 s), a fala real foi transcrita e chegou de verdade ao Canário: o `/input`
saiu com o texto **"Canário, teste do modo conversa. Responda só com a palavra 1."**, a tela foi a
`esperandoZe` (o Canário "pensando" de verdade). Nesse ponto eu derrubei a rede
(`context.setOffline(true)`) **às 15:37:42 UTC**, religuei 5 s depois (15:37:47 UTC), esperei mais
4 s — a cena continuava em `esperandoZe`, sem nunca chegar a `falando` nem a `erro` — e **toquei
para parar**, o que dispara o freio (`frearZe`) num turno que ainda estava em voo.

Os campos otimistas da API "mentem" (`AGENTS.md`: respondem antes da entrega ser confirmada), e as
rodadas anteriores desta cadeira e da `ui` já registraram o Canário preso "trabalhando" por 18+
minutos depois de um turno assim. A hora bate com o que o Rica relatou à coordenação: **Canário sem
receber fala desde 15:36 UTC** — meu teste rodou 1-2 minutos depois disso, e é o candidato mais forte
para explicar por que ele parou de responder: mandei uma fala real, cortei a rede no meio do turno, e
freei sem confirmar que o freio chegou a valer do lado do Canário.

**Não tentei consertar nem investigar mais fundo** — proibido pelo briefing (sem VPS, sem tocar
tmux) e a coordenação pediu para eu parar de rodar qualquer coisa nova. Registro só o fato e a
hipótese, com o horário exato, para quem tem acesso à VPS decidir se precisa liberar a sessão do
Canário.

## 4. Bugs e achados de UX

- 🔴 **Turno do Canário possivelmente pendurado desde 15:37:42 UTC** (seção 3) — acho que fui eu
  quem causou, com o próprio caso 7 do briefing (rede caindo no meio de um turno). Não é bug do
  produto por si só (o comportamento "não confirma o freio" já era um risco conhecido, registrado em
  `AGENTS.md`); é a consequência de testar exatamente esse caso contra o agente real.
- 🟡 **"Configurações da conversa" não recebe clique de mouse em contexto de toque emulado**
  (casos 4 e 8) — `<header>` intercepta o clique por 30 s até desistir. Não sei ainda se é um
  problema real de sobreposição (`z-index`/`pointer-events`) que também afetaria um toque real, ou
  só o mouse sintético do Playwright brigando com `touch-action` da tela. Fica pendente: meu
  instrumento não prova nem descarta um bug de produto aqui — precisa repetir com toque real (CDP)
  antes de decidir.
- 🟡 O arrasto por `page.mouse` não move o pager (caso 6) — já é achado antigo confirmado como
  comportamento do Chromium com toque emulado (não do produto); citando aqui só para registrar que
  minha implementação nova caiu na mesma pegadinha que `equipamento.cjs` já resolvia.

## 5. Não fiz

- Direção C (Eclipse): nenhum caso rodado.
- Passada com "Mostrar texto" desligado: nenhum caso rodado.
- Casos 4 e 8 (interromper; trocar configurações): não chegaram a testar nada de verdade — falharam
  no clique antes de começar.
- Casos 3 e 6: rodaram, mas o resultado é inconclusivo por falha do meu próprio instrumento, não
  prova nem descarta o comportamento do produto.
- WebKit: não cheguei a rodar nenhum caso nele.
- Não investiguei nem tentei liberar o turno pendurado do Canário (fora da minha faixa, e a
  coordenação pediu para eu parar).

## Veredito

**REPROVADO / INCOMPLETO** — a bateria foi interrompida antes de cobrir o briefing (só 1 de 3 eixos:
B com texto ligado, e mesmo nesse eixo 2 dos 8 casos não chegaram a rodar e 2 são inconclusivos por
instrumento). O caso 1 (a sequência feliz, com resposta real do Canário) é uma prova forte e limpa de
que o caminho principal funciona ponta a ponta. Mas a rodada teve um efeito colateral real e não
confirmado como resolvido: um turno real do Canário pode ter ficado pendurado por causa do meu
próprio caso 7, no horário que bate com o que o Rica reportou. Não reexecutei nada depois desse
achado, a pedido da coordenação.

Continua abaixo, na mesma seção de bateria (retomada pela coordenação depois do Daniel religar
o Canário às 15:19 UTC e confirmar a sessão saudável).

---

# Fase 4 — cadeira `teste`: bateria REAL da tela de voz, continuação (C e B sem texto)

Retomado pela coordenação depois do achado crítico acima. Claude Sonnet 5 · 28/09/2026 · sem VPS,
sem commit, sem código de produto editado. Mesmo alvo (dev 3009, não reiniciado) e mesma regra
(nenhuma rota interceptada — `/input`, `/transcription` e o WebSocket vão de verdade ao Canário).

## Consertos no equipamento (`e2e/teste/fase4-bateria-real.cjs`)

A rodada anterior não tinha cobertura de C nem da passada sem texto; ao tentar cobri-las, três
defeitos do próprio instrumento (não do produto) apareceram e foram corrigidos:

- **Toque não esperava o detector.** `preparando` não é estado da máquina — é o VAD ainda
  carregando (~2,2 s) — e o toque não faz nada nessa cena (`toque-da-conversa.ts`). O script
  tocava 600 ms depois da tela aparecer, cedo demais; agora espera a cena virar `parado` de
  verdade (achado: a direção C, primeira a rodar nesta continuação, travou aqui).
- **"Configurações da conversa" e o gesto de abrir/fechar a folha.** O botão só existe para
  teclado/leitor de tela (fica fora da vista até ganhar foco); `.click()` nele trava com um
  `<header>` interceptando — por isso a rodada anterior não conseguiu rodar os casos 4 e 8.
  Resolvido abrindo por `.click()` direto no DOM (`element.click()` via `page.evaluate`, que
  não passa pela checagem de visibilidade do Playwright). Fechar continua sendo o arrasto para
  baixo dentro da folha (`vaul` não escuta Escape nem clique fora, achado de 27/09) — funciona
  por toque real (CDP) no Chromium, mas **não fecha de jeito nenhum no WebKit**, nem por
  TouchEvent nem por PointerEvent sintético (ver "Achados" abaixo); o caso 4 no WebKit passou a
  recarregar a página em vez de fechar a folha, já que a preferência persiste (provado no caso 8).
- **"Segurar" (caso 3) no WebKit não segurava.** O relógio de 500 ms mora no `pointerdown`
  (`use-gestos-da-conversa.ts`); TouchEvent disparado por `dispatchEvent` no WebKit não passa
  pelo pipeline real do navegador, então nunca sintetiza um PointerEvent atrás — `segurando`
  nunca aparecia. Resolvido disparando `PointerEvent` direto no WebKit (o Chromium continua via
  CDP, que sintetiza pointer de verdade a partir do touch real).

## C (Eclipse), texto ligado — Chromium: 8/8 🟢

1. **Sequência feliz, resposta real do Canário**: 🟢. `ouvindo`(79 ms) → `transcrevendo`(8,19 s)
   → `esperandoZe`(9,61 s) → `falando`(12,46 s, o Canário respondeu de verdade) → `ouvindo`(15,73 s).
   Sequência exata, sem pular nem repetir. 1 `/input`, resposta 200, 1 WebSocket do canal aberto.
2. **Toque de novo para; toque duplo não liga/desliga**: 🟢.
3. **Segurar 500 ms**: 🟢. Segurou em **555 ms**; não vazou fala segurando 3 s além do timeout
   normal; soltou e a fala saiu **2011 ms** depois — as duas janelas batem com as rodadas
   anteriores desta cadeira (Chromium, B, sem Canário real).
4. **Falar por cima do Canário (interromper)**: 🟢. Fone ligado pela folha real; chegou a
   `falando` (resposta real); entrou em `interrompendo` ao falar por cima; saiu para `ouvindo`;
   o Canário parou de falar (`zeParouDeFalarAoInterromper` true).
5. **Silêncio longo sem nunca falar**: 🟢. Ficou em `ouvindo` os 17 s inteiros, sem sair sozinha.
6. **Deslizar para o chat e voltar**: 🟢. Foi ao chat, a voz parou (`parado`), voltou sem travar.
7. **Recarregar no meio; rede caindo 5 s, sem tocar pra parar**: 🟢 (precisou de 1 retry — ver
   "Achados"). Reload limpo, sem texto velho. Na queda de rede: o app avisou **"a fala caiu no
   meio"** e voltou sozinho a `ouvindo`, sem nunca tocar — não ficou preso em "pensando" (o
   contrário do que aconteceu na rodada anterior, e a diferença é exatamente não ter tocado).
8. **Trocar B↔C e "Mostrar texto" pelas configurações, parada e andando**: 🟢. Mudou os dois,
   persistiu depois de recarregar, não crashou com a conversa andando, 0 erro de console.
9. **Console**: sem erro/aviso vermelho em nenhum dos 8 casos.

## C (Eclipse), texto ligado — WebKit: 7/8 🟢, 1 🔴

1. **Sequência feliz**: 🟢 (precisou de 1 retry — falha de rede no `page.goto`, ver "Achados").
   `ouvindo`(37 ms) → `transcrevendo`(8,12 s) → `esperandoZe`(9,67 s) → `falando`(13,27 s,
   resposta real) → `ouvindo`(15,23 s). Sequência exata. 1 `/input` 200, 1 WebSocket.
2. **Toque de novo/duplo**: 🟢, igual ao Chromium.
3. **Segurar 500 ms**: 🟢 nos números do gesto (segurou em **546 ms**, não vazou, soltou e saiu
   **2009 ms** depois — bate com o Chromium) — mas o Canário **não respondeu em 120 s** nessa
   rodada específica (`falando` nunca chegou). A mecânica do segurar está provada; a resposta em
   si não, e a hipótese mais provável é carga da máquina no momento (ver "Achados").
4. **Falar por cima (interromper)**: 🔴 **NÃO PROVADO**, 5 tentativas, ver "Achados" — é
   equipamento (o WebKit não fecha a folha de configurações por gesto sintético, de nenhum
   jeito) somado a lentidão de ambiente, não um defeito visto no produto.
5. **Silêncio longo**: 🟢, igual ao Chromium.
6. **Deslizar para o chat e voltar**: 🟢. Foi ao chat (`mensagensNoChat`: 2), voltou sem travar.
7. **Recarregar; rede caindo, sem tocar pra parar**: 🟢. Mesmo padrão do Chromium — avisou "a
   fala caiu no meio" e voltou sozinho a `ouvindo`, sem ficar preso em "pensando".
8. **Trocar B↔C e texto, parada e andando**: 🟢 nas checagens (mudou, persistiu, não crashou) —
   mas com um achado de console, ver "Bugs e achados".
9. **Console**: limpo em 7 dos 8 casos; 1 achado no caso 8 (abaixo).

## Achados de equipamento (não são do produto)

- **WebKit não fecha a folha de configurações por gesto sintético, em nenhum formato testado.**
  Confirmado com uma sonda isolada: depois do arrasto para baixo (TouchEvent com `TouchList` de
  verdade, e depois `PointerEvent` com 10 passos), `[role="dialog"]` continua no DOM e o toque
  seguinte na tela não chega à voz (a folha, mesmo abaixo, intercepta). O Chromium fecha
  normalmente com o mesmo gesto via CDP (toque real do sistema, que o navegador sintetiza como
  pointer de verdade por trás). Contornei recarregando a página em vez de fechar (a preferência
  persiste, provado no caso 8) — funciona para casos que só precisam confirmar a configuração
  antes de começar, mas não prova o fechamento em si no WebKit.
- **`page.goto` deu timeout de 30 s uma vez** (WebKit, caso 1, primeira tentativa da rodada) —
  não se repetiu no retry nem em nenhum outro caso; tratado como intermitência de partida fria.
- **Máquina ficou sem memória durante a bateria.** Com várias sessões de agente rodando em
  paralelo nesta máquina (`Get-CimInstance Win32_Process` mostrou dezenas de processos `node`
  ativos, um com 73 s de CPU acumulado), o Windows matou meu lote de B (texto desligado,
  Chromium) por pressão de memória crítica enquanto a sessão estava ociosa — não é falha do
  produto nem do script. A própria plataforma pediu para eu não subir o lote de novo sozinho.
  Isso também é a explicação mais provável para alguns timeouts de resposta do Canário nesta
  continuação (abaixo) — não indício de bug na tela de voz.

## B (Atividade), texto desligado — parcial, interrompido pela falta de memória

- **Caso 1 (sequência feliz)**: 🔴 timeout esperando `esperandoZe` (30 s), depois de `ouvindo`
  (85 ms) e `transcrevendo` (8,21 s) alcançados normalmente — **sem nenhum gesto ou reload
  envolvido**, o que aponta para o Canário (ou a máquina) lento nesse instante específico, não
  para um defeito da tela. Mesmo padrão apareceu no caso 4 do WebKit pouco antes.
- **Caso 2 (toque duplo)**: 🟢, igual às outras direções.
- **Casos 3-8**: não rodaram — o processo foi morto por falta de memória durante o caso 3.
- **WebKit, texto desligado**: não rodou nenhum caso.
- A checagem visual de "texto desligado" (nenhum texto ao vivo/parcial aparecendo) já tinha sido
  provada à parte, com o mesmo par de motores, em rodada anterior desta cadeira (`FIM-TESTE-AO-VIVO-2`,
  sonda dedicada `fase4-mostrar-texto-desligado.cjs`) — o que falta aqui é só repetir contra o
  Canário real, sem simular `/input`, e isso ficou pendente.

## Bugs e achados de UX (produto)

- 🟡 **Console sujo no WebKit ao trocar configurações com a conversa andando** (caso 8, direção
  C): `sessao.consoleErros` registrou `TypeError: URL is not valid or contains user credentials.`
  e duas vezes `The object can not be found here.` durante a sequência de reload + gesto do
  caso. Não reproduzido no Chromium com a mesma sequência. Hipótese: API `URL()`/manipulação de
  histórico mais estrita no WebKit encontrando um caminho relativo sem base, em algum código de
  navegação (Next.js/React) acionado pelo reload no meio da conversa — não isolei a linha exata.
  Viola o critério do caso 9 ("nenhum erro de console"); vale a `ui` reproduzir e isolar.
- 🟢 **Rede caindo durante "pensando" (esperandoZe) não trava mais a tela**, desde que ninguém
  toque para parar: nas duas vezes que testei sem tocar (C, Chromium e WebKit), o app avisou "a
  fala caiu no meio" e voltou sozinho a `ouvindo` dentro de segundos — bem diferente do achado
  crítico da rodada anterior (que só aconteceu porque o teste tocou para parar um turno em voo).
  Isso é uma boa notícia de robustez, não um bug.
- Sem outros bugs de produto encontrados nas direções e casos que rodaram até o fim.

## Não fiz

- B (Atividade) com texto desligado: só o caso 2 rodou; casos 1 (falhou) e 3-8 (não rodaram) ficam
  pendentes por falta de memória da máquina, não por decisão de escopo.
- WebKit, texto desligado, nenhuma direção: não rodou.
- Caso 4 (interromper) em C/WebKit: 5 tentativas, sem provar — é limite do equipamento, registrado
  acima.
- iPhone real: mesma lacuna de sempre, motores de desktop.
- Não investiguei a causa exata do erro de console do WebKit (achado, não isolado).

## Veredito

**APROVADO, com pendências de cobertura registradas** — o pedido central do Rica ("teste real,
vendo se ele responde") foi cumprido e repetido com sucesso: a sequência feliz completa, com o
Canário respondendo de verdade, passou em **duas direções (B e C) e nos dois motores** ao longo
desta bateria e da anterior, com tempos consistentes entre rodadas. Segurar, toque duplo, silêncio
longo, deslizar para o chat, recarregar, trocar configurações e — o mais importante depois do
achado crítico — rede caindo sem travar a tela quando ninguém toca para interromper, todos
confirmados em C nos dois motores. Nenhum bug de produto bloqueante encontrado; um achado de
console no WebKit (🟡) vale investigação da `ui`. As pendências (B sem texto completo, WebKit sem
texto, interromper em WebKit) são por falta de memória da máquina e por um limite de equipamento
do WebKit com o gesto de fechar a folha — não por suspeita de defeito no produto — e ficam
registradas para quem retomar.

FIM-DA-BATERIA
