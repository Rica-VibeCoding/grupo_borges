# Turno 1 v2 — Card do agente (função primeiro, forma depois)

> **Por que v2:** a v1 colocou desenho ASCII e imagem de mockup como anexo. Resultado: o Designer copiou o desenho e a imagem em vez de extrair tom. Nesta v2 não tem desenho ASCII, não tem mockup do cockpit anexado, e a paleta vem em **hex literal hardcoded** dentro do prompt (não em `@theme inline` que ele pode ignorar).

---

## 1. O que estamos construindo

Cockpit interno pra orquestrar **6 agentes Claude Code (CLI)** que rodam 24/7 numa VPS Linux, cada um numa sessão `tmux`. Cada agente é especializado (dev sênior, marketing, CFO read-only, consigliere, etc). Hoje os handoffs entre eles passam por Telegram — quero substituir por **interface visual única** que mostra estado vivo.

Uso é **interno e privado** (apenas eu, Rica). Backend FastAPI já existe e entrega os endpoints listados na Sec 5. UI vai pra Vercel; navegador na tailnet bate direto na VPS via Tailscale Serve.

Plataforma alvo: **desktop primeiro** (1440×900 e ultrawide). Mobile-friendly secundário.

**Leitura intensa, escrita pontual.** Vou olhar várias vezes ao dia pra responder em 1 segundo: quem está rodando, quem travou, quem ficou ocioso, quem precisa de input, qual modelo cada instância está usando.

Este turno foca em **1 componente apenas: o card do agente**. Não desenhe layout do cockpit, não desenhe header/filter bar/kanban. Só o card, em 5 estados de status + 1 estado expandido (multi-instância).

---

## 2. Filosofia visual — Console Operacional Sci-Fi Sóbrio

**Sci-fi sim, mas SÓBRIO.** Apollo Guidance Computer + bridge de Foundation (Apple TV, série) + control-room IBM dos anos 70 + Severance UI. **NÃO** Cyberpunk 2077, **NÃO** Star Trek LCARS hollywood. Nada de scanlines fortes, glow exagerado, cores neon saturadas em larga superfície.

Vibe: "este monitor existe há 20 anos e ainda funciona perfeitamente". Densidade alta, monospace dominante, hairlines de 1px como linguagem visual primária.

---

## 3. Paleta — hardcoded em hex (NÃO use Tailwind slate-*/zinc-* nem cores próprias)

Cole esse `<style>` no HEAD do HTML standalone que você gerar. Use as variáveis em todo o card.

```html
<style>
:root[data-theme="dark"] {
  --bg:               #060b18;  /* deep navy quase preto */
  --panel:            #0d1b2a;  /* azul-noite */
  --card:             #112240;  /* azul mid */
  --card-2:           #153258;  /* azul mid-light pra hover/active */
  --border:           #1a3a5c;  /* hairline visível */
  --border-subtle:    #142d4a;  /* hairline interna */
  --text:             #e0f7fa;  /* cyan-ice quase branco */
  --muted:            #5d9bb8;  /* azul-acinzentado */
  --accent:           #00b8d4;  /* CYAN SÓBRIO — uso primário */
  --accent-hot:       #00f0ff;  /* CYAN NEON — só focus ring/pulse de status */
  --accent-subtle:    rgba(0, 184, 212, 0.08);
  --accent-border:    rgba(0, 184, 212, 0.25);

  --status-idle:      #5d9bb8;
  --status-running:   #00b8d4;
  --status-blocked:   #ff6b35;
  --status-done:      #23a86b;
  --status-offline:   #4a5666;  /* cinza-muted, não cor */
}
:root[data-theme="light"] {
  --bg:               #eef1f5;
  --panel:            #e8ecf2;
  --card:             #f4f6f9;
  --border:           #c4cdd8;
  --border-subtle:    #d8dee6;
  --text:             #0a1628;
  --muted:            #5a6a7e;
  --accent:           #0097a7;
  --accent-hot:       #00b8d4;
  --status-idle:      #5a6a7e;
  --status-running:   #0097a7;
  --status-blocked:   #d35400;
  --status-done:      #1f8050;
  --status-offline:   #98a4b3;
}
</style>
```

Toggle dark/light no canto top-right da viewport (botão ícone Sun/Moon da Lucide). Persistir em `localStorage` (`cockpit-theme`). Animação 150ms ao trocar.

**Regra dura:** se a cor do elemento não estiver na paleta acima, **não use**. Não invente cinzas, não use opacidade Tailwind sobre branco. Variações = mudar `opacity` da var, ou usar `--card-2` em vez de `--card`.

---

## 4. Tipografia — mono dominante

- **Mono = JetBrains Mono.** Use em ≥70% dos elementos textuais: slug, status label, model id, cli, IDs (`RN-2182`), timestamps, paths, contadores, badges, headers de coluna, navigation labels.
- **Sans = Geist Sans (não Inter, não Roboto, não system).** Use APENAS em: nome do agente (ex "Daniel Singh"), descrição de role em prose curta.
- **Tamanhos:** body 13px / mono caption 11px / mini-mono uppercase 10px (labels HUD com letter-spacing 0.05em).
- Letter-spacing: -0.02em em mono caption normal; +0.05em em mini-mono uppercase.

---

## 5. O CARD do agente — função primeiro

### 5.1 Dados que cada card consome (do backend real)

Os campos abaixo vêm de `GET /api/agents` (lista) ou `GET /api/agents/{slug}` (detalhe). Cada card é alimentado por 1 row. Na UI gerada por você, **mocke** esses campos com dados realistas pro agente Daniel.

| Campo (backend)                | Tipo            | Como aparece no card                                                |
|--------------------------------|-----------------|---------------------------------------------------------------------|
| `slug`                         | string          | Texto pequeno em mono lowercase abaixo do nome                      |
| `name`                         | string          | Nome em sans, peso médio (`Daniel Singh`)                           |
| `role`                         | string          | Linha menor em sans regular (`Dev sênior — Líder de área`)          |
| `emoji`                        | string          | **NÃO usar como avatar gráfico.** Usar como tag mini-mono opcional após o nome (ex: pílula minúscula). Pode ser omitido sem prejuízo. |
| `state_cli`                    | string          | Footer: `cc` ou `codex` em mono caption                             |
| `state_model`                  | string          | Footer: `opus-4.7` ou `sonnet-4.6` em mono caption                  |
| `pane_excerpt`                 | string          | Zona PREVIEW: 2 linhas em mono 11px (último output do tmux)          |
| `instance_count`               | integer         | Badge à direita do footer: `[2]` em mono peso 600                    |
| `current_task_id`              | string nullable | Quando preenchido, mostra ID em mono colorido cyan na zona PREVIEW (`RN-2182`) antes do excerpt |
| `last_seen`                    | unix timestamp  | Footer: `há 12s` em mono 10px                                        |
| `capabilities` (JSON array)    | list            | Não exibir todas. Mostrar contador: `5 skills` em mini-mono uppercase, clicável (abre modal aba Skills) |

**Sparkline (campo separado):** vem de `GET /api/agents/{slug}/sparkline?hours=24` que retorna `[{bucket: "YYYY-MM-DD HH", count: int}, ...]` com 24 entradas (uma por hora). No card aparece como **mini bar chart**: 24 barras verticais finas (1-2px de largura cada), altura proporcional ao count, espaçamento 1px, total ~60-80px de largura, ~18-22px de altura. Cor das barras = `--accent` (cyan); barras vazias = `--border-subtle` (linha muito tênue). Posição: zona dedicada entre PREVIEW e footer (Sec 6, "zona 2.5"). Mock: passar 24 valores realistas (alguns picos de 8-12 eventos, vales de 0-2). Quando o agente está `offline`, o sparkline aparece esmaecido (opacity 0.35).

**Status agregado:** o card mostra 1 status que é derivado das instâncias:
- Se ≥1 instância `running` → card em `running`.
- Senão se ≥1 `blocked` → `blocked`.
- Senão se ≥1 `idle` → `idle`.
- Senão se todas `done` → `done`.
- Se `last_seen` > 60s atrás OU sem state → `offline`.

### 5.2 Interações no card (este turno mostre, mas NÃO precisa funcionar)

Mostre os elementos que disparam estas ações (botões, chips, badges com cursor pointer e hover state). Lógica não precisa rodar; é prototype visual.

- **Click no card (área grande)** → abriria modal de detalhe com 4 abas (Missão · Skills · Docs · Tabelas). Indicador visual: `cursor: pointer` + leve elevação no hover.
- **Click no badge `[N]` de instâncias** → expande pílulas inline `daniel-1` `daniel-2` (Sec 5.4). NO ESTADO COLAPSADO mostre só o badge.
- **Hover em pílula de instância** → tooltip pequeno: model + cli + uptime.
- **Click em pílula de instância** → seleciona aquela instância (foco visual + ring cyan).
- **Click no chip `5 skills`** → abriria modal aba Skills.
- **Botão `+` ao lado do badge `[N]`** → abriria nova instância. Mostre o botão pequeno `+` em hairline, mono, sem fundo.
- **Click no chip `opus-4.7`** → abriria dropdown de modelo (Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / Codex GPT-5.5). Indicador: chevron pequeno após o label.

### 5.3 Estados visuais — gerar 5 cards lado a lado, um por estado

Renderize o **mesmo agente Daniel** em **5 cards horizontais lado a lado**, cada um num estado diferente:

1. **`running`** — dot status pulsando cyan `#00b8d4` (animation 1.6s ease-in-out, opacity 0.6↔1.0, box-shadow alpha máx 0.25 blur 4px). Zona PREVIEW mostra task ID `RN-2182` em mono cyan + 2 linhas de pane_excerpt com fade-out gradient na 2ª linha (mask-image, NÃO `text-overflow: ellipsis`). Footer com `há 12s`.
2. **`idle`** — dot estático `#5d9bb8` muted. Zona PREVIEW vazia ou com texto mini-mono uppercase muted: `STANDBY · sem tarefa ativa`. Footer com `há 4min`.
3. **`blocked`** — dot estático `#ff6b35` (laranja). Zona PREVIEW mostra label mini-mono uppercase laranja: `AGUARDANDO INPUT` + 1 linha do prompt pendente. Footer com `há 1min`.
4. **`done`** — dot estático `#23a86b` (verde). Zona PREVIEW mostra mini-mono uppercase verde: `CONCLUÍDO ·` + `RN-2178` em mono verde + 1 linha de outcome. Footer com `há 8min`.
5. **`offline`** — card com opacidade geral 0.55, dot `#4a5666`, hairline mais fraca (`--border-subtle`). Zona PREVIEW mostra mini-mono uppercase muted: `SEM HEARTBEAT · última conexão há 2h14`.

### 5.4 Multi-instância — 1 card adicional expandido

Renderize **mais 1 card abaixo dos 5** mostrando o estado **expandido** após clicar no badge `[3]`. Nesse card, em vez do badge `[3]` colapsado:

- Linha de pílulas inline horizontal: `daniel-1` `daniel-2` `daniel-3`, separadas por gap de 8px.
- Cada pílula tem dot status próprio à esquerda + label `daniel-N` em mono.
- A pílula **selecionada** (vamos assumir `daniel-2`) tem outline 1px `--accent-hot` com glow contido.
- Cada pílula é clicável (cursor pointer); hover mostra tooltip com model+cli+uptime.
- Botão `+` no fim das pílulas pra abrir nova instância.

Quando expandido, a zona PREVIEW mostra o `pane_excerpt` da instância **selecionada** (não a agregação).

---

## 6. Anatomia visual — zonas (descrição, não desenho)

Card com largura entre 240px e 280px, altura variável por estado mas com consistência. Layout vertical em 3 zonas separadas por hairline 1px `--border-subtle` ocupando full width:

- **Zona 1 (header):** avatar à esquerda + bloco de texto (nome / slug / role) à direita do avatar. Status pill no canto top-right (dot 6px + label uppercase 10px mono). Padding 12px. Sem background diferenciado.
- **Zona 2 (preview):** label mini-mono `PREVIEW` (uppercase 10px peso 500 letter-spacing 0.05em opacity 0.5) + content (task ID em mono colorido conforme estado + pane_excerpt 2 linhas mono 11px com fade-out gradient na 2ª linha quando running). Altura mínima reservada (~64px) pra não saltar entre estados.
- **Zona 2.5 (sparkline):** linha curta entre preview e footer. À esquerda: label mini-mono uppercase `24H` (opacity 0.4). À direita: mini bar chart de 24 barras (Sec 5.1, "Sparkline"). Altura total da zona ~22px. Hairline `--border-subtle` divide essa zona da seguinte.
- **Zona 3 (footer):** linha única em mono 11px opacity 0.6: `model_id · cli` à esquerda, depois badge `[N]` ou pílulas (Sec 5.4), depois timestamp `há Xs` em mono 10px à direita. À extrema direita um chip clicável `5 skills` em mini-mono uppercase.

**Avatar (zona 1):**
- Caixa 36×36 px, `border-radius: 2px` (NÃO round, NÃO `rounded-md`).
- Conteúdo: **iniciais do nome em JetBrains Mono peso 600, 14px**, sobre fundo `--card-2`. Pra Daniel Singh: `DS`. Pra José Pavan: `JP`. Pra Lucas Marchetti: `LM`. Pra Vinicius Zanella: `VZ`. Pra Felipe Conti: `FC`. Pra Luiz Barsi: `LB`.
- **NÃO use emoji como avatar.** Emoji da YAML é decorativo opcional (ver Sec 5.1).

**Frame do card:**
- Background `--card`, border 1px `--border`, `border-radius: 2px` (sci-fi sóbrio quer cantos retos).
- Padding 12px.
- Hover: border vai pra `--accent-border`, `transform: translateY(-1px)`, transition 150ms ease-out, cursor pointer. Sutil.
- Focus visible (Tab navigation): outline 1px `--accent-hot` (`#00f0ff`) com offset 2px, glow máximo blur 6px alpha 0.2.

**Pulse no dot running:**
- `@keyframes`: opacity 0.6 → 1.0 → 0.6, box-shadow `0 0 4px rgba(0, 184, 212, 0.25)` → transparent → mesmo. Period 1.6s ease-in-out infinite.
- Dentro de `@media (prefers-reduced-motion: reduce)` → animation: none, opacity 1.0 fixa.

---

## 7. Anti-padrões — NUNCA fazer

- ❌ Inter, Roboto, Helvetica, system fonts (essas são "AI default")
- ❌ `border-radius` > 2px (exceto o dot do status que é `border-radius: 50%`). NUNCA `rounded-md`/`-lg`/`-xl`.
- ❌ Purple/violet/indigo gradients (cliché AI)
- ❌ Gradients lineares em background do card. Use cor sólida.
- ❌ Sombras pesadas (`shadow-md`+). Hover usa só border + translateY, NÃO drop-shadow.
- ❌ Glow excessivo (text-shadow alpha > 0.25, blur > 8px) — vira disco-club
- ❌ Scanlines decorativas no background — pega pesado e não combina com sóbrio
- ❌ Cyan neon `#00f0ff` em larga superfície (background, gradients, borders grossas). Só em focus ring e pulse.
- ❌ Spinners genéricos. Pra loading: scan-line cyan ou texto + sublinhado.
- ❌ **Emoji como avatar gráfico.** Emoji só em contexto textual auxiliar.
- ❌ **Truncate com `...` em pane_excerpt.** Sempre fade-out gradient via mask-image.
- ❌ **Copiar layout de qualquer imagem anexada.** Esta sessão não anexa mockup do cockpit. Use só a paleta e tipografia descritas acima.
- ❌ Microcopy bobinho ("Oops!", "Ready! 🎉"). Texto seco e técnico.
- ❌ shadcn-style padrão (rounded-md, soft shadows, neutral palette) — perde toda a identidade.
- ❌ Tab/Component library aparente (não use componentes que pareçam Material/Chakra/Mantine).

---

## 8. Output esperado deste turno

**1 página HTML standalone** com:

1. Toggle dark/light (Sun/Moon Lucide) no top-right da viewport. Persistir em `localStorage`.
2. **5 cards horizontais lado a lado** (Sec 5.3) em viewport ≥1440px. Em viewport mais estreita, wrap em 2 linhas.
3. **1 card adicional abaixo** mostrando estado multi-instância expandido (Sec 5.4).
4. Background da viewport `--bg`. Sem nenhum chrome de app (sem header de cockpit, sem nada além dos cards e do toggle).
5. Pulse no card `running` ativo (CSS animation respeitando `prefers-reduced-motion`).
6. Hover state em todos os cards funcional.
7. Focus ring cyan ao tabular.

**Stack do HTML:** Tailwind 4 via CDN (ou classes utilitárias inline) + `<style>` global com a paleta da Sec 3 + JS mínimo pra toggle de tema. NÃO importe shadcn, NÃO importe Material UI, NÃO importe Radix UI components (vamos rebuildar do zero quando portar pra Next.js depois).

---

## 9. Critério de aceite

- [ ] Paleta usa **EXATAMENTE** os hex da Sec 3, dark + light. Nenhuma cor inventada.
- [ ] Tipografia: ≥70% dos elementos textuais em JetBrains Mono. Geist Sans só em nome e role.
- [ ] **Avatar tem iniciais em mono**, não emoji.
- [ ] 5 estados (running / idle / blocked / done / offline) renderizados lado a lado, cada um VISUALMENTE distinto pelo dot de status + zona PREVIEW.
- [ ] Card multi-instância expandido renderizado abaixo, com 3 pílulas e 1 selecionada.
- [ ] `border-radius` máximo 2px em qualquer elemento (exceto dot redondo do status).
- [ ] Hairlines 1px nas 4 zonas internas do card (header / preview / sparkline / footer) + na border externa.
- [ ] Sparkline com 24 barras, altura proporcional, cor `--accent`, esmaecido em `offline`.
- [ ] Pulse no `running` com period 1.6s, opacity 0.6↔1.0, glow contido (alpha ≤0.25 blur ≤4px), respeitando `prefers-reduced-motion`.
- [ ] Light mode tem o mesmo nível de polimento que dark — não pode ser afterthought retinted.
- [ ] Focus ring cyan ao Tab funciona, offset 2px.
- [ ] HTML standalone, sem dependência de framework JS.

Quando devolver, vou avaliar contra cada item acima. Se passar, abro turno 2 (replicar pros 6 agentes diferentes + adicionar header com filter bar + KPI panel lateral + footer técnico).
