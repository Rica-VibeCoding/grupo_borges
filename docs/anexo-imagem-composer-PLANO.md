# PLANO — anexo de imagem com preview no composer

> Documento de trabalho **autocontido**. Quem executa não precisa da sessão de
> ninguém: tudo que decide está aqui. `tropa_task` **5c9cca2c**.
> Escrito em 05/08/2026 pelo Pavan, com a doc citada em cada decisão.

## 1. O que o Rica pediu

Palavras dele, por áudio em 05/08 00:35:

> "Está muito feia, aparece um código mostrando que tem uma imagem, isso é
> prática péssima. (…) A imagem tem que parar no chat, eu poder escrever alguma
> coisa, depois num botão que eu possa enviar. E aí depois de enviada ela sobe e
> aparece a imagem."

O "código" que ele vê é o **caminho absoluto do arquivo** aparecendo como texto
cru no feed — hoje é assim que o anexo se manifesta pra ele.

**Referências visuais** (commit `387e451`, capturas do ChatGPT):

- `docs/cockpit-design-reference/anexo-01-composer-com-miniatura.png` — antes de enviar
- `docs/cockpit-design-reference/anexo-02-feed-apos-envio.png` — depois de enviar

Não copiar pixel. Extrair o comportamento e traduzir para `docs/cockpit-v2-estetica.md`.

## 2. O que JÁ EXISTE — não construir de novo

Levantado no código em 05/08, antes de planejar. **A legenda já funciona ponta a
ponta** e ninguém precisa tocar no backend:

- `lib/anexo.ts:275,284-285` — `enviaAnexo(slug, arquivo, caption)` já recebe a
  legenda e faz `fd.append('caption', legenda)`.
- `apps/api/routers/agents.py:2747` — a rota `POST /{slug}/file` já declara
  `caption: str | None = Form(default=None)`.
- `agents.py:2446-2465` (`_agent_file_message`) — já concatena
  `\nCaption: <texto>` ao envelope.

**O composer já passa o texto digitado como caption.** O que o Rica não vê é
isso acontecendo, porque o upload dispara no instante em que ele escolhe o
arquivo — não há momento em que a imagem "para" e ele possa escrever.

> Consequência para o escopo: **isto é trabalho de front, quase inteiro.** A
> preocupação que eu tinha levantado com o Rica — "juntar legenda e imagem mexe
> no formato do envelope" — **está resolvida e não é mais risco**. O contrato de
> `agents.py:2450` (path SEMPRE em linha própria, senão o CC auto-anexa e
> consome o texto) continua valendo e continua respeitado, porque a legenda
> entra numa linha `Caption:` separada.

## 3. O que muda de verdade — três frentes

### Frente A — o anexo para de subir sozinho

Hoje `usa-anexo.ts:103-113` sobe assim que o arquivo é escolhido, com quatro
fases (`ocioso | enviando | erro | sucesso`). O arquivo precisa ficar **retido**
em estado local até o usuário despachar.

A máquina do anexo ganha uma fase anterior ao `enviando` — arquivo escolhido,
validado, com preview, ainda **não** enviado. A validação de
`lib/anexo.ts:179` (`validaAnexo`) roda **na escolha**, não no envio: recusar um
`.mov` de 292 MB depois que o usuário escreveu a legenda é desrespeito.

O despacho passa a ser o **mesmo botão de enviar do texto**. Não existe botão
separado — é o que a referência mostra e é o que evita duas noções de "enviar"
na mesma tela.

### Frente B — a miniatura no composer

Estado 1 da referência: a miniatura vive **dentro** do composer, acima do campo
de texto, alinhada à esquerda, com respiro. Quadrada, cantos bem arredondados,
borda um degrau mais clara que o fundo. **O composer cresce em altura** — a
miniatura não flutua nem sobrepõe. A barra de ações (`+` / modelo / microfone /
enviar) segue no rodapé, inalterada.

**Medidas das capturas** (Daniel, 05/08 — as duas têm viewport diferente, 913px
e 1279px, mas a **coluna de conteúdo é a mesma nas duas, ~767px**, então os
números são comparáveis; medido na imagem, erro de ~3px):

- miniatura no composer: **~146px** quadrada, radius **~16px** → 19% da coluna
- imagem no feed: **~254px** → 33% da coluna, e **1,74×** a miniatura

São **dados**, não decisão — a proporção é o que vale, e o valor final se fecha
contra `cockpit-v2-estetica.md`.

### Frente C — a imagem no feed

Estado 2 da referência: a imagem sobe **alinhada à direita**, maior que a
miniatura, cantos arredondados e **sem moldura de bolha** — a própria imagem é o
cartão. Hoje o feed recebe o envelope como texto e não sabe que aquilo é imagem;
precisa reconhecer o padrão e renderizar, escondendo o caminho.

> ⚠️ **A referência 02 não responde a pergunta central desta frente.** Nela a
> imagem subiu **sozinha** — o texto à esquerda ("Analisando imagem
> selecionada") é resposta do assistente, não legenda do Rica. Então a captura
> **não mostra** como imagem e legenda convivem quando sobem juntas: o texto
> fica dentro do mesmo cartão, embaixo da imagem, ou vira bolha separada? Isso
> muda o **renderer**, não só o CSS. Está na seção 7.

## 4. Doc consultada — o que sustenta cada decisão

Stack real, conferida em `apps/cockpit/package.json`: **Next 16.2.6, React
19.2.6, Tailwind 4.3.0** (`@tailwindcss/postcss`), TypeScript 5.7.3, radix-ui
1.6.7, `@tanstack/react-virtual` 3.14.9. **Nenhuma lib de animação** — CSS puro.

**Preview local e liberação de memória.** React 19 permite que o callback de
`ref` **retorne uma função de cleanup**, chamada quando o ref se solta
(react.dev, `reference/react-dom/components/common`: *"The returned function
will be called when the ref is detached"*). É o lugar documentado para revogar o
objectURL: preso ao nó, não a um efeito que pode rodar em ordem diferente. A doc
avisa ainda que, sem retornar cleanup, o React chama o callback com `null` — e
que esse comportamento retrocompatível **será removido** numa versão futura.

**Entrada e saída da miniatura, sem lib.** Tailwind 4 expõe o variant
`starting:` (`@starting-style`) e `transition-discrete`
(`transition-behavior: allow-discrete`), documentados em
`docs/transition-behavior` e no post da v4. **Atenção, e isto já custou tempo
nesta base:** `@starting-style` cobre elemento que **aparece**, não elemento
**removido do DOM** — a saída precisa de caminho próprio (manter montado durante
a transição, ou aceitar sumiço seco). Ver a memória
`reference_starting_style_saida_dom`.

**Movimento reduzido.** Tailwind 4 expõe `motion-reduce:` / `motion-safe:`
(mesma página de variants). Obrigatório na animação da miniatura.

**Imagem de dimensão desconhecida no feed.** Doc do `next/image` (Next 16):
`width`/`height` são obrigatórios **exceto** em import estático ou com `fill`, e
*"if unknown, `fill` is recommended"*. Com `fill`, passar `width`/`height` junto
**lança erro**, e o componente aplica `position:absolute` + 100% — exige
container posicionado com dimensão própria. Com `unoptimized`, o Next devolve o
`src` cru sem passar pelo loader nem validar hostname.

**A imagem vem de rota própria, não de `/public`.** O upload é servido pelo
backend. Quando `next/image` carrega URL local, ela passa pelo roteador interno
(`fetchInternalImage`), que valida corpo não-vazio e teto de **50 MB**
(`ImageError(413)` acima disso). Nosso teto de imagem é 10 MB
(`agents.py:_IMAGE_MAX_BYTES`), então folgado — mas **não existe rota que sirva
o upload de volta**: hoje o arquivo só é escrito em
`apps/api/uploads/agents/<slug>/`. **Criar essa rota é pré-requisito da Frente
C** e é o único trabalho de backend do plano.

## 4-A. HEIC do iPhone — o achado que muda o escopo

Levantado em 05/08 na doc do WebKit e da MDN. **É o maior risco do plano e já
tem decisão tomada.**

Três fatos, todos contra nós:

1. A transcodificação HEIC→JPEG guiada pelo `accept` existe, mas está
   documentada **só para macOS** — os bugs que a implementaram
   ([212489](https://bugs.webkit.org/show_bug.cgi?id=212489),
   [213347](https://bugs.webkit.org/show_bug.cgi?id=213347)) têm `[macOS]` no
   título e guarda `#if PLATFORM(MAC)` no código. **Não há nenhuma doc oficial
   descrevendo o que o iOS entrega** ao escolher foto HEIC da biblioteca.
2. O suporte a HEIC anunciado no Safari 17 é de **exibição**, não de conversão
   no upload ([webkit.org/blog/14445](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)).
3. As notas do **Safari 27 beta** registram como *correção*: *"Fixed HEIC images
   were incorrectly converted to JPEG when uploaded via drag-and-drop or file
   input."* ([webkit.org/blog/17967](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)).
   Ou seja: o WebKit está **removendo** a conversão.

E o `accept` não salva ninguém — MDN é literal: *"The `accept` attribute doesn't
validate the types of the selected files; it provides hints… you should make
sure that the `accept` attribute is backed up by appropriate server-side
validation."*

### O valor do `accept` importa MUITO — e o nosso está errado hoje

A regra do WebKit (bug 212489) é transcodificar quando o `accept` inclui *"at
least one MIME type which CG supports encoding to"* — CoreGraphics. **`image/*`
não é MIME concreto e não dispara nada.** Matriz testada com HEIC real
([kou_pg_0131](https://zenn.dev/kou_pg_0131/articles/safari-input-file-heic)):

- macOS, `accept=""` ou **`image/*`** → **continua HEIC**
- macOS, `accept="image/heic"` → continua HEIC
- macOS, `accept="image/jpeg"` → JPEG · `"image/png"` → PNG
- macOS, `accept="image/jpeg,image/png,image/gif"` → JPEG (**o primeiro
  convertível vence**)
- iOS, qualquer `accept` testado → JPEG (e igual em Chrome/Firefox/Edge no iOS,
  todos WebKit)

**`lib/anexo.ts:95` usa hoje `image: 'image/*'`** — o único valor que garante
HEIC voltando no Mac. É bug latente **vivo agora**, não hipótese futura.

Pior: `accept="image/*,image/heic"` faz o Safari 17+ agir ao contrário — pega um
JPEG de verdade e devolve `.heic`
([Apple 743049](https://developer.apple.com/forums/thread/743049)). **Nunca pôr
`image/heic` no `accept`.**

**E mesmo com o `accept` certo, HEIC continua chegando:** o caminho
"Explorar/Arquivos" (iCloud Drive, Dropbox) **não passa** pela conversão do
Photos. Some a isso o modo de falha clássico — HEIC de verdade com extensão
`.jpg` ([Esri #184](https://github.com/Esri/data-collection-ios/issues/184)).

Hoje `_IMAGE_ALLOWED_MIMES` aceita só `image/jpeg`, `image/png`, `image/webp`.
Chegando `image/heic`, o anexo é **recusado** — e o Rica manda foto do iPhone o
tempo todo.

**DECISÃO: aceitar HEIC no backend e normalizar na gravação.** Não é
preferência, é a única opção que não depende do que a Apple resolver fazer na
próxima versão. Recusar com mensagem bonita continua sendo o Rica sem conseguir
anexar foto.

Viabilidade **conferida, não suposta**: `pillow-heif` 1.5.0 publica wheel
binária `cp312 manylinux_2_28 x86_64` — instala sem compilar nesta VPS. O
Pillow 12.3.0 que já está no `.venv` **não** registra `.heic`/`.heif` (só
`.avif`), então o plugin é necessário.

A conversão entra **no mesmo ponto** onde a orientação EXIF já é normalizada, e
o resultado gravado é JPEG — o resto do sistema não fica sabendo que HEIC
existiu.

## 5. Etapas

Uma etapa, um commit. Não misturar.

0. **HEIC — as três camadas, e nenhuma sozinha basta.**
   - ~~**`accept`:** trocar `image/*` por `image/jpeg,image/png`~~ —
     **REVOGADO em 05/08, e a razão importa.** O `image/*` **fica**. A MDN
     amarra o wildcard à câmera na mesma frase — *"Many mobile devices also let
     the user take a picture with the camera when this is used"* — e **não
     documenta** o que acontece com lista de mimes concretos. O ganho da troca
     era converter no cliente, e a camada 2 tornou isso dispensável; o risco era
     perder a câmera do Rica, que é o uso real dele. Trocar seria pagar o certo
     pelo incerto. (Divergência do Daniel, com fonte, e ele estava certo.)
     **Nunca** `image/heic` no `accept` — isso continua valendo.
   - **O que a camada 1 virou:** o front parava de recusar HEIC **antes de
     subir**. A validação do cliente rodava primeiro e barrava a foto sem o
     backend ter chance de converter — sem isso, as camadas 2 e 3 nunca eram
     alcançadas.
   - **Backend aceita e converte:** `pillow-heif` na dependência, `image/heic` e
     `image/heif` em `_IMAGE_ALLOWED_MIMES`, conversão para JPEG na gravação
     junto do `exif_transpose` (preservando `icc_profile` — foto de iPhone é
     Display P3).
   - **Validar por magic bytes, não por `file.type` nem extensão** — e
     **`ftyp` sozinho NÃO serve de assinatura de imagem**: HEIC e MP4 dividem o
     mesmo box ISO-BMFF no offset 4, tanto que `_MOVIE_LEADING_BOXES` já usa
     `data[4:8] == b"ftyp"` pra reconhecer **vídeo**. Sniffar só isso mandaria
     todo vídeo pela porta da imagem, pro Pillow, gravado com extensão errada. O
     que separa os dois é a **brand no offset 8**, e a lista boa é a de
     `pillow_heif.misc.get_file_mimetype` — que é quem o `is_supported` da
     própria lib consulta. Precedente de sniff no arquivo: `agents.py:2314`
     (PNG). (Risco que o plano não tinha; achado do Daniel.)

   Teste com HEIC de verdade. É a **etapa 0** porque sem ela as outras entregam
   uma tela bonita que recusa a foto dele.
1. ~~**Rota de leitura do upload.**~~ — **NO AR em 05/08 (`3c5bcef`)**,
   `GET /{slug}/file/{filename}`, dev e produção. Três coisas que a etapa
   decidiu e que valem para quem seguir:
   - **A tabela de content-type é FECHADA**, derivada das três tabelas de
     escrita — o que a `POST` grava é o que a `GET` serve. Com `media_type=None`
     o Starlette cai em `guess_type`, que **adivinha**, e adivinhar `text/html`
     sob o domínio do cockpit é script rodando com a origem dele. Extensão fora
     da tabela é 404.
   - **`inline` + `nosniff`**, porque o destino é um `<img>`; o default do
     Starlette é `attachment`. Seguro porque a tabela não tem `text/html` nem
     `image/svg+xml`.
   - **`Cache-Control: private, max-age=31536000, immutable`** — o nome é
     `timestamp-uuid` e nunca é reescrito. Sem isso o feed virtualizado revalida
     a mesma foto a cada vez que o item volta à tela. **Fica** (aval do Pavan).

   **Armadilha de teste, achada provando:** travessia com `%2F` volta 404 do
   **roteador**, não da guarda — `{filename}` sem `:path` não casa segmento com
   barra, então a requisição nem chega na função. Quem exercita a guarda de fato
   é o teste de **symlink** apontando pra fora (exige 400). Só o teste de `../`
   deixaria uma guarda não exercitada passando por testada.
2. **Retenção do arquivo — e a porta precisa saber que existe anexo.** Nova fase
   na máquina do anexo: escolhido e validado, ainda não enviado. `validaAnexo`
   passa a rodar na escolha. Testes em `lib/*.test.ts` (padrão do repo: lógica
   pura em `.ts` com `.test.ts` ao lado — **não existe teste de componente**).

   **Junto, e não na etapa 4:** `abrePorta` hoje recusa texto vazio com
   `recado: null` — a única recusa muda do módulo, e muda **de propósito**,
   porque campo vazio não é gesto e não há o que preservar nem explicar. Com
   anexo retido isso **inverte**: o Rica anexa a foto, não escreve nada, toca
   enviar, e cai justamente na recusa que não fala. É o defeito de 05/08 com
   roupa nova, nascido da própria invariante que o consertou. Como é **mudança
   de assinatura** do módulo, entra aqui — deixar para a etapa 4 faz a etapa 2
   sair já quebrada. (Achado do Daniel na leitura, antes de escrever qualquer
   linha.)
3. **Miniatura no composer.** Preview por `URL.createObjectURL`, revogado no
   cleanup do callback de `ref`. Botão de remover **sempre visível** — sem
   `:hover`, que não existe no iPhone — com alvo de toque `--ck-touch-min`.
   Entrada com `starting:` + `motion-reduce:`.
4. **Despacho conjunto, e o anexo passa a entrar pela porta.** O botão de enviar
   manda arquivo + legenda. Respeitar a invariante de `porta-de-envio.ts`
   (commit `d6b1a46`): **nada evapora** — se o envio falhar, a miniatura e o
   texto continuam lá.

   **Escolha explícita, não efeito colateral:** hoje o anexo **não passa pela
   porta** — só há duas chamadas de `preparaEnvio` no composer (linhas 208 e
   260, texto e voz). Consequência real: anexo durante `/compact` sobe e **corta
   o resumo ao meio**, que é exatamente o que a porta impede para o texto; e
   anexo com envio em voo passa por cima. Esta etapa unifica os três caminhos na
   mesma porta **de propósito**, e é isso que fecha o buraco — não é
   consequência acidental de mexer no botão.
5. **Renderização no feed.** Reconhecer o envelope e mostrar a imagem no lugar do
   caminho. Alinhada à direita, sem moldura. `next/image` com `fill` em container
   com proporção, ou `<img>` — decidir medindo dentro do virtualizador, que é
   onde altura errada estraga o scroll (ver `reference_tanstack_estimatesize_measureelement`).

   **Insumo que a etapa 1 deixou** (não é decisão, é dado): a rota já serve com
   content-type explícito e `immutable`, então o loader do `next/image`
   reprocessaria uma imagem que já está do tamanho certo. Se a escolha for
   `next/image`, `unoptimized` é a opção honesta — com ela a doc diz que o src
   sai cru, sem validação de hostname.

## 6. Régua de pronto

- O Rica anexa uma foto, ela **para** no composer, ele escreve, manda num toque,
  e a imagem aparece **renderizada** no feed. Nenhum caminho de arquivo visível.
- Percorrido **na tela**, no dev (3009) e na produção (3008) depois do build — não
  por `curl`, não por teste só. Ver `feedback_pronto_exige_caminho_completo`.
- Nada evapora em nenhum caminho: falha de upload, falha de envio, recusa por
  tamanho. Arquivo e legenda continuam onde estavam.
- `node --test` do cockpit e `pytest` da API (com `uv sync --extra dev`, senão a
  suíte se desmonta) passando; `tsc --noEmit` limpo.
- Testado no **iPhone**, que é o uso real — não só no desktop.

## 7. Aberto — decidir, não chutar

Sem fonte no material que eu levantei. Quem executar deve pesquisar ou perguntar,
**não inventar**:

- ~~**Imagem + legenda no feed: um cartão ou dois?**~~ — **DECIDIDO (Pavan,
  05/08): um cartão só, imagem em cima e legenda embaixo.** A referência 02 não
  responde porque nela a imagem subiu sozinha, então a decisão é minha e não do
  executor. Razão: é **um gesto só** do Rica — ele anexou e escreveu numa
  tacada, e o backend manda os dois num envelope único
  (`_agent_file_message` concatena `Caption:`). Duas bolhas contariam ao olho
  uma história que o sistema não viveu, e o feed passaria a sugerir duas
  mensagens onde houve uma. Se a legenda vier vazia, o cartão é só a imagem.
  Cuidado de implementação vindo do Messenger: `min-width: 0` nos filhos flex,
  senão o cartão não encolhe.
- **Gap e padding** da miniatura dentro do composer. O tamanho e o radius já
  estão medidos (§3, Frente B); o respiro em volta não.
- **Duração e curva** do movimento. A regra da casa é movimento curto; sem
  número publicado, não chutar valor "que parece bom".
- **Mais de uma imagem** por mensagem. A referência mostra uma. Fora do escopo até
  o Rica pedir.
- ~~**HEIC do iPhone**~~ — **resolvido, virou decisão: ver §4-A.** Aceitar e
  converter no backend.
- **Nome genérico `image.jpg`** que o iOS dá a foto de câmera: com várias fotos
  ele não distingue qual é qual. Já conhecido, nunca registrado.
- **Progresso do upload** e o que aparece enquanto sobe.

## 8. Regras que a doc já cravou — não redecidir

Levantado em 05/08 na MDN e na W3C/WAI. Quem executar **não precisa pesquisar de
novo** e **não deve divergir** sem trazer fonte melhor.

- **Preview por `URL.createObjectURL`, e revogar tarde.** MDN: *"As long as
  there's one object URL active, the underlying object cannot be
  garbage-collected and may cause memory leaks"*; e revogar assim que a imagem
  renderiza **quebra o uso** (salvar, abrir em nova aba) — *"you should revoke
  object URLs only when the resource is no longer accessible by the user (such
  as when the image is removed from the DOM)"*. Casa com o cleanup do callback
  de `ref` do React 19 (§4). `revokeObjectURL` em URL já revogada **não faz
  nada**, então chamada dupla é inofensiva.
- **Nunca `display: none` no `<input type="file">`.** MDN, na página do próprio
  elemento: *"`opacity` is used to hide the file input instead of
  `visibility: hidden` or `display: none`, because assistive technology
  interprets the latter two styles to mean the file input isn't interactive"*, e
  o `<label>` deixa de ser acionável por teclado. (A MDN se **contradiz** entre
  páginas — o guia de exemplos usa `display:none`. Vale a página de referência,
  não o guia.)
- **`accept` é dica, não contrato** — MDN manda respaldar com validação de
  servidor. É a mesma razão da §4-A.
- **Saída animada não remove o nó.** O caminho documentado mantém o elemento na
  árvore e transiciona `display` ou `content-visibility` com
  `transition-behavior: allow-discrete`, que segura o valor visível por 100% da
  duração. Para nó **efetivamente removido** da árvore, a MDN **não documenta**
  caminho em CSS puro — então a saída da miniatura mantém o nó montado durante a
  transição.
- **Alvo de toque:** WCAG 2.2 **SC 2.5.8 (AA) = 24×24 CSS px**; **SC 2.5.5
  (AAA) = 44×44**. E controle revelado por hover cai no **SC 1.4.13**, que exige
  ser descartável, apontável e persistente — mais SC 2.1.1 (acionável por
  teclado). Some com o fato de o iPhone não ter hover: **o botão de remover é
  sempre visível.**
- **`prefers-reduced-motion`: substituir, não necessariamente zerar.** MDN fala
  em *"removes, reduces, or replaces motion-based animations"* e o exemplo
  oficial troca escala por opacidade — *"tone down the animation to avoid
  vestibular motion triggers"*. Fade de opacidade é o substituto documentado.

## 9. O que a comunidade cravou — números e armadilhas com fonte

Levantado em 05/08 em código de projetos reais e em issues, não em tutorial.

**Números de referência** (nossa captura do ChatGPT dá 146px de miniatura; os
projetos abertos usam bem menos):

- [`vercel/ai-elements`](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/attachments.tsx):
  grade que quebra linha, miniatura **96px**, gap **8px**, botão remover **24px**
  a **8px** do canto, ícone **12px**.
- [`ibelick/zola`](https://github.com/ibelick/zola/blob/main/app/components/chat-input/file-items.tsx):
  faixa horizontal rolável **acima** do textarea, cartão **180px**, radius
  `2xl`, miniatura **40px**, remover **24px** com anel de 3px.
- `assistant-ui`: miniatura **40px**.

> Para o iPhone, 96px+ come altura do composer; a faixa de 40–56px é mais
> honesta em mobile-first. Decidir contra `cockpit-v2-estetica.md`.

**Botão de remover.** Consenso claro, e **nenhuma fonte** defende long-press ou
swipe. GitLab #7842: *"If it's a touch device, the button should always be
visible"*. **A armadilha está no código de referência**: o `ai-elements` esconde
o X com `opacity-0 group-hover:opacity-100` — no iPhone **nunca aparece**.
LibreChat [#13712](https://github.com/danny-avila/LibreChat/pull/13712) trocou
breakpoint de largura por **`@media (hover: hover)`**, porque tablet passa do
`md` e não tem hover. **Usar a media query de hover, nunca largura.** Alvo:
24px de pintura, **44px de área** via padding (WCAG 2.5.5 / Apple HIG). E
blindar o X contra foto clara — anel na cor do fundo ou `backdrop-blur`.

**Movimento.** Material 3: short1 50 · short2 100 · short3 150 · short4 200ms.
NN/g: *"the duration of most animations should be in the range of 100–500 ms"*,
e *"at 500ms, animations start to feel like a real drag"*. Zola usa **200ms sem
repique**; prompt-kit usa 150ms. **Convergência: 150–250ms**, entrada
`ease-out`, saída `ease-in`, nunca linear. A partir de 400ms já é lento.
Em `prefers-reduced-motion`, colapsar para **0.01ms e não zero** — zero mata o
`transitionend`.

**Antipadrões que já estão no nosso caminho:**

- **`createObjectURL` dentro do render.** Vaza blob a cada re-render e faz a
  imagem piscar, porque o cache não sabe que as duas URLs são a mesma imagem
  ([jonathanleemartin.com](https://jonathanleemartin.com/blog/dont-over-react/)).
  O Zola comete isso hoje, duas vezes por item. O certo é criar no `add`,
  revogar no `remove`/`clear`/desmonte — e **nunca revogar antes do `load`**.
- **Fonte < 16px no campo focado** dá zoom no iOS. O nosso já usa 16px
  (`composer.tsx:342`), mas a pegadinha é que **16px dentro de
  `transform: scale(0.9)` renderiza 14,4px e zooma igual**. Consertar com
  `user-scalable=no` viola WCAG 2.1 — não fazer.
- **Layout shift:** `width`/`height` (ou `aspect-ratio`) na miniatura, senão o
  navegador reserva 0×0. **Agravante no iPhone:** a faixa crescendo com o teclado
  aberto briga com o viewport visual; mitigações citadas são `dvh`,
  `visualViewport` e `interactiveWidget: 'resizes-content'`.
- **`alt` da imagem:** sem `alt` o leitor lê o nome do arquivo; com `alt=""` ele
  pula a imagem inteira. Os dois projetos usam o nome do arquivo com fallback.
- **Nome genérico:** o iOS batiza toda foto de `image.jpg` e várias se
  sobrescrevem ([enketo-express #374](https://github.com/kobotoolbox/enketo-express/issues/374)).
  Renomear antes de subir.
- **Não esconder as restrições até o toque** (limite de tamanho e formato
  visíveis antes) — [uxpatterns.dev](https://uxpatterns.dev/patterns/media/image-upload).

**Colar e arrastar** são baratos e valem: varrer `clipboardData.items`, filtrar
`kind === "file"`. Ressalva real: copiar imagem **de dentro do Safari** põe a
URL na área de transferência, não os bytes
([Apple 693560](https://developer.apple.com/forums/thread/693560)). No iPhone é
irrelevante — é acabamento de desktop.

**Se alguém pensar em converter HEIC no cliente:** não. O canvas do iOS Safari
tem teto de área (16.777.216 px antes do iOS 18) e foto de iPhone moderno
estoura. A conversão é no servidor, §4-A.
