# Aprendizado — contrato da API

Base: `/api/aprendizado`. Autenticação normal do cockpit (tailnet).

- `GET ?agente=pavan&tipo=memoria&desde=epoch&ate=epoch&offset=0&limite=100`: `{itens, total, proximo_offset}`. Filtros opcionais, datas inclusivas, limite 1–500, offset ≥ 0. Tipos: `memoria|memoria_compartilhada|skill`. Ordenação: data decrescente, empate por id crescente. `agente=ze-shared` identifica aprendizado compartilhado. Filtro desconhecido de agente retorna vazio; tipo inválido retorna 422.
- Nó: `{id, agente, tipo, acao, data, titulo, descricao, origem, caminho, fonte_data}`. `acao=criou|mudou`, `origem=agente|sonho`, data em segundos UTC. ID opaco estável por arquivo canônico + ação; não é um caminho fornecido pelo cliente.
- `GET /{id}/conteudo`: `{caminho, texto}` atual completo, com linhas suspeitas removidas pelo mesmo `SECRET` da Faxina. Os nós de criação e mudança abrem o mesmo arquivo atual; não são versões históricas. 404 inexistente, 403 caminho/link indevido, 413 acima de 200 KiB.

A lista é um inventário do aprendizado ativo: memórias individuais `~/.claude/memory-*/*.md`, compartilhadas `ze-shared/memory/shared_*.md`, skills `ze_claude/*/.claude/skills/*/SKILL.md`. Não inclui índices, `arquivo/`, `*.antiga-*`, cofre/vault/.env ou links externos. Aliases de skills internos são deduplicados pela pasta canônica; o agente é o dono canônico, usando `agents.yaml` quando mapeado e nome do workspace nos demais.

Para conteúdo versionado, mostra criação e última mudança do caminho atual no Git (`fonte_data=git`); arquivos auxiliares também contam como mudança de skill. Não reconstrói todas as revisões intermediárias nem renomes antigos. Memória individual não tem histórico: um nó `mudou` usa `metadata.modified` ou mtime; criação desconhecida não é inventada. Sonho exige `backup/<rodada>/aplicacao.json`, IDs presentes no manifesto e digest proposto igual ao conteúdo atual. Proposta pendente ou conteúdo alterado depois não recebe selo Sonho.

Cache do inventário por 15 s, com uma varredura concorrente por processo. Conteúdo sempre relido e validado; mudanças externas podem levar até 15 s para aparecer na lista. Paginação por offset é sobre o inventário corrente, não um snapshot permanente. Primeira medição real: 958 nós/812 arquivos; varredura 2,22 s fria, 1,31 s seguinte, antes do cache.

Prova HTTP em `127.0.0.1:8013` (app real, lifespan desligado para não iniciar watchers/executores): GET global sem filtros (958 nós, página de 100) 1,28 s frio e 36 ms em cache; sob a suíte concorrente, o frio chegou a 3,62 s. CWD `apps/api` para resolver corretamente `GB_DB_PATH=db/grupo_borges.db`. Pavan: nó `46e0f024675aa03fbf4483936ed972f6`, 16/11/2026 05:10:35 UTC; Daniel: `ccc7133460f65e55f8fc023024999456`, 16/11/2026 04:54:25 UTC. Conteúdo do primeiro retornou 200. Leituras apenas; nenhum item criado no banco real.

## Poda e desfazer

Todos os POST desta API exigem JSON `{"confirmar": true}` **depois da confirmação na tela**. Ausência, falso, número ou string retornam 422 sem efeito. A UI deve guardar o `operacao_id` devolvido para oferecer desfazer, inclusive depois que o nó sair da lista.

- `POST /{id}/apagar`: só `memoria`. Move para `memory-<agente>/arquivo/<nome>.md`, remove a linha do `MEMORY.md`; se houver outros links nessa linha, remove somente o link escolhido. Preserva os demais links, permissões e conteúdo. Resposta `{operacao_id: "memoria-…", tipo: "memoria", status: "arquivado", agente, caminho, arquivado_para, criado_em}`. Operação concluída antes da resposta; invalida o cache local. Segunda tentativa com nó já ausente retorna 404.
- `POST /{id}/arquivar`: só `skill`. Retorna `{operacao_id: "faxina-<id>", tipo: "skill", status, faxina_item}`. `arquivar_pedido` significa **pedido**, não movimento concluído. Reutiliza item ativo ou cria pedido pela `GrupoBorgesDB.request_skill_archive`; decisão explícita dispensa apenas idade/cooldown da candidatura automática. O executor existente da Faxina continua impondo índices/citações, aliases, git limpo, destino livre e commit dos dois caminhos. Repetir pedido pendente retorna o mesmo item. Erro existente retorna 409 e exige conferência na Faxina.
- `POST /podas/{operacao_id}/desfazer`: memória volta imediatamente, com status `restaurado`; skill delega à Faxina e retorna `desfazer_pedido`. Pedido de skill ainda não executado não pode ser desfeito (409); aguardar `arquivado` e então desfazer. Repetir enquanto no estado de destino é idempotente. Para acompanhar skills, use a listagem existente `/api/faxina?status=todos` e o id do `faxina_item`.
- Memória compartilhada é somente leitura: ambos os POST de poda retornam 403.

Memória e índice são validados novamente no momento da operação, sem confiar no cache. Não aceita links simbólicos no arquivo, índice ou destino, nem sobrescreve destino existente. Índice ausente retorna 404; índice em formato de referência desconhecido retorna 409 em vez de deixar ponteiro quebrado. Excesso de tamanho retorna 413. Cada substituição do índice é atômica, com modo preservado e fsync. Move o arquivo preservando inode/modo/mtime e sem sobrescrever destino. Usa a trava do Sonho e uma trava local de poda. Escritores externos que ignoram essas travas ainda podem gerar conflito.

Desfazer preserva edições posteriores em outros trechos do índice. Alteração no trecho removido, arquivo arquivado alterado ou nova memória no caminho original retorna 409 sem sobrescrever. Duas alterações de arquivo não formam uma transação de filesystem: falha normal tenta reverter ambas. Journal privado (0600) em `~/.local/state/aprendizado/memoria-<id>.json` guarda o índice antes/depois e permite desfazer após restart. Interrupção abrupta com journal `preparado` exige conferência manual; não há repetição automática. O journal e suas cópias do índice nunca são expostos pelas rotas de conteúdo.

Validação isolada (todos os movimentos e pedidos em diretórios/banco temporários):

```sh
apps/api/.venv/bin/python -m pytest apps/api/tests/test_aprendizado*.py apps/api/tests/test_faxina*.py apps/api/tests/test_store.py apps/api/tests/test_security_headers.py -q
```

Resultado final: 136 testes passaram, incluindo toda a suíte `test_faxina*.py`. Confirmação HTTP somente de leitura; poda e desfazer exercitados exclusivamente na bancada temporária. Na VPS, não havia `dream-pavan/backup/aplicacao.json` (nem pasta `backup/`): propostas existentes não foram tratadas como aplicações.
