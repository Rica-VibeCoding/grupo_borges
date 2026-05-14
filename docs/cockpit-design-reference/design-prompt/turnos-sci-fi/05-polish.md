# Turno 5 — Polimento final (estados marginais, foco, motion, a11y)

> **Nota 2026-05-12:** este briefing virou referência histórica do Designer. O snapshot canônico entregue é `entregas/05-polish-v1.html`; a implementação viva está em `/home/clawd/repos/grupo_borges/apps/web/`. Os checklists abaixo são critérios de validação visual/a11y, não status real automaticamente pendente.

> **Último turno do plano sci-fi sóbrio.** Você já tem o cockpit completo: card individual (`Agent Card · Daniel v3.html`), frota com chrome (`Cockpit · Frota v1.html`), modal de detalhe (`Cockpit · Agent Modal v1.html`) e kanban tabular (`Cockpit · Kanban v1.html`). Agora **polir os estados marginais que dão profissionalismo** — erro de conexão SSE, loading inicial, focus rings consistentes, respeito a `prefers-reduced-motion`, microcopy técnico em todos os edge cases, checklist de acessibilidade.
>
> **Reuse tudo que você entregou.** Este turno não redesenha; **adiciona camada de polish em cima do cockpit completo**. O output do turno 5 deve mostrar a **tela inteira** (cards + chrome + kanban) com os estados de polish aparentes via toggle de demo (você decide a forma — botão UPPERCASE seca tipo `[demo: SSE OFF]` no footer, ou auto-cicla a cada N segundos).
>
> **Crie em arquivo HTML standalone novo; não toque nos arquivos já existentes do projeto.**

---

## 1. O que estamos construindo

Os turnos 1-4 entregaram o **caminho feliz** do cockpit — backend conectado, dados chegando, agentes vivos. Este turno entrega **os momentos onde algo dá errado** ou ainda está carregando, e **garante que o sistema é navegável por teclado** e respeita preferências de motion. É o que separa "protótipo bonito" de "ferramenta diária que sobrevive a sexta-feira 18h com SSE caído".

Os 5 estados marginais que importam:
1. **SSE desconectado** (banner persistente + degradação visual de cards/kanban).
2. **Loading inicial** (antes do SSE conectar).
3. **Focus rings consistentes** em todos os elementos navegáveis por teclado.
4. **prefers-reduced-motion** honrado em todas as animações infinitas/longas.
5. **Microcopy técnico seca** em todos os estados de erro, vazio e edge case.

E como bônus opcional: **toast** discreto pra eventos pontuais (SSE reconectou, task entregue).

---

## 2. Conceito visual

Mesmo cyberpunk HUD operacional dos turnos 1-4. **Erros não gritam** — banner SSE desconectado é informação técnica calma com hairline vermelho, não vermelhão berrante. Loading não é shimmer Material UI genérico — é varredura cyan sutil que se sente "scan operacional", não placeholder skeleton. Focus rings são cyan contidos com glow controlado, não disco-club.

Pensa numa estação operacional onde o engenheiro de plantão prefere ver "SSE DESCONECTADO — tentativa 3" sem alarme sonoro escandaloso, e quer que `Tab` navegue na ordem que faz sentido sem precisar pegar o mouse.

---

## 3. Paleta + tipografia — fiéis aos turnos anteriores

Cole o mesmo `<style>` da paleta. Status colors que aparecem com mais peso neste turno:
- `--status-blocked` (`#ff6b35` laranja) e `#ff5252` vermelho saturado — usar com hairline + alpha baixo no background, nunca preenchimento sólido.
- `--accent` / `--accent-hot` (`#00f0ff` neon) — focus rings + scan-line de loading.
- `--status-done` (`#64ffda` mint) — toast de sucesso (SSE reconectado).

Tipografia: **JetBrains Mono dominante** (≥70%) em microcopy técnico de todos os estados, **Geist Sans** mantém lugar só em prose corrida (que neste turno mal aparece).

---

## 4. Banner SSE desconectado — função, não decoração

**Quando aparece:** frontend perde conexão SSE (mock: simula com toggle de demo).

**Comunica:**
- `SSE DESCONECTADO — tentando reconectar (tentativa N)` em mono UPPERCASE peso 500.
- Ícone Lucide `AlertTriangle` à esquerda, cor `--status-danger` (`#ff5252`).
- Timestamp à direita em mono pequeno opacity reduzida.
- Background tint vermelho **muito subtle** (alpha ~0.08 do `--status-danger`) — sem vermelhão.
- Border-bottom 1px sólido `--status-danger`.
- Position fixed top, full width, z-index acima do header.

**Comportamento:**
- Entrada: slide-down ~200ms.
- Saída (quando reconecta): slide-up ~200ms + dispatch toast "SSE reconectado" no canto inferior (Sec 8).
- Cards e kanban no estado desconectado: opacity reduzida (~0.6), ícone Lucide `WifiOff` cinza ao lado do nome de cada card como redundância visual.

**Liberdade:**
- Forma exata do banner — pode ser uma linha única dense, pode ter mini-stats (tentativa N de M, latência do último ping). Sua decisão.
- Posição do timestamp e do counter "tentativa N".
- Se o banner deve ter um botão `[REINTENTAR]` à direita (chip mono UPPERCASE) ou só auto-retry silencioso. Sua decisão.

---

## 5. Loading inicial — scan-line cyan, não shimmer

**Quando aparece:** primeiros 1-2 segundos do mount, antes do SSE conectar.

**Comunica:**
- Conteúdo dos cards / kanban / KPI panel ainda não chegou.
- Sistema **está tentando conectar**, não travou.
- Vibe sci-fi de "varredura operacional", não "esqueleto carregando".

**Forma sugerida:**
- Linha horizontal 1px de altura, cor `--accent` com gradiente fade-out nas pontas, deslizando vertical ao longo do container (de `translateY(0)` a `translateY(100%)`), opacity oscilando 0 → 0.6 → 0 ao longo da varredura. Loop infinito ~1.5s, ease-out.
- Aplicar em: cada card de agente, cada coluna do kanban, KPI panel.
- Quando dado chega: scan-line some (fade out ~200ms), conteúdo aparece com fade-in.

**Liberdade:**
- Você pode escolher **outra forma de scan-line** se considerar mais coerente com a vibe — pulso de glow cyan na border do container, dot percorrendo a hairline, varredura horizontal em vez de vertical. Restrições: **não shimmer skeleton genérico**, **não spinner circular**, **respeitar prefers-reduced-motion**.
- Microcopy auxiliar opcional: `▸ CONNECTING...` em mono opacity 0.5 dentro de algum container. Sua decisão se vale ou se polui.

---

## 6. Focus visible — anel cyan contido, consistente em tudo

**Onde aplicar:** todos os elementos navegáveis por teclado — cards de agente, dropdowns do filter bar, tabs do modal, rows do kanban, botões, links, toggle de tema, search field.

**Função:**
- Operador navegando por `Tab` precisa **ver onde está sem ambiguidade**.
- Anel cyan + glow contido — HUD feel sem virar disco.
- Consistente em todos os focáveis (mesmo padrão visual em todos).

**Forma sugerida:**
- `outline: 1px solid var(--accent-hot)` (`#00f0ff` no dark, `#0097a7` no light).
- `outline-offset: 2px`.
- `box-shadow: 0 0 6px rgba(0, 240, 255, 0.25)` (glow contido — alpha ≤0.3, blur ≤8px).
- Light mode: aumentar alpha do glow pra compensar fundo claro.

**Tab order esperado:**
- Header (logo / search / theme toggle) → filter bar → 6 cards (esquerda pra direita) → KPI panel → kanban (coluna por coluna, top-down dentro de cada coluna).
- Dentro do modal aberto: close button → 4 tabs (esquerda pra direita) → conteúdo da aba.

**Liberdade:**
- Tratamento exato do focus em rows do kanban (anel ao redor da row inteira ou só do ID?). Sua decisão.
- Se cards "selecionados" por teclado têm tratamento extra além do focus ring (ex: hairline cyan engrossado). Sua decisão.

---

## 7. prefers-reduced-motion — honrar de verdade

**Regra dura:** todas as animações infinitas/longas devem ter fallback estático ou curto quando o usuário prefere reduzir motion.

**Mapping:**
- **Pulse do running** (turnos 1+2): substitui por opacity estática elevada (~0.85).
- **Scan-line de loading** (Sec 5): substitui por dot estático cyan + label `▸ CONNECTING` em mono.
- **Animação de abertura do modal** (turno 3): vira fade simples ≤100ms.
- **Cross-fade entre abas do modal** (turno 3): instantâneo.
- **Hover translate-y** (cards, chips): remover. Border color change pode permanecer.
- **Banner SSE slide-down/up** (Sec 4): vira fade simples.
- **Task nova entrando no kanban** (turno 4): aparece direto, sem flash de background.
- **Toast slide-in/out** (Sec 8 opcional): vira fade.

**Implementação técnica:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
Override seletivo onde precisar manter alguma transição curta (focus ring entrando rápido, por exemplo). Geralmente nada precisa.

**Critério:** quando ativar `prefers-reduced-motion: reduce` no DevTools, o cockpit **continua plenamente legível e navegável**, sem nenhuma animação infinita rodando.

---

## 8. Microcopy técnico — texto seco em todos os estados

Tudo UPPERCASE mono pra labels, ProperCase pra prose curta auxiliar. Nunca `Oops!`, `Ready! 🎉`, ou tom infantil.

**Estados de erro / edge case:**
- SSE desconectado: `SSE DESCONECTADO — tentando reconectar (tentativa N)`.
- Backend offline (404 no endpoint base): `BACKEND OFFLINE — verifique Tailscale serve`.
- Agente offline (heartbeat ausente): card com label `OFFLINE`, sem timestamps fakes ou contagem otimista.
- Loading inicial: `▸ CONNECTING...` ou similar, mono opacity reduzida.
- Empty kanban: `▸ AGUARDANDO O PRIMEIRO EVENTO` (já definido no turno 4).
- Modal abrindo agente sem dados completos (mock de borda): label técnico tipo `▸ NO DATA // FETCHING`, sem placeholder bonitinho.

**Liberdade:** você pode adicionar microcopy auxiliar em outros estados que identificar — separadores HUD, labels de saúde do sistema, contadores de retry. Manter o tom seco.

---

## 9. Toast de notificação (opcional, nice-to-have)

Pra eventos pontuais que não precisam de banner persistente — SSE reconectou, task nova entregue, agente voltou online.

**Comunica:**
- `● SSE RECONECTADO` em mono UPPERCASE peso 500 + dot cor por tipo.
- Timestamp à direita em mono pequeno.

**Comportamento:**
- Position fixed bottom-right, z-index acima do modal.
- Background `--panel`, border 1px `--border`.
- Padding ~10px 16px, largura ~280px.
- Aparece slide-in-right ~200ms + permanece ~4s + slide-out-right ~200ms.
- Stack vertical se múltiplos (gap ~8px).
- `Esc` ou click no toast: fecha imediato.
- `prefers-reduced-motion`: vira fade.

**Liberdade:** se você considerar que toast adiciona ruído e o cockpit já comunica reconexão pelo banner sumindo, pode pular. Decisão sua, com bias pra **incluir** (operador agradece confirmação visual rápida).

---

## 10. Checklist de acessibilidade — entregar marcado

Antes de devolver, verificar:

- [ ] **Contraste WCAG AA** mínimo em texto e UI elements (testar com Lighthouse no DevTools).
- [ ] **Tab order** lógico nos dois modos (cockpit principal e modal aberto) — Sec 6.
- [ ] **Esc** fecha modal e devolve foco pro card que abriu (já validado no turno 3).
- [ ] **Enter/Space** ativa card focado (abre modal) e row focada do kanban (highlight).
- [ ] **←/→** navega entre as 4 abas do modal (já validado no turno 3).
- [ ] **ARIA labels** em todos botões icônicos (`aria-label="Toggle theme"`, `aria-label="Open settings"`, `aria-label="Reconnect SSE"`, etc).
- [ ] **`aria-live="polite"`** em região do kanban pra anunciar tasks novas chegando.
- [ ] **`role="dialog"` + `aria-modal="true"` + `aria-labelledby`** no modal (já no turno 3).
- [ ] **Focus trap** funcional no modal (já no turno 3).
- [ ] **`prefers-reduced-motion`** honrado em todas as animações infinitas/longas (Sec 7).
- [ ] **`prefers-contrast: more`** opcional — se sobrar tempo, fortalecer borders e texto pra esse modo.

---

## 11. Light mode — checklist específico

Quando trocar pra light, validar que:

- [ ] Cyan accent `#0097a7` legível em fundo `#eef1f5` — focus ring continua visível.
- [ ] Hairlines `#c4cdd8` visíveis mas não brutos.
- [ ] Status colors no kanban legíveis: warning `#c45000`, danger `#c62828`, success `#2e7d52`.
- [ ] Banner SSE desconectado com vermelho legível em fundo claro (alpha pode precisar ser mais alto que no dark).
- [ ] Scan-line de loading com cyan teal mais escuro adapta — se ficar invisível, escurecer.
- [ ] Modal backdrop translúcido com blur ≤4px (sci-fi sóbrio).
- [ ] Pulse do running (no light) usa cyan teal escuro em vez de neon — neon `#00f0ff` em fundo claro vira invisível.

---

## 12. Liberdade criativa

**Suas (não minhas):**
- Forma exata do banner SSE (Sec 4) — densidade, posição do counter "tentativa N", presença ou não de botão `[REINTENTAR]`.
- Forma do scan-line de loading (Sec 5) — varredura vertical, horizontal, glow pulsando na border, dot percorrendo hairline. Restrição: não shimmer Material genérico.
- Tratamento de focus em rows do kanban (anel inteiro vs só ID).
- Inclusão ou não do toast (Sec 9) — bias pra incluir.
- Microcopy auxiliar adicional em estados que você identificar como "mereciam um label técnico".
- Forma do toggle de demo entre estados (botão `[demo: SSE OFF]` no footer? command palette `⌘K` com comando `simulate disconnect`? auto-cicla a cada N segundos com chip indicando o estado atual?). Sua decisão.

**Minhas (não negociáveis):**
- Paleta + tipografia.
- `prefers-reduced-motion` honrado de verdade (Sec 7).
- Tab order lógico (Sec 6).
- Microcopy seco em todos os estados (Sec 8).
- Checklist de a11y (Sec 10) entregue marcado.

---

## 13. Anti-padrões — só esses

- ❌ Banner SSE com vermelhão saturado / preenchimento sólido (sem hairline + alpha controlado).
- ❌ Shimmer skeleton genérico Material UI tipo loading.
- ❌ Spinner circular (não combina com sci-fi sóbrio HUD).
- ❌ Focus ring sem glow (perde feel HUD) ou com glow agressivo (alpha > 0.4, blur > 8px = disco-club).
- ❌ Animações infinitas que ignoram `prefers-reduced-motion`.
- ❌ Microcopy bobinho em qualquer estado de erro (`Oops!`, `Connection lost 😔`).
- ❌ Toast com gradient, sombra grande, ou animação bounce/spring.
- ❌ Outline default do browser em focus (preto serrilhado) sobrevivendo em algum elemento.

---

## 14. Stack do output

- HTML standalone.
- Tailwind 4 via CDN ou utility classes inline (mesma escolha dos turnos anteriores).
- `<style>` global com paleta hardcoded (cole do `Cockpit · Frota v1.html`).
- **augmented-ui via CDN** — neste turno, raramente precisa adicionar (já está nos containers anteriores). Não adicionar em banner SSE ou toast — ficam genéricos.
- **Lucide icons via CDN** (`https://unpkg.com/lucide@latest`) — `AlertTriangle` no banner, `WifiOff` nos cards desconectados, qualquer outro ícone discreto que precisar.
- JS: theme toggle persistido em `localStorage` (mesma chave `cockpit-theme`), simulação de toggle entre estados (SSE on/off, loading on/off), focus management consistente, dispatch de toast.
- Geist Sans + JetBrains Mono via Google Fonts.

---

## 15. Critério de aceite — pela vibe, não checklist

Quando eu abrir o output:

- **Banner SSE desconectado é informação técnica**, não alarme. Vermelho contido, hairline disciplinada, microcopy seco. Cards e kanban degradam coerentemente.
- **Loading inicial parece operacional**, não placeholder. A varredura cyan tem peso de "scan", não shimmer.
- **Tab navega o cockpit inteiro** numa ordem que faz sentido. Em cada parada, o focus ring é visível mas contido — sem disco.
- **`prefers-reduced-motion: reduce` desliga TUDO que é infinito ou longo.** Cockpit continua usável e legível, sem nenhuma animação rodando.
- **Microcopy em todos os estados é seca e técnica.** Nenhum `Oops!` em lugar nenhum.
- **Light mode é tão refinado quanto dark** — todos os checks da Sec 11 passam.
- **Algo me surpreende no polish** — toggle de demo com personalidade, contador de retry no banner, microcopy técnico em estado vazio que faz sorrir, toast com tratamento HUD próprio. Você teve liberdade na Sec 12; quero ver onde usou.

---

# Pós-handoff — pra Claude Code (Daniel-VPS)

Quando você terminar e eu aprovar, vou usar **`Send to local coding agent`** (ou `Handoff to Claude Code`) pra mandar o handoff bundle pro Claude Code (Daniel-VPS).

**Indicações pro implementador (referência futura):**

- Bundle deve incluir todos os 5 estados do cockpit num conjunto coeso (HTML único multi-view ou múltiplos arquivos linkáveis).
- Componentes nomeados semanticamente: `AgentCard`, `FilterBar`, `FilterDropdown`, `KPIPanel`, `Modal`, `ModalTabs`, `KanbanColumn`, `KanbanRow`, `StatusPill`, `Toast`, `SSEBanner`, `LoadingScanline`, `CommandPalette`.
- CSS custom properties no root pra paleta — facilita migração pra Tailwind 4 `@theme inline` no port.
- Stack final será **Next.js 16 + Tailwind 4 + Radix primitives + augmented-ui + componentes custom** (não shadcn).
- Comportamentos do protótipo (focus trap, keyboard nav, prefers-reduced-motion, ARIA) devem sobreviver ao port — não são "extras pra adicionar depois".

Obrigado. Boa entrega.
