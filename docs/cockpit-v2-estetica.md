# Contrato de estética — Cockpit v2

> **Dono:** Daniel. **Ownership por caminho:** este arquivo + a metade "pele" dos tokens.
> O esqueleto (medida, densidade, área de toque, ritmo de espaçamento, escada de container query) é do Pavan e vive em `TOKENS.md` / `globals.css` congelado — aqui **não** se redefine medida.
> **Gate:** estético, juiz único é o Rica, veredito binário (`docs/cockpit-v2-playbook.md` §9).
> Aprovado com emenda em 30/07/2026: estrutura de tokens, hierarquia de superfícies e piso de contraste vêm do congelado; **os valores de cor são deste documento**.

## 0. Como consumir este contrato

As sessões paralelas (Daniel ×N, Tara, Hiro) **consomem, não reescrevem**. Regra de ouro para o executor:

- Precisa de uma cor? Usa um token daqui. **Hex cru em componente reprova review.**
- Precisa de uma medida? Vai no esqueleto, não aqui.
- O token que você precisa não existe? **Pede.** Inventar token é criar um segundo sistema.

A razão de existir: três Daniels sem contrato produzem três estilos (`playbook` §9, última linha).

## 1. A tese — por que isto não é um clone do ChatGPT

O baseline mediu o que a tela realmente é: **82% dos blocos são `tool_use`/`tool_result`** — 1.500 + 1.499, contra 330 de texto e 804 de thinking; 23 ferramentas distintas, 24 formas de resultado, Bash com 738 chamadas (`fixtures/cockpit-v2/README.md`).

Isso muda o objeto de design. **Não estamos desenhando um chat; estamos desenhando um log de execução que às vezes conversa.** Quem clona a bolha do ChatGPT está polindo os 18%.

Consequência direta: o "amei" do Rica não vai nascer da bolha de mensagem. Vai nascer de **como a execução se apresenta** — a ferramenta rodando, o diff chegando, o raciocínio abrindo, a falha acontecendo. É aí que vai o esforço.

Três decisões de autoria sustentam isso:

1. **Luz em vez de sombra.** Em fundo escuro, sombra não existe (preto sobre preto). O que dá profundidade é emissão: mais claro = mais perto. Toda a hierarquia é luminância, mais um fio de luz de 1px no topo de cada superfície elevada — material recebendo luz de cima. Zero `box-shadow` com blur no feed.
2. **A neutra tem temperatura.** Cinza neutro perfeito (`#212121`) é a assinatura do ChatGPT: quem vê, reconhece. A nossa neutra carrega um traço frio de azul-violeta (croma 0.008–0.012 em OKLCH, matiz 265) — invisível como "cor", decisivo como identidade, e faz a luz dos estados ler como emissão real.
3. **Temperatura sobe conforme a máquina precisa de você.** A paleta de estado não é decorativa, é um ciclo de vida: frio quando a máquina trabalha sozinha, quente quando ela precisa de um humano. Violeta (pensando) → ciano (executando) → **âmbar (te espera)** → verde (feito) / coral (falhou). O único estado quente é o único que chama o Rica.

## 2. Tokens de pele — valores

Espaço OKLCH, matiz base **265**. Todos os valores abaixo foram **verificados por cálculo** (§3), não estimados.

### 2.1 Superfícies — a escada de luz

Ordem de elevação fixada pelo esqueleto: `app < nav < composer < mensagem elevada`. Em fundo escuro, subir na hierarquia é **clarear**.

| Token | OKLCH | sRGB | Onde |
|---|---|---|---|
| `--ck-surface-canvas` | `oklch(0.215 0.008 265)` | `#18191d` | palco do chat — onde o texto longo vive |
| `--ck-surface-nav` | `oklch(0.250 0.010 265)` | `#1f2227` | coluna da tropa, gaveta, chrome |
| `--ck-surface-composer` | `oklch(0.285 0.011 265)` | `#272a30` | composer, campos, popover |
| `--ck-surface-raised` | `oklch(0.315 0.012 265)` | `#2f3238` | mensagem elevada, tool group aberto, overlay |

Não é preto puro de propósito: `#000` em OLED de celular causa arraste (*smearing*) na rolagem e endurece a leitura de texto longo.

### 2.2 Texto

| Token | OKLCH | sRGB | Contraste (pior caso) | Uso |
|---|---|---|---|---|
| `--ck-text-primary` | `oklch(0.96 0.004 265)` | `#f0f2f4` | **11.5:1** | corpo, título |
| `--ck-text-secondary` | `oklch(0.76 0.008 265)` | `#aeb1b6` | **6.0:1** | metadado, label, timestamp |
| `--ck-text-tertiary` | `oklch(0.62 0.008 265)` | `#84868b` | **3.55:1** | ⚠️ **nunca corpo** — só ícone, separador, texto ≥ 20px |

`tertiary` não alcança 4.5:1 sobre a superfície elevada. É deliberado e é o limite dele: quem usar `tertiary` em texto pequeno quebra o piso.

### 2.3 Estados — o ciclo de vida da execução

| Token | OKLCH | sRGB | Pior caso | Significa |
|---|---|---|---|---|
| `--ck-state-thinking` | `oklch(0.73 0.14 285)` | `#9f9afc` | 5.2:1 | raciocinando (`thinking`) |
| `--ck-state-running` | `oklch(0.78 0.13 220)` | `#36caf1` | 6.7:1 | ferramenta em execução |
| `--ck-state-attention` | `oklch(0.82 0.14 78)` | `#f6b84d` | 7.3:1 | **espera humano** (permissão, `requires-action`) |
| `--ck-state-ok` | `oklch(0.76 0.13 150)` | `#6fc884` | 6.3:1 | concluído |
| `--ck-state-fail` | `oklch(0.74 0.16 22)` | `#ff7d7c` | 5.2:1 | falhou, cancelado |
| `--ck-focus` | `oklch(0.80 0.13 220)` | `#40d1f7` | 7.2:1 | anel de foco de teclado |

`--ck-state-fail` fica **fora do gamut sRGB** por escolha: em tela display-P3 (o iPhone do Rica) o vermelho existe mais vivo; em sRGB o browser reduz para o gamut. O P3 é ganho, não dependência.

> **Como o browser reduz, de verdade** (verificado pelo Pavan em rota independente, e corrige o que este documento afirmava antes): CSS Color 4 **não** faz clamp por canal — faz *gamut mapping* reduzindo o **croma** e preservando L e H. Os dois caminhos foram calculados: clamp por canal dá **5.21:1**, redução de croma dá **5.23:1**. Passa nos dois, e a medição por clamp usada aqui é a **conservadora** — o real é ligeiramente melhor. Quem revalidar cor fora de gamut pode medir por clamp com segurança: erra para o lado seguro.

### 2.4 Diff

| Token | OKLCH | sRGB | Nota |
|---|---|---|---|
| `--ck-diff-add` | `oklch(0.76 0.14 148)` | `#6dc97d` | 6.3:1 no pior caso |
| `--ck-diff-del` | `oklch(0.74 0.16 22)` | `#ff7d7c` | mesmo valor de `state-fail` — coerência: remoção e falha são o mesmo vermelho |
| `--ck-diff-add-bg` | `color-mix(in oklch, var(--ck-diff-add) 12%, var(--ck-surface-canvas))` | — | fundo de linha, nunca cor cheia |
| `--ck-diff-del-bg` | `color-mix(in oklch, var(--ck-diff-del) 12%, var(--ck-surface-canvas))` | — | idem |

Sinal de menos em estatística de diff é **U+2212 (`−`)**, não hífen — herdado do Codex (`playbook` §6). Com `tabular-nums`.

### 2.5 Bordas e luz

| Token | Valor | Piso | Uso |
|---|---|---|---|
| `--ck-edge-functional` | `oklch(0.60 0.012 265)` → `#7d8088` | **≥ 3:1 obrigatório** | borda de input, botão, controle — qualquer coisa que diga "aqui se interage" |
| `--ck-edge-hairline` | `oklch(0.38 0.010 265)` | sem piso | separador decorativo entre mensagens/linhas |
| `--ck-edge-light` | `rgb(255 255 255 / 0.07)` | sem piso | fio de luz de 1px no **topo** de superfície elevada |

A distinção não é estética, é WCAG 2.1 §1.4.11: o piso de 3:1 vale para **componente de interface e indicador de estado**, não para separador decorativo. Se eu exigisse 3:1 em toda borda, a tela viraria uma grade cinza-claro.

Por que exatamente `L=0.60`, e não menos: `L=0.56` **reprova** (2.78:1 sobre a superfície elevada). `L=0.58` passa, mas por **0.02** (3.02:1) — margem que qualquer arredondamento de renderização come. `L=0.60` dá 3.27:1, que é folga saudável. **Não "otimizar" isso para baixo.**

Aplicação do fio de luz, barata e sem blur:

```css
box-shadow: inset 0 1px 0 0 var(--ck-edge-light);
```

### 2.6 Interação — o mesmo véu de luz, três degraus

Levantado pela auditoria do Kimi (30/07): faltava hover e pressed, e cada executor
escolheria um degrau diferente. A resposta **não** é um par de tokens por superfície
(seriam oito) — é **um véu de branco que compõe sobre qualquer superfície**, coerente
com a decisão de autoria nº 1: interagir é receber mais luz.

| Token | Valor | Δ na superfície | Onde |
|---|---|---|---|
| `--ck-overlay-hover` | `rgb(255 255 255 / 0.03)` | 1.087× | ponteiro em cima — não existe no celular |
| `--ck-overlay-selected` | `rgb(255 255 255 / 0.04)` | 1.134× | item aberto da tropa, aba ativa |
| `--ck-overlay-pressed` | `rgb(255 255 255 / 0.05)` | 1.168× | `:active`, dedo no alvo |

O degrau natural da escada de elevação é 1.09–1.11×, então `hover` fica **abaixo** de
uma elevação e `pressed` fica pouco acima: interagir nunca é confundido com subir de
camada.

**Por que o teto é 0.05, e não mais.** Véu de luz clareia o fundo e, com isso, **derruba
o contraste de tudo que está por cima**. O piso que trava primeiro é o de borda
funcional (3:1). Medido sobre `--ck-surface-composer`:

| α | borda funcional | `state-fail` | `text-secondary` |
|---|---|---|---|
| 0.03 | 3.35 | 5.34 | 6.15 |
| 0.04 | 3.21 | 5.12 | 5.90 |
| 0.05 | **3.12** | 4.97 | 5.72 |
| 0.06 | 3.02 | 4.82 | 5.55 |
| 0.065 | ❌ **2.98** | 4.75 | 5.47 |

`0.06` ainda passa, mas por 0.02 — a mesma margem que reprovei em `--ck-edge-functional`
na §2.5. Fica em **0.05**, com folga de 0.12.

> ⛔ **Véu é proibido sobre `--ck-surface-raised`.** Lá até o `hover` de 0.03 leva a borda
> funcional a **2.98** — reprova. Na superfície elevada quem sinaliza interação é o
> **filete lateral** e o fio de luz ficando mais forte, não o preenchimento. Na prática
> não custa nada: linha de ferramenta colapsada vive no `canvas` e item de tropa vive no
> `nav`; `raised` é bloco expandido, que não é alvo de clique inteiro.

Item **selecionado** carrega, além do véu, uma **barra de 2px à esquerda** em
`--ck-text-primary`. Uma diferença de 1.13× de luminância não sobrevive ao Rica olhando
o celular no sol, e cor sozinha nunca é portadora de significado (§3).

### 2.7 Link, seleção e véu de modal

| Token | Valor | sRGB | Pior caso | Uso |
|---|---|---|---|---|
| `--ck-link` | `oklch(0.82 0.09 250)` | `#97c9fd` | **7.40:1** | URL em saída de ferramenta, caminho clicável |
| `--ck-selection-bg` | `oklch(0.42 0.08 265)` | `#374c79` | — | fundo de `::selection` |
| `--ck-selection-fg` | `var(--ck-text-primary)` | `#f0f2f4` | **7.57:1** | texto selecionado, **forçado** |
| `--ck-scrim` | `rgb(0 0 0 / 0.55)` | — | 1.53× | véu atrás de modal e gaveta no celular |

**Link.** `WebFetch` (255) + `WebSearch` (171) são o segundo maior bloco de ferramentas
do baseline depois do Bash — URL aparece o tempo todo, e sem token o primeiro executor
inventa. Matiz 250 fica a 30° do ciano de `running`/`focus` (220) e a 35° do violeta de
`thinking` (285) — equidistante dos dois estados com que poderia ser confundido. O croma
é **0.09, mais baixo que o de qualquer estado** (0.13–0.16), de propósito: uma URL no meio
do stdout não pode gritar mais alto que uma falha.

Contraste medido em toda a escada: canvas 10.11 · nav 9.18 · composer 8.28 · raised 7.40 ·
composer com `pressed` 7.09. Passa AAA (7:1) em **todas**, que é o piso de corpo — link é
texto de corpo, não abro exceção. Acima de `L=0.82` com esse croma o azul sai do gamut
sRGB, então este é o valor mais saturado que ainda cumpre AAA sem depender de gamut mapping.

> ⛔ **Link é sempre sublinhado.** `text-decoration-thickness: 1.5px`, `text-underline-offset: 2px`.
> Cor não é portadora única (§3), e num log cheio de estado colorido o sublinhado é o que
> diferencia "clicável" de "colorido".

**Seleção.** Log implica copiar trecho, e o azul default do browser destoa. `::selection`
**força os dois lados** — fundo e cor — porque senão selecionar um trecho em `state-fail`
ou `diff-add` produz um par não medido. Forçando, existe **um** par e ele dá 7.57:1.
O realce se destaca 2.07× no canvas e 1.51× no raised — nos dois casos acima do degrau de
elevação (1.11×), então a seleção nunca some.

```css
::selection { background: var(--ck-selection-bg); color: var(--ck-selection-fg); }
```

**Véu.** Preto puro a 55% sobre o canvas dá `#0b0b0d`, e o modal em `raised` se destaca
1.53× do fundo velado — mais do que a escada de elevação inteira (canvas→raised = 1.37×).
Coerente com "luz = perto": o fundo não escurece por sombra, ele **perde luz**.

> ⛔ **Véu não leva `backdrop-filter`.** `blur` em tela cheia na GPU do celular é justamente
> o que afunda o item 1 do gate. Cor chapada, zero blur (§9.2).

## 3. Piso de contraste — não negociável

Emenda do Pavan, e concordo sem ressalva: contraste é acessibilidade, não gosto.

| Alvo | Piso | Norma |
|---|---|---|
| corpo e título | **7:1** | WCAG 2.1 AAA |
| metadado, label | **4.5:1** | AA |
| texto de estado / pill | **4.5:1** | AA |
| borda funcional, indicador de estado | **3:1** | AA §1.4.11 |
| alvo de toque | **44 × 44 px CSS** | iOS HIG |
| `font-size` de campo de entrada | **≥ 16px** | evita zoom automático do iOS |
| foco de teclado | outline 2px + offset 2px, **nunca só cor** | AA §2.4.7 |

Duas regras que fecham o piso:

- **Cor nunca é o único portador de significado.** Todo estado carrega ícone ou texto além da cor — daltonismo, e também o Rica olhando de relance no celular.
- **O pior caso manda.** Contraste se verifica contra `--ck-surface-raised` (a mais clara), porque é onde a margem é menor. Passou lá, passou em todas.
- **Emenda de 30/07, e ela muda a régua:** com a chegada do véu de interação (§2.6), a superfície mais clara que um texto pode pisar deixou de ser `raised` puro e passou a ser **`composer` + `--ck-overlay-pressed`**. Véu de luz clareia o fundo e come contraste de tudo por cima — foi o que fixou o teto do véu em 0.05 e o que proibiu véu sobre `raised`. Quem propuser cor nova mede contra **os dois**: `raised` puro e `composer` + `pressed`.

### Como revalidar (obrigatório ao propor cor nova)

Cole e rode — sem dependência externa:

```python
import math
def lin(L, C, H):
    h = math.radians(H); a, b = C*math.cos(h), C*math.sin(h)
    l_, m_, s_ = L+0.3963377774*a+0.2158037573*b, L-0.1055613458*a-0.0638541728*b, L-0.0894841775*a-1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    return (4.0767416621*l-3.3077115913*m+0.2309699292*s,
            -1.2684380046*l+2.6097574011*m-0.3413193965*s,
            -0.0041960863*l-0.7034186147*m+1.7076147010*s)
def lum(c):
    r, g, b = (min(max(x, 0.0), 1.0) for x in lin(*c))
    return 0.2126*r + 0.7152*g + 0.0722*b
def ratio(fg, bg):
    a, b = sorted((lum(fg), lum(bg)), reverse=True)
    return (a + 0.05) / (b + 0.05)

RAISED = (0.315, 0.012, 265)          # pior caso — sempre medir contra este
print(round(ratio((0.74, 0.16, 22), RAISED), 2))   # state-fail -> 5.21
```

Proposta de cor sem o número calculado **não entra**.

## 4. Tipografia

**Escolha:** `Geist Sans` + `Geist Mono` (ambas variáveis, licença OFL).

| Token | Valor |
|---|---|
| `--ck-font-sans` | `var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif` |
| `--ck-font-mono` | `var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace` |

As duas `--font-geist-*` são as variáveis que o `next/font` publica; quem as declara é o
`layout.tsx`, que é do Pavan. O `globals.css` só consome.

Fundamento, não gosto: o único dado real de produto do Codex é `"Geist Mono", ui-monospace` no app desktop (`playbook` §6, que manda escolher a sans por critério próprio — "Söhne" é atribuição de SEO, não fato). Geist é desenhada para interface de desenvolvedor, tem `tabular-nums` e evita o reflexo de cair em Inter, que é o que todo mundo usa.

### A divisão que importa

> **Mono é a voz da máquina. Sans é a voz do produto.**

- **Mono:** comando, saída, caminho de arquivo, diff, nome de ferramenta, identificador, chip de versão.
- **Sans:** todo o chrome — navegação, label, título, botão, estado vazio, texto do Rica.

Isto **não** é o retorno do tema revogado. O `DECISOES.md` de maio cravava "JetBrains Mono em ≥70% da tela" como estética sci-fi, e o Rica revogou. Aqui mono é 100% do **conteúdo de execução** e 0% do **chrome** — o oposto de uma tela de terminal: o produto parece produto, e o que a máquina fez parece o que a máquina fez.

### Escala

| Passo | Tamanho | Uso |
|---|---|---|
| `--ck-text-xs` | 0.75rem / 12px | overline, badge |
| `--ck-text-sm` | 0.8125rem / 13px | mono de conteúdo, metadado |
| `--ck-text-base` | 0.9375rem / 15px | corpo do chat |
| `--ck-text-md` | 1rem / 16px | **campo de entrada** (piso do iOS) |
| `--ck-text-lg` | 1.25rem / 20px | título de seção |
| `--ck-text-hero` | 1.75rem / 28px | estado vazio, hero |

### Duas exigências técnicas — entram no gate, não são gosto

Impostas pelo Pavan na aprovação da tipografia, e corretas:

1. **Self-host obrigatório, via `next/font/local`.** A fonte **não pode depender de rede externa**: quem serve é a VPS, e o cockpit é acessado pelo tailnet. CDN de fonte é ponto único de falha fora do nosso controle.
2. **Medir o peso servido.** Duas fontes variáveis entregues inteiras afundam o **item 1 do gate** (streaming sem engasgo no celular). Se o par Geist Sans + Geist Mono não couber no orçamento, o corte é nas variações de peso — não na legibilidade.

#### Medido em 30/07, e corrige duas coisas que eu tinha escrito

Baixei o pacote `geist@1.7.2` e pesei os arquivos, em vez de estimar:

- **`subset: 'latin'` não existe para fonte local.** A tabela de referência do `next/font`
  marca `subsets` como ✓ para `font/google` e **✗ para `font/local`** — subsetting é do
  pipeline do Google. Exigir subset numa fonte local era exigência impossível: risquei.
- **Peso real servido: 137,7 KB** — `Geist-Variable.woff2` (68,0 KB) + `GeistMono-Variable.woff2`
  (69,7 KB). O pacote traz 45 woff2 e 2,1 MB no total, mas `geist/font/sans` e `geist/font/mono`
  referenciam **só os dois variáveis**; o resto nunca sai do `node_modules`. Cabe no orçamento
  sem cortar peso nenhum.

**Como declarar, e por que não é o atalho do pacote.** O caminho de uma linha seria importar
`GeistSans`/`GeistMono` do pacote, mas ele fixa os próprios parâmetros — e o default de
`display` no `next/font` é **`swap`**. `swap` renderiza na fonte de sistema e **troca depois**,
e a troca reflui a página inteira. Num log que está streamando isso é exatamente o que o
**item 2 do gate** proíbe ("nada animado pode causar reflow durante o stream"), e o mono, que
é a maior parte da tela, ainda vem com `adjustFontFallback: false` no pacote.

Então: `next/font/local` apontando para os dois `.woff2` (copiados do pacote ou baixados),
com **`display: 'optional'`**. `optional` dá ~100 ms de bloqueio e **nunca troca depois** — num
servidor no tailnet a fonte chega folgada dentro da janela, e o pior caso é uma carga em fonte
de sistema, não um reflow no meio do stream. `weight: '100 900'`, `preload: true`, e as
variáveis `--font-geist-sans` / `--font-geist-mono` para casar com os tokens acima.

### Entrelinha e tracking — agora token, não prosa

Estavam escritos aqui como frase, e frase não se consome: o Pavan já escreveu `0.08em` no
overline da tropa em vez de `0.055em`, corrigido à mão. Remendo não é solução — viram token.

| Token | Valor | Onde |
|---|---|---|
| `--ck-leading-body` | `1.55` | corpo e mono — bloco de código respira |
| `--ck-leading-hero` | `1.2` | hero, estado vazio |
| `--ck-track-hero` | `-0.035em` | hero |
| `--ck-track-title` | `-0.012em` | título de linha |
| `--ck-track-overline` | `0.055em` | overline maiúscula |

Os três trackings vêm do Codex (`playbook` §6). No corpo, tracking é **zero** — não tem token
porque não tem valor a lembrar. `--ck-leading-body` entra no `body`; hoje ele não declara
`line-height` nenhum e herda o `normal` do browser (~1.2), que é 22% mais apertado do que o
contrato manda.

Duas medidas fecham: `--ck-text-sm` (13px) × 1.55 = 20,15px, que é o que faz a linha de
ferramenta colapsada caber nos 28–32px da §7 com o respiro do `--ck-space-1` nos dois lados.
São **duas** entrelinhas, não três, de propósito: um terceiro valor vira escolha, e escolha
vira divergência.

`tabular-nums` obrigatório em: contador de token, tempo decorrido, estatística de diff, quota.
Precisa de veículo — a `--ck-font-mono` já carrega o recurso, mas o `%` de contexto na tropa é
sans e hoje renderiza proporcional, então o número dança a cada atualização. Uma classe
utilitária (`font-variant-numeric: tabular-nums`) resolve para os dois casos.

## 5. Movimento

Duração: **120ms** (resposta a toque) · **200ms** (entrada de elemento) · **320ms** (troca de superfície).
Easing: entrada `cubic-bezier(0.2, 0, 0.2, 1)` · saída `cubic-bezier(0.4, 0, 1, 1)`. **Sem bounce** — ferramenta de trabalho não quica.

Isto aqui é prosa, e prosa não se consome. O mapa para token — **estes cinco vivem na §B, são
do Pavan**, e hoje só existem três:

| Token | Valor | Estado |
|---|---|---|
| `--ck-dur-fast` | `120ms` | ✅ existe |
| `--ck-dur-enter` | `200ms` | ❌ **falta** — micro-momento 2 (ferramenta entrando) |
| `--ck-dur-calm` | `320ms` | ✅ existe |
| `--ck-ease` | `cubic-bezier(0.2, 0, 0.2, 1)` | ✅ existe (entrada) |
| `--ck-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | ❌ **falta** — micro-momento 3 (filete de running sumindo) |

Sem `--ck-dur-enter` o executor escreve `200ms` cru ou usa `calm`, que é 60% mais lento do que
o contrato manda. O pulso do micro-momento 1 (1.8 s, `ease-in-out`, infinito) fica como
`animation` do componente — é um keyframe, não um token de ritmo.

Três regras duras, que existem por causa do gate técnico:

1. **Só `transform` e `opacity`.** Animar `width`/`height`/`top`/`left` reprova — sai do compositor e briga com o streaming.
2. **Nada animado pode causar reflow durante o stream.** Gate item 2: só a mensagem que está streamando muda na tela.
3. **`prefers-reduced-motion: reduce` desliga tudo**, trocando por mudança de opacidade instantânea. Sem exceção.

## 6. Micro-momentos — onde mora o "amei"

Seis momentos. São a entrega estética, não enfeite.

1. **O agente começa a pensar.** Sem spinner. O fio de luz do topo da mensagem **respira**: `opacity` 0.35 → 0.9, 1.8s, `ease-in-out`, infinito, na cor `--ck-state-thinking`. Uma propriedade animável, zero layout, zero `setState` por frame.
2. **Uma ferramenta entra.** A linha colapsada aparece com `opacity` 0→1 e `translateY(2px)→0` em 200ms. Nome da ferramenta em mono. **Altura reservada antes de existir conteúdo** — é o hotspot 6 do débito (expandir empurrando o scroll).
3. **Grupo de ferramentas durante execução.** Filete lateral de 2px em `--ck-state-running` no container; ao concluir, o filete some em 320ms. Auto-expand durante o streaming já vem do `tool-group`.
4. **Uma ferramenta falha.** Nada pisca. A superfície **perde o fio de luz** (fica apagada) e o filete lateral vira `--ck-state-fail`. A metáfora é consistente em todo o sistema: luz = vida.
5. **O agente pede permissão.** O único estado com direito a movimento persistente, porque é o único que chama o Rica: filete `--ck-state-attention` pulsando, linha com peso maior, alvo de toque ≥ 44px e confirmação obrigatória (gate item 10). É também o evento que justifica o Web Push.
6. **A voz entra.** O canvas do orb monta em fade de 320ms; o chat **não desmonta** — recua para `opacity: 0.4`. Ao sair, o canvas é **desmontado**, não escondido (GPU de celular divide memória com a CPU). Orb alimentado por RMS de `getByteTimeDomainData`, desenho dentro do `requestAnimationFrame`, **zero `setState` por frame**.

## 7. A gramática da execução

A peça central, pelos números do baseline. Cada forma tem uma aparência fixa — se dois executores desenharem a mesma coisa diferente, o contrato falhou.

- **Ferramenta colapsada = uma linha.** Altura de 28–32px: ícone, nome em mono, alvo resumido, duração à direita em `tabular-nums`. Com 3.080 eventos numa sessão, card generoso por chamada torna a tela infinita. **Densidade é o que faz parecer profissional; card gordo é mequetrefe.**
- **Expandida = bloco** sobre `--ck-surface-raised`, com fio de luz e filete de estado à esquerda.
- **Ferramentas consecutivas agrupam** (`tool-group`), com contador. Bash domina com 738 chamadas — sem agrupar, o feed é uma parede.
- **`thinking` é colapsável e nasce fechado**, exceto quando é o bloco ativo. 804 ocorrências: aberto por default afoga o resto.
- **Diff usa o `structuredPatch` que já vem pronto** no resultado de `Edit`/`Write` (77 ocorrências) — não calcular diff no cliente. **Unified** por padrão; split só a partir de 64rem de container (o Codex web é unified).
- **Caminho de arquivo trunca o diretório e preserva o nome inteiro** (§6 do playbook).
- **Erro de ferramenta não é modal.** Fica na linha, expansível.

### 7.1 Syntax highlighting: não vai ter. E o que vai no lugar

Decisão explícita, porque "não decidido" é o que faz cada renderer inventar o seu.

**Não entra highlighter de linguagem no v2.** Os números do baseline não sustentam o custo:
de 3.080 eventos, **1.417 são shell e saída de shell** (Bash 738 + o resultado
`stderr_stdout` 679) — texto plano, sem gramática a colorir. Código-fonte de verdade aparece
em Read/Write/Edit (160), diff (40) e SQL (50): **cerca de 250 eventos, 8% da tela.** Um
tokenizador por linguagem custa bundle e reflui enquanto o bloco cresce durante o stream —
os itens 1 e 2 do gate — para pintar 8%.

E há um erro de foco embutido na pergunta: **o que um log de execução precisa distinguir não
é `if` de `for`, é `stderr` de `stdout`.** Nenhum highlighter faz isso.

Então o bloco de código é mono de uma cor só, e a informação vem da estrutura — **zero token
novo**:

- **stdout e stderr, os dois em `--ck-text-primary`.** Dimear stderr seria errado: quando um
  build falha, o texto mais importante da tela está nele. O que separa os canais é um rótulo
  em mono `stderr` em `--ck-text-secondary` e um filete em `--ck-edge-functional`.
- **Canal ≠ desfecho.** Escrever em stderr não é falhar — muita ferramenta manda progresso
  por lá. `--ck-state-fail` entra pelo código de saída (§6, micro-momento 4), nunca pelo canal.
- **Gutter e número de linha em `--ck-text-secondary`**, nunca `--ck-text-tertiary`: número de
  linha é texto pequeno, e `tertiary` não alcança 4.5:1 (§2.2).
- **Diff continua colorido** — `--ck-diff-*` já existe e vem do `structuredPatch` pronto.
- **URL dentro do bloco vira link**, com `--ck-link` e sublinhado (§2.7).

Se um dia entrar highlighter, entra como decisão nova com paleta medida — não como um executor
escolhendo hex no meio de um renderer.

## 8. Estados de borda — desenhados contra as fixtures

Não invento estado vazio: as 52 famílias em `fixtures/cockpit-v2/familias/` são a lista de casos, e as duas de borda (`borda__*.json`) são as que ninguém escreve de propósito.

| Caso real | Quantos | Aparência |
|---|---|---|
| `content: null` | 199 | **Não é vazio, é evento sem corpo.** Nunca renderizar caixa vazia: colapsa na própria linha de cabeçalho |
| `content` string em vez de lista | 87 | Um único bloco de texto; não quebrar em *parts* |
| `isImage` em resultado de Bash | 5 formas | Miniatura com **altura reservada**; abre em overlay |
| `isBase64` em recurso MCP | — | Igual à imagem, com badge de origem MCP |
| `structuredPatch` em Edit/Write | 77 | Vai direto pro diff viewer |

Estado vazio de verdade (agente sem conversa, lista sem resultado) usa `--ck-text-hero` em sans, uma frase, uma ação. Sem ilustração — ilustração genérica é a assinatura do mequetrefe.

## 9. Proibições — reprovam review

1. Hex cru em componente. Só token.
2. `backdrop-blur` em lista ou feed. Permitido **só** no composer flutuante (um elemento).
3. `box-shadow` com blur > 8px em fundo escuro.
4. Animar `width`/`height`/`top`/`left`.
5. `100vh` — usar `100dvh` + `env(safe-area-inset-*)`.
6. `font-size` < 16px em campo de entrada.
7. Cor como único portador de significado.
8. `--ck-text-tertiary` em texto de corpo.
9. Token novo inventado localmente — pedir, não criar.
10. Três colunas simultâneas no celular: **uma superfície por vez**.
11. Véu de interação (`--ck-overlay-*`) sobre `--ck-surface-raised` — derruba a borda funcional para 2.98:1 (§2.6).
12. Link sem sublinhado, ou URL renderizada como texto comum (§2.7).
13. `backdrop-filter` no véu de modal (§2.7) — a exceção de blur continua sendo só o composer.
14. Highlighter de linguagem em bloco de código (§7.1).
15. Entrelinha ou tracking escritos como valor solto — são token desde 30/07 (§4).

## 9.1 A regra do santo graal — como toda UI definitiva fecha

> **Rica, 30/07/2026, depois de reprovar a primeira TROPA:** *"sempre que terminar a
> UI, tem que ver se ela está o santo graal. Se não tiver, não serve, tem que polir até
> ficar alta performance visual — tem que valer largar o cockpit antigo. Usar toda a
> computação para pensar em algo que seja meu, mas com o toque de excelência das UIs
> modernas. Tudo de UI tem que carregar frontend designer, plugin do CC, pesquisar se
> for preciso. Pode ser por último, depois de tudo funcionando, mas se algo for ficar
> definitivo tem que ser assim: com contexto limpo, e não com um monte de outra coisa
> de código na cabeça tentando implementar uma UI bonita."*

Isto é regra de processo, não gosto. Vale para qualquer superfície que vá ficar.

1. **Rodada dedicada, contexto limpo.** UI definitiva não sai no fim de um turno que
   passou o dia em `useLayoutEffect` e perfil de CPU. Fecha o turno, `/compact` ou
   sessão nova, e só então a rodada visual. Foi exatamente o que produziu a TROPA
   reprovada: pele feita logo depois de sete horas de instrumentação do gate.
2. **Carregar a skill `frontend-design`** (plugin oficial do CC, `frontend-design@claude-plugins-official`,
   já instalado nesta máquina) antes de desenhar. Ela existe para evitar o que o Rica
   chamou de "um visual que um LLM bem paradinho faria" — inclusive nomeando os três
   clichês em que o design gerado por IA cai. Pesquisar referência real quando o
   assunto pedir.
3. **A régua é largar o antigo.** A pergunta não é "está bonito?", é "isto vale
   substituir o cockpit que funciona?". Enquanto a resposta for não, a peça não está
   pronta — não importa que passe no gate técnico.
4. **Autoral, não clone.** Segue valendo a divisão do playbook §9: esqueleto emprestado
   e invisível (medida, ergonomia), autoria na pele. "Está dentro das medidas do
   ChatGPT" nunca foi defesa contra "não amei".
5. **Ordem permitida:** pode vir por último, depois de a coisa funcionar. O que não
   pode é virar definitivo sem passar por aqui.
6. **Juiz único: o Rica.** Binário, sem recurso a argumento técnico.

Corolário para mim (Pavan): despachar frente visual junto com frente de instrumentação
no mesmo turno é erro meu, não do executor.

## 10. Fronteira — o que este documento NÃO decide

Do esqueleto (Pavan), e aqui só se obedece:

- largura da coluna do chat (escada de container query: 32rem → 40rem → 48rem), margem do thread, composer de 768px × 52px, sidebar de 260px
- ritmo de espaçamento, densidade, área de toque
- estrutura e nomenclatura dos tokens, hierarquia entre superfícies, e o piso de contraste
- `STACK.md`, `DATA-CONTRACT.md`, `OWNERSHIP.md`, `packages/cockpit-core/**`, `apps/cockpit/**`

`apps/web` não recebe commit de ninguém.

**Modo claro:** o v2 nasce só escuro (o alvo é dark, e o usuário é celular). Os tokens são semânticos de propósito — quando o claro entrar, deriva valores sem renomear nada.

Dois detalhes que **furam a estética inteira** se esquecidos — apontados pelo Pavan, e obrigatórios:

```css
:root { color-scheme: dark; }   /* sem isto, scrollbar, input, select e date picker
                                  NATIVOS renderizam claros e destroem a tela */
```

```html
<meta name="theme-color" content="#18191d">  <!-- = --ck-surface-canvas -->
```

Sem o `theme-color`, a barra do Safari no iPhone do Rica destoa da tela — e é a primeira coisa que ele vê. Se `--ck-surface-canvas` mudar, **este valor muda junto**.

---

> Regra que resolve a tensão com a §6, nas palavras do Pavan e que assino:
> **se altera medida, justifica; se altera aparência, ousa.**

---

## Apêndice — bloco pronto para a §A do `globals.css`

Os 14 tokens da segunda leva, na ordem em que entram. Integração é do Pavan; isto existe para
que não haja transcrição à mão de valor medido.

```css
  /* -- tipografia: família (as --font-geist-* vêm do next/font no layout) -- */
  --ck-font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --ck-font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace;

  /* -- tipografia: métrica. Eram prosa no contrato; viraram token depois de o
        overline nascer com 0.08em em vez de 0.055em ------------------------ */
  --ck-leading-body: 1.55;      /* corpo e mono */
  --ck-leading-hero: 1.2;
  --ck-track-hero: -0.035em;
  --ck-track-title: -0.012em;
  --ck-track-overline: 0.055em;

  /* -- interação: UM véu de luz que compõe sobre qualquer superfície.
        Teto 0.05: em 0.065 a borda funcional cai pra 2.98:1 e reprova.
        PROIBIDO sobre --ck-surface-raised (lá 0.03 já dá 2.98). ------------ */
  --ck-overlay-hover: rgb(255 255 255 / 0.03);     /* Δ 1.087x */
  --ck-overlay-selected: rgb(255 255 255 / 0.04);  /* Δ 1.134x + barra 2px */
  --ck-overlay-pressed: rgb(255 255 255 / 0.05);   /* Δ 1.168x */

  /* -- link: matiz 250, a 30° do ciano de running e 35° do violeta de
        thinking. Croma 0.09 < croma de qualquer estado, de propósito: URL no
        stdout não grita mais que falha. AAA em toda a escada. -------------- */
  --ck-link: oklch(0.82 0.09 250);                 /* #97c9fd  7.40:1 no raised */

  /* -- seleção: força fundo E cor, senão selecionar texto em state-fail ou
        diff-add produz um par que ninguém mediu ---------------------------- */
  --ck-selection-bg: oklch(0.42 0.08 265);         /* #374c79 */
  --ck-selection-fg: var(--ck-text-primary);       /* 7.57:1 sobre o fundo acima */

  /* -- véu de modal: o fundo PERDE luz, não ganha sombra. Zero blur. ------- */
  --ck-scrim: rgb(0 0 0 / 0.55);                   /* modal destaca 1.53x */
```

Fora do `:root`, duas regras que fecham o par medido e a entrelinha:

```css
::selection { background: var(--ck-selection-bg); color: var(--ck-selection-fg); }
body { line-height: var(--ck-leading-body); }   /* hoje herda ~1.2 do browser */
```

E no `@theme inline`, para que exista utilitário e não valor arbitrário:

```css
  --color-link: var(--ck-link);
  --font-sans: var(--ck-font-sans);
  --font-mono: var(--ck-font-mono);
  --text-xs: var(--ck-text-xs);
  --text-sm: var(--ck-text-sm);      /* 13px — sem isto, `text-sm` do Tailwind
                                        entrega 14px e parece que usou o token */
  --text-base: var(--ck-text-base);
  --text-md: var(--ck-text-md);
  --text-lg: var(--ck-text-lg);
  --text-hero: var(--ck-text-hero);
```

Faltam ainda, na §B e com o Pavan: `--ck-dur-enter: 200ms` e
`--ck-ease-exit: cubic-bezier(0.4, 0, 1, 1)` (§5).

---

## 10. Veredito parcial do Rica — 30/07 16:31

**As cores estão aprovadas.** Palavras dele: *"as cores do nosso cockpit novo estão
aprovadas"*. A paleta de `--ck-*` sai da mesa de discussão; quem for desenhar daqui pra
frente **consome** os tokens, não propõe cor nova sem revalidar pelo §3.

Junto veio uma referência visual — a tela do ChatGPT Plus, guardada em
`/tmp/cockpit-v2-prints/referencia-rica-chatgpt.jpg` — com o pedido: *"olha como quero os
desenhos e fontes, pra ele se inspirar"* e a ressalva *"mas essa tela muito preta, prefiro
a nossa"*.

### A distinção que governa o uso dessa referência

**Empresta-se o vocabulário. Não se empresta a gramática.**

- **Vocabulário — adotar:** ícone de traço fino e contorno aberto (não há um único ícone
  sólido na referência inteira); ações da mensagem como fileira de ícones pequenos, sem
  moldura e sem fundo; tipografia de peso regular com escala curta, deixando o espaço fazer
  o trabalho que o negrito faria; lista lateral densa, sem cartão e sem borda — **item é
  linha, não card**, que é a mesma régua da §7.
- **Gramática — não adotar:** a estrutura de tela. A §1 deste contrato declara que o v2
  **não é um clone do ChatGPT**, e o próprio Rica já havia pedido *"algo que seja meu, mas
  com o toque de excelência das UIs modernas"*. A referência é de um **chat**; a nossa tese
  é **log de execução** (82% `tool_use`). Copiar a organização dela trairia a tese que
  justifica o projeto.
- **A cor da referência está descartada por ele mesmo.** O preto quase absoluto sai;
  `--ck-surface-canvas` fica.

Consequência prática: a referência entra como **calibragem de acabamento**, não como novo
layout. Ícone de ferramenta com traço fino, duração em peso regular, linha colapsada sendo
linha — e a §7 segue mandando na estrutura.

---

## 11. Conflito interno do contrato — 32px × 44px (aberto, 30/07)

A entrega da linha de ferramenta (`117749e`) expôs uma **contradição entre duas seções
deste próprio contrato**, e o Daniel fez o certo: declarou o desvio em vez de escolher em
silêncio.

- **§7** manda a linha colapsada ter **28–32px** de altura. Densidade é a tese: com 3.080
  eventos por sessão, linha gorda torna a tela infinita.
- **§3 / mobile** manda alvo de toque de **44×44px**. O alvo real é iPhone.

Num elemento que é *ao mesmo tempo* item de lista denso e alvo de toque, os dois não cabem.
Ele resolveu por **32px**, com o argumento de que as linhas são adjacentes e contíguas —
então não há pixel morto entre alvos, e o alvo efetivo é a linha inteira na largura da tela.

**Decisão minha, provisória:** fica 32px, e o motivo é que o argumento é bom para a
dimensão horizontal (o alvo tem 390px de largura) e a §7 é explícita. **Mas não está
aprovado** — 32px na vertical fica abaixo do guideline, e numa lista densa errar o toque
significa expandir a linha errada, que é irritação real e repetida.

**Isto só se resolve com o dedo do Rica na tela.** Nenhum de nós tem como decidir por
raciocínio: ou ele erra o toque no uso normal, ou não erra. Vai junto da medição do gate,
e até lá continua marcado como aberto — não como resolvido.

---

## 12. Segunda referência do Rica — a tela do Codex, e ela é para ADOTAR (30/07 13:47)

> Nota de numeração: existem duas seções "10" neste arquivo (a *Fronteira*, mais acima, e o
> *Veredito parcial*). Não renumerei para não invalidar as citações dos despachos já dados.
> Referências a §10 daqui pra frente significam o **Veredito parcial**.

Chegou uma segunda referência — `/tmp/cockpit-v2-prints/referencia-rica-composer.jpg`, a tela
inicial do **Codex** (aba *Work*) — e o tom mudou. Na primeira era *"pra ele se inspirar"*.
Nesta é: **"essa ui está muito boa, adota ela"**. Antes disso ele nomeou o que quer, e as
palavras são dele:

- *"chat input maior com modelo em baixo"*
- *"botão em cima para mudar a tela para as que vamos precisar"*

### O que fica adotado — a gramática, não só o vocabulário

A §10 dizia *"empresta-se vocabulário, não gramática"*. Para **estas duas peças**, a regra
está revogada por ordem direta dele. O que se adota:

1. **Composer alto, controles por dentro.** A caixa de escrever é alta e tem respiro — não é
   uma linha fina. Os controles moram **dentro** dela, na base: à esquerda as ações de anexo,
   à direita **o modelo e o esforço** (na referência, `5.6 Sol · Extra alto` com chevron),
   o microfone, e o botão de envio como único elemento sólido da tela.
2. **Modelo e esforço embaixo, à direita, dentro do composer.** Isto não é enfeite: o cockpit
   já tem seletor de modelo e de esforço por agente (família Kimi inclusive). Hoje eles moram
   longe de onde a decisão é tomada. Na referência, a escolha do motor está a um toque de onde
   se escreve — que é onde ela pertence.
3. **Barra segmentada no topo para trocar de tela.** Na referência é `Chat | Work`. Pill
   contido, centralizado, o ativo em superfície elevada e o inativo só texto.

### O que continua NÃO sendo adotado, e o motivo não mudou

**O feed.** A §1 vale inteira: 82% do tráfego é `tool_use`, a tela é **log de execução** e não
sequência de bolhas. A referência é a tela *vazia* do Codex — ela mostra o composer e a
navegação, não mostra o feed. Adotar o que a imagem mostra não conflita com a nossa tese em
lugar nenhum; a §7 (gramática da execução, já entregue em `117749e`) segue mandando no feed.

E **a cor continua nossa** — a §10 registrou o *"essa tela muito preta, prefiro a nossa"*, e
esta referência é do mesmo preto quase absoluto. `--ck-surface-canvas` fica.

### O limite honesto da barra de telas

*"as que vamos precisar"* inclui a fase 2 (kanban), que **não existe** e não vai ser desenhada
agora (§4.1 do `cockpit-v2-ESTADO.md`). Botão que não leva a lugar nenhum é mentira de UI e
reprova pela §9. A barra nasce com os destinos que **existem hoje** e com o desenho pronto para
receber o terceiro quando a fase 2 chegar.
