# Auditoria — ações rápidas do painel (commit c111fa3, Daniel, 30/07)

> Auditor: Hiro. Regra da casa: RELATO, não correção — quem ajusta é o Daniel.
> Escopo: `acoes-rapidas.ts`, `acoes-rapidas.test.ts`, `bloco-de-acoes.tsx`,
> `app/acoes/page.tsx`, plug em `app/agente/[slug]/page.tsx`.
> Régua: `docs/cockpit-v2-estetica.md` (§2.6, §3, §9, tokens), ordens do Rica.

**Fila — fechada:**

- [x] 1. Desvio §2.6: elevação + fio de luz no lugar da barra de 2px
- [x] 2. Textos removidos: ponto cego de acessibilidade
- [x] 3. Tokens dos 3 controles × proibições §9 × toque/contraste
- [x] 4. Leitura geral do código novo (lógica, não só tema)
- [x] 5. Suíte 242 + tsc — **242/242 pass, tsc --noEmit exit 0** (rodados por mim)

---

## Veredito por item da fila

### 1. Desvio §2.6 — APROVADO, com número meu por cima do dele

A §2.6 manda véu `--ck-overlay-selected` (1.134×) + barra de 2px em
`text-primary` para item selecionado. O segmentado usa pastilha elevada
(`raised` sobre trilho `composer`) + fio de luz `.ck-lit`. O desvio é legítimo:

- É **ordem direta do Rica**, citada no código e no commit: *"tira essa linha
  branca de selecionado, vamos pensar em algo mais discreto que pegue o botão
  todo"*. Pela §9.1 ele é juiz único — ordem dele revoga contrato.
- A justificativa técnica é correta: a §2.6 pensa item de lista; segmentos
  contíguos com barras verticais de 2px não leem como seleção.
- **§9.11 respeitada**: o ativo perde o `.ck-veil` (véu sobre `raised` = 2.98:1
  na borda funcional). O inativo mantém `.ck-veil` sobre o trilho `composer`,
  que é exatamente a superfície que a tabela da §2.6 mediu. Correto.
- Contraste re-medido por mim (Python, sRGB): ativo `#f0f2f4/#313131` =
  **11.59:1**; inativo `#b1b1b1/#2a2a2a` = **6.69:1**; em voo (opacity 0.55
  composto) = **4.82:1** — passa o piso de 4.5:1 para label até no estado
  transitório. O "1,33× mais claro que o trilho" do commit é consistente com a
  escada de superfícies (composer 0.285 → raised 0.315).
- Não é cor sozinha (§9.7): seleção = elevação + textura (fio de luz) +
  `aria-pressed`. A luminância é a mesma linguagem da §2.5/§2.6.

### 2. Textos removidos — DOIS pontos cegos (achados 1 e 2 abaixo)

A retirada dos textos foi ordem do Rica e está fiel: nada entrou no lugar, a
ressalva sobrevive no `aria-label` do grupo via `descreveControle` (testado em
`acoes-rapidas.test.ts:224`). Mas a cobertura de leitor de tela tem dois furos
que o commit não viu — detalhados nos achados 1 e 2.

### 3. Tokens × §9 × toque/contraste

- **Zero hex cru** nos 3 arquivos (o `#424242` em `bloco-de-acoes.tsx:251` é
  comentário citando o token hairline, não valor aplicado). §9.1 ok.
- **Nenhum token inventado localmente** (§9.9): todos os `var(--ck-*)` usados
  existem no `globals.css` — conferi um a um (`surface-composer`,
  `surface-raised`, `edge-functional`, `edge-light`, `state-ok`,
  `state-attention`, `text-primary/secondary`, `touch-min`, `radius-frame/chip`,
  `dur-fast`, `ease`, `track-overline`, `leading-body`, `text-xs/sm`,
  `space-*`).
- **Toque 44px**: segmentos, destrava e "Tentar de novo" usam
  `minHeight: var(--ck-touch-min)`. **Exceção: o botão de dispensar aviso**
  (achado 5).
- **Movimento**: só `color` e `opacity` em `transition` — §9.4 ok.
- **`title` + `aria-pressed` + `aria-busy` + `role="group"`** presentes.

### 4. Leitura geral — sólida, com uma lacuna de corrida (achado 3)

O desenho está bom: transporte por ref (laço infinito documentado e evitado),
AbortController na reabertura, reversão guardada por contador de sequência,
`leiaDestrava` conferindo `tmux_delivered` (o 200 mentiroso), diagnóstico
sempre com resumo + saída, valor cru pro endpoint e rótulo pt-BR na tela,
escada de risco estável com degrau desconhecido indo pro fim. O plug na
`page.tsx` usa o `usePainelAberto` como combinado (fallback do servidor fora do
provider, otimista dentro) e posiciona as ações fora da área rolável — coerente
com o `.ck-flutua` ancorado no topo.

### 5. Suíte + tsc

`npm test`: **242 pass, 0 fail** (bate com o commit; os 2 testes removidos
cobriam só o texto revogado). `npx tsc --noEmit`: **exit 0**.

---

## Achados (severidade decrescente)

### 1. MÉDIA · a11y — `descricao` vira só `title`, nunca `aria-label`

`acoes-rapidas.ts:60-62` documenta o contrato do campo: *"Vira `title` E
`aria-label`: no toque o primeiro não existe, então ele nunca é o único
portador."* O `bloco-de-acoes.tsx:407` aplica **só o `title`** — não há
`aria-label` por opção em lugar nenhum do segmentado.

Consequência: a explicação do que cada modo faz ("Lê e propõe. Não altera
nada.") não existe no toque nem no leitor de tela. Eram justamente os dois
públicos que o comentário dizia proteger. O Rica mandou tirar os textos da
tela, não do produto — e metade da proteção combinada ficou só no papel.

### 2. MÉDIA · a11y — `aria-label` estático do destrava engole os três estados

`bloco-de-acoes.tsx:288`: o botão tem `aria-label="Destravar o agente — envia
Escape no terminal dele"` fixo, e o nome acessível **sempre** vence o conteúdo.
O leitor de tela nunca anuncia "Destravando…" nem "Escape enviado" — o recibo
(entregue = palavra + cor verde) é 100% visual. `aria-busy` cobre parcialmente
o "enviando"; o "entregue" não chega a quem não vê. Efeito colateral: no estado
entregue, o nome acessível não contém o texto visível ("Escape enviado"), o que
também fura WCAG 2.5.3 (label-in-name) para controle por voz.

### 3. BAIXA · lógica — falha de troca atropelada some em silêncio

`bloco-de-acoes.tsx:206-214`: a guarda `meu === sequencia.current` impede que
resposta velha reverta troca nova (correto), mas o mesmo `if` suprime o
`setFalha`. Cenário: toque no esforço (rede recusa) seguido de toque na
permissão (rede aceita). A falha do esforço não reverte nem avisa — e o valor
otimista recusado sobrevive na tela, porque o `anterior` da segunda troca já o
continha. A próxima abertura do painel corrige (re-busca), mas até lá o Rica vê
um esforço que o back não gravou, sem aviso nenhum. Janela pequena, cenário
real (dedo insiste + back recusando é o caso da vitrine "O back recusa").

### 4. BAIXA · docs — vitrine descreve comportamento que o Rica revogou

`app/acoes/page.tsx:225`: a nota da seção Codex diz *"a ressalva aparece UMA
vez no rodapé em vez de três"*. O rodapé de ressalva saiu do
`bloco-de-acoes.tsx` por ordem do Rica — quem exercitar a vitrine procura um
texto que nunca aparece e pode reportar defeito onde não há.

### 5. BAIXA · toque — dispensar aviso tem alvo de ~21px

`bloco-de-acoes.tsx:316-328`: o botão de fechar a falha é `padding: 4px` +
ícone de 13px ≈ **21×21px**, abaixo do piso de 44×44 da §3 (iOS HIG, tabela de
contraste). É o único alvo do bloco sem `minHeight: var(--ck-touch-min)`.

### 6. NIT — `role="status"` + `aria-live="assertive"` no mesmo elemento

`bloco-de-acoes.tsx:310-311`: `status` já implica `aria-live="polite"`; marcar
`assertive` por cima é contraditório e o comportamento varia entre leitores.
Se a intenção é interromper, `role="alert"` diz isso de graça.

---

## O que conferi e está certo (para não reabrir)

- Desvio §2.6 com ordem do Rica citada e §9.11 respeitada; contrastes medidos
  por mim passam (11.59 / 6.69 / 4.82).
- Ressalva `session_may_diverge` fora da tela mas presente no `aria-label` do
  grupo, com teste cobrindo.
- `tmux_delivered: false` vira aviso, nunca recibo — testado.
- Valor cru pro endpoint, tradução só na pele; escada de risco estável;
  degrau desconhecido vai pro fim sem sumir — testado.
- Quatro controles nunca juntos (CC × Codex) — testado.
- Re-busca a cada abertura via `usePainelAberto` (integração com o meu
  painel-otimista exatamente como combinado, fallback fora do provider).
- `acceptEdits` só aparece quando é o valor atual — testado.
- Placeholder de 96px `aria-hidden` durante a carga — sem pulo de layout.
- Zero hex cru, zero token inventado, zero animação de layout.
- 242/242 testes, tsc limpo.
