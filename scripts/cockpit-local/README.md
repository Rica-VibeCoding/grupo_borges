# Lançador opcional do cockpit local

Instale `agente.sh` e `agentes.py` juntos na pasta do painel da máquina,
preservando o `agentes.json` local. A cópia versionada conserva o contrato
original `agente.sh <ligar|desligar|estado> <id>` e acrescenta:

- `ligar <id> --resume <UUID>`: valida a conversa no cwd do agente antes de subir.
- `relancar <id> --resume <UUID>`: troca o processo sob a mesma trava.
- `relancar <id> --new`: abre uma conversa nova sem `--resume`, com UUID próprio.

Flags, settings e esforço continuam vindo do cadastro local. `state_dir` é
opcional: quando presente define `TELEGRAM_STATE_DIR` e habilita o canal Telegram;
quando ausente não passa `--channels` e remove um state dir herdado.
Cada servidor nasce em scope próprio; nenhuma operação usa sudo.

Por agente, `env_arquivo` aponta para um arquivo absoluto fora do repo, regular,
do próprio usuário, modo **600**. Formato: uma linha `KEY=VALUE`, valor literal
(inclusive espaços e `=`), sem aspas de shell, expansão ou `export`; linhas vazias
e comentários `#` são ignorados. Ausência do campo conserva o ambiente atual.
Arquivo ausente, symlink, modo inseguro ou conteúdo inválido recusa a largada.
O filho lê o arquivo e usa `execve`: valores não entram em argv, comandos tmux,
scope systemd ou mensagens de erro. O arquivo privado não deve ir para o git.
`env_remover` é uma lista opcional de nomes que serão retirados do ambiente
herdado (ex.: `ANTHROPIC_AUTH_TOKEN` ao usar chave própria, ou `NO_COLOR`, que
impede distinguir a sugestão dim do input ocupado). `PATH` vem do cadastro global.

O ID local precisa ser o nome de `tmux_session` da API: para o Canário use
`id/socket/sessao: canario`, mantendo o slug **canarinho** no YAML local.
Cadastre-o com `boot: false`, sem `state_dir`, e autorize a raiz do workspace
montado em `GB_ALLOWED_WORKSPACE_ROOTS`. Persona na montagem é somente leitura.
Para um workspace dentro de repo via sshfs, `GIT_CEILING_DIRECTORIES` no arquivo
privado limita a descoberta do repo pai nos comandos que respeitam o ambiente.
No Canário local, a cerca é `/home/ricardo/ze_claude/ze_claude`; o cwd continua
sendo o da persona. O Claude higieniza variáveis Git em alguns subprocessos e
pode usar o repo pai como cwd: a cerca não garante inicialização rápida; ainda
foram observadas leituras lentas de Git na montagem. Não modifica o repo
montado nem os demais agentes.
Com o lançador local habilitado, Nova/Retomar respondem em até 20 s:
operação ainda em curso retorna 202, preserva a tarefa e é acompanhada pelo
`/operacao` existente da gaveta. Isso evita o timeout do proxy Next durante
um turno lento do motor; sem lançador local continua o teto de 90 s da VPS.
O modelo efetivo vem do motor local, não do `model_default` do cadastro;
confirme o nome retornado pelo assistente no JSONL e o contexto na statusline.

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

## Fluyt Comercial e Pós no notebook

Os IDs `fluytcom` e `fluytpos` usam sessão/socket próprios, `boot: false`,
Opus 5.5 e esforço médio. O Comercial abre na raiz do clone local do Fluyt;
o Pós abre em `apps/pos`. Cada cadastro usa `state_dir` do seu canal e as flags
`--settings ~/.claude/agentes/<id>.settings.json` e
`--mcp-config ~/.claude/agentes/<id>.mcp.json`, com caminhos absolutos.
O lançador já preserva essas flags no Ligar, Relançar e Retomar.

Nos settings, mantenha `env.TELEGRAM_STATE_DIR` igual ao cadastro e
`autoMemoryDirectory` apontando para a memória própria. O Pós exclui o
`CLAUDE.local.md` da raiz via `claudeMdExcludes`. Hooks usam as cópias locais
do notebook, como no Estúdio; scripts de voz ficam na montagem `ze_claude`.
Arquivos já existentes no clone são preservados; insumos privados novos que
não sejam ignorados exigem exclusões locais em `.git/info/exclude`.
Não altere arquivos versionados do Fluyt para instalar as personas.

Arquivos MCP/canais e `.env` ficam em modo 600, diretórios privados em 700.
Mantenha cabeçalhos e tokens nos arquivos privados, nunca em flags.
Se o Context7 global herdado usar `--api-key`, sobrescreva somente o servidor
dos agentes novos no MCP próprio, usando `env.CONTEXT7_API_KEY` em vez da flag.
Não altere o cadastro global nem reinicie as sessões existentes.
Confirme Telegram e `supabase_geral` no `/mcp`, um poller por token, um turno
pela API e o mesmo UUID com `--resume` após desligar/ligar. Valide o JSONL:
persona e memória próprias, sem persona da raiz no Pós.

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
