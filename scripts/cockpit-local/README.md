# Lançador opcional do cockpit local

Instale `agente.sh` e `agentes.py` juntos na pasta do painel da máquina,
preservando o `agentes.json` local. A cópia versionada conserva o contrato
original `agente.sh <ligar|desligar|estado> <id>` e acrescenta:

- `ligar <id> --resume <UUID>`: valida a conversa no cwd do agente antes de subir.
- `relancar <id> --resume <UUID>`: troca o processo sob a mesma trava.
- `relancar <id> --new`: abre uma conversa nova sem `--resume`, com UUID próprio.

Flags, settings, esforço, canal e `TELEGRAM_STATE_DIR` continuam vindo do cadastro
local. Cada servidor nasce em scope próprio; nenhuma operação usa sudo.

Na unit da API: `Environment=COCKPIT_LANCADOR=/caminho/absoluto/agente.sh`.
Sem essa variável, os controles continuam pelo lançador original da VPS.
Na `.env`: `GB_ALLOWED_WORKSPACE_ROOTS=/raiz/um:/raiz/dois`. Vazio conserva
`/home/clawd/repos`. Caminhos são resolvidos antes da comparação, inclusive symlinks.
Se o nome do socket difere da sessão, `GB_TMUX_SOCKET_OVERRIDES={"sessao":"socket"}`;
vazio conserva o template `COCKPIT_TMUX_SOCKET`.

## Telemetria, histórico e anexos (API)

As opções abaixo são desligadas por padrão e podem ser colocadas na `.env` da API:

- `GB_LOCAL_CLAUDE_TELEMETRY=true`: vincula contexto/modelo à sessão registrada
  em `~/.claude/sessions/<pid>.json`, validando PID vivo e cwd. Lê a statusline
  em `/tmp/cc-status-<UUID>.json`; não edita statusline nem settings do terminal.
- `GB_JSONL_BACKFILL_CURRENT=true`: no boot, importa apenas o JSONL da conversa
  confirmada no processo de cada agente. Não escolhe pelo arquivo mais recente.
  O ledger SQLite `jsonl_imports` e a deduplicação dos eventos anteriores evitam
  duplicação no restart e no fluxo ao vivo. Histórico não dispara tasks/hooks;
  replay inicial respeita a ordem dos timestamps e o cursor continua por ID.
- `GB_CHANNEL_ATTACHMENT_ROOT=~/.claude/channels`: libera os anexos sob essa
  raiz resolvida, recusando `..` e symlinks para fora. Vazio conserva a raiz
  histórica `/home/clawd/.claude/channels`.

Após editar a configuração, reinicie somente a unit da API. Reiniciar a API
ou o painel da máquina não reinicia os scopes dos agentes.
