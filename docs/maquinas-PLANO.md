# Tela "Máquinas" — plano v2 (05/11/2026)

> **Nome (Rica, 05/11 12:02):** a máquina é o **Arsenal** (hostname `arsenal`, `arsenal.tailfe77db.ts.net`, mesmo IP), servidor caseiro ligado 24 h (vai ganhar +16 GB). Na API, id `arsenal`, env `MAQUINA_ARSENAL_*`; "PC2" abaixo é o nome antigo. Painel entra no repo em `grupo_borges/maquina/` (D2).
>
> **v2 (revisão do Pavan, aprovada com 4 ajustes):** limiar do "parado" fixado · uma só leitura do `resumo` no cliente · Protegido ampliado · R1 vira pendência pós-entrega.

Dono: Daniel 2 (líder) · revisão: Pavan (two-eyes) · ordem do Rica, 05/11 11:15.
Pesquisa medida no PC2: `/tmp/pesquisa-maquinas.md` (Canário, 05/11) — os números abaixo vêm dela.
Sai do repo quando a tela estiver no ar e virar skill (regra de 03/11).

## O que muda em relação ao briefing (medido, não opinião)

1. **`hyprctl dispatch closewindow pid:X` não existe no PC2.** Hyprland 0.56 com config Lua: `dispatch` só fecha a janela em foco. Fechar é por **CDP `Browser.close`** (Chrome de agente) e **SIGTERM** no processo principal (o resto). SIGKILL nunca.
2. **`hyprctl` sem env devolve vazio sem erro.** O painel exporta `XDG_RUNTIME_DIR=/run/user/1000` e `HYPRLAND_INSTANCE_SIGNATURE` (pasta em `/run/user/1000/hypr/`). Lista vazia com janela aberta = bug, e o teste cobre.
3. **A unidade da lista é o *scope* do systemd, não a janela.** Cada app aberto mora em `app.slice/app-<nome>-<pid>.scope` (Chromes medidos assim); os agentes moram em `cockpit-tmux-<agente>-*.scope`. O scope junta a árvore inteira (inclusive o `crashpad` que o `ppid` perde) e cobre o Chrome headless da 9226, que não tem janela.
4. **Memória = PSS + SwapPss somados no scope.** RSS mente ~6× (fluytpos: PSS 31 MB × RSS 287 MB). Com 3,2 GB em swap, PSS sozinho subestima: soma o `SwapPss`. 130 ms, sem root.
5. **"Parado há" é observação do painel**, não dado do sistema: delta de CPU por `schedstat` (ns) da árvore. A linha diz "parado há 40 min" só se o painel observou 40 min; antes disso, "parado desde que comecei a olhar (12 min)".
6. **Linha "Tela" não tem leitura sob demanda.** Sem `hypridle`, `/dev/input` fora do grupo do `ricardo`, Hyprland não expõe idle. Ver **D1**.

## Arquitetura

```
cockpit (VPS)  ──/api/maquinas/*──▶  cockpit-api (VPS)  ──Tailscale + chave──▶  painel.py (PC2 :8787)
```

- O navegador nunca fala com o PC2. A `cockpit-api` guarda a lista de máquinas (`pc2` agora; VPS/note/PC entram como mais uma entrada) e faz o meio de campo.
- **Chave compartilhada** no cabeçalho `Authorization: Bearer` pros endpoints novos do painel (hoje o painel só confere `Host`/`Origin`, e qualquer nó da Tailscale manda "desligar agente"). Chave no cofre + `.env` da `cockpit-api` + arquivo `0600` no PC2. Os endpoints antigos ficam como estão (cirurgia de diff).

## Back — PC2 (`painel.py`, Codex `gpt-6.1-sol` high)

Antes de tudo: `cp painel.py painel.py.bak-maquinas` (e `agentes.py` se tocar). **D2** decide se ganha repo.

| rota | quando | o que faz |
|---|---|---|
| `GET /api/maquina/resumo` | a cada 30 s (selo + mini cartão) | RAM, CPU, disco, temperatura (package, já existe), `parados_30min` (contagem), `tela` |
| `GET /api/maquina/abertos` | só com a tela aberta e visível | lista de itens (abaixo) |
| `POST /api/maquina/fechar` `{id}` | botão | relista, acha o id, recusa Protegido/sumido, fecha, espera até 8 s, devolve `liberou_mb` |

- **Item:** `id` = hash de (`scope`, `starttime` do processo principal) — PID reciclado não casa. `grupo` (seus/agente/protegido), `rotulo` em português, `dono`, `memoria_mb` (PSS+SwapPss), `parado_s` + `observado_desde`, `abas` (só Chrome com CDP: `/json/list`, `type=="page"`, título ≤ 40), `pede_confirmacao` (VS Code, LibreOffice), `acao_rotulo` ("Fechar Chrome do Fluyt Com").
- **Grupos:** *De agente* = `--user-data-dir=~/.config/ze-chrome*` (porta e dono pelo `cmdline`, nome pelo `agentes.json`). *Protegido* = `cockpit-tmux-*.scope`, `cockpit-*.service` (inclui o próprio `painel.py`/`cockpit-maquina`), sshd, tailscaled, Hyprland/sessão gráfica, barra e shell do Omarchy (layer, sem janela de cliente), pipewire/wireplumber, Xwayland. *Seus* = o resto de `app.slice` com janela no `hyprctl`. Regra de fechar é **lista de permissão** (agente + seus); tudo fora dela recusa 403, inclusive id forjado.
- **Limiar do "parado":** scope inteiro com < 0,1 s de CPU a cada 10 s = dormindo (pesquisa §4: Chrome ocioso gasta 0,4–2 ms em 3 s). `parado_s` conta desde a última janela acima do limiar.
- **Observação de CPU:** a thread `coletar()` que já existe (3 s) ganha uma amostra de `schedstat` dos scopes a cada 60 s (<10 ms). PSS e CDP só no `abertos`. Nenhum processo novo.
- **`liberou_mb`** = PSS+SwapPss do scope medido no instante do pedido, confirmado pelo scope sumir. Scope que não some em 8 s → 409 "não fechou", sem escalar pra SIGKILL.

## Back — VPS (`cockpit-api`, Codex)

`routers/maquinas.py` + `services/maquinas.py`, no molde de `routers/vps.py`:
- `GET /api/maquinas` → abas (`[{id:"pc2", nome:"PC2", online}]`).
- `GET /api/maquinas/{id}/resumo` → **cache de 30 s no servidor**: vários clientes = no máximo 1 chamada ao PC2 a cada 30 s. PC2 fora → `online:false`, sem 500.
- `GET /api/maquinas/{id}/abertos`, `POST /api/maquinas/{id}/fechar` → repasse sem cache.
- Teste pytest com o painel falso (offline, 403 de protegido, cache).

## Tela (Opus 5.5 + plugin `ui` + `frontend-design`, `docs/cockpit-v2-estetica.md`; diff pelo `ui:revisor-ui`)

- `app/maquinas/page.tsx` (rota própria = chunk próprio). Abas por máquina no topo (só PC2 agora).
- Painel de desempenho: **mesmo desenho do `bloco-da-vps.tsx`**, reaproveitando `recursos-da-vps.ts` (tetos/formatadores) + temperatura.
- Linha "Tela" (ver D1). Lista em três grupos; Protegido com cadeado, sem botão. Confirmação só onde `pede_confirmacao`. Depois de fechar: "liberou 410 MB" na própria linha.
- Busca só com a tela aberta e `!document.hidden` — o mesmo `setInterval` + `visibilitychange` do `BlocoDaVps`; sem SWR/React Query.
- **Selo** no atalho Máquinas: o selo da Faxina é calculado no servidor ao abrir a home; o das Máquinas precisa de um componente cliente pequeno (`AtalhoDeMaquinas`) que lê o `resumo` a cada 30 s. Vermelho com RAM > 85%. Sem timer de fechar.
- **Mini cartão do PC2** em `tropa.tsx`, embaixo do `<BlocoDaVps />`.
- **Uma só leitura do `resumo` no cliente:** selo e mini cartão aparecem na mesma tela, então um provedor/hook compartilhado (`usaResumoDaMaquina`) faz uma requisição a cada 30 s, com a mesma pausa por `visibilitychange`. O cache de 30 s da API não dispensa isso.

## Ordem e réguas de pronto

1. **Back PC2** — pronto quando: `abertos` lista os 5 Chromes (inclusive o headless da 9226) + Chrome pessoal + `foot`, com memória em PSS; um Chrome de agente sem uso vira "parado"; nada do grupo Protegido (agentes, barra/shell do Omarchy, pipewire, Xwayland, painel) aparece com botão; `fechar` com id de Protegido → 403; sem chave → 401; `agentes` vivos intactos (`pgrep claude`/`bun` antes e depois).
2. **Back VPS** — pytest verde; `curl` da VPS no PC2 real devolve o resumo.
3. **Tela** — clicada pelo harness, console limpo, revisor-ui passado.
4. **Teste do Rica (Canário, ponta a ponta)** — abrir 1 Chrome de agente (`BH_MAQUINA=fluytcom-pc2`), ver na lista com as abas, fechar pelo botão, conferir "liberou X MB" e o processo morto; Protegido sem botão e recusado pela API. Um Chrome por vez.
5. Skill enxuta `maquinas` + apagar este plano.

## Decisões (pro Rica, via Pavan)

- **D1 — Linha "Tela".** Recomendo instalar o `hypridle` (pacote oficial, ~2 MB de RAM) com um ouvinte que grava a hora do último uso num arquivo; o painel só lê o arquivo. É o único processo novo do projeto e contraria a regra "nenhum processo novo". Alternativas: pôr o `ricardo` no grupo `input` (o painel passaria a poder ler todas as teclas: não recomendo) ou tirar a linha.
- **D2 — Painel ganha repo?** Recomendo **sim**: `grupo_borges/maquina/` com `painel.py`/`agentes.py`, instalado no PC2 por `scp`. Hoje são 13 `.bak-*` soltos e nenhum histórico.

## Riscos

- **R1** — "Parado há" zera quando o painel reinicia (é memória do processo). A linha mostra desde quando observa.
- **R2** — VS Code com SIGTERM pode perder o que não foi salvo; por isso a confirmação. O back confere na doc do VS Code se o *hot exit* cobre SIGTERM antes de codar.

## Pendências pós-entrega

- Endpoints antigos do painel (`/api/acao`: ligar/desligar agente) seguem abertos pra Tailscale inteira, sem a chave nova — o Pavan leva ao Rica no fechamento.

## Estado em 05/11 ~14:30 (para retomar depois de compactar)

- **No ar:** tela Abertos (`fb5f1f3`), painel do Arsenal novo (8787), `cockpit-api` com a chave em `~/.config/cockpit/maquinas.env` (drop-in `cockpit-api.service.d/maquinas.conf`; também `COCKPIT_MAQUINA_NOME=VPS`). Prova de duas metades OK (`/tmp/e2e-abertos.md`; o print 5 do Canário é da bancada, não vale). Linger ligado no Arsenal pelo Pavan.
- **Pronto, sem commit, esperando o Rica (prints `/tmp/maquinas-prints/cartao-*.png`):** cartão da lateral com nome da máquina + Temperatura no lugar de Swap quando há sensor. Arquivos: `apps/api/{routers/vps.py,services/vps_recursos.py,tests/test_vps_recursos.py}` e no cockpit `app/abertos/page.tsx`, `lib/maquinas{,.test}.ts`, `components/shell/{recursos-da-vps{,.test}.ts,bloco-da-vps.tsx,barra-de-medida.tsx,tropa.tsx}`, `components/maquinas/{mini-cartao-da-maquina,painel-da-maquina}.tsx`. Publicar = commit desses paths + restart `cockpit-api` + `scripts/publicar-cockpit.sh`.
- **Em curso:** Codex trocando rótulos técnicos dos Protegidos em `maquina/maquinas.py` (saída `/tmp/codex-rotulos-out.txt`); depois: scp pro Arsenal + restart `cockpit-maquina`.
- **Pendente de decisão:** Abertos dentro do cockpit do Arsenal precisa de `MAQUINA_ARSENAL_CHAVE` na `cockpit-api` de lá.
- **Depois:** Fase 5 (skill enxuta `maquinas`/`abertos`, este plano sai do repo); `/tmp/painel-8788` e `teste-abertos-chrome` já limpos no Arsenal.

## Mudança de 05/11 14:21 (Rica, via Pavan) — linha por máquina

- O cartão grande (bloco-da-vps) sai da home e da tropa, nos dois cockpits. Entra uma linha por máquina no molde do mini cartão: nome · RAM · temperatura (Swap onde não há sensor) · parados. A cor de alerta é a de hoje. Tocar na linha abre `/abertos?m=<id>`.
- Máquinas listadas: a local (`/api/vps`) mais as de `/api/maquinas`. Uma remota com o mesmo nome da local vence, porque é ela que tem Fechar. Nenhum nome fixo no código.
- `/abertos` ganha a aba da máquina local (a VPS) com os 4 números e a lista de processos. É SÓ LEITURA, sem Fechar, porque ali morrem agente e serviço (decisão do Pavan).
- O print do cartão-arsenal de 14:01 foi descartado e não sobe. Novos prints em `/tmp/maquinas-prints/linhas-*.png`. Nada se publica antes do ok do Rica.
- Rótulos do grupo Protegido no ar no Arsenal: `09ca1d5`, `51c37a6`, `ca79b47` (104 testes).
- A chave da `cockpit-api` do Arsenal está em `~/.config/cockpit/maquinas.env` (0600), com drop-in `maquinas.conf`. Ela só vale depois de reiniciar a `cockpit-api`, junto com a publicação.
