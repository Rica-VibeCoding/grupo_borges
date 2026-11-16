# Aprendizado — contrato da API

Base: `/api/aprendizado`. Autenticação normal do cockpit (tailnet).

- `GET ?agente=pavan&tipo=memoria&desde=epoch&ate=epoch&offset=0&limite=100`: `{itens, total, por_agente, total_geral, proximo_offset}`. Filtros opcionais, datas inclusivas, limite 1–500, offset ≥ 0. Tipos: `memoria|memoria_compartilhada|skill`. Ordenação: data decrescente, empate por id crescente. `agente=ze-shared` identifica aprendizado compartilhado. Filtro desconhecido de agente retorna itens vazios; tipo inválido retorna 422.
- `total` é a quantidade de nós com todos os filtros, antes da paginação. `por_agente` é um objeto JSON `{ "<slug>": <inteiro> }`, com a contagem de nós do inventário inteiro por agente, aplicando **somente `tipo`**: ignora `agente`, `desde`, `ate`, `offset` e `limite`. Omite agentes sem nós. `total_geral` é a soma dos valores de `por_agente`, com a mesma regra. Inventário vazio: `por_agente: {}`, `total_geral: 0`. São contagens de nós, não de arquivos: criação e mudança contam separadamente. A UI obtém as contagens em uma única página, sem baixar o inventário inteiro.
- Nó: `{id, alvo_id, agente, tipo, acao, data, titulo, descricao, origem, caminho, fonte_data}`. `acao=criou|mudou`, `origem=agente|sonho`, data em segundos UTC. `id` é opaco e estável por arquivo canônico + ação; `alvo_id` é uma string opaca de 32 caracteres hexadecimais, estável por tipo + caminho canônico do **arquivo**, independente da ação, data ou conteúdo. Os dois nós do mesmo arquivo compartilham `alvo_id`; aliases de skill também. Renomear/mover o arquivo muda a identidade; recriar no mesmo caminho mantém a identidade. A UI deve agrupar o estado de poda por `alvo_id`, continuando a enviar `id` nas rotas. Nenhum dos IDs é um caminho fornecido pelo cliente.
- `GET /{id}/conteudo`: `{caminho, texto}` atual completo, com linhas suspeitas removidas pelo mesmo `SECRET` da Faxina. Os nós de criação e mudança abrem o mesmo arquivo atual; não são versões históricas. 404 inexistente, 403 caminho/link indevido, 413 acima de 200 KiB.

A lista é um inventário do aprendizado ativo: memórias individuais `~/.claude/memory-*/*.md`, compartilhadas `ze-shared/memory/shared_*.md`, skills `ze_claude/*/.claude/skills/*/SKILL.md`. Não inclui índices, `arquivo/`, `*.antiga-*` ou cofre/vault/.env. A pasta `memory-<agente>` pode ser um link simbólico: seu realpath é a pasta canônica permitida, mantendo o agente pelo nome do alias e expondo o caminho real. Links nos arquivos ou abaixo dessa pasta continuam proibidos, inclusive links que apontem para fora. Exemplo: `memory-sobral` → `ze_claude/sobral/memory` é legível. Aliases de skills internos são deduplicados pela pasta canônica; links de skills externos ao repo são excluídos. O agente é o dono canônico, usando `agents.yaml` quando mapeado e nome do workspace nos demais.

Para conteúdo versionado, mostra criação e última mudança do caminho atual no Git (`fonte_data=git`); arquivos auxiliares também contam como mudança de skill. Não reconstrói todas as revisões intermediárias nem renomes antigos. Memória individual não tem histórico: um nó `mudou` usa `metadata.modified` ou mtime; criação desconhecida não é inventada. Sonho exige `backup/<rodada>/aplicacao.json`, IDs presentes no manifesto e digest proposto igual ao conteúdo atual. Proposta pendente ou conteúdo alterado depois não recebe selo Sonho.

Cache do inventário por 15 s, com uma varredura concorrente por processo. Aplicações e manifestos de Sonho são carregados uma vez por varredura, compartilhados pelas memórias. Falha/timeout do Git gera log e usa datas locais; falha ao ler/obter data de um arquivo gera log e pula só esse item, preservando a listagem e a resolução dos demais nós para poda. Conteúdo sempre relido e validado; mudanças externas podem levar até 15 s para aparecer na lista. Paginação por offset é sobre o inventário corrente, não um snapshot permanente. Primeira medição real: 958 nós/812 arquivos; varredura 2,22 s fria, 1,31 s seguinte, antes do cache.

Prova HTTP em `127.0.0.1:8013` (app real, lifespan desligado para não iniciar watchers/executores): GET global sem filtros (958 nós, página de 100) 1,28 s frio e 36 ms em cache; sob a suíte concorrente, o frio chegou a 3,62 s. CWD `apps/api` para resolver corretamente `GB_DB_PATH=db/grupo_borges.db`. Pavan: nó `46e0f024675aa03fbf4483936ed972f6`, 16/11/2026 05:10:35 UTC; Daniel: `ccc7133460f65e55f8fc023024999456`, 16/11/2026 04:54:25 UTC. Conteúdo do primeiro retornou 200. Leituras apenas; nenhum item criado no banco real.

## Poda e desfazer

Todos os POST desta API exigem JSON `{"confirmar": true}` **depois da confirmação na tela**. Ausência, falso, número ou string retornam 422 sem efeito. A UI deve guardar o `operacao_id` devolvido para oferecer desfazer, inclusive depois que o nó sair da lista.

- `POST /{id}/apagar`: só `memoria`. Move para `arquivo/<nome>.md` dentro da pasta canônica de memória, remove a linha do `MEMORY.md`; se houver outros links nessa linha, remove somente o link escolhido. Preserva os demais links, permissões e conteúdo. Memória cuja pasta real fica dentro do monorepo (caso do Sobral, versionado em Git) é **somente leitura**: retorna 409 com `detail: "memória dentro do monorepo é somente leitura; a poda exige operação com Git"`, sem mover nem alterar índice/Git. A poda local não cria commits; mover ali deixaria alterações fora do executor da Faxina. Resposta de sucesso `{operacao_id: "memoria-…", tipo: "memoria", status: "arquivado", agente, caminho, arquivado_para, criado_em}`. Operação concluída antes da resposta; invalida o cache local. Segunda tentativa com nó já ausente retorna 404.
- `POST /{id}/arquivar`: só `skill`. Retorna `{operacao_id: "faxina-<id>", tipo: "skill", status, faxina_item}`. `arquivar_pedido` significa **pedido**, não movimento concluído. Reutiliza item ativo ou cria pedido pela `GrupoBorgesDB.request_skill_archive`; decisão explícita dispensa apenas idade/cooldown da candidatura automática. Se o registro anterior estiver `arquivado`, mas a skill existir novamente no caminho original (restauração manual/recriação), encerra o registro velho como `mantido`, preservando commit/destino históricos, e cria **novo pedido com novo id**, na mesma transação. O executor existente da Faxina continua impondo índices/citações, aliases, git limpo, destino livre e commit dos dois caminhos; arquivo antigo no destino continua impedindo nova execução. Repetir pedido pendente, por qualquer nó do mesmo `alvo_id`, retorna o mesmo item. Erro existente retorna 409 e exige conferência na Faxina.
- `POST /podas/{operacao_id}/desfazer`: memória volta imediatamente, com status `restaurado`; skill delega à Faxina e retorna `desfazer_pedido`. Pedido de skill ainda não executado não pode ser desfeito (409); aguardar `arquivado` e então desfazer. Repetir enquanto no estado de destino é idempotente. Para acompanhar skills, use a listagem existente `/api/faxina?status=todos` e o id do `faxina_item`.
- Memória compartilhada é somente leitura: ambos os POST de poda retornam 403, tanto pelo nó de criação quanto pelo de mudança. Nos tipos que permitem poda, usar qualquer nó do mesmo arquivo tem o mesmo efeito.

Memória e índice são validados novamente no momento da operação, sem confiar no cache. Não aceita links simbólicos no arquivo, índice ou destino, nem sobrescreve destino existente. Índice ausente retorna 404; índice em formato de referência desconhecido retorna 409 em vez de deixar ponteiro quebrado. Excesso de tamanho retorna 413. Cada substituição do índice é atômica, com modo preservado e fsync. Move o arquivo preservando inode/modo/mtime e sem sobrescrever destino. Usa a trava do Sonho e uma trava local de poda. Escritores externos que ignoram essas travas ainda podem gerar conflito.

Desfazer preserva edições posteriores em outros trechos do índice. Alteração no trecho removido, arquivo arquivado alterado ou nova memória no caminho original retorna 409 sem sobrescrever. Duas alterações de arquivo não formam uma transação de filesystem: falha normal tenta reverter ambas. Journal privado (0600) em `~/.local/state/aprendizado/memoria-<id>.json` guarda o índice antes/depois e permite desfazer após restart. Interrupção abrupta com journal `preparado` exige conferência manual; não há repetição automática. O journal e suas cópias do índice nunca são expostos pelas rotas de conteúdo.

Validação isolada (todos os movimentos e pedidos em diretórios/banco temporários):

```sh
apps/api/.venv/bin/python -m pytest apps/api/tests/test_aprendizado*.py apps/api/tests/test_faxina*.py apps/api/tests/test_store.py apps/api/tests/test_security_headers.py -q
```

Resultado após as correções do review: **157 testes passaram**, incluindo toda a suíte `test_faxina*.py`. Regressões cobrem pasta de memória como alias (leitura, poda fora do repo, bloqueio no repo e links internos), skill restaurada/recriada, destinos de links semelhantes, falhas de Git/stat, contagens acima de 3.000 nós, `alvo_id` comum aos dois nós e uma leitura de cada aplicação/manifesto por varredura.

Prova adicional somente de leitura na API real em dev, `127.0.0.1:8013`, lifespan desligado e autenticação de dev habilitada em loopback, sem reiniciar produção:

```sh
curl --fail-with-body --silent --show-error \
  'http://127.0.0.1:8013/api/aprendizado?agente=sobral&tipo=memoria&limite=1'
```

Em 16/11/2026 retornou HTTP 200 (2,55 s frio), `total: 13`, `proximo_offset: 1` e:

```json
{
  "por_agente": {
    "barsi": 19, "canario": 11, "caseiro": 56, "daniel": 116,
    "felipe": 7, "fluytcom": 16, "fluytpos": 2, "miga_dani": 32,
    "pavan": 350, "sobral": 13, "vinicius": 19
  },
  "total_geral": 641
}
```

O primeiro item do Sobral teve `id: "dcd526f4e3aef6dae5d058ff7646d48d"`, `alvo_id: "dbd213c9fd5a5bb2d401394c10a1b31e"` e caminho real `/home/clawd/repos/ze_claude/sobral/memory/sobral_project_ponte_direta_tropa.md`. As contagens incluem todos os agentes apesar do filtro `agente=sobral` e da página de um item. Poda e desfazer foram exercitados exclusivamente em diretórios/banco temporários; nenhum item foi criado no banco real. Na primeira prova na VPS não havia pasta `dream-pavan/backup/`: propostas existentes não foram tratadas como aplicações.
