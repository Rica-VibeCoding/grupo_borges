# Estética do Cockpit v2 — especificação

Base de toda sessão que mexe em UI do `apps/cockpit`. Divergiu do `app/globals.css`, o CSS é o estado.
Medida (espaço, largura, toque, raio, ritmo) é da §B do `globals.css`; aqui se decide aparência.

## 1. Princípios

1. **Log de execução que às vezes conversa.** ~82% dos blocos são `tool_use`/`tool_result`: o
   esforço vai em como a execução aparece, não na bolha.
2. **Espaço na tela é caro; enfeite precisa se pagar.** Herói grande, halo, ilustração,
   cabeçalho que repete o que a tela já mostra: fora. A identidade do agente já está na
   tropa, então o chat não tem faixa de identidade: no topo fica só a pílula do agente, que
   também abre a gaveta (§8).
3. **Luz em vez de sombra.** Profundidade é luminância (mais claro = mais perto) mais um fio
   de luz de 1px no topo da superfície elevada. Fundo escuro não tem sombra.
4. **Acromático onde não há significado.** Superfície, texto e borda têm croma zero. Matiz é
   reservado a estado e tons de estado (§2), diff, link, seleção, ouro do pulso, verde dos atalhos
   de tela e acentos da gaveta (§8). Foco não tem cor (§9.17).
5. **A temperatura sobe quando a máquina precisa de você:** violeta (pensando) → dourado do pulso
   (executando, no feed; ciano só fora dele) → **âmbar (espera humano)** → verde (feito) / coral
   (falhou). Âmbar é o único estado que chama o Rica; dourado e âmbar são vizinhos (1,1:1 entre si),
   então quem os separa é a palavra ("Executando…" × "Aguardando você") e o pulso (respira × chama).
6. **Discreto.** A direção é a da ACI Biller dark (§11), sem o herói chamativo.
7. **Juiz único é o Rica, veredito binário.** A régua é "isto vale substituir o que existe?".
   UI que vai ficar sai em rodada dedicada, com contexto limpo e a skill `frontend-design` carregada.

## 2. Cor

Toda cor mora em `app/globals.css`: §A (pele) e §G (gaveta, escopada em `.ck-gv`) e, por ofício,
§B (véu das gavetas, ouro do pulso), §F (flutuante), §T (tropa), os tons `--ck-tom-*`/`--ck-conversa-*`
e a `.ck-bolinha`. Componente só consome `var(--ck-*)` — inline ou em classe, nunca cor literal.
Token que falta se pede ao dono da §A, não se inventa.

**Superfícies — a escada de luz** (croma 0; o `L` carrega a hierarquia):
- `--ck-surface-canvas` `#191919` — palco do chat e todo chrome que mora dentro da folha
- `--ck-surface-nav` `#222222` — a mesa: tropa, faixa lateral
- `--ck-surface-composer` `#2a2a2a` — campo, bloco expandido da execução, cartão da VPS
- `--ck-surface-raised` `#313131` — bolha do Rica, bloco de código, cartões de resultado

Menu e popover não são da escada: vestem o flutuante (§8).

Não é preto puro no palco: `#000` em OLED arrasta na rolagem e endurece texto longo.
**Texto:** `primary` (corpo, título) · `secondary` (metadado, label, número de linha) ·
`tertiary` **nunca em corpo**. Em texto, só metadado miúdo (hora, contagem, detalhe técnico) sobre
superfície onde passa 4.5:1 — `canvas`, gaveta (`gv-camada`, `gv-bloco`) e flutuante. Sobre `nav`,
`composer` e `raised` (4.39, 3.94 e 3.55:1), só ícone, separador ou texto ≥ 20px.

**Estado:** `--ck-state-thinking`, `-running`, `-attention`, `-ok`, `-fail`.
**Tom de estado** (`--ck-tom-voce/ze/pensa/prepara/erro/ocupado/desligado`): a cor de quem está com a
vez, consumida pela pílula do agente e pela tela de voz; aponta para os estados. `--ck-conversa-*` é apelido.
`--ck-alert-*` (`> [!NOTE]` do markdown) **copia** os valores de estado, sem `var()`: são independentes.

**Diff:** `--ck-diff-add`, `--ck-diff-del` (= `state-fail`), fundos `-bg` a 12%, nunca cor cheia. Menos do saldo é U+2212 (`−`); o marcador de linha do diff é `-`.

**Bordas:**
- `--ck-edge-functional` — input, botão, controle. Piso 3:1; `L=0.60` é o mínimo com folga, não baixar.
- `--ck-edge-hairline` — separador decorativo no plano, sem piso.
- `--ck-edge-light` — fio de luz no topo do elevado (`inset 0 1px 0 0`). Separador dentro do flutuante é `--ck-flutuante-fio`.
- `--ck-edge-composer` / `-foco` — só a caixa do composer, que já se distingue pelo material.

**Interação — um véu de luz que compõe sobre qualquer superfície:** `--ck-overlay-hover` (0.03),
`-selected` (0.04), `-pressed` (0.05). Teto 0.05 sobre a escada de superfícies: acima disso a borda
funcional cai abaixo de 3:1. Exceções do CSS: dentro de `.ck-menu-surface` o véu sobe a 0.06/0.09/0.11
(fundo quase preto); na tropa o hover é meia pílula (`--ck-tl-hover`). **Proibido sobre `raised`.**
Selecionado é o véu `-selected` (`.ck-veil[data-selecionado]`); na tropa vira pílula e no menu véu mais
forte com ✓ (§8). Não há barra lateral. Botão com véu dentro de superfície arredondada: a superfície
recorta (`overflow: clip`), senão o véu sai de canto vivo por cima do raio.

**Link e seleção:** `--ck-link` (croma menor que qualquer estado: URL não grita mais que falha),
sempre sublinhado via `.ck-link`. `::selection` força fundo **e** cor (`--ck-selection-*`).

**Materiais (vidro):** cada um é token próprio, não se reaproveita entre eles.
- Caixa do composer: `--ck-surface-composer-material` (raised 60%) + `--ck-veu-desfoque` 36px.
- Borda progressiva (`.ck-borda-progressiva`, acima do composer): `--ck-rodape-material` (canvas 70%)
  — tint na cor da superfície coberta, então some sozinho quando não há nada atrás.
- Pílula do agente: `--ck-conversa-pilula` + fio `--ck-conversa-pilula-fio` + desfoque 20px; na tropa, sem desfoque.
- Véu de operação: `--ck-scrim` + `--ck-veu-desfoque`.
- Véu das gavetas: `--ck-veu-gaveta` (preto 38%) + `--ck-veu-gaveta-desfoque` 6px; tocar fecha.
- Superfície flutuante: `--ck-flutuante-*` (§8, Superfícies flutuantes).

## 3. Contraste — piso

- corpo e título: **7:1** (AAA)
- metadado, label, texto de estado, pílula: **4.5:1**
- borda funcional, indicador de estado, ícone que carrega significado: **3:1**
- alvo de toque: **44 × 44 px** (`--ck-touch-min`); o desenho pode ser menor, o alvo não. **Exceção
  única:** linhas contíguas do feed (execução, grupo de passos, cartão do `/compact`) têm alvo de 32px —
  errar abre a vizinha, reversível. Botão isolado dentro delas volta aos 44px
- foco de teclado: sem anel nem outline (§9.17); aparece por véu ou pela borda do próprio elemento — no
  composer a borda da caixa clareia, no menu um fio interno cinza de 1px
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
- **Mono é a voz da máquina** (comando, saída, caminho, diff, identificador). O nome da ferramenta,
  na expansão, é overline em sans.
  **Sans é a voz do produto** (navegação, label, título, botão, texto do Rica).
- **Escala:** `--ck-text-xs` 12 · `-sm` 13 (mono de conteúdo, metadado) · `-base` 15 (corpo) ·
  `-md` 16 · `-lg` 20 · `-hero` 28. O `text-sm` do Tailwind está mapeado para 13px.
- **Campo de entrada ≥ 16px** (`--ck-text-md`): abaixo disso o Safari dá zoom ao focar.
- **Entrelinha e tracking são token**, consumidos pelas utilitárias `leading-body` (1.55),
  `leading-hero` (1.2), `tracking-hero`, `tracking-title`, `tracking-overline`. Corpo: tracking zero.
  Corpo e UI têm só essas duas entrelinhas; a legenda da voz tem token próprio
  (`--ck-conversa-legenda` / `-leading`).
- **`tabular-nums` (`.ck-tabular`)** em contador de token, tempo, estatística de diff, cota e `%`.

## 5. Movimento

- **Tokens:** `--ck-dur-fast` 120ms (toque) · `--ck-dur-enter` 200ms (entrada) · `--ck-dur-calm` 320ms
  (troca de superfície) · `--ck-ease` (entrada) · `--ck-ease-exit` (saída) · `--ck-mola` (entrada com peso).
  Bounce só em mola: `--ck-mola` no CSS; na Motion, `spring` com `bounce` ≤ 0.22 (pílula, palavra que
  gira, fala da voz). A esfera mini é a da tela de conversa (`EsferaConversa mini`); o bonequinho do composer (`.ck-bolinha-*`) está desligado e guardado no código.
- **Deslocar, escalar e aparecer é só `transform` e `opacity`**; cor, fundo e borda podem transicionar
  no ritmo dos tokens. Abrir, fechar e trocar de estado no feed (grupo, linha viva, execução) animam pela
  Motion (`AnimatePresence`, `layout`), nunca por keyframe que mexe em tamanho (liberado pelo Rica, 02/10).
- **`prefers-reduced-motion: reduce` desliga tudo**, trocando por mudança instantânea. **Exceção:
  indicador de progresso** (o anel do grupo, §7) segue girando — é informação, não enfeite; o que a
  preferência corta nele são as transições (fechar, nascer o miolo, deslizar).
- **Biblioteca: Motion (`motion/react`)**, com `layoutDependency` em todo `layout` e `MotionConfig reducedMotion="user"`.
  O `reducedMotion="user"` só para transform e layout: **opacity em laço segue rodando**, então
  quem pulsa opacity (esqueleto) consulta `useReducedMotion()` e para à mão.
  Transição de largura `auto` em CSS (`interpolate-size`) não existe no Safari do iPhone
  (MDN, 10/2026); a Motion faz por `transform`.
- **Entrada e saída de superfície é `.ck-surge`**, o movimento do app inteiro: quem anima superfície
  nova usa ele, não keyframe próprio. Elemento removido do DOM não anima a saída, então a superfície
  fica **sempre montada** e alterna `data-aberto`; escondida por `visibility`. O gesto é
  `translateY(6px) + scale(0.98)` — afunda e se afasta, não desliza da borda. Variantes declaradas no
  CSS: no celular a gaveta (≤ 640px) sobe 24px e a tropa entra 8px pela esquerda (`.ck-surge-lado`);
  menus e barras de cima da caixa usam `ck-menu-entra` (4px, 0.99).
- **Abertura otimista:** o toque muda o estado no mesmo frame (`useOptimistic` + `router.push`, em
  `superficie-otimista.tsx`); a URL segue fonte da verdade (deep-link, voltar, refresh).
- **Painel com altura do conteúdo:** filhos `flex-auto`, nunca `flex-1` (no WebKit a base 0 dá altura 0),
  e `height: auto` em vez de `fit-content`.

## 6. Micro-momentos

1. **A linha do agora** (`feed/linha-do-agora.tsx`, 02/10): rodapé do feed, fora da lista virtualizada.
   À esquerda, a **esfera da tela de conversa em miniatura** — o mesmo componente (`EsferaConversa mini`),
   mesmo shader e mesmas cores, nunca imitação em CSS (Rica, 02/10). Aparece só pensando
   (`esperandoZe`), executando (`trabalhando`) ou esperando você (`ouvindo`), entrando e saindo em mola;
   parada ou desligada ela sai e libera o WebGL. Ao lado, a frase — «Pensando há N s», o passo em voo
   ou «Esperando você» —, com o brilho que corre (`.ck-brilho-texto`) no dourado do pulso. A troca de
   estado é a da tela de voz: o ritmo da matéria se aproxima aos poucos, sem tranco.
2. **Chegada:** `.ck-chega` — `opacity` + `translateY(6px)` em `--ck-dur-enter`, só na fala do agente
   que chega ao vivo (prazo 1 s) e no corpo aberto pelo dedo. Replay e o que remonta ao rolar aparecem
   parados. Linha e grupo de ferramenta entram, saem e trocam de estado pela Motion (§5).
3. **Grupo de ferramentas em voo:** a cápsula do grupo (§7) leva à esquerda um **anel aberto girando**
   no dourado do pulso (`--ck-pulso-ouro`); ao terminar, o mesmo anel fecha a volta e ganha o miolo do
   desfecho. **Filete azul (`--ck-state-running`) é proibido** em todo o feed; "pensando", "trabalhando"
   e "trocando" são só texto pulsando, sem linha. **Texto em voo no feed é dourado** (a linha da
   execução, "Pensando", "trabalhando"; `--ck-pulso-ouro`, 8,1:1 sobre `raised`). A frase do grupo é a
   exceção: fica em `secondary` — quem diz "em voo" é o anel.
4. **Falha:** nada pisca; a superfície perde o fio de luz e o filete vira `--ck-state-fail`. No grupo,
   o anel fecha a volta em `--ck-state-fail` com um ✕ no miolo e a palavra (`erro`, `interrompido`) vai à direita.
5. **Espera humano:** filete âmbar **parado** (no grupo, um ponto âmbar parado no lugar do anel) e
   frase âmbar pulsando com `ck-chama` (mais forte e mais rápido que o `ck-respira` do trabalhando),
   alvo ≥ 44px — o único pulso que chama o Rica.
   `AskUserQuestion` sem resposta é `aguarda`, não `rodando`: "Aguardando você: <pergunta>".
6. **Agente vivo na gaveta:** o ponto do agora do pulso respira só enquanto ele trabalha.

Canvas/WebGL (voz): desmontado ao sair, desenho no `requestAnimationFrame`, zero `setState` por frame.

## 7. Gramática da execução (feed)

- **Ferramenta colapsada = uma linha de 32px fixos**, frase de chat em sans: verbo em português +
  alvo resumido (`Executou npm test`), na cor do desfecho. Sem ícone, sem nome da ferramenta, sem
  duração. À direita, o rendimento em `tabular-nums` (`+N −M`, contagem, `erro`) e o chevron. A linha
  inteira é o alvo. Densidade é o que faz parecer profissional.
- **Expandida = bloco** sobre `--ck-surface-composer`, raio `--ck-radius-frame`, fio de luz (`.ck-lit`,
  some na falha) e filete de estado à esquerda; o nome da ferramenta em overline. Mono só no pedido,
  na saída e no diff.
- **Consecutivas agrupam** (`grupo-ferramentas`, `feed/grupo-ferramentas.tsx`): 2+ linhas de trabalho
  viram uma. **Nasce sempre fechada** e o toque do Rica abre (02/10). Abrir e fechar é da Motion:
  altura e opacidade em `--ck-dur-enter` (`--ck-ease` entrando, `--ck-ease-exit` saindo), o chevron
  gira no mesmo ritmo e o grupo que remonta ao rolar aparece parado; o virtualizador acompanha pelo
  `ResizeObserver` do item, quadro a quadro. **Uma linha viva só:** o passo
  rodando aparece apenas na linha do agora, ao lado da esfera; no grupo e no feed ele surge quando
  termina, já no passado. Item que é só esse passo (`soPassoEmVoo`) fica no feed com a mesma chave e o
  envelope sem padding — altura zero, sem vão acima da linha do agora.
  **Uma forma só, do primeiro passo ao fim:** cápsula neutra (`--ck-surface-nav`, `--ck-radius-caixa`, sem filete, `overflow: clip`). O estado mora em três lugares da mesma linha:
  - **Marca** (slot fixo de 14px à esquerda, `feed/marca-do-grupo.tsx`): UM anel do começo ao fim. Em voo,
    arco aberto girando no dourado (giro imperativo num valor de movimento, que nenhum
    `MotionConfig` para); em `aguarda`, só um ponto `--ck-state-attention` parado, sem anel. No fim, o
    arco completa a volta (~160 ms) e nasce o miolo (~300 ms no total): **concluído = anel fechado +
    ponto no meio em `--ck-tom-feito`**, o verde-sálvia do pensar da esfera (7,9:1 sobre `nav`), não o
    `--ck-state-ok`; **falhou = anel fechado + ✕ no meio em `--ck-state-fail`** — forma própria, para a
    cor não ser a única portadora. O grupo que remonta ao rolar aparece com a marca pronta.
  - **Texto:** em voo, o resumo em `secondary`; fechado e em `aguarda`, a pergunta em âmbar chamando.
    Ao fechar, «N passos ·» entra à esquerda e a frase desliza pelo `layout` da Motion, sem pulo.
  - **Relógio** à direita, `tabular-nums`: conta ao vivo (tique de 1 s isolado num filho) e, no fim,
    troca por cruzamento pela duração medida (`duracaoDoGrupo`, até o último pedido de ferramenta).
  Depois do relógio, o saldo `+N −M`, o selo âmbar de retentativas (só no fim) e `erro`/`interrompido`
  em `--ck-state-fail` (só com o veredito). **Em curso** é o grupo no fim do feed com a corrida de pé
  (`indiceDoGrupoEmCurso`): entre um passo e o próximo ele segue girando, e falha no meio também; o anel
  só fecha quando vem fala depois ou a corrida para (`faseDoGrupo`). Com movimento reduzido, o anel segue
  girando e as trocas ficam instantâneas (§5).
- **Só o último turno em voo tem passo rodando** (`feed/orfas-do-turno.ts`, 02/10): ferramenta sem
  resultado vira falha `interrompido` em `--ck-state-fail` quando o agente já respondeu depois dela ou o
  turno acabou (`isRunning`, prazo da linha viva, frota offline); `AskUserQuestion` só pela resposta
  posterior. Falha e não neutro: neutro concluído é o anel com ponto, que afirmaria um sucesso que ninguém viu.
  A linha avulsa diz `interrompido` como o grupo, pela mesma marca (`foiInterrompida`), nunca `erro`.
- **`thinking`** sem texto não aparece; com texto nasce **sempre fechado** (`Raciocínio · N linhas`),
  inclusive o bloco ativo.
- **Diff sai dos argumentos**, calculado no cliente (`diff-lines.ts`): `Edit` por `old_string`/
  `new_string`, `Write` novo como tudo adicionado; `structuredPatch` não é lido. Só unified.
- **Caminho de arquivo trunca o diretório** e preserva o nome inteiro.
- **Identificador cru nunca vira alvo** (`file_id`, UUID, hash, token — `identificador-opaco.ts`): sem
  alvo legível, a linha é verbo + complemento (`Baixou o anexo`) ou verbo + nome amigável da ferramenta.
- **Context7 e `ask_user` têm verbo próprio:** o Context7, com qualquer prefixo, pelo método
  (`Localizou <lib>`, `Consultou a documentação`); o `ask_user` do MCP é pergunta ao Rica como o
  `AskUserQuestion` (`Perguntou <pergunta>`).
- **Erro de ferramenta não é modal:** fica na linha, expansível.
- **Sem highlighter de linguagem.** Bloco de código é mono de uma cor. stdout e stderr em
  `text-primary`; o que separa é um rótulo `stderr` em `secondary` e um filete funcional. Canal não é
  desfecho: `state-fail` vem do código de saída. Gutter em `secondary`. URL no bloco vira link.
- **Bordas reais do dado:** `message: null` não vira item (nunca caixa vazia); `content` string vira
  um bloco só; imagem com altura reservada (`aspect-ratio 4/3`), abrindo em aba nova.
- **Estado vazio:** retrato do agente (56px) e saudação em `--ck-text-hero` sans, em `secondary`. Sem
  ação, sem ilustração.

## 8. Gramática dos painéis — a gaveta é o modelo

O modelo vivo é `components/gaveta/` (peças em `pecas.tsx`) com os tokens da §G. Painel novo compõe
dessas peças antes de criar outra.

**Layout.** Celular: uma superfície por vez. Desktop (≥ 768px): a tropa é faixa permanente na mesa
(`nav`); o palco é uma **folha** em `canvas` com 8px de margem, raio `--ck-radius-caixa` e fio de luz;
o item selecionado da tropa é pílula (abaixo).

**Gaveta.** Flutua com 8px de folga e raio 16px; ancora embaixo no celular (≤ 640px) e no topo no
desktop, crescendo para baixo e rolando por dentro. Cabe sem rolar em 390×844 e 1440×900.

**Camadas.** Cartão-mãe `--ck-gv-fundo` (quase preto) → cartões `--ck-gv-camada` (grafite, raio 16,
respiro `--ck-space-3`) → blocos `--ck-gv-bloco` (quase preto, raio 12). Dentro de `.ck-gv`, moldura
vira pílula e os fios somem: a separação é a camada.

**Cabeçalho baixo, uma linha:** a pílula do agente (bolinha "!" quando algo pede olho)
· interruptor da sessão · `×` com alvo de 44px. Embaixo, a statusline com a barra de contexto na
largura toda. Não há herói.

**Pílula do agente** (`shell/pilula-do-agente.tsx`) — a identidade do agente em qualquer tela: foto com
aro no tom de estado, primeiro nome, palavra do estado; o fundo estica com mola quando a palavra muda.
Geometria e fundo (o vidro escuro) únicos; só a voz anima (ondas falando, barras ouvindo). Palavra e tom saem de uma régua só
(`shell/estado-da-pilula.ts`), a mesma da pílula da voz, da gaveta e do rótulo do pulso: a cena da voz
em curso vence; sem ela, a frota no vocabulário da voz (trabalhando · na linha · esperando você · desligado).

**Peças:**
- `Cartao` — título opcional à esquerda, ação à direita.
- `Bloco` — o preto dentro do cartão.
- `Interruptor` — trilho + botão **com a palavra do estado ao lado** (Ativo/Desligado). Um toque age.
- `Segmentado` — escolha entre poucas: trilho preto, a marcada em `--ck-gv-pilula`, `radiogroup`.
- `Pilula` — botão de ação cinza, raio pill, alvo 44px.
- Área tracejada com `Mais` (+) — porta para abrir ou criar.
- `BolinhaDeAlerta` — "!" vermelho; o motivo sempre aparece em texto na mesma gaveta.
- Ícone (`shell/icones.tsx`): traço fino, contorno aberto; sólido só no botão que conclui a ação
  (enviar, onda, parar); ação sem moldura.

**Um papel por cor:** o aro da pílula = tom de estado; azul (`--ck-gv-ativo`) = **ligado**, a ⭐
marcada e a ação principal do painel (Voltar ao chat), e nada mais; vermelho (`--ck-gv-alerta`) = só a bolinha "!"; âmbar = atenção, do estado global. Não entra
acento novo.

**Lista da tropa** (`shell/linha-da-tropa.tsx`, §T do `globals.css`) — lista, não cartões; uma anatomia
para todo agente, de pé ou dormindo, em **duas linhas no máximo**: foto redonda com aro parado no tom de
estado · nome · `%` de contexto; embaixo, o modelo · há quanto tempo agiu (`last_seen`, "agora / 12 min /
3 h / 2 d", "—" sem leitura). O estado não vira palavra na linha: aro aceso > na linha > desligado, que
também esmaece foto e nome (a palavra fica no nome acessível). Nada aparece a mais ao selecionar.
Selecionado = pílula, o vidro escuro da `PilulaDoAgente` sem desfoque; hover é meia pílula. Nada pulsa;
só a cor troca, em `--ck-dur-calm`. O pulso de 24h mora na gaveta. O topo do chat é a própria pílula
(`lugar="topo"`, foto 36). A VPS é cartão no pé da tropa (`composer` + fio de luz, grade 2×2 de barras
finas, cor só acima do teto de `recursos-da-vps.ts`, processos atrás de pílula).

**Medidores:** contexto neutro → âmbar ≥ 25% → `state-fail` > 30% (`corDoContexto`); cota âmbar ≥ 80% → `state-fail` ≥ 95% (`corDaCota`).

**Carga sem pulo:** enquanto o dado não volta, reserva a altura que ele vai ocupar.

**Conversas** (`?painel=conversas`, `gaveta/painel-de-conversas.tsx`) — terceira visão da gaveta,
porta no lugar do antigo Destravar. Lista só com título e tempo; o toque abre a **leitura** por cima
(`.ck-surge`, título por `layoutId`), com ⭐, Concluída, Renomear, 🗑 e o **Continuar esta** no rodapé —
pílula clara, sem âmbar e sem confirmação: ocupado, só o nome muda; na espera, enche por dentro com as
etapas reais da troca. Barra indeterminada só na espera vista do painel. "Em uso agora" some com a conversa de
agora vazia. O ritmo da Motion espelha os tokens em `gaveta/ritmo-do-historico.ts`. A troca aparece no chat como marco
(`feed/marco-da-troca.tsx`), e o pedido que o cockpit faz ao agente é linha discreta, nunca balão
do Rica. Decisões e contrato: `docs/conversas/PLANO.md`.

**Superfícies flutuantes.** Tudo que abre por cima de outro componente — menu (motor, conta,
modelo e esforço), bolha de comandos, gaveta do "+", aviso do véu de operação — veste `.ck-menu-surface`
(§F do `globals.css`), o material da pílula do agente: o escuro dela, mas **opaco** (`--ck-flutuante-fundo`;
texto de trás não pode ser lido através do menu), fio `--ck-flutuante-fio`, raio `--ck-flutuante-raio` 22px e a sombra `--ck-flutuante-sombra`
(a exceção da §9.3: sobre a gaveta quase preta, luminância não separa camada). Dentro dela o item tem
raio 18px (concêntrico ao respiro de 4px), hover e `data-highlighted` são véu branco e o selecionado é
véu mais forte com ✓. Nem a caixa nem o item mostram anel de foco (§9.17); o item focado é o véu e,
no foco por teclado, um fio interno de 1px em `--ck-edge-functional` — cinza, nunca cor. Menu novo usa
as primitivas de `components/ui/` e herda tudo isso; cor literal ou borda própria no conteúdo do menu
não entra.
Menu de conta: uma conta por bloco (`--ck-flutuante-bloco`) — nome curto, email miúdo, marcas
"✓ ativa" e "melhor agora" (mais folga somando 5h e 7d, `conta-folga.ts`) — e as janelas numa grade de
colunas fixas (rótulo · barra · % · quanto falta, "2h/5h · volta 04:40", "3/7 d"). O tempo vem
de cada conta, do reset que o `/api/contas` lê na sonda; o traço só quando falta leitura.

**Composer.** Duas camadas de vidro: a caixa tem o próprio, na forma dela (§2); acima, a borda
progressiva (`.ck-borda-progressiva`, 5 camadas de 1→16px + `--ck-rodape-material`) dissolve o feed a
partir da cabeça da bolinha (`.ck-bolinha`, a presença do agente no alto do composer). Altura, respiro e
teclado: `cockpit-v2-composer.md` §5. Em repouso, uma
fileira ([+] · campo · motor · voz); com conteúdo, texto em cima e controles na base, até `--ck-h-campo-max`. Barra de rolagem do app
(`scrollbar-*` **e** `::-webkit-scrollbar`, sem setas).

## 9. Proibições — reprovam review

1. Hex, `rgb()`, `oklch()` ou cor nomeada fora do `globals.css`.
2. `backdrop-filter` fora dos materiais declarados na §2 — nunca em lista ou feed.
3. `box-shadow` como sombra de profundidade, salvo `--ck-flutuante-sombra` na superfície flutuante (§8). Brilho emissivo de cor (o pulso) é luz, não sombra.
4. Animar `width`/`height`/`top`/`left` em CSS — no feed, mudança de tamanho é da Motion (§5).
5. `100vh`. Altura da app é da `.ck-janela`: `100dvh` no navegador, `100lvh` no app instalado,
   `--ck-viewport-altura` com teclado (`cockpit-v2-composer.md` §5). Fora dela, `100dvh` + `env(safe-area-inset-*)`.
6. `font-size` < 16px em campo de entrada.
7. Cor como único portador de significado.
8. `--ck-text-tertiary` em corpo, ou como texto sobre `nav`, `composer` ou `raised` (§2).
9. Token inventado localmente.
10. Mais de uma superfície por vez no celular.
11. Véu de interação (`--ck-overlay-*`) sobre `--ck-surface-raised`.
12. Link sem sublinhado, ou URL como texto comum.
13. Enfeite que não se paga: herói, halo, ilustração genérica, cabeçalho redundante, botão que não leva a lugar nenhum.
14. Highlighter de linguagem em bloco de código.
15. Tamanho, entrelinha ou tracking como valor solto (`text-[13px]`, `leading-[1.55]`).
16. Acento novo na gaveta, ou acento fora do seu papel (§8).
17. Anel ou linha de foco colorida (`outline`, `ring`, `box-shadow`) em qualquer elemento — o `--ck-focus` azul saiu do código por ordem do Rica (02/10). O `:focus-visible` global é `outline: none`; foco aparece por véu ou borda do próprio elemento, nunca por linha azul. Doc de referência antigo que peça *focus ring* está revogado.

## 10. Amarrações e verificação

- `:root { color-scheme: dark; }` — sem isso, scrollbar, input e select nativos saem claros.
- `theme-color` bate com a cor que encosta na barra do Safari: `#191919` (canvas) no `layout.tsx` e no
  `manifest.ts` (`background_color`, `theme_color`); `#222222` (mesa) em `app/page.tsx` e
  `app/faxina/page.tsx`. Mudou o token, muda aqui.
- O WebKit não roda na VPS. Prefixo `-webkit-` se confere no CSS servido; defeito que só aparece no
  iPhone do Rica pede instrumento que leia o layout no aparelho dele antes de qualquer hipótese.

## 11. Referência — ACI Biller dark

Imagens em `docs/referencias/aci-biller/` (web e mobile; fonte: theskinsfactory.com, case ACI Biller dark).

- fundo do cartão-mãe: ACI `#000000` → nosso `--ck-gv-fundo` `#0a0a0a`
- cartão: ACI `#212028` → `--ck-gv-camada` `#1d1e21`
- bloco interno: ACI `#000000`–`#040405` → `--ck-gv-bloco` `#0d0e10`
- pílula: ACI `#3a3d49` → `--ck-gv-pilula` `#343539`
- acento laranja: ACI `#f17a23` → não adotado; a identidade é o aro da pílula, no tom de estado
- azul "ligado": ACI `#2e82e1` → `--ck-gv-ativo` `#3589ed`; rótulo em `--ck-gv-ativo-texto` `#6ab3fd`
- alerta: ACI `#de051e` → `--ck-gv-alerta` `#ea2126`
- texto secundário: ACI `#828284` → nosso `--ck-text-secondary` `#b1b1b1`

**Decisão.** Adota-se a gramática (camadas preto/grafite, pílula, interruptor com rótulo, tracejado
com "+") e não os valores: degraus de camada mais baixos que os da ACI (discreto), pretos
levemente erguidos (OLED), e texto e azul mais claros, porque o cinza secundário e o azul de rótulo
da ACI ficam abaixo de 4.5:1 sobre o cartão. O herói com halo da ACI não entra.

---
Histórico de decisões, medições e tentativas até 10/2026: `docs/pesquisas/cockpit-v2-estetica-historico-ate-2026-10.md`.
