# Painel Linux na VPS

A VPS usa o mesmo `maquina/painel.py` do Arsenal e do Note, com resumo,
abertos e Fechar, em **100.116.1.44:8787**. Unit de usuário:
`cockpit-maquina.service`, instalada de `maquina/cockpit-maquina.service`.
O antigo `cockpit-vps-resumo.service` foi parado, desabilitado e removido.

Código instalado em `~/.local/share/cockpit-maquina/`: `painel.py`,
`maquinas.py`, `frota.py`, `agentes.py`, `agente.sh` e `painel.html`.
`agentes.json` é configuração local, fora do repo. Contém `frota_vps: true`,
IP/porta e os mapeamentos `id` → `nome`, socket e sessão. `boot` fica falso;
o painel não inicia agentes. `COCKPIT_MAQUINA_CONFIG` permite usar outro
caminho para a configuração, sem alterar o código.

## Chave

`~/.config/cockpit-maquina/chave` é arquivo regular 0600 do usuário `clawd`,
com a **mesma** `MAQUINA_VPS_CHAVE` de `~/.config/cockpit/maquinas.env` (0600).
O drop-in existente da `cockpit-api.service` continua carregando esse env.
Não há chave no repo. Nunca imprimir o env, o arquivo da chave, headers nem
argumentos com o valor. Para curl, Authorization entra por stdin com `--config -`.

## Limite de Fechar

`maquinas.py` descobre cgroup e runtime pelo UID real (na VPS, **1002**).
O adaptador `frota.py` lê `/sys/fs/cgroup` inteiro para também listar os
serviços de sistema e containers. Tudo começa protegido.

Só entra no grupo `terminal` uma sessão confirmada em socket local do usuário,
configurado em `agentes.json`, com nome exato ou sufixo `__…` para cadeira.
O socket `default` só aceita sessões do mesmo cadastro. `pavan-alerta` tem
`cadeira_de: pavan`. Sessões ausentes não viram linhas falsas.

Os nomes reais medidos são `app.slice/tmux-spawn-*.scope` para shells,
`borges.slice/borges-frota.slice/run-u*.scope` para CLIs/MCPs e serviços ou
scopes diferentes para servidores tmux. O cgroup `run-u5465` contém também o
servidor de Canário: **não é uma unidade segura para fechar Pavan**.

Cada sessão agrega os descendentes de seus panes através desses cgroups.
Não inclui outro servidor tmux, seus descendentes, processos de serviços,
painel, API, Next, Docker, SSH, Tailscale ou cron. CPU e parado usam deltas dos processos (todas as threads), amostrados a cada
3 segundos. RAM dos recortes = `Pss_Anon`; serviços/containers inteiros =
`anon` do cgroup legível, inclusive para root. Shmem/tmpfs são contabilizados
à parte, sem duplicar arquivos mapeados; fórmulas no `maquina/README.md`.
Falha de medição = `null`, nunca zero. Tela é nula.
O resumo mantém o critério do Arsenal para `parados_30min` (não conta terminais).

Fechar revalida a sessão e fixa cada processo com pidfd antes de executar
`tmux -S <socket> kill-session -t $N` e SIGTERM nesses descritores. Nunca usa
`kill-server`, `systemctl stop` de scope ou sinal por PID simples. O servidor
tmux, supervisores, pollers e serviços continuam protegidos. Uma sessão cujo
servidor pertence a `borges-clawd@*.service` ativo também fica protegida:
parar seu supervisor exige a operação de frota do cockpit.
Processos órfãos sem parentesco comprovado ficam protegidos, mesmo que o cwd
ou argv pareça de um agente. `/api/acao` legado é recusado na VPS; a operação
de ligar/compactar/nova conversa continua no cockpit.

## Validação e atualização

Rodar separadamente, a partir da raiz:

```sh
apps/api/.venv/bin/python -m pytest -q maquina/test_maquinas.py
apps/api/.venv/bin/python -m pytest -q apps/api/tests/test_maquinas.py
```

Os testes de Fechar usam processos/cgroups de fixture e executor falso.
Na VPS real, validar só GET: sem chave 401; com chave resumo e abertos 200;
pela `cockpit-api`, `/api/maquinas/vps/abertos` 200. Não testar Fechar real.

Após copiar os arquivos, reiniciar **somente** `cockpit-maquina.service`.
Mudanças na ponte exigem um restart da `cockpit-api.service`. Nenhum build de
Next ou restart de agente é necessário.

## Arsenal e Note

Não foram alterados nesta tarefa. No Arsenal, URL e chave da VPS já estão em
`~/.config/cockpit/maquinas.env`: falta levar os arquivos da ponte
(`apps/api/services/maquinas.py`, `apps/api/routers/maquinas.py`) e reiniciar sua
API para remover a restrição antiga de resumo. A cópia local deve ser
preservada; ver o procedimento de merge na skill `abertos`. No Note ainda é
necessário provisionar URL/chave no env da API e atualizar a ponte.

O painel desses desktops não precisa ativar `frota_vps`; continua usando
scopes/janelas do Linux como antes.

## Prova local — 06/11/2026

GET direto sem chave: **401**. Com chave: resumo **200**, abertos **200**.
Fechar real não foi executado. Rótulos/grupos recebidos (duplicatas agrupadas):

- `terminal`: Canário; Daniel Singh; Felipe Conti; José Pavan; José Pavan · cadeira; Miga; Pedro Sobral.
- `agente`: vazio.
- `seus`: vazio.
- `protegido`: API do cockpit local; Acesso SSH; Atd; Bot conecta; Casa carro; Caseiro dvr lado; Caseiro dvr ponte; Caseiro go2rtc tailnet; Claude code proxy; Cockpit local; Container api-m1au8sl5uzs0fmitzgfz7j3h; Container beszel-agent-dkmiz5udj35i23lhe86tjeih; Container beszel-dkmiz5udj35i23lhe86tjeih; Container coolify; Container coolify-db; Container coolify-proxy; Container coolify-realtime; Container coolify-redis; Container coolify-sentinel; Container crm-teste; Container go2rtc; Container ha-mcp; Container homeassistant; Container n8n-h7ldbsmcr4pue3bik148uqap; Container postgres-m1au8sl5uzs0fmitzgfz7j3h; Container postgresql-h7ldbsmcr4pue3bik148uqap; Container redis-m1au8sl5uzs0fmitzgfz7j3h; Container task-runners-h7ldbsmcr4pue3bik148uqap; Containerd; Cron; Cs ingest server; Docker; Fail2ban; Fluyt atendente; Fluyt atendente vigia; Fwupd; Getty tty1; Gpg agent; Iscsid; Massari api; Massari dev; Massari paleta; Modemmanager; Multipathd; Obras ofra; Painel desta máquina; Polkit; Portao promob; Rpcbind; Rsyslog; Run u2412; Run u3244; Run u5139; Run u5917; Run u874; Serial getty ttyama0; Servidor tmux (cockpit-ligar-daniel); Servidor tmux (cockpit-ligar-pavan); Servidor tmux (cockpit-ligar-sobral); Servidor tmux (run-u4777); Servidor tmux (run-u5351); Servidor tmux (run-u5465); Servidor tmux (vigia-fluyt-ponte); Serviços da sessão (acessibilidade); Session 79917; Session c126; Session c144; Session c179; Session c3061; Session c3069; Session c3070; Session c3079; Session c3080; Session c3081; Session c3091; Session c3130; Session c536; Session c600; Session c604; Session c645; Session c653; Sistema; Snap.oracle cloud agent.oracle cloud agent; Snap.oracle cloud agent.oracle cloud agent updater; Snapd; Tailscale; Terminal; Udisks2; Unattended upgrades; Unified monitoring agent.

Ponte pela `cockpit-api` local (`127.0.0.1:8002`): `GET /api/maquinas/vps/abertos` **200**, após **um único restart** da API no fim. Testes separados: `maquina/test_maquinas.py` **191 passaram**; `apps/api/tests/test_maquinas.py` **72 passaram**. Nenhum Fechar foi chamado na VPS real.
