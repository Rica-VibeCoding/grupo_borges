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
