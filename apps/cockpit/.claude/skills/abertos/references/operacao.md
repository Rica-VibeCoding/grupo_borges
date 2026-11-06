# Abertos — operação em detalhe

## Onde está cada peça

- **Tela:** `app/abertos/page.tsx`; `components/maquinas/` (painel-da-maquina, painel-local, lista-de-abertos, linha-aberta, linhas-das-maquinas, faixa-de-energia, selo-de-maquinas, usa-*); `lib/maquinas.ts`, `lib/linhas-das-maquinas.ts`, `lib/energia.ts` (+ `.test.ts`, rodar com `node --test`).
- **API (VPS e Arsenal):** `apps/api/routers/{maquinas,energia,vps}.py`, `services/{maquinas,energia,vps_recursos}.py`, testes em `apps/api/tests/` (`uv run pytest`). Lista de máquinas do painel: `MAQUINAS` em `services/maquinas.py`; de energia: `MAQUINAS` em `services/energia.py`.
- **Painel do Arsenal:** `maquina/` no repo (painel.py, maquinas.py, agentes.py, testes). Instalado em `~/.local/share/cockpit-maquina/`; chave em `~/.config/cockpit-maquina/chave` (0600). `agentes.json` é privado e só existe lá. O "parado há" sobrevive ao restart por `~/.cache/cockpit-maquina/observacoes.json` (relógio de parede); apagar o arquivo zera a contagem. O painel escuta só no IP Tailscale: testar com `http://100.91.105.22:8787`, não `127.0.0.1`.
- **Ociosidade:** hypridle com config própria (`~/.config/cockpit-maquina/hypridle.conf`, serviço `cockpit-maquina-idle`). O `hypridle.service` do pacote está mascarado porque o padrão dele trava a tela e suspende.

## Contratos

- `/api/maquinas` → `[{id, nome}]`; `/api/maquinas/{id}/resumo` (cache 3 s; fora do ar → `{online:false, motivo}` em português); `/abertos` e `/fechar` repassam ao painel. Id do item: `\A[A-Za-z0-9_-]+\z`, ≤128.
- `/api/energia` → `[{id, nome, ligado, ligar:{pode, motivo}, em_andamento}]`. `ligado` = TCP 22 em ≤3 s, cache 15 s. `/impacto` → agentes (scopes `cockpit-tmux-*` + nomes do `agentes.json`), Chromes (no Arsenal, pela MESMA lista do painel; fora dele, pelo `ps`/PowerShell), `em_uso`. `/desligar` exige `{confirmo:true}`; Linux = `sudo -n systemctl poweroff` por SSH, PC = `pc.sh desligar`. `/ligar` em máquina ligada não executa nada.
- `/api/vps` → nome, temperatura (coretemp/k10temp; `null` sem sensor), consumidores.

O residual **Memória do sistema** tem grupo próprio: não conta abertos nem soma no Protegido. Residual negativo ou sem todos os operandos é `null`. Resumo com CPU `null` continua online; o PC usa `parados_30min: null` e explica a lista indisponível por 501.

`painel-local.tsx` continua importado pelo fallback de `app/abertos/page.tsx`: não é usado para as quatro máquinas cadastradas, mas atende um nome local fora desse cadastro.

## Medições que custaram

- Memória: `anon` de `memory.stat` nas unidades inteiras (descontando filhas),
  `Pss_Anon` nos recortes; shmem/tmpfs, cache retido, kernel e zram têm linhas
  próprias. Fontes, fórmulas e limites: [README da máquina](../../../../../../maquina/README.md#quebra-da-ram-física).
  Sem swap/cache nos apps; falha de medição = `null`. CPU amostrada a cada 3 s: `cpu.stat` do cgroup nas unidades inteiras; nos recortes, `/proc/<pid>/stat`, onde processo que nasceu depois da amostra anterior conta inteiro, o que saiu fica no residual e o que chegou de outro item (CPU da vida inteira) deixa o item sem delta até a próxima. Fechar = CDP `Browser.close`, com SIGTERM por pidfd de reserva; nunca SIGKILL.
- `query user` do Windows sai com código 1 mesmo listando quem está logado; só 255 é falha de SSH.
- Chrome no Windows: contar só o processo sem `--type=` (eram 44 processos e 4 Chromes).
- No Arsenal, os agentes são scopes do systemd; `tmux list-sessions` sem socket não acha nada.
- Wake-on-LAN sem `ethtool`: ioctl `ETHTOOL_GWOL` via `sudo python3`. Arsenal `enp1s0` suporta `g`, desligado; Note só no cabo (desconectado).
- `pgrep -c -f ze-chrome-teste` conta o próprio comando (+1).
- Linger=yes no Arsenal é obrigatório: sem ele os serviços de usuário morrem quando a última sessão SSH fecha.
- A aba oculta não busca dados (`document.hidden`): teste de navegador precisa de janela visível.

## Prova de duas metades (como foi feita em 05/11)

1. Subir o alvo: `systemd-run --user --slice=app.slice --collect /opt/google/chrome/chrome --headless=new --user-data-dir=$HOME/.config/ze-chrome-teste --remote-debugging-port=9299 https://example.com` no Arsenal.
2. Canário com `browser-harness`: home (linhas vivas), abas, Fechar no "Chrome do Teste" → "Liberou X MB" e processos a 0; aba VPS com zero botões; confirmação de Desligar com a contagem batendo com a lista, e Cancelar.
3. Encerrar o alvo: `systemctl --user stop chrome-teste-*`.
