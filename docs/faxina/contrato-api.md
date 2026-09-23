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
- Não existe promoção automática após sete dias: `persist()` cria apenas `pendente`. Uma política futura precisa de autorização separada antes de chamar `decide_faxina`.

## Jev

- A varredura madura consulta o Jev apenas para novos candidatos, antes de gravar. Duas perguntas `choice` por unidade: destino e motivo. Até 10 unidades e 24 KB por lote.
- A chave OPENROUTER sai do cofre somente para a memória e o ambiente do processo filho do Jev. Erro de API interrompe sem inserir candidatos nem repetir a chamada; HTTP 402 é identificado explicitamente.
- Envio de conteúdo autorizado pelo Rica em 23/09/2026 e ligado por padrão: título, cabeçalhos e até 1.500 caracteres do corpo; para skill, trecho do próprio `SKILL.md`. `--somente-metadados` desliga o conteúdo. Linhas com indicadores de segredo são removidas da cópia, mantendo o restante. É redução de dano, não garantia universal de anonimização. Nunca envia cofre, `.env` ou destinos externos ao repositório. Arquivos maiores que 200 KiB ficam sem trecho.
- Parecer é exibição, não autorização: devolve o rótulo concreto de maior probabilidade e `jev_probabilidade` (REAL entre 0 e 1, opcional). Se `incerto` liderar, só mostra o concreto quando ele supera o segundo concreto por pelo menos 0,15; caso contrário, parecer e probabilidade ficam `null`. Não renormaliza probabilidades. Motivo segue a mesma regra, independentemente do destino. Saída 2 de um lote não apaga respostas de outros documentos.
- Os limiares originais 0,8 / 0,15 permanecem na avaliação conservadora gravada em `jev-decisoes.jsonl`, para eventual política futura de automação. Nenhuma automação de arquivamento está habilitada.
- `jev_duplica_de` não é inventado: as duas perguntas não identificam um arquivo substituto.
- O consumo devolvido pelo provedor fica no relatório da passagem em `jev_uso` e em `${XDG_STATE_HOME:-$HOME/.local/state}/faxina-frota/jev-uso.jsonl`, sem documentos nem credenciais.

## Agenda semanal

- `scripts/faxina-semanal.sh`: trava exclusiva, estado em `${XDG_STATE_HOME:-$HOME/.local/state}/faxina-frota`, marcador `YYYY-Www` somente após sucesso e registro com rotação de 1 MB.
- `scripts/faxina.crontab`: segunda às 11h UTC, equivalente a 08h BRT. O cron Debian da Oracle ignora `CRON_TZ`; o script define `TZ=America/Sao_Paulo` para calcular a semana. Não depende das sessões dos agentes.
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
```

Todos os movimentos desses testes ocorrem em repositórios temporários. Não criar candidatos artificiais no banco de produção.
