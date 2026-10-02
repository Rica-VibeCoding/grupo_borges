# Cockpit v2 — Conversas: retomar conversa antiga (PLANO GUIA)

> **Chegou aqui depois de um `/clear`? Este arquivo é o ponto de retomada.** Leia o banner, a
> seção "Mecânica das cadeiras" e **só a primeira fase aberta** — as outras não entram no seu
> contexto. A pesquisa de referência está em `pesquisa.md` (Canário, 01/10); consultar por seção,
> nunca inteira.
>
> **RODADA 2 (01/10 tarde): CONCLUÍDA** — F14–F17 no ar em 01/10 (`11e8ea9`), conferência APROVADA no canarinho. Cadeiras no PC Windows (`tmux -L conversas`, clone `projetos\grupo_borges-cadeiras`) porque o Omarchy estava fora.
>
> **ESTADO (01/10/2026 — atualizar em 2 linhas ao fechar cada fase):** F0 ✅. Base no Omarchy:
> `pytest` 765 ok + 3 falhas de ambiente (`test_tmux_driver_ciclo_de_vida`, pede o
> `subir-frota.sh` da VPS); front 1508/1510 com 1 falha antiga (`configuracao-operacional.test.ts:32`,
> endereço `:3446`); `type-check` verde. No Omarchy é `pnpm` direto (Node 26, sem `corepack`).
> F1 ✅ (`relatos/f1.md`): diálogo de retomada só abre com flag de servidor, desligada hoje na VPS
> e no Omarchy; `--continue` e `--resume` chegam iguais ao gancho (`source: resume`). Em curso:
> **CONCLUÍDO (01/10).** F13b: o stream não reinicia no meio de uma troca (medir o v2 com `?recentes=1`; sem ele o replay é a cabeça, não a cauda). F13 publicada: o chat segue a troca (`conversa-trocada` no stream), marco da troca, pedido do cockpit discreto, "Voltar ao chat" no Histórico. F11 APROVADO pela `teste` (`relatos/f11.md`); F12 publicou o acabamento (`/clear` puro, feed sem resíduo, 🔒 sem falso positivo, briefing em BRT, espera que confere o cartão). F7b: atual certa depois de restart. F7 ✅ (gancho `SessionStart` registrado na VPS). F6 ✅ (publicada; A → B → A no canarinho, 200 em 28/22/20 s, sem diálogo). F5 ✅ (publicada; Nova conversa provada no canarinho em 18 s). F9 ✅ publicada na 3008 (`f70f8ad`), a cadeira `teste` ainda não passou. F3 ✅ (API publicada; lista real do Pavan 0,36 s com cache,
> 9,7 s a frio → aquecimento entra na F5). F2 ✅ (lista: 323 ms a frio / 1 ms com cache em 172 arquivos no Omarchy). F4 ✅
> (`ze_claude` `1c6763f`, provado no canarinho). F8 ✅ (`relatos/f8.md`, capturas em `/tmp/f8/` do Omarchy): 3 direções
> enviadas ao Rica, aguardando a escolha.

## O pedido

No card de cada agente, uma lista das conversas do Claude Code dele, para retomar uma conversa
antiga na mesma linha e continuar um projeto que ficou parado. É o `/resume` do CC com cara de
cockpit, no celular. Pedido do Rica em 30/09–01/10/2026.

## Decisões (não reabrir sem fato novo)

1. **Lista por agente**: últimos 30 dias, mais as ⭐ de qualquer idade. A mais recente em cima,
   com tempo relativo na linha ("3h", "ontem").
2. **Filtro**: *Todas*, *⭐ Especiais* e *⚠️ Com pendência*, mais busca por título e nota. Conversa
   com até 2 turnos fica escondida.
3. **Estacionar**: antes de sair de uma conversa, o próprio agente escreve um título e uma nota
   de onde parou e qual é o próximo passo. Isso vale para **Nova conversa** e para **Retomar**.
4. **Nova conversa** = estacionar e depois `/clear <título>`. O CC nativo dá esse nome à conversa
   que **sai**.
5. **Retomar troca a conversa da linha**: estaciona a atual, derruba a linha (o que rodava em
   segundo plano morre, por decisão do Rica) e sobe de novo com `--resume <id>`.
6. **Briefing de retorno**: ao retomar, o agente recebe os commits que mexeram nos arquivos
   daquela conversa desde a última atividade dela, mais os arquivos que continuam sem commit.
7. **Selos na lista**: ⚠️ conversa que deixou arquivo sem commit; 🔒 conversa aberta em outro
   lugar, que fica **bloqueada**, sem botão de retomar nem de excluir.
8. **Excluir** manda o arquivo para a lixeira com `gio trash`, depois de confirmar.
9. **Retenção** de 365 dias no CC (`cleanupPeriodDays` em `~/.claude/settings.json` da VPS,
   aplicado em 01/10). A tela continua mostrando só 30 dias, mais as ⭐.

**Fora do escopo:** retomar conversa pesada de forma compactada; conversas de Codex e opencode;
persona que mudou desde a conversa; lista geral da frota.

## O que já existe (mapa de 01/10)

- **Front vivo** em `apps/cockpit`, produção na 3008 (`:3446`) e API na 8002. `apps/web` é legado.
- **Gaveta do agente — UI NOVA desde `dfd2dc4` (01/10), fonte canônica da tela**:
  - Forma em `components/gaveta/`: `GavetaNova` (`gaveta-nova.tsx:212`) monta cabeçalho ·
    Conversa (ajustes de voz) · Sessão · Motor e conta · MCPs. Peças em `pecas.tsx` (`Cartao`,
    `Bloco`, `Interruptor`, `Segmentado`, `Pilula`, `Mais`); tokens na §G do `globals.css`,
    escopados em `.ck-gv`. Regras visuais: §17 "A gaveta hoje (01/10)" de
    `docs/cockpit-v2-estetica.md`.
  - **Estado e rede** (ligar, desligar, ocupado, painel) vêm de `usaVidaDoAgente`
    (`usa-vida-do-agente.ts:49`). Ação nova de tela pendura nele, não cria máquina paralela.
  - O `BlocoDeAcoes` **saiu** (`bloco-de-acoes.tsx` apagado). Ligar agora é o `acionarLigar` do
    `usaVidaDoAgente`.
  - Visões: `VistaDaGaveta` (`components/shell/vista-da-gaveta.tsx:23`) só conhece `mcps` e
    detalhes; `?painel=conversas` entra como terceira visão. A porta dos MCPs (`Cartao` +
    `LinkDaGaveta`, `gaveta-nova.tsx:252`) é o molde da porta das Conversas.
  - Casca: `GavetaPainel` (`components/shell/superficie-otimista.tsx:308`) e `Painel`
    (`app/agente/[slug]/page.tsx`). O cliente HTTP fica em `packages/cockpit-core/src/api.ts`.
- **Ligar**: `agents.py:4624` chama `tmux_driver.boot_agent` (`tmux_driver.py:1956-2024`), que
  passa `systemd-run … --setenv=FROTA_FLAGS_EXTRA=--continue` (`:1994`) para o `subir-frota.sh`.
  O script repassa a variável crua para o `claude`. Para retomar, basta parametrizar esse
  `--setenv`, validando o id com `_SESSION_ID_PATTERN` (`:490`).
- **Enviar texto** para o agente: `POST /input` (`agents.py:3113`). Interromper:
  `/interromper` (`:4465`). Desligar: `/desligar` (`:4573`).
- **Conversa atual de cada agente**: `db.latest_jsonl_session_id` (`db/store.py:1586`),
  alimentado pelo `orchestrator/jsonl_watcher.py` (mapa slug ↔ pasta em `:723`). Caminho do
  JSONL: `_claude_resume_jsonl_path` (`tmux_driver.py:1021`).
- **Banco**: `db/schema.sql` com `CREATE TABLE IF NOT EXISTS`, aplicado por `_apply_schema`
  (`store.py:331`). Coluna nova entra por `_add_column_if_missing` (`:391`).
- **Testes**: API com `uv run pytest` (molde: `test_agent_input.py`). Front com `node --test`
  pelo `corepack pnpm --filter @grupo_borges/cockpit test`. O script lista as pastas uma a uma,
  então pasta nova tem que ser acrescentada no `package.json`. Depois roda o `type-check`.

## Armadilhas conhecidas — cada fase confere as que tocam nela

- **O boot dá o nome do agente a toda conversa**, com `/rename` via `renomear_via_api`
  (`ze_claude/ze-shared/scripts/subir-frota.sh:143-157`, chamadas em `:267`, `:658`, `:690` e
  `:1064`). Num Retomar, isso **sobrescreve** o título da conversa retomada. Corrigido na F4.
- **`/clear <nome>` tem sentido trocado no cockpit.** O CC nativo dá o nome à conversa **que
  sai**. O `_rename_apos_clear` (`agents.py:3085`) dá o mesmo nome à conversa **nova**. Corrigido
  na F5.
- **O título gravado é quase sempre o nome do agente.** Medido em 01/10: a última `custom-title`
  das conversas do Pavan é "Pavan" ou "José Pavan". A lista trata título igual ao nome do agente
  como ausente.
- **Diálogo "Resume from summary"**: conversa com mais de 100 mil tokens e parada há mais de uma
  hora abre uma pergunta antes de continuar, e numa linha tmux ninguém responde. Medido na F1.
- **O `/relaunch` atual não serve.** Ele só retoma a conversa corrente e recusa qualquer outra
  (`tmux_driver.py:1478`).
- **JSONL não é formato documentado.** Ler só o começo e o fim do arquivo, com cache por `mtime`,
  e testar contra amostras gravadas.
- **Mensagem enviada no meio de um turno chega, mas não vira turno.** Estacionar só com o agente
  ocioso (`ze-shared/memory/shared_mensagem_no_meio_do_turno_nao_vira_turno.md`).
- **`subir-frota.sh`**: editar com um boot em andamento corrompe a execução, e a edição atômica
  perde o `+x` (MURAL).

## Mecânica das cadeiras (Omarchy)

- **Máquina**: o notebook no Omarchy, `ssh ricardo@100.116.209.95` (nó `omarchy`, porta 22).
  16 núcleos, 23 GB, CC 2.1.284 (a VPS está no 2.1.286), `gh` logado como `Rica-VibeCoding`.
  O nó `note-ricardo` é o Windows da mesma máquina: com ele, o note parece desligado.
  **Omarchy fora → PC Windows** (rodada 2): `ssh RicardoBorges@100.118.54.91`, clone
  `Documents\dev\projetos\grupo_borges-cadeiras`, `tmux -L conversas` (psmux), cadeira subida com
  `claude --model claude-opus-5-5 --dangerously-skip-permissions` para a `tela` (confirmar "trust" com Down+Enter); a `api` sobe em Codex.
  Comando PowerShell vai num `.ps1` por `scp` + `powershell -File` (aspas não sobrevivem ao SSH).
  Na home do PC: `capc.ps1 <sessao> <n>` (captura no `-L conversas`; o `cap-daniel.ps1` é do `-L conversa`,
  outra casa) e `sendc.ps1 <sessao> <arquivo>` (texto + Enter separado). Briefing vai em `C:\tmp\brief-*.md`
  e a mensagem só aponta o arquivo; o patch volta em `C:\tmp\*.patch`.
  Patch: `git diff --binary --output=C:\tmp\fN.patch` (o stdout do PowerShell estraga o patch);
  arquivo novo entra com `git add -N` e sai com `git reset` depois, senão trava o `pull`.
  Sem cadeira `teste`: o Canário (DeepSeek, VPS) confere — nunca uma cadeira de outro motor.
- **Repositório**: `~/Projetos/grupo_borges`, clonado na F0. O clone é só das cadeiras.
- **Casa** `tmux -L conversas`, com até três sessões:
  - `api-gpt`: **Codex** `codex.cmd -m gpt-6-sol -c model_reasoning_effort=medium --dangerously-bypass-approvals-and-sandbox` — back-end só GPT-6 Sol;
  - `tela`: Claude Code com `claude-opus-5-5`, carregando a skill `frontend-design` e lendo `docs/cockpit-v2-estetica.md` — UI só Opus 5.5;
  - `teste`: Claude Code com DeepSeek, pela função `deep` — pesquisa e teste (browser-harness) só DeepSeek.

  Motor por papel é regra fixa do Rica (02/10): não se troca por conveniência.

  Para subir uma sessão: `tmux -L conversas new-session -d -s api -c ~/Projetos/grupo_borges
  'bash -ic "cc --model claude-opus-5-5"'`. O `bash -ic` carrega as funções do
  `casas-omarchy.sh`.
- **Duas cadeiras Opus no máximo ao mesmo tempo**, porque a conta é uma só.
- **Despacho**:
  1. Escrever o briefing em `docs/conversas/briefings/fN-<nome>.md` (ele se basta sozinho),
     commitar e dar push na VPS.
  2. No Omarchy, rodar `git pull --ff-only`.
  3. Mandar à cadeira uma linha só, sem acento, com `send-keys -l` e o Enter num comando
     separado.
- **Captura**: `ssh ricardo@100.116.209.95 'tmux -L conversas capture-pane -p -t api' | tail -15`.
  Conferir a barra de contexto em toda captura.
- **A cadeira não commita.** Ela escreve o relato em `docs/conversas/relatos/fN.md`, com os
  números dos testes e o `type-check`, em até 15 linhas. Prova de tela e artefato vão para
  `/tmp`, fora do repositório.
- **A cadeira não avisa ninguém na VPS.** O orquestrador vigia o relato. Na VPS há mais de um
  Pavan (a linha `borges-pavan` do cockpit, o Pavan 2 e o orquestrador), e um `send-keys` em
  `borges-pavan` cai numa sessão que não conduz este plano.
- **Levar o diff do Omarchy para a VPS**:
  1. Puxar o patch: `ssh ricardo@100.116.209.95 'cd ~/Projetos/grupo_borges && git add -N . && git diff --binary' > /tmp/fN.patch`
  2. Na VPS: `git apply --check` e depois `git apply`.
  3. Revisar o diff.
  4. `git commit -- <paths>` e push.
  5. No Omarchy: `git fetch && git reset --hard origin/main && git clean -fd`.
- **Na VPS só se aplica, revisa e commita.** Teste e `type-check` rodam no Omarchy, para poupar
  a RAM da VPS. As exceções são as medições que precisam da frota e a ponta a ponta da F11.
- **Entre fases a cadeira recebe `/clear`.** No meio de uma fase, passou de 30%: `/compact`.
- **O orquestrador** lê só a fase em curso, o relato e o diff. Ao fechar a fase, atualiza o
  banner e commita. Passou de 25%, `/clear`: o banner devolve o fio.
- **Publicar**:
  - API: restart da `cockpit-api.service`. Afeta o feed de todos, então só em janela e sem
    turno longo de agente em andamento.
  - Tela: `next build` e restart da `cockpit-v2.service`. Isso força a recarga no iPhone.
  - Link para o Rica só depois do APROVADO da cadeira `teste`.

## Contrato da API (fechado na F2; F3, F5–F7 e as fases de tela seguem este desenho)

Base: `/api/agents/{slug}/conversas`.

- `GET ?filtro=todas|estrela|pendencia&q=<texto>&curtas=0|1` devolve
  `{suportado, conversas[], escondidas_curtas}`.
  - Cada item da lista: `id`, `titulo`, `titulo_origem`, `nota`, `atualizada_em`, `turnos`,
    `bytes`, `estrela`, `atual`, `bloqueada`, `bloqueada_por` (slug da linha que tem a conversa
    aberta, ou `null`; pedido da F8, entra na F3), `pendencia` (número de arquivos sem commit, ou
    `null` até a F7).
  - `titulo_origem` vale `estacionada`, `custom`, `ai`, `prompt` ou `primeira`.
  - `suportado` é `false` para motor que não é CC; nesse caso a lista vem vazia.
- **Ordem de queda do título**: título estacionado → `custom-title` diferente do nome do agente →
  `ai-title` → `last-prompt` → primeira mensagem do usuário. Nunca vazio.
- `POST /{id}/estrela {valor}` e `DELETE /{id}` (que manda para a lixeira). Responde 409 se a
  conversa for a atual ou estiver 🔒.
- `POST /estacionar {titulo, nota}`: chamado **pelo agente**. Grava os dois para a conversa
  atual dele.
- `POST /nova {forcar}` e `POST /{id}/retomar {forcar}`:
  - Resposta síncrona com teto de 90 s. Se o cliente cair, a operação continua no servidor.
  - `GET /operacao` devolve a fase em curso: `{fase: estacionando|religando|pronta|erro|null,
    desde}`, para a tela mostrar os passos da espera (pedido da F8; entra na F5 e na F6).
  - Agente no meio de um turno: 409 `ocupado`. Com `forcar`, interrompe e segue sem a nota.
- `GET /{id}/briefing`: só devolve texto para uma conversa que **acabou de ser retomada pelo
  cockpit**. A marca vale 10 minutos e é consumida uma vez. Fora disso, vazio.

Estado próprio numa tabela nova, `conversa_meta (slug, session_id, titulo, nota, estrela,
estacionada_em, retomada_em)`.

---

## F0 — Bancada (orquestrador, sem cadeira)

- **Entrega**:
  - Clone em `~/Projetos/grupo_borges`.
  - `uv sync --extra dev` em `apps/api` e `corepack pnpm install`.
  - Base verde no Omarchy: `pytest`, mais `test` e `type-check` do cockpit, com os números
    anotados no banner.
  - Casa `conversas` no ar, com a sessão `api`.
- **Pronto**: os três comandos verdes, ou as falhas que já existiam anotadas como base.
- **Tamanho**: 15 minutos de máquina.

## F1 — Medições (cadeira `api`, sem código de produto)

Responder com prova, numa pasta descartável `~/sonda-conversas` do Omarchy e sem mexer no repo:

- **M1 — o diálogo de retomada.**
  - `--resume <id>` numa conversa com mais de 100 mil tokens e parada há mais de 1 hora, dentro
    de um tmux: o diálogo aparece? Quais teclas escolhem "retomar inteira"?
  - O "Don't ask me again" grava em qual arquivo e em qual chave? (diff do `~/.claude.json`
    antes e depois)
  - Se o Omarchy não tiver conversa desse tamanho, o orquestrador mede na VPS, num socket
    `-L sonda`, sem mandar mensagem. Se usar `--fork-session`, confirmar que o fork não muda o
    diálogo, e mandar o JSONL do fork para a lixeira no fim.
- **M2 — `/clear <nome>`.** Qual JSONL recebe a `custom-title`? A conversa nova nasce sem nome?
- **M3 — gancho `SessionStart` com `source: resume`.**
  - Ele dispara no `claude --resume <id>` da largada?
  - O `additionalContext` chega ao modelo? (Pedir ao modelo que repita uma palavra-senha.)
  - Ele também dispara com `--continue`?
- **Pronto**: relato com os comandos e as saídas. Diálogo e teclas descritos com captura de tela.
- **Tamanho**: pequeno. Só leitura e sondas.

## F2 — API: a lista (cadeira `api`)

- **Entrega**:
  - `services/conversas.py`, que lê a pasta do agente (cwd → pasta no `~/.claude/projects`),
    só o começo e o fim de cada JSONL, com cache por `mtime`.
  - Títulos pela ordem de queda do contrato.
  - Contagem de turnos.
  - Janela de 30 dias mais as ⭐.
  - Filtro, busca e `curtas`.
  - A tabela `conversa_meta`.
  - A rota `GET`.
  - `atual` e `bloqueada`: a conversa está 🔒 se for a atual de **outra** linha viva, ou se o
    JSONL foi escrito nos últimos 2 minutos sem ser a atual desta linha.
- **Pronto**:
  - Testes com amostras de JSONL em `tests/fixtures/conversas/`: título igual ao nome do agente
    cai para o próximo, arquivo truncado não derruba a lista, e `curtas` esconde as de até 2
    turnos.
  - `pytest` verde.
- **Fora**: escrita de qualquer tipo, selo ⚠️ e tela.
- **Tamanho**: cerca de 250 linhas, mais os testes.

## F3 — API: estrela e excluir (cadeira `api`, depois de `/clear`)

- **Entrega**: `POST estrela` e `DELETE` com `gio trash`. O id passa pelo
  `_SESSION_ID_PATTERN` e o caminho resolvido tem de ficar dentro da pasta do agente. Responde
  409 para a conversa atual ou 🔒.
- **Pronto**:
  - Testes: id malicioso (`../`), conversa atual, 🔒 e a estrela sobrevivendo a 30 dias.
  - **O orquestrador publica a API**, em janela, e mede a lista real do Pavan (172 arquivos)
    com `curl`: tempo a frio e com cache. Se passar de 1 s com cache, volta para a `api`.
- **Tamanho**: cerca de 100 linhas.

## F4 — Boot respeita a conversa retomada (orquestrador, repo `ze_claude`)

- **Entrega**: o `subir-frota.sh` **não** chama `renomear_via_api` quando o `FROTA_FLAGS_EXTRA`
  traz `--resume`. São as quatro chamadas, em `:267`, `:658`, `:690` e `:1064`.
- **Antes de salvar**:
  - `journalctl --user -u 'cockpit-ligar-*'` sem boot em andamento.
  - Escrever num arquivo novo e mover por cima.
  - Conferir o `+x` no `git diff --cached --stat`.
- **Pronto**: o Ligar comum (com `--continue`) continua nomeando, provado no canarinho. O
  `--resume` não nomeia, provado com `FROTA_FLAGS_EXTRA` à mão no canarinho.
- **Tamanho**: menos de 20 linhas.

## F5 — API: estacionar e Nova conversa (cadeira `api`)

- **Entrega**:
  - `POST /estacionar`.
  - `POST /nova`, com este fluxo:
    1. O agente está ocioso? Se não estiver, 409, ou interromper se vier `forcar`.
    2. Mandar o pedido de estacionar.
    3. Esperar o `POST /estacionar` por até 60 s.
    4. Esperar o agente ficar ocioso.
    5. Mandar `/clear <título>`.
  - A mensagem de estacionar é um texto fixo, com o `curl` pronto: título de até 6 palavras e
    nota de até 200 caracteres (onde parou e o próximo passo).
  - Se o agente não responder no prazo, segue sem nota, com o título de queda.
  - **Corrigir o `_rename_apos_clear`**: depois de `/clear <título>`, a conversa nova recebe o
    **nome do agente**, não o título. Antes de mudar, ler o `git log -S _rename_apos_clear` para
    não quebrar o rodapé do card (`RodapeDeCota.sessao`).
- **Pronto**: testes com tmux e relógio falsos para ocioso, ocupado, `forcar`, agente que não
  responde e título com aspas ou acento no `/clear`.
- **Tamanho**: cerca de 200 linhas.

## F6 — API: Retomar (cadeira `api`, depois de `/clear`)

- **Entrega**: `POST /{id}/retomar`, com este fluxo:
  1. Validar: a conversa é deste agente e não está 🔒.
  2. Estacionar a atual, com o fluxo da F5.
  3. `/desligar`.
  4. `boot_agent` com flags parametrizadas (`--resume <id>` no lugar de `--continue`).
  5. Gravar `retomada_em`.
  6. Esperar a linha ficar pronta e tratar o diálogo. F1: são **dois** diálogos possíveis, ambos
     atrás de flag de servidor desligada em 01/10 (`tengu_gleaming_fair*` e `tengu_amber_tally`
     no `cachedGrowthBookFeatures` do `~/.claude.json`). No de retomada, a opção 2 é "Resume full
     session as-is"; no de cota, `new_conversation` dispara um `/clear` sozinha. A chave
     `resumeReturnDismissed: true` no `~/.claude.json` cala os dois (lida no binário, não medida).
     Teclas não medidas: se o diálogo aparecer, escolher a opção 2 e conferir a linha pronta; não
     ficou, erro legível. A linha nunca fica parada num diálogo.
- **Pronto**:
  - Testes: id de outro agente, 🔒, agente ocupado, falha no boot (a linha não pode ficar
    morta sem aviso: voltar com `--continue` e responder erro) e diálogo detectado.
  - O orquestrador prova no canarinho pela API publicada: retomar a conversa A, depois a B,
    depois a A de novo.
- **Tamanho**: cerca de 200 linhas.

## F7 — Briefing de retorno e selo ⚠️ (cadeira `api`)

- **Entrega**:
  - Uma função que lista os arquivos mexidos pela conversa, a partir das entradas
    `file-history-snapshot` do JSONL.
  - Com ela, `git log --since=<última atividade>` e `git status` sobre esses caminhos, repo por
    repo.
  - O campo `pendencia` na lista, com cache.
  - `GET /{id}/briefing`, que devolve no máximo 25 linhas.
  - O script `apps/api/scripts/briefing-retorno.sh`, que lê o JSON do gancho e chama a rota em
    até 3 s. Responde com `additionalContext`, e fica calado se a API cair ou se não houver
    retomada marcada.
  - **O orquestrador registra o gancho** `SessionStart` com `matcher: resume` no
    `~/.claude/settings.json` da VPS.
- **Pronto**:
  - Testes: arquivo criado do zero não aparece (limitação conhecida, documentada no relato),
    repo sem mudança devolve vazio, e o `--continue` comum não recebe briefing.
  - O orquestrador prova no canarinho que o agente cita o briefing depois de retomar.
- **Tamanho**: cerca de 200 linhas.

## F8 — Tela: direções visuais (cadeira `tela`; pode correr junto de F2 e F3)

- **Entrega**: 2 ou 3 direções em captura de iPhone, com dados falsos que seguem o contrato,
  **dentro da gramática da gaveta nova** (peças de `pecas.tsx`, tokens `.ck-gv`, §17). A porta
  na `GavetaNova` não pode empurrar a gaveta para fora de 390×844 sem rolar, e o nome não pode
  confundir com o cartão "Conversa" de voz que já existe. Precisam mostrar: lista com tempo relativo, título e nota; filtros; busca; os selos
  ⭐ ⚠️ 🔒; os botões Retomar, Nova conversa e Excluir; e a confirmação de Retomar ("vai
  interromper o que está rodando").
- **Pronto**: o Rica escolhe a direção. **Nenhum código de produto antes disso.**

## F9 — Tela: a gaveta de leitura (cadeira `tela`)

- **Entrega**:
  - `?painel=conversas` como terceira visão da `VistaDaGaveta`, com a porta na `GavetaNova`.
  - **Decisão do Rica (01/10):** a porta ocupa o lugar do **Destravar**, no cartão Sessão, e o
    Destravar sai da gaveta (talvez não volte). A porta aparece com o agente ligado ou desligado.
  - **Direção A** aprovada (lista abre no lugar, toque expande a nota e as ações), com o "Em uso
    agora" + Nova conversa da C no topo. O `/clear` sai dos Comandos. "Sem sinal" fica só no
    pulso. Capturas em `/tmp/f8/` do Omarchy; protótipo em `/tmp/f8/prototipo/`.
  - O cliente da lista no `cockpit-core/api.ts`.
  - Filtros, busca, tempo relativo e os selos, na direção aprovada. O filtro ⚠️ fica escondido
    enquanto `pendencia` vier `null`.
  - Pasta nova incluída no script `test`.
- **Pronto**: `test` e `type-check` verdes, e a cadeira `teste` aprova contra a API publicada.
- **Fora**: botões de ação.

## F10 — Tela: as ações (cadeira `tela`, depois de `/clear`)

- **Entrega** (estado de ocupado e de religar lido do `usaVidaDoAgente`):
  - Retomar, com confirmação e com o caso "ocupado → interromper e trocar".
  - Nova conversa.
  - ⭐ e 🗑️ (com confirmação).
  - Estado de espera de até 90 s ("estacionando…", "religando…").
  - Erro legível quando a operação falhar.
- **Pronto**: `test` e `type-check` verdes, e a cadeira `teste` aprova o fluxo inteiro no
  canarinho.

## F11 — Publicar e conferir

- **Entrega**: o orquestrador publica a tela (build e restart da 3008) e a cadeira `teste` roda o
  caminho completo na `:3446` com o canarinho: Nova conversa → nota aparece → Retomar a antiga →
  briefing citado → ⭐ → excluir uma conversa curta.
- **Pronto**: APROVADO da `teste`, o link vai para o Rica, e ele confere no iPhone com uma
  conversa real dele.

---

# Rodada 2 — o fluxo do dia a dia (pedido do Rica, 01/10 à tarde)

O Rica usou a F13 no iPhone e achou a tela carregada: muito texto para ler e troca de verdade a
cada toque. Ele quer bater o olho e saber o que fazer.

## Decisões da rodada 2 (Rica, 01/10)

1. **Olhar ≠ trocar.** Tocar numa conversa do Histórico abre a conversa só para leitura (últimas
   mensagens e a nota), sem mexer no agente. Quem troca é um botão só, **Continuar esta**, no fim
   da leitura.
2. **Continuar esta sem confirmação** com o agente ocioso (nada se perde: a de agora fica no
   Histórico). Com o agente no turno, **uma linha** ("José Pavan está trabalhando") e o botão
   laranja. Some o parágrafo de aviso.
3. **Nova conversa direto no painel** (gaveta), um toque, ao lado da porta do Histórico.
4. **Voltar pra anterior**: na conversa nova vazia, um atalho único que retoma a que acabou de
   sair. É o desfazer de quem tocou errado. A foto do agente **não** se repete ali: a pílula no
   alto já mostra. **Retirado em 02/10 a pedido do Rica:** poluía a tela; quem quer a anterior
   busca no Histórico da gaveta.
5. **Concluída**: marca manual; a conversa sai da lista *Todas* (fica num filtro próprio).
6. **Lista enxuta**: só título e tempo. A nota mora dentro da leitura. **Renomear** também mora
   na leitura.
7. **Limpeza**: some o cartão "Em uso agora" quando a conversa atual tem 0 turnos; a espera da
   troca vira uma barra, sem as linhas de etapa nem "pode levar até 90 s".
8. **Título segue com o agente** (estacionar, F5), com o título de queda quando ele não responde.
   Medido em 01/10: o `ai-title` do CC existe em 11 de 58 conversas do Pavan e 1 de 28 do Daniel
   (7 dias) — não serve de fonte principal. **Pendência segue só pelo git**, sem LLM.

## Movimento da rodada 2 (Rica, 01/10: "tudo que puder, use ela, inclusive carregando")

A casa já tem a stack: **Motion** (`motion/react` 12.43, em `apps/cockpit/package.json`), os tokens
`--ck-dur-*`, `--ck-ease*`, `--ck-mola` e a entrada `.ck-surge` (regras na §5 de
`docs/cockpit-v2-estetica.md`). Hoje ela vive em 4 arquivos só (pílula, composer, anexo, voz).
F15 e F16 usam ela em todo momento abaixo, sem keyframe próprio e sem lib nova:

- **Carregando**: lista e leitura entram com linhas-esqueleto pulsando (opacity), trocadas pelo
  conteúdo num fade, sem salto de altura.
- **Lista → leitura → lista**: a leitura surge por `.ck-surge` e o título da linha tocada vira o
  título da leitura (`layoutId`). Voltar desfaz o mesmo gesto.
- **Filtros**: o fundo do segmento ativo desliza entre *Todas* / ⭐ / *Concluídas* (`layoutId`).
- **Linha que sai** (Concluída, 🗑, ⭐ no filtro ⭐): `AnimatePresence` com saída em opacity e as
  de baixo sobem por `layout`.
- **⭐ marcada**: um pulso de escala com `--ck-mola`.
- **Agente ocupado**: o botão passa de claro a âmbar em cor+opacity, sem pular de tamanho.
- **Espera da troca**: barra **indeterminada** (a API não dá porcentagem), por transform.
- **Conversa nova**: "Voltar pra anterior" entra por `.ck-surge` e sai em fade no primeiro turno.
- **Nova conversa na gaveta**: toque com `--ck-dur-fast`.
- **O pulso dourado de trabalhando** (`components/shell/faixa-do-pulso.tsx`, `--ck-pulso-ouro`) fica como está: "ele funciona bem" (Rica, 01/10).
- Regras que não mudam: só `transform` e `opacity`; `MotionConfig reducedMotion="user"`;
  `layoutDependency` em todo `layout`; nada anima o feed durante o stream.

## F14 — API da rodada 2 (cadeira `api`)

- **Entrega**:
  - `GET /{id}/leitura`: últimas mensagens da conversa (texto do Rica e do agente, sem ferramenta),
    lidas do JSONL, sem tocar no tmux. Reaproveitar a canonização do feed (`_eh_residuo_de_troca`).
  - `concluida` na `conversa_meta`: `POST /{id}/concluida {valor}`; filtro `concluidas`; *Todas*
    deixa de trazer as concluídas.
  - `POST /{id}/titulo {titulo}`: renomear (grava na `conversa_meta`, vence na ordem de queda).
  - `anterior` na resposta da lista: id da última conversa deixada pela troca, para o atalho
    "Voltar pra anterior".
- **Pronto**: testes da rota de leitura (conversa grande, conversa com `/clear` no topo), da
  concluída e do renomear; `pytest` e `ruff` sem falha nova.

## F15 — Tela: o Histórico novo (cadeira `tela`, carrega `frontend-design`)

- **Antes do código:** protótipo do Histórico (lista enxuta + leitura + Continuar esta) mandado
  ao Rica em print de celular. Só codar com o aval dele.
- **Protótipo aprovado pelo Rica em 01/10** (prints em `/tmp/f15/` na VPS). Movimento: seção acima.
- **Entrega**: lista só título e tempo; toque abre a leitura; Continuar esta, ⭐, Concluída,
  Renomear e 🗑️ dentro da leitura; confirmação de uma linha só no caso ocupado; cartão de 0 turnos
  some; espera em barra.
- **Pronto**: `test` e `type-check` verdes, e a cadeira `teste` aprova contra a API publicada,
  com print.

## F16 — Tela: painel e conversa nova (cadeira `tela`)

- **Entrega**: botão **Nova conversa** na gaveta, ao lado da porta do Histórico; atalho **Voltar
  pra anterior** na conversa nova vazia (some no primeiro turno).
- **Pronto**: a cadeira `teste` roda no canarinho: Nova pelo painel → Voltar pra anterior → espiar
  uma antiga sem trocar → Continuar esta → Concluída. Publica na 3008 e o link vai ao Rica.
