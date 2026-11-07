# Faxina — contrato da etapa 1

## API

- `GET /api/faxina?status=pendente|arquivado|todos`: filtro exato; padrão `pendente`. Retorna `{itens, resumo: {pendentes, arquivados, ultima_varredura}}`. Contagens globais, independentes do filtro.
- `POST /api/faxina/{id}/manter`: `pendente → mantido`.
- `POST /api/faxina/{id}/arquivar`: `pendente → arquivar_pedido`.
- `POST /api/faxina/{id}/desfazer`: `arquivado → desfazer_pedido`.
- Os três POST devolvem o item completo. Repetir a decisão enquanto está no estado de destino devolve o mesmo item, sem renovar a data. Transição incompatível: HTTP 409. Item inexistente: HTTP 404.
- `GET /api/faxina/{id}/conteudo`: `{caminho, texto}`. Em `arquivado` e `desfazer_pedido`, lê `arquivado_para`; nos demais, lê o caminho original. Para `tipo=skill`, o caminho identifica a pasta e o conteúdo vem de `SKILL.md`. HTTP 413 acima de 200 KiB; HTTP 403 para caminho indevido ou link simbólico; HTTP 404 para arquivo ausente.
- `id`: inteiro. Datas: segundos desde 1970 UTC, ou `null`. `citado_em`: lista JSON de caminhos. `ultima_varredura` fica `null` até haver uma varredura real.
- `manter` e a restauração concluída renovam `decidido_em`, zeram `dias_parado` e impedem nova candidatura por 20 dias. Não inventam uma leitura: `ultima_leitura` continua sendo a leitura observada.
- `todos` também mostra pedidos em execução e erros. Erros exigem conferência manual; não há repetição automática de operações que falharam.

## Integração da próxima etapa

- `GrupoBorgesDB.create_faxina_item(...)`: caminho relativo incluindo espaço de trabalho, tipo, datas, citações e parecer opcional. Retorna item existente enquanto houver estado ativo; retorna `None` quando ainda não completou 20 dias. Sem leitura conhecida, usa último commit; sem nenhuma data, não cria candidato.
- `GrupoBorgesDB.record_faxina_scan(epoch)`: registrar apenas uma varredura efetivamente concluída, mesmo sem candidatos.
- O parecer do Jev, a instrumentação de leitura, a varredura e os avisos não pertencem à etapa 1.

## Executor

`python scripts/faxina_executor.py --db /caminho/absoluto/banco.db --repo /caminho/ze_claude`

- Executa uma passagem. As unidades em `scripts/systemd/faxina-executor.{service,timer}` chamam a passagem a cada minuto, como usuário `clawd`.
- A unidade usa o mesmo diretório de trabalho e `get_settings()` da API, inclusive o `.env`. Isso preserva a interpretação de `GB_DB_PATH` relativo.
- Origem precisa ser arquivo regular versionado, sem alterações locais ou preparadas para commit. Uma skill é uma pasta inteira com `SKILL.md`; arquivos ignorados, não versionados, especiais e links simbólicos internos bloqueiam o movimento. Outros diretórios e links simbólicos não são movidos. O destino não pode existir. Links simbólicos externos apontando à skill entram em `citado_em`, pois seriam quebrados pelo movimento.
- Consulta `citado_em` e relê índices `CLAUDE.md`, `README.md`, `SKILL.md`, `MEMORY.md` versionados ou não ignorados. Índices dentro de `arquivo/` são excluídos. Índices com link simbólico interno são consultados; não segue índices para fora do repositório.
- Referência ao caminho, caminho absoluto ou caminho relativo ao índice bloqueia com `erro: "citado em <índice>"`. Nenhum índice é editado.
- `git mv` preserva `<espaço de trabalho>/arquivo/<resto>`. Commit exclusivamente dos dois caminhos, sem push. Alterações e índice git de outras sessões permanecem intactos.
- Uma trava impede dois executores simultâneos. Registro em `.git/faxina-operation.json` permite reconhecer commit concluído antes de uma interrupção na gravação do banco. Interrupção antes do commit vira erro para conferência manual; falha normal de commit tenta reverter apenas o movimento.
- Restauração termina em `mantido`. `commit_sha` passa a identificar o commit da restauração; `arquivado_para` permanece como histórico.

## Varredura da etapa 2

- `scripts/faxina_varredura.py` roda em modo relatório por padrão. `--aplicar` só grava após 20 dias desde o primeiro registro válido em `leituras.jsonl`.
- Candidatos versionados: `*/docs/**/*.md`, `ze-shared/planos/**/*.md` e pastas canônicas de `*/.claude/skills/*/SKILL.md`. Cada skill conta como uma unidade; aliases são deduplicados.
- Exige simultaneamente 20 dias sem leitura e sem commit. Leitura de qualquer arquivo interno ou invocação do nome/alias da skill conta como uso. Alterações locais excluem candidatos.
- `@caminho` e `@include caminho` em `CLAUDE.md`, inclusive referências transitivas, excluem arquivos carregados na inicialização. Nomes/caminhos referenciados em ganchos registrados globalmente ou por espaço de trabalho e em `ze-shared/hooks/*` também são excluídos. Citações comuns ficam no cartão.
- Cartão `pendente` há 7 dias (folga de 1h), com `jev_veredito = arquivar` e `jev_probabilidade ≥ 0,8`, vira `arquivar_pedido` no início da varredura (`arquivar_sem_resposta`, autorizado pelo Rica em 23/09). O resto fica pendente. Quem move é o executor, com as mesmas travas do toque manual.

## Jev

- A varredura madura consulta o Jev apenas para novos candidatos, antes de gravar. Duas perguntas `choice` por unidade: destino e motivo. Até 10 unidades e 24 KB por lote.
- A chave OPENROUTER sai do cofre somente para a memória e o ambiente do processo filho do Jev. Erro de API interrompe sem inserir candidatos nem repetir a chamada; HTTP 402 é identificado explicitamente.
- Envio de conteúdo autorizado pelo Rica em 23/09/2026 e ligado por padrão: título, cabeçalhos e até 1.500 caracteres do corpo; para skill, trecho do próprio `SKILL.md`. `--somente-metadados` desliga o conteúdo. Linhas com indicadores de segredo são removidas da cópia, mantendo o restante. É redução de dano, não garantia universal de anonimização. Nunca envia cofre, `.env` ou destinos externos ao repositório. Arquivos maiores que 200 KiB ficam sem trecho.
- Cada record também leva `sinais`: até 6 `linhas_estado` de até 240 caracteres encontradas no texto inteiro; `citacoes_repo` com contagem de arquivos versionados que citam caminho ou nome e até 5 caminhos (sem o próprio alvo, seu conteúdo interno ou `arquivo/`); até 5 `skills_relacionadas` ativas de `<workspace>/.claude/skills/*` ou `ze-shared/.claude/skills/*`, com nome, caminho e description até 150 caracteres; `ultimo_commit_pasta` em UTC, de qualquer arquivo irmão; e até 8 `decisoes_rica` com caminho e decisão, do mesmo workspace, priorizando a mesma pasta. Skills usam interseção simples de termos de pelo menos 4 caracteres no caminho/título e nome/description, sem acentos e descartando palavras genéricas e o nome do workspace; similaridade não comprova substituição.
- Os sinais são locais, sem chamada de rede. Aplicam os mesmos filtros `SECRET` e `restricted_path`, excluem cofre/vault, `.env` e destinos externos; fontes de conteúdo precisam ser arquivos regulares seguros. Aliases de skills internas são resolvidos e deduplicados. Description suspeita é removida antes do corte, assim como linhas de estado suspeitas. `--somente-metadados` também desliga linhas de estado e leitura de skills; preserva citações, data da pasta e exemplos de caminhos/decisões.
- Histórico aberto por SQLite URI `mode=ro`, sem migrar/inicializar o banco. O schema atual não identifica o autor: decisões `mantido`/`arquivado` com data são usadas, excluindo conservadoramente qualquer arquivamento compatível com `arquivar_sem_resposta` (veredito arquivar, probabilidade ≥ 0,8 e prazo ≥ 7 dias menos 1h). Isso pode excluir decisões humanas indistinguíveis da regra. O próprio caminho/id nunca entra como exemplo; no replay só entram decisões anteriores à data da decisão avaliada. Exemplos com o mesmo caminho são deduplicados.
- A pergunta aceita como evidência suficiente de `arquivar` qualquer um: linha de estado do próprio documento dizendo implementado/entregue/desligado/descartável/substituído/concluído; skill ativa cobrindo o assunto sem citação viva fora de `arquivo/`; pesquisa pontual, bruto, rascunho, briefing de despacho ou versão numerada sem citação viva e com pasta parada; decisões passadas do Rica em casos do mesmo tipo/pasta apontando arquivar. Não exige prova formal adicional de encerramento.
- `manter` exige sinal positivo: índice vivo (`CLAUDE.md`, `README.md`, `SKILL.md`, `MEMORY.md`, `AGENTS.md`) ou script/código vivo citando; skill sem substituta; referência/procedimento ainda aplicável; projeto com pasta viva. `incerto` significa sinais contraditórios, não falta de prova formal. Idade isolada não decide. O contexto explicita a reversibilidade via git, o baixo custo de errar arquivando e a revisão manual que manter lixo impõe ao Rica.
- O teto de 24.000 bytes mede o JSON UTF-8 completo com perguntas e sinais; ao exceder, reduz o número de cartões do lote, sem retirar sinais. Se nem um cartão couber, falha explicitamente antes de abrir o cofre ou chamar a API.
- Parecer é exibição, não autorização: devolve o rótulo concreto de maior probabilidade e `jev_probabilidade` (REAL entre 0 e 1, opcional). Se `incerto` liderar, só mostra o concreto quando ele supera o segundo concreto por pelo menos 0,15; caso contrário, parecer e probabilidade ficam `null`. Não renormaliza probabilidades. Motivo segue a mesma regra, independentemente do destino. Saída 2 de um lote não apaga respostas de outros documentos.
- Os limiares originais 0,8 / 0,15 permanecem na avaliação conservadora gravada em `jev-decisoes.jsonl`. O parecer continua sendo exibição; a regra `arquivar_sem_resposta` descrita acima permanece intacta.
- `jev_duplica_de` não é inventado: as duas perguntas não identificam um arquivo substituto.
- O consumo devolvido pelo provedor fica no relatório da passagem em `jev_uso` e em `${XDG_STATE_HOME:-$HOME/.local/state}/faxina-frota/jev-uso.jsonl`, sem documentos nem credenciais.

## Agenda semanal

- `scripts/faxina-semanal.sh`: trava exclusiva, estado em `${XDG_STATE_HOME:-$HOME/.local/state}/faxina-frota`, marcador `YYYY-Www` somente após sucesso e registro com rotação de 1 MB.
- `scripts/faxina.crontab`: sábado às 13h UTC, equivalente a 10h BRT. O cron Debian da Oracle ignora `CRON_TZ`; o script define `TZ=America/Sao_Paulo` para calcular a semana. Não depende das sessões dos agentes.
- Falha não marca a semana concluída; nova execução manual pode repetir. A saída registra contagens, não o corpo dos documentos.

## Aviso

- Após criar candidatos novos, envia uma única mensagem MarkdownV2 ao chat `7262275215` pelo bot em `~/.claude/channels/telegram-auxiliar/.env`.
- Destino: https://borges.tailfe77db.ts.net:3446/faxina. Só contagem e endereço, sem documentos.
- Zero candidatos novos: não lê token nem envia mensagem. Falha de envio não repete automaticamente: os candidatos permanecem no banco e o registro exige conferir o Telegram antes de reenviar, evitando duplicata quando houve perda da resposta.

## Validação isolada

```sh
cd apps/api
.venv/bin/python -m pytest tests/test_faxina.py tests/test_faxina_executor.py tests/test_store.py tests/test_security_headers.py -q
.venv/bin/python -m pytest tests/test_faxina_executor.py::test_ciclo_http_arquivar_desfazer -q -s
.venv/bin/python -m pytest tests/test_faxina_jev.py tests/test_faxina_replay.py tests/test_faxina_varredura.py -q
```

Todos os movimentos desses testes ocorrem em repositórios temporários. Não criar candidatos artificiais no banco de produção.

## Replay da régua do Rica

```sh
apps/api/.venv/bin/python scripts/faxina_replay.py \
  --db apps/api/db/grupo_borges.db --repo /home/clawd/repos/ze_claude \
  --desde 1794052800
```

Chama a API real pelo mesmo caminho de credencial do Jev. Só lê o banco (`mode=ro`), não move arquivos nem grava `jev-decisoes.jsonl`/`jev-uso.jsonl`. Compara os mesmos cartões `arquivado`/`mantido` desde o corte, com as exclusões conservadoras de origem e segurança acima. Exibe acordo antes (veredito no banco) e depois, incluindo `duplica` e ausência de parecer na matriz, sempre no denominador total.

`--sem-exemplos` desliga apenas as decisões passadas do Rica nos sinais enviados; a pergunta e os outros sinais permanecem iguais. A saída identifica a variante, enumera os cartões avaliados (id/caminho/decisão humana) para conferir o mesmo corpus e lista os erros com o parecer, probabilidade e motivo retornados, sem inventar explicação causal. Diagnóstico de sinal faltando/pergunta exige inspecionar a evidência enviada. O campo `antes` continua sendo o veredito original no banco, não o resultado da rodada 1; para essa comparação, usar o artefato preservado da rodada 1.

Conteúdo já movido é lido de `arquivado_para`, preservando o caminho original no record. A idade zerada pelo toque manter é reconstruída na data de criação. A decisão/status do alvo não é enviada ao Jev; histórico exclui o próprio alvo e decisões simultâneas/posteriores. É uma comparação com os sinais locais atuais: citações, skills e atividade da pasta não são reconstruídas na versão histórica do repo.
