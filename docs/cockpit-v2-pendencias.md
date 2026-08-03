# Cockpit v2 — Pendências (Auditoria Tara, 02/08/2026)

> Auditoria só-relatório rodada pela Tara em 02/08 23:42, cobrindo os 19 commits do dia
> (`e132166`..`48db48a`) + o working tree sujo do frontend. Vivia só em `/tmp`
> (`/tmp/tara-auditoria-geral.md`); persistida aqui para não sumir num reset.
> **Estado em 03/08 (commit `e6f68aa`): os 11 achados continuam ABERTOS** — nenhum foi
> tratado. Cuidado: o commit `e1f9966` diz "fecha achados da auditoria", mas é de uma
> auditoria ANTERIOR (do driver), não desta lista.

## BLOQUEIA

- [ ] **#1 — Retry do painel aborta a própria requisição.**
  `apps/cockpit/components/shell/bloco-de-acoes.tsx:220`. O `setTimeout` chama
  `setRetentativa(n+1)` + `buscar(controlador.signal)` juntos; o bump de `retentativa`
  re-roda o efeito, cujo cleanup faz `controlador.abort()` — mata o fetch recém-nascido.
  Painel nunca reconecta sozinho, só fechar/reabrir. **Frente: frontend.**
- [ ] **#2 — Relaunch pode deixar o agente num shell vazio.**
  `apps/api/services/tmux_driver.py:1021`. Se `_wait_for_processes_exit` estoura (>5s),
  a função retorna ANTES do `send_keys` que lança o Claude (linha 1028) — janela nova
  fica só com shell, janela velha já morta. `52cecac` mexeu no arquivo mas só pra
  recuperar canais; o fluxo do bug segue intacto. **Frente: backend.**

## GRAVE

- [ ] **#3 — Claude vivo vira "offline" após 5 min ocioso.**
  `apps/api/db/store.py:191`. Com `session_present` mas `lifecycle` não-fresh, o caminho
  não-Codex cai no `return "offline"` final em vez de derivar `ocioso`. **Backend.**
- [ ] **#4 — Compact compara relógio do iPhone com o do VPS.**
  `apps/cockpit/app/agente/[slug]/feed-da-conversa.tsx:45/50` + `lib/compact.ts:161`.
  Início usa `Date.now()` do browser, fim usa timestamp do servidor; relógio adiantado
  do iPhone descarta o resumo real e trava o composer. **Frontend.**
- [ ] **#5 — Teste do compact valida flag impossível no caminho real.**
  `packages/cockpit-core/src/chat-payload-classifier.ts:110` + `apps/api/.../agents.py:1834`.
  Teste injeta `isCompactSummary` que o serializador do backend remove; produção depende
  do prefixo textual em inglês. Teste prova o comportamento errado. **Backend + teste.**
- [ ] **#6 — Cota Codex velha carimbada como atual.**
  `apps/api/.../codex_reader.py:253` + `agents.py:963`. A normalização não preserva o
  timestamp do evento e `_build_codex_painel_quotas` usa `time.time()` como `updated_at`
  → a UI nunca mostra "dados antigos". **Backend.**
- [ ] **#7 — Quotas/contexto prontos entregues no app CONGELADO, não no painel v2.**
  `page.tsx` (v2) não referencia quotas; o `QuotasBloco` só existe em
  `apps/web/components/painel-panel.tsx:135,148` (congelado). Recurso testado e pronto,
  invisível pro Rica no produto atual. **Frontend (portar pro v2).**

## MENOR

- [ ] **#8 — Delegação some em conversa vazia.**
  `feed-da-conversa.tsx:98`. Empty-state decide por `itensBase.length === 0`, mas
  delegações entram em `itens` (lista final) → agente sem mensagens que delega mostra
  "Sem conversa ainda". **Frontend.**
- [ ] **#9 — Marca de delegação morta não é limpa (risco de reviver por reuso de PID).**
  `apps/cockpit/app/api/delegacoes/delegacoes.ts:103`. `if (!pidVivo(marca.pid)) continue;`
  pula o PID morto mas não apaga o arquivo órfão, apesar do comentário dizer que limpa.
  **Frontend.**
- [ ] **#10 — Scripts de medição apontam pra rotas apagadas.**
  `docs/cockpit-v2-medicao/escala_g1_tres_bracos.py:52` usa `/spike`, `/spike/sem-lib`,
  `/spike/feed`, deletadas no working tree → 404. **Docs/scripts.**
- [ ] **#11 — Working tree falha em `git diff --check`.**
  `packages/cockpit-core/src/render-items.test.ts:414` — "new blank line at EOF".
  **Trivial.**

## Ruído descartado pela Tara (não perseguir)
`ade0356`/`6ec3ed4` (regressão temporária já tratada), `2fe2ce0` (90s de resume estão
certos — o defeito é o gate de 5s = #2), fila/recibo (o eco reconcilia), flags/vitrines
(não sobrou `RELANCAR_LIBERADO` nem rota de vitrine), concorrência tmux (locks em
`finally`).

## Validação da Tara
143 testes backend + 366 cockpit + 40 cockpit-core passando, typecheck limpo — mas as
suítes **não exercem** o retry React real (#1) e, em #5, validam o comportamento errado.
