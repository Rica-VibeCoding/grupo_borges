# Turno 1 — Foundation visual + card do agente

> **Versão canônica (post-mortem v1+v2 em `.archived/`).** Esta foi a versão que funcionou no Claude Designer em 2026-05-10. Princípio que valeu: **paleta exata + conceito + funções DUROS, mas forma + composição + animação SOLTOS pra liberdade criativa do Designer**. Quando colar no Designer pra novo turno, adicione no topo: "Crie em arquivo HTML standalone novo; não toque em arquivos já existentes do projeto."

---

## 1. O que estamos construindo

Cockpit interno que orquestra **6 agentes Claude Code (CLI)** rodando 24/7 numa VPS. Hoje os handoffs entre eles passam por Telegram; quero substituir por **interface visual única** que mostra estado vivo. Uso é privado (apenas eu), backend FastAPI já existe atrás de Tailscale Serve. UI desktop primeiro (1440px+), leitura intensa, escrita pontual.

Este turno foca em **1 componente: o card do agente** — em 5 estados de status + 1 estado expandido (multi-instância). Não desenhe o cockpit inteiro.

---

## 2. Conceito visual

**Cyberpunk HUD aesthetic operacional** — não decoração, função. Inspiração: bridge de uma estação espacial moderna em série de prestígio (não Star Wars hollywood, não Cyberpunk 2077 saturado). O sistema parece ter sido desenhado por engenheiros aeroespaciais que valorizam densidade de informação, e está em uso há 5 anos sem virar nostalgia.

**Cyan neon como sinal de vida.** Sobre o navy escuro de fundo, o cyan `#00f0ff` é caro — só aparece onde algo está vivo: status running, ID de task ativa, focus ring, glow sutil em superfície ativa, hover. Em estados parados (idle/done/offline), o cyan some, o card fica monocromático muted, comunicando "sem ação". Quem olha pra tela em 1 segundo sabe quem está rodando, sem precisar ler.

**Densidade alta, mono dominante, hairlines como gramática visual.** Pouca cor, muita estrutura. Cantos retos ou quase. Sombras só de luz (glow), nunca de objeto.

---

## 3. Paleta — Hermes scifi-theme.css fiel

Cole esse `<style>` no HEAD. Use as variáveis em todo lugar — **se a cor não está aqui, não use** (sem slate Tailwind, sem opacidade sobre branco, sem cinza inventado).

```html
<style>
:root[data-theme="dark"] {
  /* Surfaces */
  --bg:               #060b18;   /* deep navy quase preto */
  --panel:            #0d1b2a;   /* azul-noite (header, modal) */
  --card:             #112240;   /* azul mid (card padrão) */
  --card-2:           #153258;   /* azul mid-light (hover, pílula) */
  --border:           #1a3a5c;   /* hairline visível */
  --border-subtle:    #142d4a;   /* hairline interna */

  /* Ink */
  --text:             #e0f7fa;   /* cyan-ice quase branco */
  --muted:            #5d9bb8;   /* azul-acinzentado */

  /* Accent — cyan neon é o protagonista */
  --accent:           #00f0ff;   /* CYAN NEON primário (running, focus, active) */
  --accent-active:    #00e5ff;   /* hover/press do accent */
  --accent-secondary: #00b8d4;   /* cyan menos saturado (links, chips secundários) */
  --accent-subtle:    rgba(0, 240, 255, 0.08);
  --accent-border:    rgba(0, 240, 255, 0.25);

  /* Status — done usa mint neon, não verde institucional */
  --status-running:   #00f0ff;   /* mesmo cyan accent */
  --status-idle:      #5d9bb8;   /* muted */
  --status-blocked:   #ff6b35;   /* laranja */
  --status-done:      #64ffda;   /* MINT NEON brilhante */
  --status-offline:   #4a5666;   /* cinza, sem cor */

  /* Glow — vibração que dá vida */
  --glow-card:        0 0 1px rgba(0, 240, 255, 0.08);
  --glow-hover:       0 0 8px rgba(0, 240, 255, 0.3);
  --glow-focus:       0 0 6px rgba(0, 240, 255, 0.4);
}

:root[data-theme="light"] {
  --bg:               #eef1f5;
  --panel:            #e8ecf2;
  --card:             #f4f6f9;
  --card-2:           #e0e4ea;
  --border:           #c4cdd8;
  --border-subtle:    #d4dbe4;
  --text:             #0a1628;
  --muted:            #5a6a7e;
  --accent:           #0097a7;
  --accent-active:    #00838f;
  --accent-secondary: #00bcd4;
  --accent-subtle:    rgba(0, 151, 167, 0.08);
  --accent-border:    rgba(0, 151, 167, 0.25);
  --status-running:   #0097a7;
  --status-idle:      #5a6a7e;
  --status-blocked:   #c45000;
  --status-done:      #2e7d52;
  --status-offline:   #98a4b3;
  --glow-card:        0 1px 2px rgba(10, 22, 40, 0.06);
  --glow-hover:       0 0 6px rgba(0, 151, 167, 0.25);
  --glow-focus:       0 0 4px rgba(0, 151, 167, 0.4);
}
</style>
```

**Como usar bem o cyan neon `#00f0ff`:**
- ✅ Em **eventos de vida** (running dot, focus ring, hover de elementos clicáveis, ID de task ativa, glow sutil em card hover).
- ✅ Em **focus state** com glow generoso (alpha até 0.4, blur até 8px).
- ❌ NÃO use em large surfaces (background, gradients gigantes) — vira disco-club.
- ❌ NÃO substitua o `--text` por accent — leitura precisa de `--text` calmo.

---

## 4. Tipografia

- **JetBrains Mono dominante (≥70%)** em qualquer coisa estruturada: slug, IDs, status label, model id, cli, paths, contadores, badges, timestamps, headers de coluna.
- **Geist Sans** apenas em: nome do agente em prose, descrição de role.
- **Nunca** Inter, Roboto, Helvetica, system fonts.
- Tamanhos sugestão: 10-14px é onde a vida acontece. Letter-spacing apertado em mono caption normal, levemente solto em mini-mono uppercase.

Importe Geist e JetBrains Mono via Google Fonts.

---

## 5. O que o card precisa mostrar (dados do backend real)

Cada card representa **1 agente**. Os dados abaixo vêm de `GET /api/agents` (campos reais do schema). Mocke pro Daniel Singh.

| Dado | Como aparece |
|---|---|
| nome | "Daniel Singh" |
| slug | "daniel" |
| role | "Dev sênior — Líder de área" |
| avatar | iniciais em mono (`DS`). **NÃO emoji** como avatar gráfico. |
| status agregado (1 dos 5 abaixo) | dot + label |
| model em uso | `opus-4.7` (clicável → dropdown: Opus 4.7 / Sonnet 4.6 / Haiku 4.5 / Codex GPT-5.5) |
| cli | `cc` ou `codex` |
| pane_excerpt | 1-2 linhas do último output do tmux capture-pane |
| task_id ativo | quando running ou done, mostra ID tipo `RN-2182` em mono colorido pelo status |
| instance_count | quando >1, badge clicável; click expande as pílulas |
| last_seen | timestamp relativo (`há 12s`, `há 4min`) |
| skills count | "5 skills" como chip clicável que abriria aba Skills do modal |
| sparkline 24h | série horária de eventos (24 valores). Vem do endpoint `/api/agents/{slug}/sparkline?hours=24`. Mocke 24 valores realistas. |

---

## 6. Estados a renderizar (5 cards + 1 expandido)

Renderize na mesma página, da forma que você achar melhor:

1. **`running`** — 1 instância ativa, task ID `RN-2182`, pane_excerpt mostrando 1-2 linhas do trabalho em curso. Cyan vivo. Pulse, glow ou outro sinal de vida no dot.
2. **`idle`** — sem tarefa, dot apagado. PREVIEW pode mostrar microcopy seca tipo "STANDBY · sem tarefa ativa" ou similar.
3. **`blocked`** — esperando input humano. Laranja `#ff6b35`. PREVIEW mostra a pergunta pendente em formato terminal (ex: `> Confirma drop de legacy_messages? (y/N)`).
4. **`done`** — concluído recentemente, mint `#64ffda`. PREVIEW mostra outcome curto + ID da task que completou.
5. **`offline`** — sem heartbeat há 2h+. Cinza-muted, opacidade reduzida. PREVIEW mostra "última conexão há 2h14".

**Card adicional (multi-instância expandido):**
- Status agregado: running.
- 3 pílulas: `daniel-1` (running), `daniel-2` (running, **selecionada**), `daniel-3` (blocked).
- Botão `+` no fim das pílulas pra abrir nova instância.
- O PREVIEW reflete a instância **selecionada** (daniel-2), com seu próprio task ID e pane_excerpt.

A diferença visual entre o card colapsado (badge `[3]`) e o expandido (3 pílulas) deve ser **óbvia em 1 segundo** — não só "tem mais coisa".

---

## 7. Liberdade criativa

**Estas decisões são SUAS, não minhas:**

- Dimensões dos cards (largura, altura, padding interno).
- Layout interno: como você organiza header, preview, sparkline, footer dentro do card. Pode ser mais zonas, menos zonas, ou layouts horizontais por estado.
- **Como representar o sparkline**: bar chart, mini line chart, sequência de pixels, heatmap horizontal — você escolhe a forma que melhor traduz "atividade nas últimas 24h" no idioma cyberpunk HUD.
- **Como animar o `running`**: pulse no dot é uma opção. Mas pode ser caret blinking, scan-line atravessando o card, glow oscilando na hairline, sweep de luz no excerpt — surpreenda. Restrição única: respeitar `prefers-reduced-motion: reduce`.
- Hover states (de cards, chips, pílulas, badges).
- Composição da página: como dispor os 5 cards (linha única? grid 2x3? agrupados por status?), onde fica o toggle de tema, se tem corner marks HUD, se tem grid texture sutil no background. Tudo seu.
- Microcopy técnico em mini-mono uppercase (corner marks, labels HUD, separadores). Encha de personalidade técnica seca.
- Detalhes que reforcem o conceito "console operacional há 5 anos em uso": versão, build hash, workspace, linha de status. Pode inventar o que fizer sentido.

**Surpreenda em microdetalhes.** O resto do briefing trava paleta, tipografia e dados — não trava como o componente respira.

---

## 8. Anti-padrões — só esses

- ❌ Inter, Roboto, Helvetica, system fonts.
- ❌ `border-radius` médio ou grande (`rounded-md`/`-lg`/`-xl`/`-full`). Cantos retos ou `rounded-sm` (~2px) máximo. Exceção: dot redondo do status.
- ❌ Purple/violet/indigo gradients — cliché AI.
- ❌ Drop-shadow comum (`shadow-md`+). Use **glow** (cyan, alpha controlado) em vez de sombra de objeto.
- ❌ Emoji como avatar gráfico — use iniciais em mono.
- ❌ shadcn-style padrão (rounded-md + soft shadow + neutral palette).
- ❌ Microcopy bobinho ("Oops!", "Ready! 🎉"). Tudo seco e técnico.
- ❌ Truncate com `...` em pane_excerpt. Use fade-out gradient via mask-image.

---

## 9. Stack do output

- HTML standalone.
- Tailwind 4 via CDN (ou utility classes inline) — você decide.
- `<style>` global com a paleta da Sec 3 hardcoded.
- JS mínimo só pra: toggle dark/light persistido em `localStorage` (`cockpit-theme`), seleção de pílula no card multi-instância, render do sparkline a partir de array de 24 valores.
- Geist Sans + JetBrains Mono via Google Fonts.
- NÃO importe shadcn, Material UI, Radix UI components — vamos rebuildar do zero quando portar pra Next.js depois.

---

## 10. Critério de aceite — pela vibe, não checklist

Quando eu abrir o output:

- **Em 1 segundo eu sei quem está rodando** sem ler nada — o cyan dá pulso de vida pros ativos, os parados ficam monocromáticos.
- **A paleta sente Hermes cyberpunk HUD**, não um navy genérico — cyan neon `#00f0ff` aparece nos lugares certos com glow, o mint `#64ffda` no done é distinto do running, o laranja `#ff6b35` no blocked grita corretamente.
- **O multi-instância expandido se sente diferente do colapsado** sem precisar de tooltip explicando.
- **Sci-fi tem peso técnico, não cosplay.** Microcopy técnico, hairlines disciplinadas, mono dominante.
- **Light mode é tão refinado quanto dark** — não é um afterthought retinted.
- **Algo no design surpreende** — uma micro-interação, um detalhe HUD, um microcopy seco que faz sorrir. Você teve liberdade na Sec 7; quero ver onde você usou.

Se passar, abro turno 2 (replicar pros 6 agentes diferentes + adicionar header com filter bar + KPI panel lateral + footer técnico).
