# F5 — API: estacionar, Nova conversa e `/operacao` (cadeira `api`)

Leia em `docs/conversas/PLANO.md`: "Armadilhas", "Contrato da API" e a seção F5. Relatos úteis:
`relatos/f1.md` (M2: `/clear <nome>`) e `relatos/f2.md` (último bullet: o `atual` só anda com a
primeira mensagem da conversa nova). Você não commita. Relato em `docs/conversas/relatos/f5.md`,
até 15 linhas, `pytest` contra a base (804 ok + 3 falhas de ambiente).

## Fatos medidos

- F1/M2: `/clear <título>` grava a `custom-title` no JSONL **que sai**; a conversa nova nasce
  sem nome e perde o `agent-name`. Por isso a Nova conversa tem de dar `/rename <agente>` depois.
- O `_rename_apos_clear` (`routers/agents.py:3085`, armado em `:3166`) hoje dá à conversa nova
  o mesmo nome passado ao `/clear`. História em `git log -S _rename_apos_clear` (`dd5386d`,
  `1cdb553`); o rodapé do card (`RodapeDeCota.sessao`) depende dele — não quebrar.
- Ocupado: `_esta_ocupado(agent)` já é a régua usada pela troca de motor (`agents.py:4223`).
  Interromper: `post_agent_interromper` (`:4466`). Enviar texto: `POST /input` (`:3113`).
- Mensagem enviada no meio de um turno chega mas pode não virar turno: só mande o pedido de
  estacionar com o agente ocioso.
- **Lista a frio na VPS: 9,7 s** com 171 arquivos logo depois do restart da API (com cache,
  0,36 s). Aquecer o cache em segundo plano na subida da API, sem segurar o startup.

## Entrega

- `POST /estacionar {titulo, nota}` (chamado pelo agente) e `POST /nova {forcar}` com o fluxo
  da F5 do plano; depois do `/clear <título>`, `/rename <nome do agente>`.
- `GET /operacao` → `{fase: estacionando|religando|pronta|erro|null, desde}`. A F6 reusa.
  Uma operação por agente: segunda chamada com uma em curso → 409.
- O aquecimento do cache da lista.

## Régua de pronto

Testes com tmux e relógio falsos: ocioso, ocupado (409), `forcar`, agente que não responde no
prazo (segue com título de queda), título com aspas/acento/quebra de linha no `/clear`, fases
do `/operacao`, e o rodapé do card continuando certo.

Viu furo? Escreva no relato; seu caminho vale.
