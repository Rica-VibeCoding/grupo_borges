# Plano — Painel Codex-nativo da Tara (cockpit)

> Sucessor da TK-25 etapa 2 (chat read/write, commit `cfd5864`). Objetivo: a Tara
> (Codex) ter no cockpit uma experiência equivalente à do Claude Code — painel,
> ações ao vivo, slashs como controles, anexos. Tudo Codex-nativo, não no-op de CC.
>
> **Contexto técnico base:** ver memória `project_tk25_codex_readonly_cockpit`. Forma
> do resume validada: `codex exec [flags] resume <id> "<prompt>"`. Spawn via `bash`
> (bit +x cai). Leitura em `services/codex_reader.py`; envio no branch codex de
> `POST /{slug}/input` (`agents.py`); wrapper `scripts/tara-codex`.

## Diagnóstico (o que está no-op pra Tara hoje, foto do Rica 03/06)

A aba PAINEL renderiza controles do Claude Code que NÃO valem pra Codex:
- EFFORT (low/medium/high/xhigh/max) — é effort do CC.
- FUNÇÕES bypass/plan — permission mode do CC.
- clear — `/clear` do CC.
- "sem dados de contexto" + "Quotas Max indisponíveis" — statusline do CC.
- SUBAGENTS — subsessões do CC (sempre 0 pra Tara).
- Barra de contexto "100% sempre" — bug semântico: usa `input_tokens` CUMULATIVO da
  sessão (1.1M) ÷ janela → clampa em 100%. Codex não expõe contexto-da-janela-agora.

## Escopo (lote único, fatiável em 2 se o Rica quiser ver rodando antes)

### 1. Painel Codex-nativo (substitui controles CC)
- **Reasoning effort** → low/medium/high (Codex só tem 3). Persiste no agent_state;
  `tara-codex` injeta `-c reasoning_effort=<v>` na próxima exec. VALIDAR EMPÍRICO antes.
- **Sandbox** → read-only / workspace-write / danger-full-access (no lugar de bypass/plan).
  Persiste; `tara-codex` usa no `-s`. Default Tara = danger-full-access.
- **Nova thread** (`--fresh`) → botão "nova conversa" (no lugar de clear). Próximo envio
  começa thread fresh em vez de `--resume-thread`.
- **Tokens** → trocar barra "100%" por tokens reais do rollout (`tokens_used` /
  `input_tokens` da thread). Sem fingir %-de-janela.
- **Ocultar** pra Codex: SUBAGENTS e "Quotas Max" (sem equivalente).

### 2. Ações ao vivo (comandos entre input/output)
- `codex_reader`: expor `item_type=function_call` com o COMANDO/nome resumido (não o
  output — `function_call_output` segue redigido). Endpoint/poll já existe.
- UI: no histórico do chat, linha discreta "▸ rodando: `<cmd>`" entre a msg do Rica e a
  resposta da Tara (tipo o CC mostra tool calls). Some quando o turno fecha.

### 3. Slashs do Codex → controles (não paleta — exec não interpreta `/cmd`)
- `/model` ✅ já tem · `/new` → botão nova thread · `/approvals` → seletor sandbox.
- `/compact`,`/init` etc: sem equivalente non-interactive — fora.

### 4. Anexos (como o CC)
- **Imagem** ✅ nativo: `codex exec -i <FILE>` (repetível). Branch codex no endpoint de
  imagem (hoje `postAgentImage` é tmux); `tara-codex` ganha passagem de `-i <path>`.
  Reusar paperclip do ChatInput no CodexChat.
- **Áudio** ✅ via STT: mesmo pipeline do CC — transcreve (skill `voz`) → texto vira
  prompt. Branch codex no endpoint de voz. Reusar mic do ChatInput no CodexChat.

## Arquitetura / decisões

- **Backend (Tara executa):** `tara-codex` ganha `--reasoning-effort`, `--image` (passa
  `-c reasoning_effort=` e `-i`); `-s`/sandbox já existe. Persistência de effort/sandbox
  no agent_state (avaliar reusar colunas de effort/permission_mode existentes vs novas).
  Endpoints: branch codex em image/voice; PATCH effort/sandbox codex-aware.
- **Frontend (Daniel):** aba PAINEL codex-aware (effort 3 níveis, sandbox, nova thread,
  tokens; oculta subagents/quotas). CodexChat ganha paperclip+mic. Ações ao vivo no
  histórico. Reaproveitar componentes do CC (não duplicar).
- **Método (igual etapa 2):** Explore (mapa do PAINEL + endpoints effort/permission +
  image/voice; reusar mapa da etapa 2) → Tara backend → Daniel frontend → integração E2E.

## Riscos / validar antes
- `-c reasoning_effort=high` funciona mesmo no `codex exec`? (testar 1 exec).
- Onde persistir effort/sandbox da Tara sem colidir com o schema effort/permission do CC.
- Contexto %-da-janela FIEL = só via Codex App Server (bridge Node) → FASE 2, fora do lote.
- Anexo imagem: confirmar `-i` aceita path absoluto no modo `exec resume`.

## Fora do escopo deste lote
- App Server / bridge Node (contexto fiel, turn/interrupt, steer) → fase futura.
- Cancelamento de turno em voo.

## Estado ao parar (03/06)
- Etapa 2 no ar (commit `cfd5864`), validada ponta-a-ponta. Tara em gpt-5.5, ociosa.
- Bate-bola com Rica fechou este escopo. Próximo = executar este plano.
