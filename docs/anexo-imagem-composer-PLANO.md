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

### Frente C — a imagem no feed

Estado 2 da referência: a imagem sobe **alinhada à direita**, maior que a
miniatura, cantos arredondados e **sem moldura de bolha** — a própria imagem é o
cartão. Hoje o feed recebe o envelope como texto e não sabe que aquilo é imagem;
precisa reconhecer o padrão e renderizar, escondendo o caminho.

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

## 5. Etapas

Uma etapa, um commit. Não misturar.

1. **Rota de leitura do upload.** `GET` que serve `apps/api/uploads/agents/<slug>/<arquivo>`
   com content-type correto. Path traversal barrado (o nome já é sanitizado na
   escrita por `_sanitize_upload_filename`, mas a leitura precisa da sua própria
   guarda). Teste que tenta escapar do diretório e falha.
2. **Retenção do arquivo.** Nova fase na máquina do anexo: escolhido e validado,
   ainda não enviado. `validaAnexo` passa a rodar na escolha. Testes em
   `lib/*.test.ts` (padrão do repo: lógica pura em `.ts` com `.test.ts` ao lado —
   **não existe teste de componente neste app**).
3. **Miniatura no composer.** Preview por `URL.createObjectURL`, revogado no
   cleanup do callback de `ref`. Botão de remover **sempre visível** — sem
   `:hover`, que não existe no iPhone — com alvo de toque `--ck-touch-min`.
   Entrada com `starting:` + `motion-reduce:`.
4. **Despacho conjunto.** O botão de enviar manda arquivo + legenda. Respeitar a
   invariante de `porta-de-envio.ts` (commit `d6b1a46`): **nada evapora** — se o
   envio falhar, a miniatura e o texto continuam lá.
5. **Renderização no feed.** Reconhecer o envelope e mostrar a imagem no lugar do
   caminho. Alinhada à direita, sem moldura. `next/image` com `fill` em container
   com proporção, ou `<img>` — decidir medindo dentro do virtualizador, que é
   onde altura errada estraga o scroll (ver `reference_tanstack_estimatesize_measureelement`).

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

- **Números concretos** de tamanho da miniatura, radius e gap. A referência é uma
  captura; medir nela e casar com `cockpit-v2-estetica.md`.
- **Duração e curva** do movimento. A regra da casa é movimento curto; sem
  número publicado, não chutar valor "que parece bom".
- **Mais de uma imagem** por mensagem. A referência mostra uma. Fora do escopo até
  o Rica pedir.
- **HEIC do iPhone.** `_IMAGE_ALLOWED_MIMES` aceita só jpeg/png/webp. Se o iOS
  entregar HEIC, a recusa tem que ser legível — hoje não sabemos o que ele
  entrega e ninguém mediu.
- **Nome genérico `image.jpg`** que o iOS dá a foto de câmera: com várias fotos
  ele não distingue qual é qual. Já conhecido, nunca registrado.
- **Progresso do upload** e o que aparece enquanto sobe.

> **Lacuna honesta deste documento:** o Rica pediu pesquisa de **comunidade**
> (padrões reais, armadilhas de iOS, números de produtos de referência) além da
> doc oficial. Os dois subagentes que eu tinha em campo foram interrompidos, e
> **só a parte de documentação oficial está coberta aqui**. O item 7 é
> exatamente o buraco que aquela pesquisa fecharia.
