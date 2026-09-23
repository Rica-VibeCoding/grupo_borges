# Faxina — contrato da etapa 1

## API

- `GET /api/faxina?status=pendente|arquivado|todos`: filtro exato; padrão `pendente`. Retorna `{itens, resumo: {pendentes, arquivados, ultima_varredura}}`. Contagens globais, independentes do filtro.
- `POST /api/faxina/{id}/manter`: `pendente → mantido`.
- `POST /api/faxina/{id}/arquivar`: `pendente → arquivar_pedido`.
- `POST /api/faxina/{id}/desfazer`: `arquivado → desfazer_pedido`.
- Os três POST devolvem o item completo. Repetir a decisão enquanto está no estado de destino devolve o mesmo item, sem renovar a data. Transição incompatível: HTTP 409. Item inexistente: HTTP 404.
- `GET /api/faxina/{id}/conteudo`: `{caminho, texto}`. Em `arquivado` e `desfazer_pedido`, lê `arquivado_para`; nos demais, lê o caminho original. HTTP 413 acima de 200 KiB; HTTP 403 para caminho indevido ou link simbólico; HTTP 404 para arquivo ausente.
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
- Origem precisa ser arquivo regular versionado, sem alterações locais ou preparadas para commit. Diretórios e links simbólicos não são movidos. O destino não pode existir.
- Consulta `citado_em` e relê índices `CLAUDE.md`, `README.md`, `SKILL.md`, `MEMORY.md` versionados ou não ignorados. Índices dentro de `arquivo/` são excluídos. Índices com link simbólico interno são consultados; não segue índices para fora do repositório.
- Referência ao caminho, caminho absoluto ou caminho relativo ao índice bloqueia com `erro: "citado em <índice>"`. Nenhum índice é editado.
- `git mv` preserva `<espaço de trabalho>/arquivo/<resto>`. Commit exclusivamente dos dois caminhos, sem push. Alterações e índice git de outras sessões permanecem intactos.
- Uma trava impede dois executores simultâneos. Registro em `.git/faxina-operation.json` permite reconhecer commit concluído antes de uma interrupção na gravação do banco. Interrupção antes do commit vira erro para conferência manual; falha normal de commit tenta reverter apenas o movimento.
- Restauração termina em `mantido`. `commit_sha` passa a identificar o commit da restauração; `arquivado_para` permanece como histórico.

## Validação isolada

```sh
cd apps/api
.venv/bin/python -m pytest tests/test_faxina.py tests/test_faxina_executor.py tests/test_store.py tests/test_security_headers.py -q
.venv/bin/python -m pytest tests/test_faxina_executor.py::test_ciclo_http_arquivar_desfazer -q -s
```

Todos os movimentos desses testes ocorrem em repositórios temporários. Não criar candidatos artificiais no banco de produção.
