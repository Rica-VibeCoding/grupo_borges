---
name: abertos
description: Tela Abertos do cockpit (/abertos) e o Ligar/Desligar das máquinas da casa (Arsenal, PC, Note; a VPS só se olha). Usar para consultar, mexer, publicar ou consertar a tela, o painel do Arsenal (`maquina/`), a `/api/maquinas` ou a `/api/energia` — e antes de qualquer teste de fechar, ligar ou desligar.
---

# Abertos — o que está aberto em cada máquina, e o botão de ligar/desligar

```
cockpit ──/api/maquinas/*──▶ cockpit-api (VPS) ──Tailscale + chave──▶ painel.py (Arsenal :8787)
        ──/api/energia/*───▶ cockpit-api (VPS) ──SSH / pc.sh──────────▶ Arsenal · PC · Note
        ──/api/vps─────────▶ cockpit-api local (a aba da máquina onde o cockpit roda, só leitura)
```

Home: uma linha por máquina (nome · RAM · temperatura, ou Swap sem sensor · parados); tocar abre `/abertos?m=<id>`.
Nenhum nome de máquina fixo em tela: vem da API (`COCKPIT_MAQUINA_NOME` ou o hostname).

## O que evita erro

1. **Quem controla a energia é a `cockpit-api` da VPS.** A do Arsenal também responde em `/api/energia`, mas desligado o Arsenal não se religa. Botão de verdade é o da VPS.
2. **Chave nova só vale depois do restart da `cockpit-api`.** Ela mora em `~/.config/cockpit/maquinas.env` (0600) e entra pelo drop-in `cockpit-api.service.d/maquinas.conf` — o `.env` do pydantic não popula `os.environ`.
3. **O Arsenal só liga de longe quando a tomada Sonoff for configurada.** A BIOS já está em Always On; o Wake-on-LAN está desligado e nada na rede de casa mandaria o pacote. Até lá, o Ligar fica desabilitado com "falta a tomada". O Note "liga só na mão" (só Wi-Fi). O PC liga pela `pc.sh` da skill `pc-remoto`.
4. **A cópia do repo no Arsenal (`~/Projetos/grupo_borges`, branch `notebook-local`) se atualiza por merge**, nunca por reset: `git status` inteiro antes, `git merge origin/main`, `next build` no lugar, restart de `cockpit-api` e `cockpit-v2`. Mudança local antiga de 03/11 guardada em `~/Projetos/arsenal-temperatura-local-0311.patch`.
5. **O `agentes.json` do painel chama `fluytcom` de "Fluyt" e `note` de "Omarchy"** — esses são os nomes que aparecem no "Cai junto" e nas linhas do grupo Agentes, diferentes do card da tropa.
6. **Teste: nunca desligar nem ligar máquina de verdade sem o Pavan.** Desligar se testa com o executor falso (`services/energia.py`); em produção, só abrir a confirmação e Cancelar. Fechar, só no "Chrome do Teste" (perfil `ze-chrome-teste`), nunca no do Rica. Os agentes do Arsenal estão vivos: nada de `claude`, `bun` ou tmux.
7. **Fechar recebe o id listado, nunca PID, não confirma nada e recusa Protegido** (Rica, 05/11: "igual ao PC"). Fecha tudo que não é sistema: seus (app.slice com janela), Chrome de agente (`ze-chrome*`) e Agentes. Em Agentes, a linha do agente é o servidor `cockpit-tmux-<ident>` mais a sessão mais antiga, e fechar ela **derruba o agente inteiro**. Cada outro `tmux-spawn` do mesmo servidor vira uma linha "<Dono> · cadeira". O resto é protegido por padrão.
9. **A tela, como o Rica aprovou em 05/11:** uma linha por item (nome · parado · CPU · RAM · Fechar); todo grupo nasce fechado, com a pílula Mostrar/Esconder ao lado do nome; o Protegido fica um degrau mais escuro, com cadeado; grupo vazio some. A UI é feita pela cadeira de UI (o plugin `ui` está clonado no Arsenal em `~/Projetos/agente-ui`).
8. **No painel do Arsenal, tudo que muda estado exige a chave** (`/api/acao` ligar/desligar/compactar/nova e o Fechar): sem chave 401, sem arquivo 503; só `/` e `/api/estado` seguem abertos na Tailscale (os `/api/maquina/*`, inclusive resumo e abertos, sempre exigiram a chave). O `painel.html` pede a chave uma vez e guarda no `localStorage` do navegador. Prova sem efeito: `ligar` num agente já ligado só faz `tmux has-session` e responde "já no ar".

10. **As 4 máquinas medem pelo mesmo contrato** (`/api/maquinas/<id>/resumo`): Arsenal e Note pelo painel Linux (`~/.local/share/cockpit-maquina/`), o PC pelo `maquina/painel_windows.py` em `%LOCALAPPDATA%\cockpit-maquina\`, que sobe pela tarefa agendada `CockpitMaquina` (pythonw; dois gatilhos: no logon e a cada 5 min, e com `IgnoreNew` a repetição só sobe o painel se ele caiu — painel mudo com o PC ligado: ver se a tarefa está `Disabled`), escuta no IP Tailscale :8787 com a regra de firewall "Cockpit maquina 8787" e chave em `%USERPROFILE%\.config\cockpit-maquina\chave`. O PC devolve temperatura `null` e `abertos` 501 (ainda não lista). Na home e na barra lateral, cada máquina é **uma linha** — CPU · RAM · °C (Rica, 06/11). A VPS roda o mesmo `maquina/painel.py` com `frota_vps: true` no `agentes.json` (agentes e cadeiras fecháveis; Docker, containers, cockpit, painel, SSH, Tailscale e cron no Protegido) → `references/maquina-vps.md`.

## Publicar

`git commit -- <paths>` → `push-meu.sh <hash>` → `scripts/publicar-cockpit.sh` → restart da `cockpit-api` da VPS → atualizar o Arsenal (item 4). Painel do Arsenal: `scp` de `maquina/*.py` para `~/.local/share/cockpit-maquina/` + `systemctl --user restart cockpit-maquina.service`.

## Mais, sob demanda

- `references/operacao.md` — arquivos, endpoints, medições (PSS, idle, Wake-on-LAN), armadilhas de depuração e a prova de duas metades.
