# F7 — API: briefing de retorno e selo ⚠️ (cadeira `api`)

Leia em `docs/conversas/PLANO.md`: "Armadilhas", "Contrato da API" e a seção F7. Seu relato da F6
está em `relatos/f6.md`; o código dela já está no `main` (`79206df`). Você não commita. Relato em
`docs/conversas/relatos/f7.md`, até 15 linhas, `pytest` contra a base (846 ok + 3 falhas de
ambiente + 2 xfailed).

## Fatos medidos na VPS (01/10)

- **Retomar publicado e provado no canarinho:** A → B → A, três 200 `pronta` em 28, 22 e 20 s.
  O processo subiu com `--resume <id>` nas três; nenhum diálogo apareceu; a nota de cada
  conversa que saiu foi gravada.
- **`retomada_em` é gravado antes do boot** (`store.marcar_retomada`), então já existe quando o
  gancho `SessionStart` roda na largada.
- **F1:** `--continue` e `--resume` chegam iguais ao gancho (`source: resume`). Quem separa o
  Retomar do Ligar comum é a `retomada_em`, não o `source`. A marca fica no banco depois da
  largada: decidir como ela deixa de valer é parte da entrega.
- A conversa deixada há duas trocas aparece 🔒 por até 2 min (escrita recente sem ser a
  `deixada`). Esperado, fica como está.

## Entrega

A da F7 do plano: arquivos mexidos a partir do `file-history-snapshot`, `pendencia` na lista com
cache, `GET /{id}/briefing` (no máximo 25 linhas) e o `apps/api/scripts/briefing-retorno.sh`.
O registro do gancho no `~/.claude/settings.json` da VPS é meu.

## Régua de pronto

Testes: arquivo criado do zero não aparece (limitação no relato), repo sem mudança devolve vazio,
`--continue` comum não recebe briefing, API fora deixa o script calado em até 3 s. `pytest` sem
falha nova. A prova de que o agente cita o briefing depois de retomar é minha, depois de publicar.

Viu furo? Escreva no relato; seu caminho vale.
