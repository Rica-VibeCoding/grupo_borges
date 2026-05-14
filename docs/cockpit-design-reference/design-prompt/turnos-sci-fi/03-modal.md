# Turno 3 — Modal de detalhe do agente (4 abas)

> **Nota 2026-05-12:** este é briefing histórico do Designer. Qualquer mock de stack/dados dentro deste arquivo não substitui o estado vivo do MVP: Next.js/FastAPI/SQLite/Tailscale em `/home/clawd/repos/grupo_borges`.

> **Continuação dos turnos 1+2.** Você já tem o card individual (`Agent Card · Daniel v3.html`) e o cockpit completo com 6 cards + chrome (`Cockpit · Frota v1.html`). Agora torne os cards **clicáveis**: click abre um modal de detalhe com 4 abas (**Missão · Skills · Docs · Tabelas**) onde o agente "se abre" — quem é, o que sabe fazer, onde grava memo, com que tabelas conversa.
>
> **Reuse a vibe do dialog da command palette `⌘K`** que você já entregou no `Cockpit · Frota v1.html` — `role="dialog" aria-modal="true"`, keyboard nav `↑↓/Esc`, animação subtle dropdown-in, painel sobre backdrop translúcido. Mesmo padrão, escala maior.
>
> **Crie em arquivo HTML standalone novo; não toque nos arquivos já existentes do projeto.** Mostre o modal **aberto por padrão** com Daniel Singh selecionado (avatar `DS`, role "Dev sênior — líder de área"), aba **Missão ativa**. Ao redor, mostre uma versão simplificada do cockpit (pode ser só os 6 cards — chrome opcional) pra dar contexto de "de onde o modal abriu".

---

## 1. O que estamos construindo

O modal é uma **mini-página dentro do cockpit** — não popup decorativo. Quando o operador clica num card, ele quer entender o agente em profundidade sem perder o contexto do cockpit. As 4 abas são as 4 perguntas que importam:

- **Missão** — quem é esse agente, o que ele faz, com quem trabalha (prose do `SOUL.md`).
- **Skills** — quais ferramentas/comandos ele invoca e com que frequência.
- **Docs** — onde mora a memória dele, a árvore de arquivos do workspace.
- **Tabelas** — com que tabelas do banco ele conversa, em que modo, com quanto volume.

Operador power-user navega por keyboard (`Tab`, `←/→`, `Esc`); operador casual clica. Ambos têm que conseguir abrir, ler, fechar em <10s sem perder estado do cockpit lá fora.

---

## 2. Conceito visual

Mesmo cyberpunk HUD operacional dos turnos 1+2. **O modal não é popup com sombra mole** — é um painel HUD sobre backdrop translúcido. Sci-fi sóbrio, hairlines disciplinadas, glow cyan controlado, augmented-ui em superfícies pontuais (frame do modal ou KPI summary inside, no máximo 2 lugares — não em todo container interno).

Pense numa estação operacional onde alguém abriu o "expediente" do agente Daniel: uma ficha técnica, organizada, sem groove visual desnecessário, que abre rápido e fecha rápido.

---

## 3. Paleta + tipografia — fiéis aos turnos anteriores

Cole o mesmo `<style>` da paleta dos turnos 1+2 (Hermes neon: `#00f0ff` accent dark / `#0097a7` light, `#64ffda` mint pra done, glow alphas 0.3-0.4). Tipografia idêntica: **JetBrains Mono dominante** (≥70%) em estrutura (slugs, paths, IDs, labels, contadores, headings de aba), **Geist Sans** apenas em prose corrida da Missão. Importar ambas via Google Fonts.

Você já tem a paleta hardcoded no `Cockpit · Frota v1.html` — pode literalmente copiar o bloco `:root[data-theme="dark"]` + `:root[data-theme="light"]` pra cá.

---

## 4. As 4 abas — função e mock data

### Aba 1 — Missão (default ativa)

Markdown render do `SOUL.md` do agente. Use este mock literal pro Daniel Singh:

```markdown
## Quem sou

**Daniel Singh.** Dev sênior do Rica em desenvolvimento de software.
Líder da área de dev. Fluyt é o produto principal, mas atendo todo
o portfólio (Conecta Movelmar, Conecta Lojistas, Radar Fluyt, e o que
nascer dali em diante).

## Especialização

- Stack: Next.js 16 + Supabase + Vercel
- Monorepo Turbo + pnpm
- Refactor + arquitetura + code review
- Marketing pro Fluyt: emails de novidades, onboarding, prospecção

## Fronteiras

- ✅ Dev/code/deploy/refactor de qualquer repo do Rica
- ❌ Operação dia-a-dia dos outros agentes (cada um cuida do seu domínio)

## Regras pessoais

- Antes de codar feature de framework: Context7 obrigatório
- Reportar com 1-2 linhas de fundamento, sem dump
- Trust internal code; validar só nos boundaries
- Preview obrigatório antes de email pra usuário ou deploy em produção
```

**Tipografia da prose:**
- Body: **Geist Sans regular** (~13px), line-height confortável, max-width prose pra leitura (~62ch).
- H2 (`## Quem sou`): **JetBrains Mono** UPPERCASE letter-spacing aberto — não Geist, mantém pegada técnica.
- Inline code (`` `Context7` ``): mono, background hairline-bordered.
- Strong: peso 600 cor `--text`.
- Listas: bullets em hairline cyan ou pseudo-glyph técnico (ex: `›`, `■`, `─`) — você escolhe.

### Aba 2 — Skills

Lista das skills que o agente invoca, com indicador de frequência/recência. Mock literal pro Daniel:

```json
[
  { "name": "fluyt-backlog",    "last_used": "há 30min", "calls_24h": 12 },
  { "name": "gmail-api",        "last_used": "há 2h",    "calls_24h": 8  },
  { "name": "vercel:deploy",    "last_used": "há 1h",    "calls_24h": 4  },
  { "name": "frontend-design",  "last_used": "há 4h",    "calls_24h": 3  },
  { "name": "code-review",      "last_used": "ontem",    "calls_24h": 0  },
  { "name": "voz",              "last_used": "ontem",    "calls_24h": 1  },
  { "name": "simplify",         "last_used": "há 3d",    "calls_24h": 0  },
  { "name": "test-fluyt",       "last_used": "há 5d",    "calls_24h": 0  }
]
```

**Função:**
- Skill ativa nas últimas 24h tem peso visual (cyan accent ou similar); skill dormente fica muted.
- Volume `calls_24h` deve ser perceptível (sparkline mini? número grande? barra horizontal? você escolhe).
- Cada linha clicável em comportamento (no protótipo, só hover/focus state — sem ação real).

### Aba 3 — Docs

Árvore de arquivos do workspace do Daniel. Mock literal:

```
daniel/
├── SOUL.md                    (esse arquivo · 8 KB)
├── IDENTITY.md                (1.5 KB)
├── AGENTS.md                  (12 KB · code rules pro Codex CLI + Daniel-CC)
├── OPS.md                     (4 KB · operação Daniel-CC)
├── TOOLS.md                   (2 KB)
├── CLAUDE.md                  (3 KB · @include resolver pra outros)
├── MEMORY.md                  (estado mutável atual)
├── memory/
│   ├── 2026-05-10-cockpit-design-3-versoes.md  (3 KB)
│   ├── 2026-05-09-grupo-borges-decisoes.md     (2 KB)
│   ├── REFERENCIA.md                            (15 KB · detalhes estáveis)
│   └── ... (47 arquivos)
└── fabrica-de-software/
    ├── INDEX.md
    ├── design-systems/
    │   ├── linear/
    │   ├── vercel/
    │   └── stripe/
    ├── cockpit-grupo-borges/
    │   ├── DECISOES.md
    │   ├── design-prompt/
    │   └── entregas/
    └── claude-code/
```

**Função:**
- Folders expandem/colapsam (caret `▶/▼` ou similar — você escolhe glyph).
- File extensions visualmente sutis (`.md` ganha cor levemente diferenciada — accent muted talvez).
- Indent claro mas não exagerado.
- Hover destaca linha. Click num arquivo (no protótipo) só dá highlight — sem preview lateral no MVP.

### Aba 4 — Tabelas

Tabelas do banco que o agente lê/escreve. Mock literal:

```json
[
  { "name": "fc_backlog",          "perm": "read/write", "rows": 87,  "last_write": "há 1h"  },
  { "name": "fc_changelog",        "perm": "read",       "rows": 142, "last_write": "há 2d"  },
  { "name": "fc_reunioes",         "perm": "read/write", "rows": 23,  "last_write": "há 6h"  },
  { "name": "email_historico_log", "perm": "read",       "rows": 891, "last_write": "ontem" }
]
```

**Função:**
- Nome da tabela em mono peso 500, letter-spacing 0.
- Permissão visível (`READ` muted, `READ/WRITE` em accent — escolha sua a forma).
- Volume de rows em destaque proporcional (mini bar horizontal? número grande? você escolhe).
- Última escrita em mono pequeno opacity reduzida.

---

## 5. Comportamento do dialog — não negociável

Reuse o que você já fez na command palette `⌘K` do `Cockpit · Frota v1.html` — só escala.

- **Trigger**: click no card abre o modal com aquele agente selecionado.
- **Backdrop**: rgba sobre `--bg`, com leve blur ou tint — você escolhe quanto. **Sem backdrop blur agressivo** (sci-fi sóbrio = sem efeito vidro Apple).
- **`role="dialog" aria-modal="true" aria-labelledby="..."`** no frame.
- **Focus trap**: Tab não escapa do modal.
- **`Esc` fecha** o modal e devolve foco pro card que abriu.
- **`←/→` navega entre as 4 abas** quando o foco está numa tab.
- **`Enter/Space`** numa tab focada ativa.
- **Tab order interno**: close button → tabs (esq→dir) → conteúdo da aba.
- **Focus visible**: ring `--accent-hot` + glow alpha 0.25-0.4 (mesma linguagem dos cards).
- **Click no backdrop** fora do frame fecha.

### prefers-reduced-motion

Se `prefers-reduced-motion: reduce`:
- Animação de abertura: substituir por fade simples curto (≤100ms).
- Cross-fade entre abas: instantâneo.
- Qualquer hover translate: remover.

---

## 6. Liberdade criativa

**Suas (não minhas):**
- Dimensões do modal (altura, largura, padding interno).
- Animação de abertura: pode ser fade+scale, slide vertical curto, "boot sequence" técnico (border traçando do canto, conteúdo aparecendo em camadas) — sua decisão. Restrição: ≤350ms total e respeitando `prefers-reduced-motion`.
- Como a aba ativa é destacada: background pill com hairline cyan? underline animado curto? glow no label? You pick — mas **nada de underline animado dramático tipo Material**.
- Layout de cada aba (Sec 4) — você decide forma de Skills (chip linha vs grid vs sparkline), forma de Docs (tree clássica vs lista flat com path breadcrumb), forma de Tabelas (linha simples vs mini bar chart).
- Augmented-ui: aplique em **≤2 superfícies pontuais** (frame do modal? KPI summary num cabeçalho da aba? você escolhe). Não em todo container — vira maquete.
- Microcopy técnico do modal: header com slug + role do agente, footer técnico opcional do modal (build info? id do agente no banco? linhas que confirmem "isso é uma ficha real, não placeholder").
- Cabeçalho do modal: avatar grande + nome + role é o reflexo natural, mas se quiser fazer com mais densidade técnica (versão da SOUL.md, last edit timestamp, contadores agregados das 4 abas) — pode.

**Minhas (não negociáveis):**
- Paleta + tipografia (idênticas aos turnos 1+2).
- Comportamento do dialog (Sec 5).
- 4 abas com os nomes literais: **Missão · Skills · Docs · Tabelas** (UPPERCASE no label da tab é OK).
- Mock data Sec 4.

---

## 7. Anti-padrões — só esses

- ❌ `border-radius` médio ou grande no frame do modal. Cantos retos ou `rounded-sm` (~2px) máx.
- ❌ Backdrop blur agressivo (>4px) — sci-fi sóbrio.
- ❌ Drop-shadow comum no modal. Use border + glow contido (alpha ≤0.2 num ring sutil).
- ❌ Underline animado dramático em tab active (Material/Tailwind UI default). Use background pill ou treatment HUD próprio.
- ❌ Animação de abertura tipo bounce/spring/disco. Sci-fi sóbrio é controlado.
- ❌ Avatar emoji como gráfico — use iniciais em mono (mesmo padrão dos cards).
- ❌ "Oops!" ou microcopy bobinho em estado vazio (nenhuma skill invocada, nenhuma tabela linkada). Use UPPERCASE mono seca tipo `▸ NO INVOCATIONS // 24H`.
- ❌ Tabs com 5+ entradas que extrapolam — use só as 4. Sem "More" dropdown.

---

## 8. Stack do output

- HTML standalone.
- Tailwind 4 via CDN ou utility classes inline (mesma escolha dos turnos 1+2).
- `<style>` global com paleta hardcoded (cole do `Cockpit · Frota v1.html`).
- **augmented-ui via CDN** já incluído nos turnos anteriores — reuse em ≤2 superfícies pontuais.
- **Comportamento de dialog**: vanilla JS é o caminho preferido (igual command palette do turno 2). Sem importar Radix em runtime no protótipo.
- JS: focus trap, keyboard nav (`Esc`/`←/→`/`Tab`), abertura/fechamento, theme toggle persistido em `localStorage` (chave `cockpit-theme`, mesma dos turnos anteriores).
- Geist Sans + JetBrains Mono via Google Fonts.

---

## 9. Critério de aceite — pela vibe, não checklist

Quando eu abrir o output:

- **Em <2s eu entendo quem é o Daniel** sem ler tudo — header do modal me diz nome + role + slug, aba Missão começa com prose direta.
- **As 4 abas têm peso equivalente**, não uma "principal" e três cosméticas. Cada uma tem hierarquia interna clara (estrutura do mock vira informação, não só lista).
- **Skills mortas e vivas se distinguem visualmente** — a invocada nas últimas 24h tem peso, a dormente respira.
- **Docs tree é navegável de relance** — folders, arquivos, contagens. Não vira lista achatada.
- **Tabelas comunicam volume e permissão** num glance. `read/write` é distinto de `read` sem precisar ler o texto.
- **Esc fecha de verdade**, foco volta pro card que abriu (testar com Tab depois).
- **`←/→` navega entre as 4 abas** (testar).
- **Light mode é tão refinado quanto dark** — não é dark com cores invertidas.
- **Algo me surpreende no chrome do modal** — microcopy técnico no header (build do SOUL.md? última edit?), animação de abertura com personalidade (boot sequence curto?), augmented-ui usado num só lugar com decisão clara, mini-statusline no footer do modal. Você teve liberdade na Sec 6; quero ver onde usou.

Se passar, abro turno 4 (kanban tabular denso de tasks abaixo dos 6 cards — formato Linear-issue-list, não cards bonitinhos).
