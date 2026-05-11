# Pesquisa: observabilidade Tara via `codex exec`

Data: 2026-05-11

Versao local testada: `codex-cli 0.128.0` (`codex --version`).

## Resumo executivo

`codex exec` ja tem saida estruturada: `--json` emite JSONL com eventos de thread, turn, itens, comandos, patches, MCP, todo list e uso de tokens.
Nao encontrei uma flag dedicada tipo `--stream`/`--events`: o streaming machine-readable suportado hoje e o proprio `--json`; patches e comandos aparecem como itens agregados, nao como deltas completos de stdout/patch.
Recomendacao: manter a decisao da Opcao A, mas implementar como wrapper que executa `codex exec --json`, normaliza os eventos e posta em um endpoint interno do cockpit, em vez de parsear stdout humano ou depender de hooks nativos.

## Perguntas investigadas

| # | Pergunta | Resposta | Fonte |
|---|---|---|---|
| 1 | Codex CLI tem log estruturado / JSON output alem do stdout? | Sim. `codex exec --json` imprime eventos JSONL em stdout. O help local 0.128.0 diz "Print events to stdout as JSONL". A doc de exec mode tambem documenta `--json`; o codigo oficial define os tipos `thread.started`, `turn.started`, `item.started`, `item.updated`, `item.completed`, `turn.completed`, `turn.failed`, `error`. | Comandos locais: `codex --version`, `codex exec --help`. Docs: [Exec Mode](https://www.mintlify.com/openai/codex/advanced/exec-mode). Codigo: [exec_events.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/exec_events.rs). |
| 2 | Ha flag pra emitir patches/edits/tokens como streaming machine-readable? (`--stream`, `--events`?) | Nao encontrei flag separada. O streaming estruturado e `--json`. Ele inclui `item.started`/`item.completed` para `command_execution`, `file_change`, `mcp_tool_call`, `todo_list` e `turn.completed.usage`. Porem comando vem com `aggregated_output`; patch vem como lista de paths/kinds/status; nao encontrei delta de patch nem delta bruto de tokens no CLI. O SDK TypeScript tem `runStreamed`, mas isso e outra superficie. | `codex exec --help`; [event_processor_with_jsonl_output.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/event_processor_with_jsonl_output.rs); Context7 `/openai/codex` sobre SDK `runStreamed`; issue de tokens [#19022](https://github.com/openai/codex/issues/19022). |
| 3 | `--config` aceita hooks pre/pos exec? | Sim, via config/hook engine, nao como flag especifica de callback. `codex_hooks` esta `stable` e `true` localmente (`codex features list`). Hooks podem ficar em `~/.codex/hooks.json`, `.codex/hooks.json` ou inline em `config.toml`, e cobrem `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop`. Mas ha gotchas: hooks sao concorrentes, cobertura de tool-level ainda incompleta, e issues recentes reportam inconsistencias em exec/Stop/hot reload. | Comando local: `codex features list`. Docs: [Hooks](https://developers.openai.com/codex/hooks). Issues: [AfterToolUse gap #15490](https://github.com/openai/codex/issues/15490), [hook parity #21753](https://github.com/openai/codex/issues/21753), [hooks stop firing #21160](https://github.com/openai/codex/issues/21160). |
| 4 | Existe `codex mcp-server`; pode ser ponte de observabilidade? | Existe, mas eu nao recomendo como MVP da ponte Daniel-CC -> Tara. A doc oficial descreve `codex mcp-server` como interface MCP experimental via stdio para controlar uma engine Codex local: threads, turns, config, approvals e notificacoes `codex/event/*`. Isso pode virar uma integracao B mais rica, mas e mais complexo que um wrapper, exige cliente MCP, e a propria doc marca como experimental/sujeito a mudanca. | Comando local: `codex mcp-server --help`. Docs: [codex_mcp_interface.md](https://github.com/openai/codex/blob/main/codex-rs/docs/codex_mcp_interface.md). |
| 5 | Parsers maduros de stdout `codex exec` em OSS? | Sim, mas o padrao maduro e parsear `--json`, nao stdout humano. Encontrei `dmora/agentrun` com backend Go para Codex JSONL; ele documenta eventos `thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`, `turn.failed`, `error`, e nota que Codex emite blocos completos sem timestamp. Tambem ha pacotes menores como `picatz/openai/codex` e wrappers Rust. | [agentrun Go package](https://pkg.go.dev/github.com/dmora/agentrun/engine/cli/codex), [picatz/openai/codex](https://pkg.go.dev/github.com/picatz/openai/codex), [nucel-agent-codex](https://docs.rs/nucel-agent-codex/latest/nucel_agent_codex/). |
| 6 | Codex emite OpenTelemetry / traces nativos? | Sim, ha configuracao OTEL na referencia oficial (`otel.trace_exporter.*`) e docs mencionam `RUST_LOG` para tracing/logging. Isso serve para observabilidade tecnica, latencia e troubleshooting, mas nao substitui eventos de produto no cockpit: OTEL nao e a fonte certa para cards/kanban/atividade de Tara. | Config ref: [OpenAI Codex config-reference](https://developers.openai.com/codex/config-reference) (`otel.trace_exporter.*`); Exec docs mencionam `RUST_LOG=info`: [Exec Mode](https://www.mintlify.com/openai/codex/advanced/exec-mode). |

## Recomendacao tecnica final

### Opcao A recomendada: wrapper `tara-codex` + POST custom no cockpit

Manter a decisao do Rica, com um ajuste importante: o wrapper deve usar `codex exec --json`, nao parsear texto humano.

Pros:

- Deterministico e simples de operar a partir do Daniel-CC: Daniel chama um comando unico para delegar a Tara.
- Nao depende de bugs/cobertura incompleta dos hooks do Codex.
- Reaproveita o backend atual: `task_events`, `/api/events` e `/api/stream` ja sao exatamente o trilho de atividade do cockpit.
- Permite registrar lifecycle claro: `tara.exec.started`, `tara.exec.event`, `tara.exec.completed`, `tara.exec.failed`.
- Pode preservar `thread_id`, prompt, cwd, exit code, uso de tokens e eventos importantes sem inventar schema do Codex.

Contras:

- So cobre execucoes feitas pelo wrapper; chamadas diretas `codex exec` continuam invisiveis.
- Precisa de disciplina/alias no Daniel-CC e talvez guardrail operacional.
- O schema JSONL do Codex ainda pode mudar; parser deve ser defensivo.

### Opcao B possivel depois: cliente de `codex mcp-server`

Usar `codex mcp-server` como ponte de controle/observabilidade e tecnicamente atraente, porque expoe threads/turns/notificacoes em uma interface estruturada. Eu descartaria no MVP porque a interface e experimental, aumenta bastante a superficie de implementacao e muda o problema de "registrar delegacao" para "controlar uma engine Codex via MCP".

### Opcao C complementar: hooks nativos Codex

Pode complementar a Opcao A para capturar uso direto do Codex, mas eu nao cravaria como trilho primario. A doc hoje ja lista `PostToolUse`, `UserPromptSubmit` e `Stop`, porem a comunidade ainda reporta lacunas de cobertura, exec/hot reload/Stop e paridade incompleta com Claude Code.

## Esboco da implementacao proposta

Sem codigo nesta fase, apenas shape:

1. Backend FastAPI
   - Criar `POST /api/events` ou `POST /api/codex-events` interno/Tailscale-only.
   - Validar payload minimo: `source="codex_exec"`, `delegator_agent_slug`, `target_agent_slug="tara"`, `session_id/thread_id`, `cwd`, `kind`, `payload`.
   - Gravar em `task_events` usando `kind` com prefixo `codex:` ou `tara:` e `raw_jsonl` para a linha original quando existir.
   - Atualizar `agent_state`/`agent_instances` para Tara em eventos started/completed/failed.

2. Wrapper local
   - Script/CLI sugerido: `scripts/tara-codex-exec` ou comando instalado fora do repo como `tara-codex`.
   - Entrada: mesmo prompt/opcoes essenciais de `codex exec`; sempre adiciona `--json`.
   - Antes de spawnar: POST `tara.exec.started` com prompt resumido, cwd, Daniel session/transcript se disponivel.
   - Durante stdout JSONL: ler linha a linha, parsear JSON, mapear eventos relevantes para `task_events`.
   - Ao fim: POST `tara.exec.completed` com exit code, `thread_id`, ultima mensagem, tokens e duracao; em erro, `tara.exec.failed`.
   - Stderr humano pode ir para log local, mas nao deve ser fonte primaria.

3. Frontend
   - Sem endpoint novo se o evento cair em `task_events`: `/api/stream` ja transmite por SSE.
   - UI pode tratar `kind` prefixado `tara.`/`codex.` como atividade de Tara no feed/card/modal.

Estimativa: 0.5 dia para backend endpoint + normalizacao minima; 0.5 dia para wrapper robusto com retry curto e parser defensivo; 0.5 dia para UI destacar os eventos. Total pratico: 1 a 2 dias, dependendo do polimento de instancia/status.

## Riscos e gotchas

- `--json` e suficiente para observabilidade de produto, mas nao e replay completo de terminal: `command_execution.aggregated_output` e agregado; `file_change` traz paths/kinds/status, nao diff completo.
- Eventos JSONL nao incluem timestamp proprio segundo parsers OSS; use timestamp do backend na chegada.
- `item.type="error"` pode ser nao fatal em alguns casos; considerar fatal primario apenas `turn.failed`, top-level `error` e exit code != 0, com allowlist para warnings conhecidos.
- `--output-schema` nao deve ser usado pelo wrapper para inferir "ultima resposta" sem cuidado; issues reportam que mensagens intermediarias podem satisfazer o schema.
- Hooks Codex existem e estao mais fortes em 0.128.0, mas nao devem ser a unica garantia de visibilidade enquanto houver issues abertas de cobertura/reliability.
- `codex mcp-server` e promissor, mas experimental. Bom candidato para Fase C quando o cockpit quiser iniciar/dirigir Tara diretamente, nao apenas observar uma delegacao disparada por Daniel.
- Chamadas diretas a `codex exec` fora do wrapper permanecem invisiveis; mitigar com alias/convenção no Daniel-CC ou hook complementar depois.
- Backend e Tailscale-only: manter endpoint interno e sem exposicao publica, seguindo a regra do repo.
