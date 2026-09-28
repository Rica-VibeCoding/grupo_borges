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
