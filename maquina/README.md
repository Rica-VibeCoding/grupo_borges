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
- Atividade de Chrome/apps: delta acima de 10% de **um núcleo**, antes do
  arredondamento. O limiar fica acima do ruído ocioso medido no Arsenal. Isso
  mede trabalho de CPU, não presença humana; abas com JavaScript contínuo
  podem continuar em uso sem teclado ou mouse. Sem delta válido fica desconhecido.
- Atividade dos terminais Linux **e VPS**: registro do Claude em
  `sessions/<pid>.json`, validado por PID e `procStart`, sob `CLAUDE_CONFIG_DIR`
  do processo ou `~/.claude`. `busy`/`shell`
  mantêm em uso mesmo durante pensamento, rede ou ferramenta sem CPU, sem
  prazo artificial. `idle`/`waiting` acumulam o tempo parado. Um `claude -p`
  vivo também é trabalho em voo. CPU de subprocessos acima de 10% de um núcleo
  prevalece sobre idle, cobrindo builds e ferramentas em segundo plano.
  CPU do próprio CLI e do servidor tmux não anula um prompt ocioso.
- O registro é interno ao Claude Code (já usado em `agentes.py`); alterações
  chegam por **inotify** e são consumidas no heartbeat de 3 s. Não há sondagem
  periódica do transcript nem comandos extras no tmux. Registro ausente,
  incompatível, PID reutilizado ou perda da vigia mantém atividade desconhecida.
  Para outros CLIs sem registro, CPU alta é último recurso para provar trabalho;
  CPU baixa não prova prompt. `frota.py` herda o mesmo detector de `Maquinas`.
- `parado_s`: `null` sem sinal confiável, `0` trabalhando, segundos acumulados
  quando parado. Pode haver atividade conhecida sem leitura de CPU. A tela só
  mostra parado após 60 s. No terminal agrupado, um membro ativo prevalece;
  sem ativo, um desconhecido mantém `null`. O histórico v3 descarta o cache
  v2, cuja semântica de atividade era outra, e sobrevive a restarts.
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
[/proc (stat, memória e PSS)](https://docs.kernel.org/filesystems/proc.html),
[inotify (eventos e substituição de arquivos)](https://man7.org/linux/man-pages/man7/inotify.7.html).

Sinais avaliados para os agentes:

- [Claude Code: transcripts](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored):
  `~/.claude/projects/<project>/<session-id>.jsonl`, com mensagens, ferramentas,
  resultados e metadados. São salvos continuamente conforme a sessão trabalha;
  a [documentação de armazenamento](https://code.claude.com/docs/en/agent-sdk/session-storage)
  esclarece que as entradas são escritas localmente em lotes. Não há garantia
  de heartbeat em pensamento/ferramenta longa. Portanto mtime recente é
  evidência auxiliar, mas mtime antigo **não** prova prompt; metadados também
  mudam o arquivo. Não foi escolhido como detector de ociosidade.
- [tmux: FORMATS](https://man.openbsd.org/tmux.1#FORMATS) define `window_activity`
  como última atividade da janela. O [código do tmux](https://github.com/tmux/tmux/blob/master/input.c)
  atualiza esse relógio ao receber saída do pty:
  redesenho do terminal também conta. `pane_last_activity` não consta nesse
  manual e expande vazio no tmux 3.8 instalado. Nenhum distingue trabalho real.
- [Claude Code: estado da sessão](https://code.claude.com/docs/en/agent-view#list-sessions-as-json)
  documenta `busy`, `waiting`, `idle`. A interface pública é `claude agents --json`;
  aqui observamos o registro interno já presente nas máquinas para manter a
  coleta por eventos e sem lançar um CLI a cada amostra. O vínculo de identidade
  é obrigatório; se o formato mudar, mostramos desconhecido. O estado explícito
  elimina a necessidade de interpretar spinner visual ou adivinhar duração
  máxima de um turno pela CPU/mtime.

Testes: `apps/api/.venv/bin/python -m pytest maquina/test_maquinas.py maquina/test_frota_codex.py -q`.
Depois dos testes, instalar os módulos alterados em `~/.local/share/cockpit-maquina`
na VPS, Arsenal e note, mantendo backup `*.bak-0611g`, e reiniciar apenas
`cockpit-maquina.service`. Provar repouso de mais de 60 s e turno em voo em
sessão própria, sem enviar teclas às sessões vivas. O front não exige rebuild
quando apenas o painel muda.
