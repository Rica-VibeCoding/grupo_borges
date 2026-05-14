# Tweak 1 — Cockpit · Kanban v1.html (5 fixes)

> **Onde colar:** projeto Designer `https://claude.ai/design/p/019e1329-d50a-7583-a0d3-3b5bbefdc096` → abrir arquivo `Cockpit · Kanban v1.html` → modo **Tweaks** (pílula no canto inferior do canvas) → colar o bloco abaixo.
>
> **Custo:** free (Tweaks não queima Send).
>
> **Se algum fix não pegar:** retesta o que faltou em segunda passada (ainda free). Os fixes 1 e 4 são os que **mais provavelmente** vão precisar Send se Tweaks falhar — comportamento composto e propagação por múltiplos lugares.

---

```
Aplique estes 5 ajustes pontuais SEM alterar nada além dos pontos listados.

1. **Badge multi-instância nos cards de agente** — hoje só o card do Daniel mostra "+2" ao lado do slug. Mudar pra `[N]` clicável (formato chip com colchetes, não símbolo `+` ou `×`) e renderizar em TODOS os 6 cards. Daniel mantém `[2]`. Os outros 5 cards single-instance mostram `[1]`. Comportamento: click no badge expande pílulas inline horizontais (mesma transição colapsado→expandido já entregue no `Agent Card · Daniel v3.html`).

2. **Footer do card Barsi (offline)** — hoje mostra `TMUX:BARSI-0`. Quando `instance_count === 0`, trocar pra `TMUX:—` (em-dash, sem o nome+zero). Manter o resto do footer do Barsi igual.

3. **Pane_excerpt do card Vinicius (idle)** — hoje aparece `STANDBY · conversation compacted at 14:22`. Trocar `STANDBY` por `IDLE` (alinhar com o status agregado do card, que já está IDLE).

4. **Reconciliar counts de "tasks running" em 3 lugares** — hoje mostra `EXEC 03` no KPI strip, `RUNNING (07)` no header da coluna do kanban, `RUN 03` no footer global. Reconciliar pra `06` em todos os 3 (= número de tasks running visíveis no feed do kanban, igual ao mock original). O segmented `RUN 02` no filter de status (que aparece como chip `● RUN 02`) pode permanecer — esse conta AGENTES em status running, semântica distinta. O `Δ +1` no canto direito do footer do kanban pode ficar como sinalização separada de "stream ativo via SSE entregando task nova".

5. **Header da coluna ARCHIVED** — hoje termina com `+TR` à direita do contador, semântica obscura. Remover o `+TR`. Header fica `ARCHIVED (28)` limpo.
```
