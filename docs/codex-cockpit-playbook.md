# Playbook — Tara/Codex no Cockpit

> Pesquisa 2026-05-19. Objetivo: ligar o card da Tara ao UI sem inventar contexto.

## Resumo

- MVP recomendado: leitura passiva de `~/.codex/state_5.sqlite` + `rollout_path` JSONL.
- Escrita/conversa real deve esperar uma etapa 2 via Codex SDK ou `codex exec resume --json`.
- Não simular `context user`: se a origem for Codex local, mostrar isso explicitamente no UI.

## Fontes

- OpenAI Codex CLI: https://developers.openai.com/codex/cli
- OpenAI Codex non-interactive: https://developers.openai.com/codex/noninteractive
- OpenAI Codex SDK: https://developers.openai.com/codex/sdk
- OpenAI Codex repo: https://github.com/openai/codex
- Local observado: `/home/clawd/.codex/state_5.sqlite` e `/home/clawd/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Context7: indisponível nesta sessão por chave inválida (`ctx7sk` ausente).

## O que a doc oficial diz

Codex CLI roda localmente, lê/altera/roda código no diretório selecionado e é open source. O modo `codex exec` aceita `--json`, que emite JSONL em stdout com eventos como `thread.started`, `turn.started`, `item.*`, `turn.completed` e `error`. Também existe `codex exec resume <SESSION_ID>` e `codex resume <SESSION_ID>`.

O Codex SDK é o caminho oficial para controlar agentes locais por aplicação. A biblioteca TypeScript permite `startThread()`, `thread.run()` e `resumeThread(threadId)`. A biblioteca Python é experimental e controla o app-server local por JSON-RPC.

## O que o disco local mostra

`state_5.sqlite` tem a tabela `threads` com:

- `id`
- `rollout_path`
- `created_at_ms`
- `updated_at_ms`
- `source`
- `cwd`
- `title`
- `tokens_used`
- `model`
- `reasoning_effort`

O JSONL de rollout tem linhas com:

- `session_meta`
- `event_msg`
- `turn_context`
- `response_item`

Dentro de `response_item`, os `payload.type` úteis são:

- `message`
- `reasoning`
- `function_call`
- `function_call_output`

Mensagens de conversa aparecem como `payload.type="message"` com `payload.role` e `payload.content`.

## Arquitetura MVP

Criar um leitor read-only para Tara:

1. Descobrir a thread atual:
   ```sql
   select * from threads
   where cwd = '/home/clawd/repos/ze_claude/tara'
   order by updated_at_ms desc
   limit 1;
   ```
2. Abrir `rollout_path` e parsear JSONL incrementalmente.
3. Converter somente mensagens seguras:
   - `role=user` vira bolha de usuário quando for mensagem externa real.
   - `role=assistant` vira bolha da Tara.
   - `role=developer/system` fica oculto ou chip técnico interno.
   - `reasoning` não deve ser exibido como conversa normal.
4. Expor no backend:
   - `GET /api/agents/tara/codex/thread`
   - `GET /api/agents/tara/codex/messages`
   - SSE `codex_message` reaproveitando o padrão atual.
5. No UI, o card da Tara mostra:
   - modelo vindo de `threads.model`
   - tokens vindos de `threads.tokens_used`
   - última atividade de `updated_at_ms`
   - fonte: `Codex local`

## Etapa 2: envio de mensagem

Opção A, preferida depois do MVP: usar Codex SDK server-side.

- Vantagem: API oficial para criar/retomar thread.
- Custo: backend atual é Python/FastAPI; SDK principal é TypeScript, então pode exigir um pequeno bridge Node.

Opção B, pragmática: usar subprocesso `codex exec resume <SESSION_ID> --json`.

- Vantagem: encaixa no backend Python.
- Custo: vira execução não interativa; precisa fila, lock por agente e captura de JSONL.

Opção C, adiar: Python SDK experimental via app-server.

- Vantagem: conversa melhor com FastAPI.
- Custo: experimental, exige checkout local do repo Codex.

## Contrato sugerido

```ts
type CodexThreadSummary = {
  thread_id: string;
  rollout_path: string;
  cwd: string;
  title: string;
  model: string | null;
  tokens_used: number;
  updated_at_ms: number;
  source: 'codex-local';
};

type CodexMessage = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'internal';
  text: string;
  timestamp: string;
  item_type: 'message' | 'function_call' | 'function_call_output' | 'reasoning';
};
```

## Riscos

- `state_5.sqlite` e rollout JSONL são armazenamento local, não contrato público estável.
- Algumas sessões têm `has_user_event=0`, mesmo com conteúdo de usuário no JSONL; não confiar só nesse campo.
- `base_instructions`, mensagens developer e tool outputs podem conter informação sensível; redigir/filtrar antes do UI.
- Não misturar sessões por `title`; usar `thread_id` e `cwd`.
- Não escrever no SQLite do Codex.

## Próximo passo recomendado

Implementar primeiro só leitura:

1. `codex_watcher.py` read-only com query em `state_5.sqlite`.
2. Parser de rollout JSONL com testes usando fixture sanitizada.
3. Endpoint de mensagens Tara no FastAPI.
4. UI reaproveitando `ChatMessages`, mas com `source='codex-local'`.
5. Depois decidir envio: SDK TypeScript bridge ou `codex exec resume --json`.
