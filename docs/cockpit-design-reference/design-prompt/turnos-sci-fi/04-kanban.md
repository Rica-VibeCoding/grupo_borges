# Turno 4 — Kanban tabular denso de tasks (formato terminal, não Trello)

> **Continuação dos turnos 1+2+3.** Você já tem o card individual (`Agent Card · Daniel v3.html`), o cockpit completo com 6 cards + chrome (`Cockpit · Frota v1.html`) e o modal de detalhe em 4 abas (`Cockpit · Agent Modal v1.html`). Agora preencha **a área abaixo dos 6 cards** com o **kanban tabular** — 5 colunas (`Backlog · Running · Review · Done · Archived`), cada coluna uma **tabela densa em mono**, formato Linear-issue-list. **Não cards verticais bonitinhos com tasks dentro**; formato tabela monospace pura, mais perto de log viewer / `kubectl get pods` do que Trello.
>
> **Reuse o chrome do `Cockpit · Frota v1.html` como contexto** — header, filter bar, KPI panel e os 6 cards continuam exatamente como estão. Este turno **adiciona o kanban embaixo** sem revisitar o que já foi entregue.
>
> **Crie em arquivo HTML standalone novo; não toque nos arquivos já existentes do projeto.** Mostre o cockpit inteiro com os cards no topo e o kanban preenchido embaixo (mock data da Sec 4).

---

## 1. O que estamos construindo

Operador olha pros 6 cards e sabe **quem está ativo**. Olha pro kanban abaixo e sabe **o que cada um está fazendo, em que estado, há quanto tempo**. O kanban é a contraparte tabular do cockpit — densa, lida em scan vertical, sem ornamento. Ninguém clica em row pra "abrir tarefa" em popup bonito; o operador escaneia 25 rows em 2 segundos e identifica o que travou, o que terminou, o que está fila.

A inspiração de forma é **Linear issue list / Vercel deployments table / `kubectl get` output** — não Trello, não cards bonitinhos com gradient e shadow.

---

## 2. Conceito visual

Mesmo cyberpunk HUD operacional dos turnos 1+2+3. **O kanban é o palco mais sóbrio do cockpit** — densidade máxima, cor mínima. O cyan `#00f0ff` aparece **só** nos IDs de tasks `running` (que estão vivas) e nos focus rings. O resto é hairline + mono em tons de `--text` e `--muted`. Mint `#64ffda` em `Done`, laranja `#ff6b35` em `Review` (esperando revisão humana). Backlog e Archived ficam quase invisíveis — informação presente, peso visual zero.

Pensa em estação operacional onde o kanban é o "feed técnico" embaixo dos painéis vivos. Quem olha pros cards vê pulso; quem olha pro kanban vê histórico em movimento. Os dois convivem na mesma tela sem competir.

---

## 3. Paleta + tipografia — fiéis aos turnos anteriores

Cole o mesmo `<style>` da paleta dos turnos 1+2+3 (Hermes neon: `#00f0ff` accent dark / `#0097a7` light, `#64ffda` mint pra done, `#ff6b35` laranja pra blocked/review, glow alphas 0.3-0.4). Você pode literalmente copiar o bloco `:root[data-theme="dark"]` + `:root[data-theme="light"]` do `Cockpit · Frota v1.html`.

Tipografia: **JetBrains Mono em 100% do kanban** — IDs, owners, paths, timestamps, headers de coluna, contadores, sub-header de tabela, microcopy técnico. **Geist Sans não aparece neste turno** (excerto: empty state pode usar Geist na linha auxiliar, opcional).

---

## 4. Mock data — 25 tasks distribuídas

Use exatamente esses dados. Os IDs seguem prefixo por status (`BK-` Backlog, `RN-` Running, `RV-` Review, `DN-` Done, `AR-` Archived) — **prefixo é informação visual**, não decoração.

```json
[
  {"id":"BK-2187","owner":"lucas","path":"/mkt/campanhas","time":"06:21","status":"backlog"},
  {"id":"BK-2186","owner":"vinicius","path":"/infra/observability","time":"05:18","status":"backlog"},
  {"id":"BK-2185","owner":"pavan","path":"/fin/planejamento","time":"05:18","status":"backlog"},
  {"id":"BK-2184","owner":"felipe","path":"/rel/especialistas","time":"05:18","status":"backlog"},
  {"id":"BK-2183","owner":"vinicius","path":"/data/ingest","time":"05:18","status":"backlog"},
  {"id":"BK-2182","owner":"daniel","path":"/app/auth","time":"05:18","status":"backlog"},

  {"id":"RN-2182","owner":"daniel","path":"/app/api/transactions","time":"14:22","status":"running"},
  {"id":"RN-2181","owner":"daniel","path":"/app/worker/events","time":"13:54","status":"running"},
  {"id":"RN-2180","owner":"pavan","path":"/fin/dre/maio","time":"14:15","status":"running"},
  {"id":"RN-2179","owner":"pavan","path":"/fin/cashflow","time":"14:11","status":"running"},
  {"id":"RN-2178","owner":"vinicius","path":"/data/pipeline/ingest","time":"14:07","status":"running"},
  {"id":"RN-2177","owner":"lucas","path":"/mkt/atribuicao","time":"14:02","status":"running"},

  {"id":"RV-2176","owner":"lucas","path":"/rel/relatorio-q2","time":"14:01","status":"review"},
  {"id":"RV-2175","owner":"daniel","path":"/app/refactor-auth","time":"13:54","status":"review"},
  {"id":"RV-2174","owner":"pavan","path":"/fin/risco-sens","time":"13:47","status":"review"},
  {"id":"RV-2173","owner":"felipe","path":"/exec-summary","time":"13:42","status":"review"},
  {"id":"RV-2172","owner":"vinicius","path":"/data/quality-check","time":"13:35","status":"review"},

  {"id":"DN-2169","owner":"felipe","path":"/rel/especialistas","time":"14:08","status":"done"},
  {"id":"DN-2168","owner":"pavan","path":"/fin/fechamento-abr","time":"13:55","status":"done"},
  {"id":"DN-2167","owner":"daniel","path":"/app/api/pagamentos","time":"13:40","status":"done"},
  {"id":"DN-2166","owner":"lucas","path":"/mkt/campanha-q2","time":"13:28","status":"done"},
  {"id":"DN-2165","owner":"vinicius","path":"/data/staging-refresh","time":"13:18","status":"done"},

  {"id":"AR-2149","owner":"pavan","path":"/fin/forecast-q1","time":"Mai-08","status":"archived"},
  {"id":"AR-2148","owner":"daniel","path":"/app/legacy-migration","time":"Mai-08","status":"archived"},
  {"id":"AR-2147","owner":"vinicius","path":"/data/mart-fin","time":"Mai-08","status":"archived"}
]
```

Contagem total por coluna (use no header, formato `(N)`): `Backlog (18)` · `Running (6)` · `Review (5)` · `Done (5)` · `Archived (28)`. Os números das colunas são **maiores que o JSON** porque algumas tasks ficam fora do viewport — mostre só o que está no JSON e adicione uma row final tipo `… 25 more` em `Backlog` e `Archived` pra indicar overflow.

**Cor por prefixo do ID:**
- `BK-*` (Backlog): `--muted` (cinza-azul calmo)
- `RN-*` (Running): `--accent` (cyan neon `#00f0ff`) com peso visual extra (bold ou letter-spacing levemente apertado)
- `RV-*` (Review): `--status-blocked` (`#ff6b35` laranja — semanticamente "esperando humano")
- `DN-*` (Done): `--status-done` (`#64ffda` mint)
- `AR-*` (Archived): `--muted` com opacity reduzida

**Owner** = slug em lowercase, mono, cor `--text` opacity 0.85. **Path** = mono cor `--muted`, com truncate quando exceder. **Time** = mono cor `--text` opacity 0.6 (formato `HH:MM` se hoje, `Mai-DD` se data passada).

---

## 5. Anatomia das colunas — função, não dimensão

**Cada coluna tem que comunicar:**
- **Header** com nome da coluna + contagem entre parênteses. Ex: `Backlog (18)`. Hierarquia clara: nome em mono peso 500, contador em mono regular opacity reduzida.
- **Sub-header de tabela** com labels das colunas internas: `ID · OWNER · PATH · TIME · S` (S = status dot). UPPERCASE mono pequeno, letter-spacing aberto, opacity baixa — funciona como legenda discreta, não como header dominante.
- **Rows** densas (4-6px de padding vertical), gap horizontal pequeno entre células, tudo mono.
- **Status dot `S`** ao final de cada row — círculo 6px na cor do status, dá redundância visual ao prefixo do ID.

**Liberdade:**
- Largura das colunas (igual? proporcional ao volume? Backlog/Archived mais estreitas porque rows são "calmas"?). Você decide.
- Separadores entre colunas: hairline vertical 1px? gap respiro? augmented-ui clip-corner num frame único do kanban inteiro? Você escolhe.
- Sub-header pode ficar dentro de cada coluna ou ser uma linha única acima das 5 colunas com larguras alinhadas. Sua decisão.
- Padding interno do container do kanban, distância dos cards acima.

---

## 6. Comportamento — função, não animação

**Hover de row:**
- Background tint subtle (algo como `--accent-subtle` ou `--card-2`) — destaca leitura sem virar interação.
- Cursor pointer.
- **Sem `translateY`, sem scale, sem glow** — kanban é estático. Tipo log viewer.

**Click de row:**
- No protótipo, só highlight visual persistente (afinal, abrir detalhe da task é fora do escopo desta tela).
- `Enter/Space` numa row focada por teclado dispara o mesmo highlight.

**Scroll vertical interno:**
- Cada coluna tem altura fixa (calculada pra caber entre os cards e o footer técnico).
- Quando exceder, scroll vertical **na coluna**, não na página inteira.
- Scrollbar custom: largura ~4px, track `--border`, thumb `--accent` (sem setas).

**Task nova entrando (simula SSE):**
- Após 2s do load, uma row nova aparece em `Running` com fade-in curto (~200ms) + flash subtle de background `--accent-subtle` por ~800ms.
- **Não inventar bounce, slide horizontal, scale.** Sci-fi sóbrio: a task aparece, pisca discretamente, repousa.
- Se `prefers-reduced-motion: reduce`: a row aparece direto, sem flash.

---

## 7. Empty states

**Coluna inteira sem tasks:**
- Header + sub-header normais.
- Body vazio (sem texto "no items"). Hairlines mantidos pra estrutura.

**Kanban inteiro sem nenhuma task (estado fresh do sistema):**
- Overlay centralizado, microcopy técnico em mono UPPERCASE opacity 0.4: `▸ AGUARDANDO O PRIMEIRO EVENTO`.
- Linha auxiliar abaixo, mono ou Geist regular opacity 0.5: `Verifique se o SSE conectou (canto inferior direito)`.
- Centralizado vertical entre headers das colunas e o footer.

---

## 8. Liberdade criativa

**Suas (não minhas):**
- Larguras de coluna, separadores entre elas, padding interno.
- Forma do header de coluna (linha simples? com underline? augmented-ui clip num frame único?).
- Forma do sub-header de tabela (legenda dentro de cada coluna ou linha única acima de todas).
- Microcopy técnico do kanban — pode adicionar uma linha no topo do container tipo `▸ TASK FEED // EVT 24H` ou `KANBAN · LIVE` se fizer sentido. Sua decisão.
- Comportamento do hover (qual tint, qual intensidade), animação de task nova entrando (dentro do limite "calmo, não decorativo").
- Linha `… N more` no fim de Backlog/Archived: forma e label seca.

**Minhas (não negociáveis):**
- Paleta + tipografia.
- 5 colunas com ordem e nomes literais: `Backlog · Running · Review · Done · Archived`.
- Mock data Sec 4.
- Cor por prefixo do ID Sec 4.
- Tipografia mono em 100% do kanban.

---

## 9. Anti-padrões — só esses

- ❌ Cards verticais bonitinhos com tasks dentro (formato Trello). Aqui é tabela monospace.
- ❌ `border-radius` em rows. Cantos retos. Quando muito, `rounded-sm` no container externo do kanban.
- ❌ Drop-shadow comum em qualquer parte do kanban. Sem sombra de objeto.
- ❌ Status dots com glow exagerado (alpha > 0.4) — kanban é sóbrio, dot é redundância visual seca.
- ❌ Hover com `translateY`, scale, ou border thickening. Só tint.
- ❌ Microcopy bobinho em empty state ("No tasks yet 🎉"). Use UPPERCASE mono seca.
- ❌ Truncate de PATH com `...` literal. Use `…` (ellipsis tipográfico) ou fade-out via `mask-image`.
- ❌ Geist Sans em row, header de coluna, ou sub-header. Mono em 100%.

---

## 10. Stack do output

- HTML standalone.
- Tailwind 4 via CDN ou utility classes inline (mesma escolha dos turnos anteriores).
- `<style>` global com paleta hardcoded (cole do `Cockpit · Frota v1.html`).
- **augmented-ui via CDN** já incluído nos turnos anteriores — reuse em ≤1 superfície pontual no kanban (ex: frame único do container, se quiser). Não em cada coluna.
- JS mínimo: theme toggle persistido em `localStorage` (mesma chave `cockpit-theme`), simulação da task nova entrando após 2s, scroll behavior das colunas, hover/focus state das rows.
- Geist Sans + JetBrains Mono via Google Fonts (Geist pode estar importado mas neste turno mal aparece).

---

## 11. Critério de aceite — pela vibe, não checklist

Quando eu abrir o output:

- **Em 1 segundo identifico estado do trabalho da frota** sem ler — running cyan acende, review laranja grita, done mint fica calmo, backlog/archived somem visualmente.
- **Densidade alta sem virar muro de texto.** Hairlines criam grid claro entre colunas e rows. Mono dominante dá leitura tabular natural.
- **Em <2s eu leio quem está fazendo o quê** scaneando vertical: vejo o owner, vejo o path, sei o tempo.
- **Hover é destaque de leitura, não interação principal.** Sutil, sem barulho.
- **Animação da task nova entrando é discreta.** Não chama atenção fora de proporção.
- **Light mode é tão refinado quanto dark.** IDs coloridos continuam legíveis no fundo claro (testar `BK-` muted, `RN-` cyan teal, `RV-` laranja, `DN-` verde teal, `AR-` muted opacity).
- **Algo me surpreende no chrome do kanban** — microcopy técnico no topo do container, separador HUD entre colunas, contador animado quando a task nova entra, mini-statusline no rodapé. Você teve liberdade na Sec 8; quero ver onde usou.

Se passar, abro turno 5 (último: polimento de estados marginais — banner SSE error, loading scan-line, focus rings, `prefers-reduced-motion`).
