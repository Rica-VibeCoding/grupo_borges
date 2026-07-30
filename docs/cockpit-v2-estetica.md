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

O baseline mediu o que a tela realmente é: **82% dos blocos são `tool_use`/`tool_result`** — 1.500 + 1.499, contra 330 de texto e 804 de thinking; 23 ferramentas distintas, 25 formas de resultado, Bash com 738 chamadas (`fixtures/cockpit-v2/README.md`).

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

`--ck-state-fail` fica **fora do gamut sRGB** por escolha: em tela display-P3 (o iPhone do Rica) o vermelho existe mais vivo; em sRGB o browser clampa. O piso de 4.5:1 foi medido **no valor já clampado**, então vale nas duas telas — o P3 é ganho, não dependência.

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

A distinção não é estética, é WCAG 2.1 §1.4.11: o piso de 3:1 vale para **componente de interface e indicador de estado**, não para separador decorativo. Se eu exigisse 3:1 em toda borda, a tela viraria uma grade cinza-claro. `L=0.56` foi testado e **reprova** (2.78:1 sobre a superfície elevada) — por isso 0.60.

Aplicação do fio de luz, barata e sem blur:

```css
box-shadow: inset 0 1px 0 0 var(--ck-edge-light);
```

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

Entrelinha: 1.55 no corpo e no mono (bloco de código respira), 1.2 no hero.
Tracking: `-0.035em` no hero · `-0.012em` em título de linha · `+0.055em` em overline maiúscula (os três vêm do Codex, §6) · zero no corpo.
`tabular-nums` obrigatório em: contador de token, tempo decorrido, estatística de diff, quota.

## 5. Movimento

Duração: **120ms** (resposta a toque) · **200ms** (entrada de elemento) · **320ms** (troca de superfície).
Easing: entrada `cubic-bezier(0.2, 0, 0.2, 1)` · saída `cubic-bezier(0.4, 0, 1, 1)`. **Sem bounce** — ferramenta de trabalho não quica.

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

## 10. Fronteira — o que este documento NÃO decide

Do esqueleto (Pavan), e aqui só se obedece:

- largura da coluna do chat (escada de container query: 32rem → 40rem → 48rem), margem do thread, composer de 768px × 52px, sidebar de 260px
- ritmo de espaçamento, densidade, área de toque
- estrutura e nomenclatura dos tokens, hierarquia entre superfícies, e o piso de contraste
- `STACK.md`, `DATA-CONTRACT.md`, `OWNERSHIP.md`, `packages/cockpit-core/**`, `apps/cockpit/**`

`apps/web` não recebe commit de ninguém.

**Modo claro:** o v2 nasce só escuro (o alvo é dark, e o usuário é celular). Os tokens são semânticos de propósito — quando o claro entrar, deriva valores sem renomear nada.

---

> Regra que resolve a tensão com a §6, nas palavras do Pavan e que assino:
> **se altera medida, justifica; se altera aparência, ousa.**
