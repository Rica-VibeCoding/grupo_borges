# Turno 2 — Frota completa (6 agentes) + chrome operacional

> **Continuação do turno 1 v3.** Você já entregou o card do agente em 5 estados + multi-instância expandido — arquivo canônico: **`Agent Card · Daniel v3.html`** (já existe neste projeto, na sessão #2 do chat). Este turno **replica pros 6 agentes reais da frota** e adiciona o chrome ao redor: header, filter bar, painel de KPIs, e footer técnico.
>
> **Reuse o card do v3 como está** — paleta, tipografia, estrutura interna do componente, microcopy técnico (`▸ STDOUT // PANE.001`, `↳ RN-2182`), sparkline, glow, tabs do multi-instância. Não redesenhe. O foco deste turno é **replicação + chrome**, não revisão do card.
>
> Nesta passagem o stack expande: agora você pode usar **augmented-ui** (CDN) pra clip-corner HUD em superfícies pontuais, e implementar comportamento de dialog/select/tabs estilo Radix (focus trap, ARIA, keyboard nav) — vanilla JS ou esm.sh, você escolhe.
>
> **Crie em arquivo HTML standalone novo; não toque nos arquivos já existentes do projeto.**

---

## 1. O que estamos construindo

A página principal do cockpit em **uma única view de leitura intensa** — quem abre identifica em 1 segundo o estado da frota inteira: quem está rodando, quem travou, quem está ocioso, quem caiu. A área central são os 6 cards (já desenhados no turno 1), e ao redor deles vive o chrome operacional: barra superior com identidade do sistema, filtros pra estreitar a frota, painel lateral com KPIs agregados, e linha de status técnica embaixo.

Este turno **não inclui o kanban de tasks** — a área abaixo dos cards fica vazia (vem no turno 4). Foque em transformar 1 card num cockpit-frame com 6 cards e bordas de informação operacional.

---

## 2. Conceito visual

Mesmo do turno 1: **cyberpunk HUD operacional**, cyan neon como sinal de vida, mono dominante, hairlines como gramática, sem sombras de objeto (só glow). O chrome ao redor dos cards **não pode competir com eles** — header e footer são informação técnica calma, filter bar é estrutura, KPI panel é dado denso. Os cards continuam sendo o palco onde o cyan acende.

Pense numa estação operacional onde alguém senta às 6 da manhã, varre os 6 cards, e o resto do chrome existe pra ele saber em que ambiente está, quantos agentes estão vivos, quando foi a última sincronização com o backend, e quais filtros estão ativos. Não decoração — instrumentação.

---

## 3. Paleta — Hermes scifi-theme.css fiel (igual ao turno 1)

Cole o mesmo `<style>` do turno 1 — paleta idêntica, sem modificação. Repetida aqui pra autonomia do arquivo:

```html
<style>
:root[data-theme="dark"] {
  --bg:               #060b18;
  --panel:            #0d1b2a;
  --card:             #112240;
  --card-2:           #153258;
  --border:           #1a3a5c;
  --border-subtle:    #142d4a;
  --text:             #e0f7fa;
  --muted:            #5d9bb8;
  --accent:           #00f0ff;
  --accent-active:    #00e5ff;
  --accent-secondary: #00b8d4;
  --accent-subtle:    rgba(0, 240, 255, 0.08);
  --accent-border:    rgba(0, 240, 255, 0.25);
  --status-running:   #00f0ff;
  --status-idle:      #5d9bb8;
  --status-blocked:   #ff6b35;
  --status-done:      #64ffda;
  --status-offline:   #4a5666;
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

Tipografia idêntica: **JetBrains Mono dominante** (≥70%) + **Geist Sans** só em prose. Importar via Google Fonts.

---

## 4. Frota real — 6 agentes (mock literal)

Use exatamente esses dados. Os nomes são reais e devem aparecer.

```json
[
  {
    "slug": "pavan",
    "name": "José Pavan",
    "role": "Consigliere",
    "model": "opus-4.7",
    "cli": "cc",
    "status": "running",
    "task_id": "RN-2180",
    "instance_count": 1,
    "last_seen_seconds_ago": 45,
    "pane_excerpt": "▸ STDOUT // PANE.001\nhandoff: pavan→daniel · fase 2 cockpit\n↳ context bundle pronto"
  },
  {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "Dev sênior — líder de área",
    "model": "opus-4.7",
    "cli": "cc",
    "status": "running",
    "task_id": "RN-2182",
    "instance_count": 2,
    "last_seen_seconds_ago": 12,
    "pane_excerpt": "▸ STDOUT // PANE.001\n✓ refactor connection-per-call\n↳ smoke test contra ~/.claude/projects/"
  },
  {
    "slug": "lucas",
    "name": "Lucas Marchetti",
    "role": "Diretor de marketing",
    "model": "sonnet-4.6",
    "cli": "cc",
    "status": "blocked",
    "task_id": "RN-2177",
    "instance_count": 1,
    "last_seen_seconds_ago": 1830,
    "pane_excerpt": "▸ STDIN // AWAIT.HUMAN\n> aprovar copy do post Instagram? (y/N)\n↳ draft em memory/2026-05-09-post.md"
  },
  {
    "slug": "vinicius",
    "name": "Vinicius Zanella",
    "role": "Especialista — lojistas",
    "model": "haiku-4.5",
    "cli": "cc",
    "status": "idle",
    "task_id": null,
    "instance_count": 1,
    "last_seen_seconds_ago": 7200,
    "pane_excerpt": "▸ STDOUT // EXIT.0\nconversation compacted at 14:22\n↳ standby"
  },
  {
    "slug": "felipe",
    "name": "Felipe Conti",
    "role": "Especialista — comercial",
    "model": "opus-4.7",
    "cli": "codex",
    "status": "done",
    "task_id": "DN-2169",
    "instance_count": 1,
    "last_seen_seconds_ago": 600,
    "pane_excerpt": "▸ STDOUT // EXIT.0\n✓ campanha pré-aprovação · 14 lojistas\n↳ DN-2169 closed"
  },
  {
    "slug": "barsi",
    "name": "Luiz Barsi",
    "role": "CFO read-only",
    "model": "haiku-4.5",
    "cli": "cc",
    "status": "offline",
    "task_id": null,
    "instance_count": 0,
    "last_seen_seconds_ago": 8400,
    "pane_excerpt": null
  }
]
```

**Notas de renderização:**
- Avatar = **iniciais em mono** (`JP`, `DS`, `LM`, `VZ`, `FC`, `LB`). Sem emoji gráfico. O **emoji só pode aparecer como microcopy** se você decidir usá-lo (não como avatar).
- **Daniel tem `instance_count: 2`** → mostre o card colapsado com badge `[2]` (transição pro expandido já validada no turno 1; aqui o foco é o estado colapsado).
- **Barsi `instance_count: 0`** + status offline → sem badge instance, opacidade reduzida, último visto em horas (`há 2h20`).
- **Sparkline** em cada card: gere 24 valores realistas por agente (alguns picos pros running, mais flat pro idle, série truncada pro offline). Mocke direto, não precisa endpoint.

---

## 5. Filter bar — campos disponíveis, você escolhe a forma

Estes são os **campos reais do backend** que filtram a lista de agentes. Não te dou número de dropdowns nem layout — escolha quais merecem chip/dropdown/segmented control, quais ficam dentro de um menu "more filters", e como dispor.

| Campo | Valores | Função |
|---|---|---|
| `status` | `idle`, `running`, `blocked`, `done`, `offline` | filtra por estado agregado do agente |
| `role` | `Consigliere`, `Dev sênior`, `Diretor de marketing`, `Especialista — lojistas`, `Especialista — comercial`, `CFO read-only` | filtra por papel |
| `model` | `opus-4.7`, `sonnet-4.6`, `haiku-4.5`, `codex-gpt-5.5` | filtra por modelo em uso |
| `cli` | `cc` (Claude Code), `codex` | filtra por CLI |
| `time_window` | `now`, `1h`, `24h`, `7d` | janela temporal pro sparkline e last_seen |
| `owner` | `solo`, `multi-instance` | colapsa pra agentes com >1 instância ativa |
| `search` | string livre | busca por nome/slug/path |

**Regras duras:**
- Filtros que estão ativos devem ser visíveis com cyan accent (não escondidos).
- Filtros que não estão ativos não podem dominar visualmente — hairlines + mono UPPERCASE pra label, não preenchimento.
- O componente comportamento estilo **Radix Select** (keyboard nav com `↑↓`, `Enter` seleciona, `Esc` fecha) é obrigatório nos dropdowns.

**Liberdade:**
- Quantos filtros ficam "primários" no chrome principal vs num menu "more"? Você decide.
- Forma do controle: chip clicável, dropdown clássico, segmented control pra `status`, search field destacado? Você escolhe por valor de uso.
- Posição da filter bar: linha abaixo do header, ou integrada nele? Decisão sua.

---

## 6. KPI panel — dados disponíveis, você escolhe a composição

Estes são os números agregados que vivem ao lado da frota. Não te dou layout — pense neles como entradas de um painel HUD que você compõe.

| KPI | Mock | Função |
|---|---|---|
| `agents_active / agents_total` | `4 / 6` | cyan accent quando ativo, cor do número reflete saúde |
| `errors_24h` | `3` | laranja `--status-blocked` se ≥1, muted se 0 |
| `tasks_running` | `3` | número grande mono, cyan accent |
| `tasks_blocked` | `1` | laranja se ≥1 |
| `last_sync` | `2026-05-10 14:22:01 -03:00` | timestamp ISO + tz, mono dense |
| `system_health` | `OK` | `OK` mint `--status-done`, `DEGRADED` laranja, `DOWN` `#ff5252` |
| `heartbeat_ms` | `1.2s` | latência do último heartbeat ao backend |
| `rtt_ms` | `24ms` | round-trip do SSE |

**Regras duras:**
- Cada KPI tem hierarquia clara: **número grande dominante** + label pequeno em mono UPPERCASE acima ou abaixo.
- Estados degradados (errors > 0, health DEGRADED) têm cor — não basta ficar cinza.

**Liberdade:**
- Painel lateral fixo? Topo? Composição em mini-tiles? Statusline cheia? Decisão sua.
- Augmented-ui em algum frame do painel pra clip-corner HUD: você escolhe se vale (em superfícies pontuais — não em todo container, vira maquete).
- Animação de transição quando KPI muda (ex: `4/6 → 5/6` quando alguém entra running): você decide se é fade, scale, contador rolando.

---

## 7. Header e footer — função, não forma

### Header

Identifica o sistema, dá saída pra controles globais (tema, busca rápida, settings), e ancora o cockpit. Não é decoração.

**Tem que comunicar:**
- Marca do sistema: `gb cockpit grupo_borges` (ou variação que o Designer julgar melhor — o slug é literal, mas a tipografia/composição é sua).
- **Versão do build** (mock: `v0.4.7`), **commit hash curto** (mock: `7543b3c`), e **uplink status** (mock: `UPLINK · TAILSCALE · OK`) — informação técnica que confirma "o sistema é real".
- Acesso a: toggle dark/light, search global (atalho `⌘K`), settings.

**Liberdade:**
- Statusline cheia integrada? Header minimalista com utility ícones à direita? Composição vertical em duas linhas? Decisão sua.
- Sticky com hairline border-bottom é o caminho mais óbvio, mas se quiser corner marks HUD ou outro tratamento — desde que não vire cosplay — pode.

### Footer técnico

Statusline operacional inferior — sticky bottom ou no fluxo, depende da altura disponível.

**Tem que comunicar:**
- `workspace · env · region · user · role · version · build`
- Conexão backend (`FASTAPI · 200`), número de agentes (`AGENTS · 06`), running/blocked/queue counts (`RUNNING · 03 · BLOCKED · 01 · QUEUE · 04`), heartbeat latency, RTT.

**Liberdade:**
- Como você dispõe e separa esses campos. Mono UPPERCASE com `·` separador é o reflexo natural — mas se quiser dividir esquerda/direita, ou agrupar em pílulas, ou usar pipe `│` como no v3 do turno 1, você escolhe.

---

## 8. Layout geral da página

Página inteira em viewport ≥1440px. Você decide:
- Como dispõe os 6 cards (linha única scrollável, grid 3×2, agrupado por status, alinhamento por densidade).
- Onde mora o KPI panel (lateral direita fixa, topo full-width, embutido no header).
- Composição vertical: header fixo + filter bar + main content + footer? Header fixo + filter bar inline com cards? Decisão sua.
- Background do `--bg` puro, ou com grid texture sutil HUD (linha 1px alpha 0.03 a cada 64px, por exemplo). Se aplicar grid, **não pode chamar atenção** — só deve ser percebido ao olhar de perto.

A área **abaixo dos 6 cards fica vazia** neste turno — o kanban entra no turno 4. Você pode marcar a região com microcopy seca tipo `▸ KANBAN · TURNO 4` ou simplesmente deixar respiro intencional. Decisão sua.

---

## 9. Liberdade criativa

**Suas:**
- Composição da página inteira (Sec 8).
- Forma e quantidade de filtros visíveis (Sec 5).
- Composição do KPI panel (Sec 6).
- Composição do header e footer (Sec 7).
- Animações: transição de KPI quando muda, hover dos chips do filter bar, abertura de dropdown.
- Microcopy técnico em mini-mono uppercase (corner marks, separadores HUD, labels do filter bar, mini-status do header).
- Comportamento de busca: inline com debounce, abre command palette `⌘K`, ou ambos.

**Minhas (não negociáveis):**
- Paleta Sec 3.
- Tipografia (mono ≥70%).
- Status labels: `idle`, `running`, `blocked`, `done`, `offline` — não inventar `STANDBY` ou `COMPLETE`.
- Mock data Sec 4.

---

## 10. Anti-padrões — só esses

- ❌ Inter, Roboto, Helvetica, system fonts.
- ❌ `border-radius` médio ou grande. Cantos retos ou `rounded-sm` (~2px) máx.
- ❌ Backdrop blur no header (sci-fi sóbrio = sem efeito vidro, deep navy puro).
- ❌ Drop-shadow comum. Use glow cyan controlado (alpha ≤0.4, blur ≤8px).
- ❌ Status labels traduzidos (`STANDBY`, `COMPLETE`) — use os 5 do backend.
- ❌ Filter bar com 9+ dropdowns enfileirados sem hierarquia (vira muro de chips).
- ❌ KPI panel virando pílulas redondas com gradiente.
- ❌ Microcopy bobinho no chrome técnico.

---

## 11. Stack do output

- HTML standalone.
- Tailwind 4 via CDN (ou utility classes inline).
- `<style>` global com a paleta da Sec 3 hardcoded.
- **augmented-ui via CDN** (`https://unpkg.com/augmented-ui/augmented-ui.min.css`) — use em superfícies pontuais (KPI panel, frame do search command palette se houver), nunca no container inteiro.
- **Comportamento estilo Radix** em dropdowns/select e qualquer dialog que aparecer — keyboard nav, focus trap quando aplicável, ARIA. Implementação: vanilla JS ou `https://esm.sh/@radix-ui/react-select` se preferir, mas sem trazer 100KB de framework. **Prefira vanilla JS pra protótipo.**
- JS mínimo: theme toggle persistido em `localStorage` (`cockpit-theme`), interatividade dos filtros (open/close, seleção, multi-select), search com debounce mock, sparkline rendering.
- Geist Sans + JetBrains Mono via Google Fonts.
- NÃO importe shadcn, Material UI — vamos rebuildar do zero quando portar pra Next.js depois.

---

## 12. Critério de aceite — pela vibe, não checklist

Quando eu abrir o output:

- **Em 1 segundo identifico estado da frota inteira** sem foco — cyan acende em quem está vivo, laranja grita em quem travou, mint sinaliza done, offline some visualmente.
- **Filter bar tem peso, não barulho.** Filtros ativos são visíveis com cyan, inativos respiram com hairlines + mono UPPERCASE. Não compete com os cards.
- **KPI panel tem hierarquia clara.** Número grande domina, label técnico em mono UPPERCASE acima/abaixo, divisores de hairline. Nada de pílulas com gradiente.
- **Header e footer parecem instrumentação operacional.** Versão, build hash, uplink status, agents count, RTT — coisas que confirmam "este sistema é real, está conectado". Não placeholders bonitinhos.
- **Augmented-ui aparece em ≤2 superfícies pontuais.** Se você usou em todo container, errou. Se usou em zero, perdeu uma chance — mas é menos grave que abusar.
- **Light mode é tão refinado quanto dark** — não é dark com cores invertidas.
- **Algo me surpreende no chrome.** Status microcopy técnico que só faz sentido em cockpit, contador animado de KPI, comando de busca com `⌘K` que abre painel HUD, separador `│` no footer com mini-pills de saúde — alguma coisa que mostre que você usou a Sec 9.

Se passar, abro turno 3 (modal de detalhe do agente em 4 abas: Missão · Skills · Docs · Tabelas).
