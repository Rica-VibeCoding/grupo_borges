# Painel do Arsenal (`cockpit-maquina`)

Painel HTTP que roda no Arsenal (servidor caseiro, `ssh ricardo@100.91.105.22`), porta 8787 na Tailscale.
Instalado em `~/.local/share/cockpit-maquina/` como serviço de usuário `cockpit-maquina.service`.
`agentes.json` (config local, com dados privados) fica só lá e não entra no repo.

Instalar uma mudança: `scp` dos arquivos para `~/.local/share/cockpit-maquina/` e
`systemctl --user restart cockpit-maquina.service`. Os agentes moram em scopes próprios
(`cockpit-tmux-*`) e não caem com o restart do painel.
