# Instalação do painel cliente na Oracle 1

## Subida automatizada da Oracle 0

Na branch `produto/painel-cliente`, com os caminhos do pacote commitados:

```sh
deploy/painel-cliente/subir.sh --seco
deploy/painel-cliente/subir.sh
deploy/painel-cliente/subir.sh --publicar
deploy/painel-cliente/subir.sh --voltar teste  # ou fred, portao
```

O padrão atualiza somente `teste`. `--publicar` repete a prova em `teste` e
exige digitar `PUBLICAR` no terminal; depois atualiza `portao` (API e tela) e
cada outro cliente do cadastro do controlador, em sequência. Cada contêiner
recebe um snapshot `painel-...` antes da alteração. O script para no primeiro
erro e não restaura automaticamente: `--voltar <alvo>` restaura o snapshot mais
recente desse alvo. Após restaurar o portão, verificar também a tela e o banco
de sessões. Snapshots Incus cobrem o volume do contêiner; conferir backups de
`/casa` e `/var/lib/painel` se forem volumes externos.

O script testa o back local, instala as dependências do front e faz o build em
um worktree temporário do commit, sem mexer no `.next` ou no `tsconfig.json` da
árvore de trabalho. O build cliente fixa `API_BACKEND_URL` em
`http://127.0.0.1:8002` e declara `COCKPIT_BUILD_SEM_BACKEND=1`, pois a API do
portão só existe na Oracle 1. Empacota `standalone`, `static` e `public` sem
`tar -h`; o executor envia por SSH e `incus file push`. Pré-requisitos na
Oracle 1: `sudo`, `incus`, `/usr/local/bin/uv`, cadastro existente e serviços
do painel. Na Oracle 0: `pnpm`, Node e a chave
`~/.ssh/casanova_ed25519`. O script não cria clientes nem tokens.

Em `teste` e demais clientes, a prova confere `/health`, as units da API e do
agente, o primeiro evento SSE autorizado e a escrita/leitura/remoção de um
arquivo de prova como `agente` em `/casa/painel/uploads/agents/<slug>`.
Em `teste`, também envia um `.txt` pela rota `/file`, confere bytes no destino
e apaga o arquivo de prova; o teste recebe o aviso do anexo no chat.
Na publicação, confere `/entrar` = 200 e `/` sem cookie redirecionando no
domínio público. O Rica faz o login real e confere 200 autenticado.

### Construir a imagem `agente-v4`

O script da imagem fica em
`/home/clawd/repos/ze_claude/pavan/docs/produto/imagem/instalar.sh`. Antes
de executá-lo no contêiner de construção, enviar `/root/painel.tgz` com
`apps/api` e `deploy/painel-cliente` deste commit (raiz `painel/`) e `/root/uv`
executável para a arquitetura da Oracle 1. Ele instala `/opt/painel`, a unit
da API, o drop-in do agente e a lógica `--resume`. O `ExecStartPre` mescla
`statusLine` e `SessionStart` em `/casa/claude/settings.json` no primeiro boot
e nos seguintes, preservando as demais chaves. Slug, tokens e `/etc/painel/*`
continuam sendo criados por `painel-add.sh` depois de lançar o cliente da
imagem. Pare a instância de construção antes de `incus publish ... --alias
agente-v4`; não reconstruir clientes existentes só para atualizar o painel.
Para gerar o arquivo a enviar, na Oracle 0 use
`git archive --format=tar --prefix=painel/ HEAD apps/api deploy/painel-cliente | gzip > /tmp/painel.tgz`.
Copie esse arquivo, o `uv` aarch64 e o `instalar.sh` alterado para a Oracle 1.
Lá, após lançar `build-v4` no projeto `default`, use `incus file push` para
colocar os três em `/root/` do contêiner (nomes `painel.tgz`, `uv` e
`instalar.sh`), execute `incus exec build-v4 -- bash /root/instalar.sh`,
pare e publique a imagem. A imagem não contém `/casa` nem tokens.

## Procedimento manual histórico


1. Instalar o mesmo checkout em `/opt/painel`, com `uv sync --frozen` em
   `apps/api`. No cliente instalar também `curl`, `jq` e `ffmpeg` para os
   scripts de Conversas/ditado. Copiar as três units de `deploy/painel-cliente/` para
   `/etc/systemd/system/` (a unit `painel-cliente-api.service` é interna a cada
   cliente; `painel-portao.service` só no portão; `painel-controlador.service`
   só no hospedeiro). Criar usuários/grupos `painel` e `painel-control`.
2. No cliente `teste`, criar `/etc/painel/agent.yaml` com **um** agente:
   `slug: teste`, `name: Teste`, `tmux_session: agente`,
   `workspace_path: /casa/workspace`, `cli_default: claude_code`,
   `model_default: opus`. Criar `/casa/painel` e
   `/casa/painel/uploads/agents` com escrita para `agente`. Em
   `/etc/painel/cliente.env`: `PAINEL_CLIENT_SLUG=teste`,
   `PAINEL_INTERNAL_TOKEN_FILE=/etc/painel/internal-token`,
   `PAINEL_HOOK_TOKEN_FILE=/etc/painel/hook-token`,
   `PAINEL_CONTROL_SOCKET=/run/painel/control.sock`,
   `PAINEL_CONTROL_TOKEN_FILE=/etc/painel/control-token`,
   `PAINEL_RESUME_FILE=/casa/painel/resume-id`,
   `GB_AGENTS_YAML=/etc/painel/agent.yaml`, `GB_DB_PATH=/casa/painel/api.db`,
   `PAINEL_UPLOADS_DIR=/casa/painel/uploads`,
   `GB_CLAUDE_PROJECTS_DIR=/casa/claude/projects`,
   `CLAUDE_CONFIG_DIR=/casa/claude`, `COCKPIT_TMUX_SOCKET=agente`,
   `GB_STT_SCRIPT=/casa/claude/scripts/stt-openai.sh`.
   Mesclar em `/casa/claude/settings.json`:
   `"statusLine": {"type": "command", "command": "python3 /opt/painel/deploy/painel-cliente/statusline-capture.py"}`.
   O script recebe o JSON oficial do Claude Code por stdin, grava
   `/tmp/cc-status-<session_id>.json` com modo `0600` e alimenta contexto,
   tokens e janelas de cota do mesmo endpoint `/painel`. O formato do stdin e
   a configuração `statusLine` estão na [documentação oficial do Claude Code](https://code.claude.com/docs/en/statusline).
3. No `agente.service`, acrescentar `Environment=PAINEL_HOOK_TOKEN_FILE=/etc/painel/hook-token`,
   `Environment=PAINEL_RESUME_FILE=/casa/painel/resume-id` e
   `Environment=COCKPIT_API_URL=http://127.0.0.1:8010`. No
   `/usr/local/bin/agente-subir`, fazer
   `. /opt/painel/deploy/painel-cliente/resume-args.sh` antes do `exec claude`
   existente e escolher `--resume "$PAINEL_RESUME_ID"` quando a variável
   estiver preenchida; em caso contrário, usar o `--continue` atual. Isto
   preserva o restante do boot e faz
   Retomar consumir uma vez o UUID validado pela API. Instalar o gancho
   `apps/api/scripts/briefing-retorno.sh` e o script `scripts/estacionar.sh`
   do checkout; ambos usam o token limitado do gancho. Colocar o script STT
   e, se voz em tempo real for habilitada, a chave OpenAI **do próprio cliente**
   em `/casa/claude/secrets/openai-api-key.txt` (modo `0600`, usuário `agente`).
4. No portão, `/etc/painel/portao.json` tem `public_origin`, `session_db`,
   `users` (`usuario -> {role, slug, password_hash, trocar_senha}`), `clients`
   (`slug -> {socket, token_file}`), `controller: {socket, token_file}`.
   `socket` de `teste` = `/run/cliente-api/teste.sock`; o do controlador =
   `/run/painel/control.sock`; `public_origin` =
   `https://agentes.conectamoveis.net.br`; `session_db` =
   `/var/lib/painel/sessions.db` (diretório `painel:painel 0700`). O hash de
   senha sai de `python painel_portao.py`
   (prompt sem eco). Em usuários novos, `trocar_senha` é `true`; o
   `painel-add.sh` já grava esse valor. O JSON é apenas semente para novos
   usuários: depois do primeiro boot, hash e indicador de troca moram em
   `/var/lib/painel/sessions.db`. Reinstalar o código ou regravar o JSON não
   substitui os dados de um usuário existente. Preserve esse banco nos backups.
   `API_BACKEND_URL=http://127.0.0.1:8002` no build e runtime
   do Next no portão. O tunnel cloudflared aponta para o Next, sem publicar
   8002/8010 na rede.
5. No hospedeiro, `/etc/painel/controlador.json` tem `token_file`,
   `client_token_files: {teste: "/etc/painel/control-teste"}` e
   `clients: {teste: {project: teste, instance: teste}}`. O token mestre é o
   arquivo referenciado pelo portão; o token de `teste` é o do cliente.
   Cada token é independente, aleatório de 32 bytes (`openssl rand -hex 32`),
   modo `0600` e proprietário igual ao usuário da respectiva unit (`agente` no
   cliente, `painel` no portão, `root` no hospedeiro). Os arquivos contêm cópias apenas do
   segredo que cada um usa.
6. Criar diretórios voláteis `/run/cliente-api-host` no host e
   `/run/cliente-api`, `/run/painel` no portão e cliente via tmpfiles.d, antes
   dos proxy devices: `/run/cliente-api-host` como `root:root 0710`,
   `/run/cliente-api` e `/run/painel` no portão como `painel:painel 0770`,
   `/run/painel` no cliente como `agente:agente 0770`.
   Adicionar os devices abaixo no hospedeiro (UID/GID medidos nos contêineres):

   ```sh
   PUID=$(incus exec portao --project portao -- id -u painel)
   PGID=$(incus exec portao --project portao -- id -g painel)
   AUID=$(incus exec teste --project teste -- id -u agente)
   AGID=$(incus exec teste --project teste -- id -g agente)
   incus config device add teste painel-api proxy --project teste bind=host listen=unix:/run/cliente-api-host/teste.sock connect=tcp:127.0.0.1:8010 mode=0660 uid=0 gid=0
   incus config device add portao painel-teste proxy --project portao bind=instance listen=unix:/run/cliente-api/teste.sock connect=unix:/run/cliente-api-host/teste.sock mode=0660 uid="$PUID" gid="$PGID"
   incus config device add portao painel-controle proxy --project portao bind=instance listen=unix:/run/painel/control.sock connect=unix:/run/painel-control/control.sock mode=0660 uid="$PUID" gid="$PGID"
   incus config device add teste painel-controle proxy --project teste bind=instance listen=unix:/run/painel/control.sock connect=unix:/run/painel-control/control.sock mode=0660 uid="$AUID" gid="$AGID"
   ```

   Manter ACL das pontes: nenhuma exceção interprojeto.

## Aplicar esta rodada na instalação que já está no ar

1. Antes de substituir `/opt/painel` nos contêineres `teste` e `fred`, copiar
   cada `/opt/painel/apps/api/uploads/agents/<slug>/` existente para
   `/casa/painel/uploads/agents/<slug>/`, preservando nomes e bytes. Criar a
   raiz como `agente:agente` modo `0700` e confirmar que os arquivos antigos
   aparecem nela. Se a atualização já tiver movido o checkout, a cópia antiga
   pode estar em `/opt/painel.velho/apps/api/uploads/agents/`.
2. Em **cada** `/etc/painel/cliente.env`, acrescentar
   `PAINEL_UPLOADS_DIR=/casa/painel/uploads`. O padrão do código é o mesmo,
   mas a variável deixa o volume explícito. Distribuir o checkout desta branch
   para `teste`, `fred` e `portao` com o procedimento de instalação existente;
   o portão precisa da lista positiva nova para `/destrava` e `/events`.
   Atualizar o script `statusline-capture.py` nos dois clientes. Nesta rodada
   há migração do banco do portão; os sockets não mudam.
3. Reiniciar `painel-cliente-api.service` em `teste` e `fred`, depois
   `painel-portao.service` no portão. Verificar `/health` do portão e, com
   sessão de cada cliente, `POST /api/agents/<slug>/destrava` **só quando o
   canal estiver travado**, `GET /api/agents/<slug>` com os campos de pane e
   `GET /api/agents/<slug>/events` com `state` inicial. Confirmar que slug
   alheio recebe `403` e que um anexo antigo abre pelo feed. O script de
   statusline imprime modelo/duração no próximo acionamento pelo Claude Code;
   não é preciso reiniciar o agente para trocar o script.
4. Entregar à executora da tela as trocas exatas do
   [contrato](produto-painel-cliente.md#estado-ao-vivo-e-troca-na-tela):
   route handler SSE no Next, `EventSource` em lugar da releitura de 5 s,
   consumo de `state.agent`/`state.painel`/`state.status`, e os campos de pane
   no `GET`/SSE. Fazer build do Next cliente com
   `NEXT_PUBLIC_COCKPIT_MODO=cliente` e
   `API_BACKEND_URL=http://127.0.0.1:8002`, publicar o build no portão e
   testar `teste` antes de `fred`.

## Aplicar a troca de senha na instalação existente

1. Fazer backup de `/var/lib/painel/sessions.db` no contêiner `portao` e
   distribuir o código atualizado deste checkout para ele. Reiniciar
   `painel-portao.service`. No boot, a tabela `users` nasce no SQLite e recebe
   os usuários do JSON como semente, com troca obrigatória para clientes.
2. No hospedeiro, forçar explicitamente `teste` e `fred` a trocar no próximo
   acesso, mesmo se o banco já tiver sido criado por um boot anterior:

   ```sh
   incus exec portao --project portao -- runuser -u painel -- /opt/painel/apps/api/.venv/bin/python /opt/painel/apps/api/painel_portao.py --config /etc/painel/portao.json force-change teste fred
   ```

   O comando falha se algum usuário não existir e não deixa atualização
   parcial. A sessão aberta passa a receber `403 trocar_senha` nas rotas do
   painel. O cliente consulta `GET /auth/me`, troca em `POST /auth/senha` e
   continua na sessão atual. Outras sessões caem.
3. Se o cliente esquecer a senha, o Rica define uma senha temporária no
   terminal, sem pô-la no histórico nem em argumentos. Exemplo para `teste`:

   ```sh
   incus exec portao --project portao -- runuser -u painel -- /opt/painel/apps/api/.venv/bin/python /opt/painel/apps/api/painel_portao.py --config /etc/painel/portao.json reset-password teste
   ```

   O comando pede a senha duas vezes sem eco, grava novo hash, revoga todas as
   sessões do usuário e exige que ele troque a senha temporária no próximo
   login. O login passa a usar o hash do SQLite, mesmo que o JSON contenha o
   hash anterior. Não há reset por e-mail.
