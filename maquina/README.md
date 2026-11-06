# Painel Linux (`cockpit-maquina`)

Painel HTTP que roda no Arsenal (servidor caseiro, `ssh ricardo@100.91.105.22`), porta 8787 na Tailscale.
Instalado em `~/.local/share/cockpit-maquina/` como serviço de usuário `cockpit-maquina.service`.
`agentes.json` (config local, com dados privados) fica só lá e não entra no repo.

Instalar uma mudança: `scp` dos arquivos para `~/.local/share/cockpit-maquina/` e
`systemctl --user restart cockpit-maquina.service`. Os agentes moram em scopes próprios
(`cockpit-tmux-*`) e não caem com o restart do painel.

Operação, contratos e armadilhas: skill `abertos` (`apps/cockpit/.claude/skills/abertos/`).

Na VPS, o mesmo painel usa `frota_vps` para listar sessões tmux e proteger
serviços e containers. Configuração e limites: [maquina-vps](../docs/maquina-vps.md).

## Medição de recursos

- CPU dos itens Linux: delta de `cpu.stat: usage_usec` do cgroup da unidade,
  incluindo threads, workers já encerrados e sub-cgroups. Unidades descendentes
  com linha própria são descontadas do pai. Percentual da máquina inteira,
  como o card total de `/proc/stat`. A coleta independente roda a cada 3 s;
  consultar agentes, janelas ou CDP não determina o intervalo.
- Atividade usa o mesmo delta, antes do arredondamento: parado abaixo de 1% de
  **um core** (o limiar anterior). Primeira leitura, contador recriado ou
  indisponível não são prova de ociosidade. O cache antigo de `schedstat` é
  descartado uma vez; o novo histórico continua sobrevivendo a restarts.
- RAM dos itens: `memory.stat: anon + shmem`, residente, sem swap e sem cache
  de arquivos recuperável. Não é `memory.current`, que inclui cache e kernel;
  antes era PSS + SwapPss. O total continua `MemTotal - MemAvailable`.
- “Fora da lista”, protegida e sem Fechar, completa CPU e RAM por diferença
  entre total e itens efetivamente devolvidos. Inclui sessões SSH fora de
  `user@`, sistema, kernel, diferenças de cache e unidades que desapareceram.
  Pequeno residual negativo pode ocorrer por arredondamento/leituras não
  atômicas; a diferença é exposta, sem normalizar ou alterar os itens.
- Exceção da VPS (`frota_vps`): sessões podem atravessar e compartilhar cgroups.
  Usa `utime + stime` de `/proc/<pid>/stat` (todas as threads) e RAM proporcional
  `Pss_Anon + Pss_Shmem`, evitando duplicar o cgroup entre sessões. Trabalho de
  processos inteiramente entre amostras fica no residual, sem dono inventado.

Referências oficiais lidas antes da alteração:
[cgroup v2 (CPU e memória)](https://docs.kernel.org/admin-guide/cgroup-v2.html),
[/proc (stat, memória e PSS)](https://docs.kernel.org/filesystems/proc.html).

Testes: `apps/api/.venv/bin/python -m pytest maquina/test_maquinas.py -q`.
Depois dos testes, instalar apenas os arquivos alterados no Arsenal, mantendo
backup `*.bak-0611b`, e reiniciar `cockpit-maquina.service`. Provar pela API
`:8787`: build ativo com CPU atribuída e soma fechando; depois repouso e Fechar
somente no Chrome do Teste (`ze-chrome-teste`).
