# Aprendizado — contrato da API

Base: `/api/aprendizado`. Autenticação normal do cockpit (tailnet).

- `GET ?agente=pavan&tipo=memoria&desde=epoch&ate=epoch&offset=0&limite=100`: `{itens, total, proximo_offset}`. Filtros opcionais, datas inclusivas, limite 1–500, offset ≥ 0. Tipos: `memoria|memoria_compartilhada|skill`. Ordenação: data decrescente, empate por id crescente. `agente=ze-shared` identifica aprendizado compartilhado. Filtro desconhecido de agente retorna vazio; tipo inválido retorna 422.
- Nó: `{id, agente, tipo, acao, data, titulo, descricao, origem, caminho, fonte_data}`. `acao=criou|mudou`, `origem=agente|sonho`, data em segundos UTC. ID opaco estável por arquivo canônico + ação; não é um caminho fornecido pelo cliente.
- `GET /{id}/conteudo`: `{caminho, texto}` atual completo, com linhas suspeitas removidas pelo mesmo `SECRET` da Faxina. Os nós de criação e mudança abrem o mesmo arquivo atual; não são versões históricas. 404 inexistente, 403 caminho/link indevido, 413 acima de 200 KiB.

A lista é um inventário do aprendizado ativo: memórias individuais `~/.claude/memory-*/*.md`, compartilhadas `ze-shared/memory/shared_*.md`, skills `ze_claude/*/.claude/skills/*/SKILL.md`. Não inclui índices, `arquivo/`, `*.antiga-*`, cofre/vault/.env ou links externos. Aliases de skills internos são deduplicados pela pasta canônica; o agente é o dono canônico, usando `agents.yaml` quando mapeado e nome do workspace nos demais.

Para conteúdo versionado, mostra criação e última mudança do caminho atual no Git (`fonte_data=git`); arquivos auxiliares também contam como mudança de skill. Não reconstrói todas as revisões intermediárias nem renomes antigos. Memória individual não tem histórico: um nó `mudou` usa `metadata.modified` ou mtime; criação desconhecida não é inventada. Sonho exige `backup/<rodada>/aplicacao.json`, IDs presentes no manifesto e digest proposto igual ao conteúdo atual. Proposta pendente ou conteúdo alterado depois não recebe selo Sonho.

Cache do inventário por 15 s, com uma varredura concorrente por processo. Conteúdo sempre relido e validado; mudanças externas podem levar até 15 s para aparecer na lista. Paginação por offset é sobre o inventário corrente, não um snapshot permanente. Primeira medição real: 958 nós/812 arquivos; varredura 2,22 s fria, 1,31 s seguinte, antes do cache.

Prova HTTP em `127.0.0.1:8013` (app real, lifespan desligado para não iniciar watchers/executores): GET global 1,37 s frio e 34 ms em cache. Pavan: nó `46e0f024675aa03fbf4483936ed972f6`, 16/11/2026 05:10:35 UTC; Daniel: `ccc7133460f65e55f8fc023024999456`, 16/11/2026 04:54:25 UTC. Conteúdo do primeiro retornou 200. Leituras apenas; nenhum item criado no banco real.
