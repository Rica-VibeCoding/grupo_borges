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
5. **O `agentes.json` do painel chama `fluytcom` de "Fluyt" e `note` de "Omarchy"** — esses são os nomes que aparecem no "Cai junto" e nos rótulos "Agente X", diferentes do card da tropa.
6. **Teste: nunca desligar nem ligar máquina de verdade sem o Pavan.** Desligar se testa com o executor falso (`services/energia.py`); em produção, só abrir a confirmação e Cancelar. Fechar, só no "Chrome do Teste" (perfil `ze-chrome-teste`), nunca no do Rica. Os agentes do Arsenal estão vivos: nada de `claude`, `bun` ou tmux.
7. **Fechar recebe o id listado, nunca PID**, e recusa Protegido. A classificação é allowlist: protegido por padrão; só `ze-chrome*` (agente) ou app.slice com janela (seus) fecham.

## Publicar

`git commit -- <paths>` → `push-meu.sh <hash>` → `scripts/publicar-cockpit.sh` → restart da `cockpit-api` da VPS → atualizar o Arsenal (item 4). Painel do Arsenal: `scp` de `maquina/*.py` para `~/.local/share/cockpit-maquina/` + `systemctl --user restart cockpit-maquina.service`.

## Mais, sob demanda

- `references/operacao.md` — arquivos, endpoints, medições (PSS, idle, Wake-on-LAN), armadilhas de depuração e a prova de duas metades.
