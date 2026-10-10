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

## Voz local (opt-in)

Na unit da API (não apenas na `.env`):
`Environment=GB_STT_SCRIPT=/caminho/absoluto/scripts/cockpit-local/stt-voxtype.py`.
O script recebe um arquivo, converte com ffmpeg para WAV PCM16, 16 kHz mono,
e executa `/usr/bin/voxtype --quiet transcribe`. Usa a configuração existente;
não modifica nem sinaliza o daemon. Requer Python 3, ffmpeg e Voxtype 1.0.1.
Só o texto final vai ao stdout, sem os cabeçalhos que o CLI imprime mesmo em
quiet. Falhas não imprimem texto; temporários são removidos. Prazo total de
28 s e encerramento do grupo de processos antecipam o timeout de 30 s da API.
Transcritores concorrentes do cockpit falham rapidamente com código 75.
O separador do stdout foi conferido no
[código do Voxtype 1.0.1](https://github.com/peteonrails/voxtype/blob/v1.0.1/src/app/transcribe_file.rs)
e nas opções do binário instalado; formato desconhecido falha sem produzir texto.

`GB_LOCAL_LIVE_STT=true` (unit ou `.env`) recusa o bilhete de streaming antes
de ler qualquer chave ou acessar a OpenAI. A tela de conversa já gera WAV ao
fim da fala pelo VAD e o composer já guarda a gravação: ambos usam
`POST /api/agents/{slug}/transcription`, sem transcrição parcial. O endpoint
de transcrição não envia ao tmux; `/voice` é o legado que transcreve e envia.
Default `false` conserva o bilhete/streaming da VPS; `GB_STT_SCRIPT` ausente
conserva o resolver anterior. Não há mudança de front nem rebuild necessário.

A GPU precisa acomodar o processo avulso além do daemon. No notebook, a
prova de 10/10/2026 falhou com `ErrorOutOfDeviceMemory` e SIGSEGV do avulso;
o daemon permaneceu ativo. Não tentar resolver reiniciando o ditado,
mudando seu modelo ou sua configuração. STT real fica pendente de capacidade.
TTS permanece no caminho existente; o fallback edge-tts é online, sem chave.
