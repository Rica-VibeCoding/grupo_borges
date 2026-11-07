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

No PC, `painel_windows.py` também lista as janelas em `/api/maquina/abertos`,
com executável e RAM por PID, somente consulta. Critérios Win32, fontes e
limites da medição: [painel Windows](../docs/painel-windows.md).

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
- RAM dos itens: `memory.stat: anon` nas unidades inteiras, descontando filhas;
  `Pss_Anon` nos recortes de processos da VPS/Chrome. Swap e cache de arquivos
  ficam fora. Shmem tem linhas próprias, inclusive arquivos sem processo vivo:
  somá-lo também nos apps duplicaria tmpfs. O cartão segue `MemTotal−MemAvailable`.
- Serviços externos a `user@` entram em **Serviços do sistema**, uma linha com
  total; só nomes com ≥20 MB aparecem no rótulo. Na VPS já estão no Protegido
  (raiz inteira dos cgroups), portanto não reaparecem nessa soma.
- `Sem dono` completa CPU/RAM por diferença dos itens realmente devolvidos;
  negativo ou operando ausente é `null`. Não reescala medidas para fechar a conta.
  CPU da VPS usa `utime+stime` de todas as threads nos recortes; processos que
  nascem e morrem entre amostras ficam no residual.

### Quebra da RAM física

- **Cache que o kernel segura** = `(MemFree + Active(file) + Inactive(file) +
  KReclaimable − MemAvailable)/1024`, em MB da tela (MiB). É a inversa de
  [`si_mem_available`](https://github.com/torvalds/linux/blob/v6.17/mm/show_mem.c#L32):
  inclui `totalreserve_pages` e as parcelas de cache/slab excluídas da estimativa.
  Fórmula conferida também no [kernel 7.2 do Arsenal](https://github.com/torvalds/linux/blob/v7.2/mm/show_mem.c#L32).
  A função saiu de `mm/page_alloc.c` e hoje está em `mm/show_mem.c`.
  Não atribuir todo residual a cache: a [documentação de MemAvailable](https://docs.kernel.org/filesystems/proc.html#meminfo)
  explica a estimativa e avisa que os contadores não recompõem toda a RAM.
- **Kernel**: `SUnreclaim + KernelStack + PageTables + SecPageTables`.
  Acrescenta `VmallocUsed` só com configuração de `VMAP_STACK` conhecida;
  se habilitado, desconta `KernelStack`, pois as [pilhas já usam vmalloc](https://docs.kernel.org/mm/vmalloced-kernel-stacks.html#allocation).
  Não soma `Slab`, `Percpu` ou `Unevictable` indiscriminadamente: há sobreposições.
- **Swap comprimido**: terceiro campo (`mem_used_total`) de cada
  [`zram*/mm_stat`](https://docs.kernel.org/admin-guide/blockdev/zram.html#stat),
  não tamanho lógico nem apenas bytes comprimidos.
- **Arquivos em /tmp, /dev/shm…**: montagens tmpfs de `mountinfo`, deduplicadas
  por dispositivo; ocupação por `statvfs` (mesma base de `df`).
  [Tmpfs pode ir para swap](https://docs.kernel.org/filesystems/tmpfs.html), logo
  ocupação não vira RAM: [`mincore`](https://man7.org/linux/man-pages/man2/mincore.2.html)
  mede páginas residentes sem lê-las. Deduplica inodes/links; não segue symlinks
  nem cruza filesystems. Acesso incompleto, arquivos desvinculados ou prazo
  de 100 ms por montagem deixam recorte **parcial**, explicitado no rótulo.
  Shmem global menos os recortes residentes fica em **Memória compartilhada e
  tmpfs sem recorte**. Ausência/divergência de fonte permanece desconhecida.
- Fontes da mesma coleta: `memoria_meminfo_kb`, `memoria_fontes` por linha e
  `kernel_vmap_stack`; ocupação lógica e RAM do tmpfs ficam discriminadas.
  O `Sem dono` ainda pode conter alocações não discriminadas do kernel,
  processos fora dos recortes e defasagem entre leituras. Não é prova de cache.
- **DRM/i915 não é outra parcela de RAM**: os buffers GEM de `system0` usam
  shmem, já cobrado acima. Somar `drm-resident-system0` ao residual duplicaria
  essa memória, mesmo deduplicando clientes (provado em 06/11: buffer de
  16 MiB subiu DRM, Shmem e o shmem do cgroup nos mesmos 16 MiB).

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

Testes: `apps/api/.venv/bin/python -m pytest maquina/test_maquinas.py maquina/test_frota_codex.py maquina/test_memoria_sistema.py maquina/test_memoria_tmpfs.py -q`;
ponte: `apps/api/tests/test_maquinas*.py`; front: `node --test apps/cockpit/lib/maquinas.test.ts`.
Instalar módulos alterados na VPS e Arsenal com backup `*.bak-0611i` e reiniciar
só `cockpit-maquina.service`; note offline fica pendente. Prova operacional e
scripts temporários ficam fora do repo. Mudou texto/contrato do front: rebuild
isolado e publicação pelo roteiro da skill `abertos` (sem push quando solicitado).
