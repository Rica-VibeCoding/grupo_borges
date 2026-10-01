# F14 — API da rodada 2 (cadeira `api`)

Leia em `docs/conversas/PLANO.md`: "Contrato da API", "Armadilhas conhecidas" e a seção
"Rodada 2" inteira (decisões 1–8 e o bloco F14). Não leia as fases F0–F13: o código é a fonte.

Você não commita. Relato em `docs/conversas/relatos/f14.md` (até 15 linhas): o que entrou, os
números de `pytest` e `ruff`, e o que você decidiu diferente deste briefing.

## Onde mora (medido em 01/10, `main`)

- Rotas: `apps/api/routers/conversas.py` (854 linhas). Lista em `get_conversas` (:143),
  estrela em `post_estrela` (:192) — o molde para `concluida` e `titulo`.
- Leitura do JSONL e ordem de queda do título: `apps/api/services/conversas.py`
  (`_resumir` :265, `_titulo` :295, `titulo_de` :313, `localizar`).
- Estado próprio: tabela `conversa_meta` em `apps/api/db/schema.sql:290`, acesso em
  `apps/api/db/store.py` (`conversa_meta_do_agente`, `apagar_conversa_meta`). Coluna nova
  precisa da migração do jeito que o `store.py` já faz com as colunas da F7
  (`atividade_em`, `briefing_em`) — banco vivo não é recriado.
- Canonização do feed: `_eh_residuo_de_troca` em `apps/api/routers/agents.py:2753` (envelope do
  `/clear` + lembrete do `/rename`). A leitura usa a mesma régua; tirar para um módulo comum se
  precisar, sem mudar comportamento do feed.
- A troca já sabe de onde saiu: `_publicar_troca` (:625) recebe `de`. Hoje isso só vai no
  evento do stream, não fica gravado.

## Entrega

1. `GET /{slug}/conversas/{id}/leitura`: últimas mensagens (fala do Rica e texto do agente,
   sem ferramenta, sem pensamento, sem resíduo de troca), do JSONL, **sem tocar no tmux**.
   Conversa de 30 MB não pode ler o arquivo inteiro: leia do fim. Traz junto título,
   `titulo_origem`, nota, estrela, concluída e turnos, para a tela não precisar da lista.
2. `concluida` na `conversa_meta` + `POST /{id}/concluida {valor}`. Filtro `concluidas`;
   `todas` deixa de trazer concluída. Conversa atual pode ser marcada? Decida e escreva.
3. `POST /{id}/titulo {titulo}`: grava na `conversa_meta`; vence na ordem de queda
   (`titulo_origem` = `estacionada` ou um valor novo, decida). Vazio = apaga o renomeado.
4. `anterior` na resposta da lista: id da última conversa que a linha deixou numa troca
   (Nova ou Retomar). Precisa sobreviver a restart da API. Some quando a anterior foi
   excluída.

## Pronto

- Testes: leitura de conversa grande (só o fim é lido), conversa nascida de `/clear` (resíduo
  fora), concluída (some de *Todas*, aparece em *Concluídas*), renomear (vence a queda, vazio
  volta), `anterior` (grava na troca, sobrevive, some na exclusão).
- `pytest apps/api` e `ruff` sem falha nova — diga a base e o depois.
- Fora daqui: tela (F15/F16), estacionar e Retomar (não mexer no fluxo da troca além de gravar
  o `anterior`).

Viu furo no desenho? O seu caminho vale: você está com o código na frente e eu não.
