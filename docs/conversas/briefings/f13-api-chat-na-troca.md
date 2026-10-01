# F13 — API: o chat acompanha a troca (cadeira `api`)

Código no `main`. Você não commita. Relato em `docs/conversas/relatos/f13-api.md`, até 12
linhas, `pytest` contra a base (879 ok + 3 falhas de ambiente + 2 xfailed). A cadeira `tela`
faz a F13 de tela ao mesmo tempo, contra o contrato abaixo.

## Fato medido na VPS (01/10, 03:00 BRT, o Rica no cockpit)

- Ele retomou "Voz em tempo real" (`a5b2f30c`) no canarinho. Às 03:00:28 a linha subiu com
  `--resume a5b2f30c`, o briefing foi lido às 03:00:32. Às 03:01 o chat **ainda mostrava a
  conversa que saiu** (`aacb8488`), terminando no pedido de estacionar e no "ok".
- O stream do chat resolve a sessão por `db.latest_jsonl_session_id` (`routers/agents.py:2901`)
  e reescaneia o disco (`sessao_no_disco`, perto de `:3036`). A F7b já sabe a atual certa
  (`_atual_e_deixada`, `--resume` do processo). Existe o evento `session-reset`
  (`services/session_reset.py`) que a tela já consome.
- O pedido de estacionar (texto que começa com `[cockpit] Vou fechar esta conversa…`) e o
  "ok" do agente aparecem no chat como fala do Rica e resposta comum.

## Entrega (contrato com a tela)

1. **Troca no stream:** quando a Nova ou o Retomar chegam a `pronta`, o stream aberto emite
   `conversa-trocada {session_id, de, motivo: "retomar"|"nova", titulo, nota, briefing}` e
   passa a servir a conversa nova, **com o histórico dela** (replay do fim, como na abertura).
   `briefing` é o texto que o gancho entregou, ou `null`. Stream aberto depois da troca já abre
   na conversa certa, antes de ela ganhar mensagem.
2. **Pedido do cockpit marcado:** as mensagens do estacionar (o pedido e a resposta "ok"
   que o segue) saem no feed com `origem: "cockpit"`, para a tela mostrar como linha
   discreta. Defina o critério e cubra com teste.

Viu furo? Escreva no relato; seu caminho vale.
