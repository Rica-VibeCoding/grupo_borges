# Estética do Cockpit v2 — especificação

Base de toda sessão que mexe em UI do `apps/cockpit`. Divergiu do `app/globals.css`, o CSS é o estado.
Medida (espaço, largura, toque, raio, ritmo) é da §B do `globals.css`; aqui se decide aparência.

## 1. Princípios

1. **Log de execução que às vezes conversa.** ~82% dos blocos são `tool_use`/`tool_result`: o
   esforço vai em como a execução aparece, não na bolha.
2. **Espaço na tela é caro; enfeite precisa se pagar.** Herói grande, halo, ilustração,
   cabeçalho que repete o que a tela já mostra: fora. A identidade do agente já está na
   tropa, então o chat não tem cabeçalho de identidade.
3. **Luz em vez de sombra.** Profundidade é luminância (mais claro = mais perto) mais um fio
   de luz de 1px no topo da superfície elevada. Fundo escuro não tem sombra.
4. **Acromático onde não há significado.** Superfície, texto e borda têm croma zero. Matiz é
   reservado a estado, diff, foco, link e aos três acentos da gaveta (§8).
5. **A temperatura sobe quando a máquina precisa de você:** violeta (pensando) → ciano
   (executando) → **âmbar (espera humano)** → verde (feito) / coral (falhou). Âmbar é o único
   estado quente e o único que chama o Rica.
6. **Discreto.** A direção é a da ACI Biller dark (§11), sem o herói chamativo.
7. **Juiz único é o Rica, veredito binário.** A régua é "isto vale substituir o que existe?".
   UI que vai ficar sai em rodada dedicada, com contexto limpo e a skill `frontend-design` carregada.

## 2. Cor

Toda cor mora em `app/globals.css`: §A (global) e §G (gaveta, escopada em `.ck-gv`).
Componente só consome `var(--ck-*)`. Token que falta se pede ao dono da §A, não se inventa.

**Superfícies — a escada de luz** (croma 0; o `L` carrega a hierarquia):
- `--ck-surface-canvas` `#191919` — palco do chat e todo chrome que mora dentro da folha
- `--ck-surface-nav` `#222222` — a mesa: tropa, faixa lateral
- `--ck-surface-composer` `#2a2a2a` — campo, popover
- `--ck-surface-raised` `#313131` — bloco expandido, overlay

Não é preto puro no palco: `#000` em OLED arrasta na rolagem e endurece texto longo.
**Texto:** `primary` (corpo, título) · `secondary` (metadado, label, número de linha) ·
`tertiary` **nunca em corpo** — só ícone, separador ou texto ≥ 20px.

**Estado:** `--ck-state-thinking`, `-running`, `-attention`, `-ok`, `-fail` e `--ck-focus`.
`--ck-alert-*` (`> [!NOTE]` do markdown) **copia** os valores de estado, sem `var()`: são independentes.

**Diff:** `--ck-diff-add`, `--ck-diff-del` (= `state-fail`), fundos `-bg` a 12%, nunca cor cheia. Menos é U+2212 (`−`).

**Bordas:**
- `--ck-edge-functional` — input, botão, controle. Piso 3:1; `L=0.60` é o mínimo com folga, não baixar.
- `--ck-edge-hairline` — separador decorativo no plano, sem piso.
- `--ck-edge-light` — fio de luz no topo do elevado (`inset 0 1px 0 0`) e separador em superfície flutuante.
- `--ck-edge-composer` / `-foco` — só a caixa do composer, que já se distingue pelo material.

**Interação — um véu de luz que compõe sobre qualquer superfície:** `--ck-overlay-hover` (0.03),
`-selected` (0.04), `-pressed` (0.05). Teto 0.05: acima disso a borda funcional cai abaixo de 3:1.
**Proibido sobre `raised`.** Item selecionado leva, além do véu, uma barra de 2px em `text-primary`.

**Link e seleção:** `--ck-link` (croma menor que qualquer estado: URL não grita mais que falha),
sempre sublinhado via `.ck-link`. `::selection` força fundo **e** cor (`--ck-selection-*`).

**Materiais (vidro):** cada um é token próprio, não se reaproveita entre eles.
- Caixa do composer: `--ck-surface-composer-material` (raised 60%) + `--ck-veu-desfoque` 36px.
- Rodapé e borda progressiva: `--ck-rodape-material` (canvas 70%) — tint na cor da superfície
  coberta, então some sozinho quando não há nada atrás.
- Véu das gavetas: `--ck-veu-gaveta` (preto 38%) + `--ck-veu-gaveta-desfoque` 6px; tocar fecha.

## 3. Contraste — piso

- corpo e título: **7:1** (AAA)
- metadado, label, texto de estado, pílula: **4.5:1**
- borda funcional, indicador de estado, ícone que carrega significado: **3:1**
- alvo de toque: **44 × 44 px** (`--ck-touch-min`); o desenho pode ser menor, o alvo não
- foco de teclado: outline 2px + offset 2px, nunca só cor
- **cor nunca é a única portadora de significado** — todo estado leva ícone ou palavra junto

**Onde medir.** Superfície sólida: contra `raised` puro **e** contra `composer` + `pressed`
(as duas mais claras que um texto pode pisar). Material translúcido: o fundo é variável — capturar
a região em ~26 posições de rolagem e usar o p99 de luminância, **nos dois estados: com conteúdo
atrás e sem nada atrás**. Vazio, o material tem de ser indistinguível da superfície que cobre.
Prova de que o desfoque pinta é o mesmo recorte com o filtro ligado e desligado, olhado — não média.

**Como revalidar** (obrigatório ao propor cor; proposta sem número não entra):

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

RAISED = (0.315, 0, 0)                              # pior caso sólido
print(round(ratio((0.74, 0.16, 22), RAISED), 2))   # state-fail
```

O clamp por canal do script é conservador para cor fora do gamut sRGB (o browser reduz croma, que dá
um pouco mais). Cor nova se mede no **estado final completo** — texto e fundo já com os valores novos.

## 4. Tipografia

- **Geist Sans + Geist Mono**, self-host por `next/font/local` (`app/fonts.ts`), `display: 'fallback'`.
  `optional` sorteia a fonte por carga; `swap` reflui a página depois de qualquer tempo.
- **Mono é a voz da máquina** (comando, saída, caminho, diff, nome de ferramenta, identificador).
  **Sans é a voz do produto** (navegação, label, título, botão, texto do Rica).
- **Escala:** `--ck-text-xs` 12 · `-sm` 13 (mono de conteúdo, metadado) · `-base` 15 (corpo) ·
  `-md` 16 · `-lg` 20 · `-hero` 28. O `text-sm` do Tailwind está mapeado para 13px.
- **Campo de entrada ≥ 16px** (`--ck-text-md`): abaixo disso o Safari dá zoom ao focar.
- **Entrelinha e tracking são token**, consumidos pelas utilitárias `leading-body` (1.55),
  `leading-hero` (1.2), `tracking-hero`, `tracking-title`, `tracking-overline`. Corpo: tracking zero.
  Só duas entrelinhas existem.
- **`tabular-nums` (`.ck-tabular`)** em contador de token, tempo, estatística de diff, cota e `%`.

## 5. Movimento

- **Tokens:** `--ck-dur-fast` 120ms (toque) · `--ck-dur-enter` 200ms (entrada) · `--ck-dur-calm` 320ms
  (troca de superfície) · `--ck-ease` (entrada) · `--ck-ease-exit` (saída) · `--ck-mola` (entrada com peso).
  Sem bounce fora da `--ck-mola`.
- **Só `transform` e `opacity` animam.** Nada animado pode refluir o feed durante o stream.
- **`prefers-reduced-motion: reduce` desliga tudo**, trocando por mudança instantânea.
- **Biblioteca: Motion (`motion/react`)**, com `layoutDependency` em todo `layout` e `MotionConfig reducedMotion="user"`.
- **Entrada e saída de superfície é `.ck-surge`**, o movimento do app inteiro: quem anima superfície
  nova usa ele, não keyframe próprio. Elemento removido do DOM não anima a saída, então a superfície
  fica **sempre montada** e alterna `data-aberto`; escondida por `visibility`. O gesto é
  `translateY(6px) + scale(0.98)` — afunda e se afasta, não desliza da borda.
- **Abertura otimista:** o toque muda o estado no mesmo frame (`useOptimistic` + `router.push`, em
  `superficie-otimista.tsx`); a URL segue fonte da verdade (deep-link, voltar, refresh).
- **Painel com altura do conteúdo:** filhos `flex-auto`, nunca `flex-1` (no WebKit a base 0 dá altura 0),
  e `height: auto` em vez de `fit-content`.

## 6. Micro-momentos

1. **Pensando:** sem spinner; o fio de luz do topo respira em `--ck-state-thinking`.
2. **Ferramenta entrando:** `opacity` + `translateY(2px)` em `--ck-dur-enter`, com altura reservada antes do conteúdo.
3. **Grupo em execução:** filete lateral de 2px em `--ck-state-running`, que some ao concluir.
4. **Falha:** nada pisca; a superfície perde o fio de luz e o filete vira `--ck-state-fail`.
5. **Pedido de permissão:** único movimento persistente — filete âmbar pulsando, alvo ≥ 44px, confirmação.
6. **Agente vivo na gaveta:** o ponto do agora do pulso respira só enquanto ele trabalha.

Canvas/WebGL (voz): desmontado ao sair, desenho no `requestAnimationFrame`, zero `setState` por frame.

## 7. Gramática da execução (feed)

- **Ferramenta colapsada = uma linha** de 28–32px: ícone, nome em mono, alvo resumido, duração à
  direita em `tabular-nums`. A linha inteira é o alvo. Densidade é o que faz parecer profissional.
- **Expandida = bloco** sobre `raised`, com fio de luz e filete de estado à esquerda.
- **Consecutivas agrupam** (`tool-group`) com contador.
- **`thinking` nasce fechado**, exceto quando é o bloco ativo.
- **Diff vem do `structuredPatch` pronto**, nunca do cliente. Unified; split só a partir de 64rem.
- **Caminho de arquivo trunca o diretório** e preserva o nome inteiro.
- **Erro de ferramenta não é modal:** fica na linha, expansível.
- **Sem highlighter de linguagem.** Bloco de código é mono de uma cor. stdout e stderr em
  `text-primary`; o que separa é um rótulo `stderr` em `secondary` e um filete funcional. Canal não é
  desfecho: `state-fail` vem do código de saída. Gutter em `secondary`. URL no bloco vira link.
- **Bordas reais do dado:** `content: null` colapsa na própria linha (nunca caixa vazia); `content`
  string vira um bloco só; imagem e base64 com altura reservada, abrindo em overlay.
- **Estado vazio:** uma frase em `--ck-text-hero` sans e uma ação. Sem ilustração.

## 8. Gramática dos painéis — a gaveta é o modelo

O modelo vivo é `components/gaveta/` (peças em `pecas.tsx`) com os tokens da §G. Painel novo compõe
dessas peças antes de criar outra.

**Layout.** Celular: uma superfície por vez. Desktop (≥ 768px): a tropa é faixa permanente na mesa
(`nav`); o palco é uma **folha** em `canvas` com 8px de margem, raio `--ck-radius-caixa` e fio de luz;
o item selecionado da tropa funde com a folha (aba).

**Gaveta.** Flutua com 8px de folga e raio 16px; ancora embaixo no celular (≤ 640px) e no topo no
desktop, crescendo para baixo e rolando por dentro. Cabe sem rolar em 390×844 e 1440×900.

**Camadas.** Cartão-mãe `--ck-gv-fundo` (quase preto) → cartões `--ck-gv-camada` (grafite, raio 16,
respiro `--ck-space-3`) → blocos `--ck-gv-bloco` (quase preto, raio 12). Dentro de `.ck-gv`, moldura
vira pílula e os fios somem: a separação é a camada.

**Cabeçalho baixo, uma linha:** retrato de 40px com anel fino laranja (apaga fora do ar) e a bolinha
"!" quando algo pede olho · nome (`text-md`, 600) · interruptor da sessão · `×` com alvo de 44px.
Embaixo, a statusline com a barra de contexto na largura toda. Não há herói.

**Peças:**
- `Cartao` — título opcional à esquerda, ação à direita.
- `Bloco` — o preto dentro do cartão.
- `Interruptor` — trilho + botão **com a palavra do estado ao lado** (Ativo/Desligado). Um toque age.
- `Segmentado` — escolha entre poucas: trilho preto, a marcada em `--ck-gv-pilula`, `radiogroup`.
- `Pilula` — botão de ação cinza, raio pill, alvo 44px.
- Área tracejada com `Mais` (+) — porta para abrir ou criar.
- `BolinhaDeAlerta` — "!" vermelho; o motivo sempre aparece em texto na mesma gaveta.
- Ícone (`shell/icones.tsx`): traço fino, contorno aberto, nunca preenchido; ação sem moldura.

**Um papel por cor:** laranja (`--ck-gv-acento`) = identidade viva (anel); azul (`--ck-gv-ativo`) =
**ligado** e nada mais; vermelho (`--ck-gv-alerta`) = só a bolinha "!"; âmbar = atenção, do estado
global. Não entra quarto acento.

**Medidores:** contexto neutro → âmbar ≥ 25% → `state-fail` > 30% (`corDoContexto`); cota âmbar ≥ 80% → `state-fail` ≥ 95% (`corDaCota`).

**Carga sem pulo:** enquanto o dado não volta, reserva a altura que ele vai ocupar.

**Composer.** O vidro tem a forma da caixa; o feed fica nítido até encostar nela. Em repouso, uma
fileira ([+] · campo · motor · voz); com conteúdo, texto em cima e controles na base, até `--ck-h-campo-max`. Barra de rolagem do app
(`scrollbar-*` **e** `::-webkit-scrollbar`, sem setas).

## 9. Proibições — reprovam review

1. Hex, `rgb()`, `oklch()` ou cor nomeada fora do `globals.css`.
2. `backdrop-filter` fora dos materiais declarados na §2 — nunca em lista ou feed.
3. `box-shadow` como sombra de profundidade. Brilho emissivo de cor (o pulso) é luz, não sombra.
4. Animar `width`/`height`/`top`/`left`.
5. `100vh` — usar `100dvh` + `env(safe-area-inset-*)`.
6. `font-size` < 16px em campo de entrada.
7. Cor como único portador de significado.
8. `--ck-text-tertiary` em texto de corpo ou texto pequeno.
9. Token inventado localmente.
10. Mais de uma superfície por vez no celular.
11. Véu de interação (`--ck-overlay-*`) sobre `--ck-surface-raised`.
12. Link sem sublinhado, ou URL como texto comum.
13. Enfeite que não se paga: herói, halo, ilustração genérica, cabeçalho redundante, botão que não leva a lugar nenhum.
14. Highlighter de linguagem em bloco de código.
15. Tamanho, entrelinha ou tracking como valor solto (`text-[13px]`, `leading-[1.55]`).
16. Quarto acento na gaveta, ou acento fora do seu papel (§8).

## 10. Amarrações e verificação

- `:root { color-scheme: dark; }` — sem isso, scrollbar, input e select nativos saem claros.
- `theme-color` bate com a cor que encosta na barra do Safari: `#191919` (canvas) no `layout.tsx`,
  `#222222` (mesa) na raiz `app/page.tsx`. Mudou o token, muda aqui.
- O WebKit não roda na VPS. Prefixo `-webkit-` se confere no CSS servido; defeito que só aparece no
  iPhone do Rica pede instrumento que leia o layout no aparelho dele antes de qualquer hipótese.

## 11. Referência — ACI Biller dark

Imagens em `docs/referencias/aci-biller/` (web e mobile; fonte: theskinsfactory.com, case ACI Biller dark).

- fundo do cartão-mãe: ACI `#000000` → nosso `--ck-gv-fundo` `#0a0a0a`
- cartão: ACI `#212028` → `--ck-gv-camada` `#1d1e21`
- bloco interno: ACI `#000000`–`#040405` → `--ck-gv-bloco` `#0d0e10`
- pílula: ACI `#3a3d49` → `--ck-gv-pilula` `#343539`
- acento laranja: ACI `#f17a23` → `--ck-gv-acento` `#f3680f`
- azul "ligado": ACI `#2e82e1` → `--ck-gv-ativo` `#3589ed`; rótulo em `--ck-gv-ativo-texto` `#6ab3fd`
- alerta: ACI `#de051e` → `--ck-gv-alerta` `#ea2126`
- texto secundário: ACI `#828284` → nosso `--ck-text-secondary` `#b1b1b1`

**Decisão.** Adota-se a gramática (camadas preto/grafite, pílula, interruptor com rótulo, tracejado
com "+", um acento) e não os valores: degraus de camada mais baixos que os da ACI (discreto), pretos
levemente erguidos (OLED), e texto e azul mais claros, porque o cinza secundário e o azul de rótulo
da ACI ficam abaixo de 4.5:1 sobre o cartão. O herói com halo da ACI não entra.

---
Histórico de decisões, medições e tentativas até 10/2026: `docs/pesquisas/cockpit-v2-estetica-historico-ate-2026-10.md`.
