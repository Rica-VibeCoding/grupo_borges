# RAM do painel de máquinas — 06/11/2026

O antigo residual virou linhas de zram, kernel e unidades do sistema com nome.
Só a diferença final se chama **Sem dono**. A unidade da interface é MB, mas
o divisor é 2²⁰ (MiB), como já era no cartão.

Fontes lidas antes da implementação:

- [Documentation/admin-guide/blockdev/zram.rst — mm_stat](https://docs.kernel.org/admin-guide/blockdev/zram.html#stat):
  os três primeiros campos são `orig_data_size`, `compr_data_size` e
  `mem_used_total`, em bytes. A linha usa o terceiro, incluindo fragmentação e
  overhead do alocador. O tamanho lógico guardado e o tamanho comprimido não
  substituem a RAM alocada. Soma todos os dispositivos `zram*`; dispositivo
  presente mas ilegível significa desconhecido, nunca zero.
- [Documentation/filesystems/proc.rst — meminfo](https://docs.kernel.org/filesystems/proc.html#meminfo):
  `MemTotal` é RAM utilizável, já descontados código do kernel e reservas físicas.
  `MemAvailable` estima quanto pode ser usado sem swap, considerando cache,
  slab reclamável e marcas d'água. Logo `MemTotal−MemAvailable` inclui processos,
  RAM do swap comprimido, alocações do kernel e a margem dessa estimativa;
  não é a soma exata de RSS. `Slab` inclui `SReclaimable` e `SUnreclaim`.
  Usamos só `SUnreclaim` + `KernelStack` + `PageTables` + `SecPageTables`
  (quando existe). Não somamos `Slab` inteiro ou `SReclaimable`. `Shmem` mede
  memória compartilhada/tmpfs e também aparece em `Cached`; não se soma de novo
  porque os itens já incluem sua parcela.
- [Documentation/admin-guide/cgroup-v2.rst — memory.stat](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files):
  serviços usam `anon+shmem` em bytes, assim como os itens inteiros existentes.
  `file` contém cache e `kernel` contém inclusive slab, pilhas e tabelas:
  nenhum deles é adicionado aos serviços. Contadores são hierárquicos; uma unidade
  filha é descontada do pai antes de ganhar sua própria linha.
- [proc.rst — smaps_rollup](https://docs.kernel.org/filesystems/proc.html):
  recortes de processos usam `Pss_Anon+Pss_Shmem`, repartindo páginas compartilhadas.
  Se Chrome já trouxe filhos de uma sessão externa, só os demais processos da
  sessão entram na linha do sistema. Falta de permissão fica desconhecida.

O grupo no front se chama **Sistema e sem dono**, com unidades `Sistema · tailscaled`,
`Sistema · sshd` etc. Não há ação de fechar nessas linhas. Na VPS, `MaquinasFrota`
já enumera `/sys/fs/cgroup` inteiro: serviços root e containers mantêm seus itens
protegidos e não reaparecem no residual. A quebra física é herdada de `Maquinas`.

`Sem dono = round(cartão − soma das demais linhas, 2)`. Não reescala os valores
medidos para caber. Se houver medida ausente ou diferença negativa, mostra
desconhecido. A diferença pode conter alocações sem contador separado, memória
fora das unidades e a margem do `MemAvailable`, além da defasagem entre leituras.
Não é correto atribuí-la inteira a cache ou a `Shmem`. O cache que o kernel
considera disponível já está fora do usado; não o acrescentamos à lista.
A CPU continua com a regra anterior: a diferença de CPU dos itens originais
fica em Sem dono; as novas linhas de RAM não inventam CPU.

O endpoint nativo inclui `memoria_fontes` por linha e `memoria_meminfo_kb` da
mesma leitura. São dados auxiliares de auditoria; a ponte da API conserva o
contrato atual de linhas e ignora esses campos extras.

Validação reproduzível:

```sh
apps/api/.venv/bin/python -m pytest maquina/test_maquinas.py maquina/test_frota_codex.py maquina/test_memoria_sistema.py -q
node --test apps/cockpit/lib/maquinas.test.ts
python3 maquina/prova_memoria.py /tmp/prova-memoria.json
```

A prova carrega os módulos **instalados** em `~/.local/share/cockpit-maquina`,
captura o texto realmente lido de proc/sysfs, confere cada nova linha contra
essas fontes e também consulta o endpoint HTTP autenticado em execução. Nas duas
leituras, soma com `Decimal` e exige igualdade exata com o total do cartão.
Nenhuma chave entra no relatório. Não pausa serviços nem sessões para medir.

Prova ao vivo às 11:23 UTC de 06/11:

- Arsenal, HTTP às 11:23:09 UTC: itens existentes 2.179,05 MB + serviços do
  sistema 62,92 MB + kernel 271,73 MB + zram 684,15 MB + Sem dono 840,33 MB
  = **4.038,18 MB**, igualdade exata com `MemTotal−MemAvailable`.
  Zram: `mm_stat` = `2468290560 699060070 717381632 …`; terceiro campo / 2²⁰
  = 684,15 MB. Kernel: `SUnreclaim=203700`, `KernelStack=15076`,
  `PageTables=59476`, `SecPageTables=0` kB; soma / 1024 = 271,73 MB.
  Maiores unidades externas: tailscaled 24,97 MB, session-211 19,37 MB,
  sshd 4,52 MB, init 2,76 MB e systemd-userdbd 2,11 MB; as demais também
  têm linha própria. `Shmem=222264` kB não ganhou uma segunda cobrança.
- VPS, HTTP às 11:22:54 UTC: itens existentes, incluindo root/containers,
  4.843,30 MB + kernel 384,16 MB + Sem dono 426,96 MB = **5.654,42 MB**.
  Sem dispositivo zram. Kernel: `SUnreclaim=263928`, `KernelStack=25796`,
  `PageTables=103652`, `SecPageTables=0` kB. Nenhum serviço duplicado no residual.
- As duas coletas diretas dos módulos instalados também passaram pela captura
  independente de proc/sysfs e pela igualdade decimal. Evidência integral na
  VPS em `/tmp/prova-memoria-{arsenal,vps}-0611h.json`.
- Testes: 267 do coletor/ações/frota/quebra e 79 da ponte da API passaram;
  os 18 testes existentes do contrato/texto do front passaram.

Instalado na VPS e no Arsenal em `~/.local/share/cockpit-maquina`, com backups
`maquinas.py.bak-0611h` e `frota.py.bak-0611h`; `memoria_sistema.py` é novo.
Reinícios comprovados por PID/data de início e checksums iguais ao repositório.
A árvore `~/Projetos/grupo_borges` do Arsenal não foi acessada.
Note: offline na Tailscale, com timeout de SSH em duas tentativas; instalação
aguarda conectividade. Não foi alegada como concluída.
