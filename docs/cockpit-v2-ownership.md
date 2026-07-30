# OWNERSHIP.md — quem mexe onde, no Cockpit v2

> Passo 2 da ordem em `cockpit-v2-fusao.md`. Consenso dos dois lados da fusão:
> **ownership por caminho de arquivo, nunca por conceito.**
>
> O recorte conceitual falha por um motivo físico: o botão de push-to-talk mora
> *dentro* do composer, então "voz" e "chat" colidem no mesmo arquivo. Caminho não
> tem ambiguidade — ou o arquivo é seu, ou não é.

---

## 1. Fase atual: contrato (a janela aberta agora)

Idêntica à tabela do `cockpit-v2-playbook.md` §9, repetida aqui porque este é o
arquivo canônico:

| Caminho | Dono |
|---|---|
| `docs/cockpit-v2-estetica.md` + metade **pele** dos tokens | **Daniel** |
| `apps/cockpit/**` (scaffold), `packages/cockpit-core/**` | **Pavan** |
| `docs/cockpit-v2-stack.md`, `-data-contract.md`, `-ownership.md` + metade **esqueleto** dos tokens | **Pavan** |
| `app/globals.css` congelado — união das duas metades | **Pavan**, na integração |
| `apps/web/**` (cockpit atual) | **ninguém** |

As sessões paralelas **consomem** o contrato de estética; não o reescrevem.
Divergência de estilo depois de aberto vira issue contra o contrato, não edição
local.

---

## 2. Fase de construção: três frentes por diretório

Vale a partir do passo 6, depois de scaffold e spike. Cada frente em **worktree
própria**, rebase diário, merge em janela revisada.

| Caminho | Dono | Por quê este recorte |
|---|---|---|
| `components/shell/**` | frente **chrome** | AppShell, três colunas, gaveta, navegação |
| `components/chat/**` | frente **chat** | composer, lista, bolha, scroll |
| `components/render/**` | frente **renderers** | um arquivo por família de payload |
| `packages/cockpit-core/**` | **Pavan** | núcleo compartilhado: mudança aqui afeta as três frentes |
| `app/globals.css` | **Pavan** | única fonte de cor. Ver §4 |
| `app/**/layout.tsx`, `page.tsx`, rotas | **Pavan** | topologia de rota é decisão de arquitetura |
| `apps/cockpit/CLAUDE.md`, `.claude/skills/**` | **Pavan** | infraestrutura de manutenção |
| `docs/cockpit-v2-*.md` | **Pavan** | os contratos |
| `fixtures/cockpit-v2/**` | **Pavan** grava, todos **leem** | baseline não se edita para passar no teste |
| `apps/web/**` | **ninguém** | congelado por decisão do Rica |
| `apps/api/**` | **fora de escopo** | o back não sai do lugar |

### Papéis fixos, e quem audita quem — regra do Rica (30/07)

Não é combinado deste passo, é **regra permanente** do grupo:

| papel | quem | audita |
|---|---|---|
| **frontend master** | **Daniel** | — |
| revisão de **frontend** | **Kimi / Hiro** | o trabalho do Daniel |
| revisão de **backend** | **Tara / Codex** | o meu trabalho |

Duas consequências que fazem a regra valer a pena:

1. **Ninguém audita a si mesmo.** Verificação que reusa a implementação do autor não
   é verificação — é a mesma conta feita duas vezes. Já pegou erro real nos dois
   sentidos: o Daniel achou uma contradição nos meus docs, e eu achei um mecanismo
   que ele afirmou sem medir.
2. **O revisor é escolhido pelo domínio, não pela disponibilidade.** Frontend vai
   para quem tem Tailwind/React no corpus; backend/infra vai para quem tem shell,
   tipos e protocolo.

O auditor **não corrige**: ele relata. Quem corrige é o dono do caminho.

Papéis do passo 7, dentro dos caminhos acima:

- **Tara (Codex)** — componentes de contrato fechado: orb em Canvas 2D, diff
  viewer, renderer de markdown. Entra como arquivo novo dentro da frente dona.
- **Hiro (Kimi)** — cauda longa da matriz de renderers, varredura de hex fora do
  tema, execução do checklist de equivalência.
- **Daniel** — a pele. Na fase de construção ele **edita arquivo existente** para
  aplicar tokens; não escreve integração nova. É a mitigação de alucinação de API:
  o risco não é o gosto dele, é inventar assinatura de biblioteca com um dia de
  vida.

---

## 3. Regra de colisão

1. **Dois autores no mesmo arquivo é conflito garantido** — não se resolve com
   cuidado, se resolve com recorte. Se duas frentes precisam do mesmo arquivo, o
   arquivo está fazendo duas coisas: quebra-se em dois antes de escrever.
2. **Quem renomeia commita primeiro** e avisa antes, não depois.
3. `git add <caminho-explícito>` sempre. Nunca `-A` na raiz — arrasta trabalho de
   outro agente.
4. Mudança em `packages/cockpit-core` **pausa as frentes**: é a única peça cujo
   contrato as três consomem. Passa por mim.

---

## 4. Cor só existe em um arquivo

`app/globals.css` é o **único** lugar do repo onde cor é declarada. Nenhum hex,
`rgb()`, `oklch()` ou nome de cor em componente, em Tailwind arbitrário
(`bg-[#123456]`) ou em style inline.

Motivo prático: é o que permite o Rica pedir "põe no verde" e a mudança acontecer
num lugar, não em quarenta. A varredura de hex solto é uma das skills de
manutenção, justamente porque este é o modo de falha que se repete.

---

## 5. Orçamento de máquina — quantos `next dev` de pé

A fusão exige este número escrito. Medido em 2026-07-30:

| | Hostinger (`srv1061129`) | Oracle (`vps-arm-borges-767247`) |
|---|---|---|
| arquitetura | x86_64 | **aarch64** |
| memória disponível | 4.685 MB de 7.940 | 8.603 MB de 11.927 |
| vCPU | — | 2 |
| disco livre | **20 G (80% cheio)** | 62 G (37%) |
| `next dev` atual | 3007, ~248 MB RSS, 3 dias de pé | — |

**Teto: 2 `next dev` na Hostinger.** O 3007 (atual, intocável) e o 3008 (v2). Não
existe terceiro.

As frentes paralelas **não sobem um dev cada**. Elas trabalham em worktree e
compartilham o 3008, ou verificam na Oracle. Três devs mais cinco sessões de CC
(`MemoryHigh` 1500 MB cada, slice `borges-frota` com `MemoryHigh=5G` /
`MemoryMax=6G`) estouram a slice — e o que estoura primeiro derruba o cockpit do
Rica.

### ⚠️ Onde o app roda: Hostinger, e isso corrige o playbook

O playbook dizia "front novo construído na Oracle". **Não dá, e o motivo é
medido:** o back (`uvicorn`) escuta **somente em `127.0.0.1:8000`**. Da Oracle,
`curl http://100.107.56.38:8000/api/fleet` devolve **código 000** — não alcança. E
o front depende de `rewrites()` para `/api`, que resolve contra o host onde o Next
roda.

As alternativas foram consideradas e recusadas: mudar o bind do uvicorn é mexer no
back durante a migração; túnel SSH permanente Oracle→Hostinger adiciona uma peça
que cai em silêncio e leva o painel com ela.

**Divisão de trabalho entre as máquinas:**

- **Hostinger** — `next dev` do v2 na 3008, porque é onde o back está. **Custo real
  medido, não estimado: 552 MB de RSS** — mais que o dobro do cockpit antigo (226 MB
  com 3 dias de pé). Turbopack em app recém-compilado é mais gordo; deve assentar,
  mas planeje com 550 MB, não com 250. Com os dois de pé a slice `borges-frota` fica em
  **3,8 GB de 5 GB** de `MemoryHigh` (76%) e a máquina com 3,9 GB livres.
  É por isso que o teto de 2 `next dev` não é conservadorismo: um terceiro encosta no
  throttle da slice, e o que engasga primeiro é o painel do Rica.
- **Oracle** — oficina do que **não** precisa do back: `next build` de verificação
  (tipos, lint, tamanho de bundle), componente isolado, spike. Tem 2× a memória e 3×
  o disco livre. O repo já está clonado em `/home/ubuntu/repos/grupo_borges`, node
  v22.22.3. Acesso: `ssh -i ~/.ssh/oracle_arm_sp ubuntu@100.116.1.44`.
- ⚠️ **`node_modules` não atravessa as máquinas** — aarch64 e x86_64 têm binários
  nativos diferentes. Cada máquina instala o seu; nunca copiar a pasta.

---

## 5.1 Pendências do contrato de estética — pedir ao Daniel antes do passo 5

Levantadas pela auditoria de frontend (Kimi, 30/07). São **decisões dele**, não
minhas: eu não invento token de pele. Mas têm de existir **antes** dos renderers,
porque quando 23 tools × 24 formas de resultado precisarem delas de uma vez, cada
executor vai escolher um valor diferente — e é exatamente o que o ownership existe
para evitar.

| falta | por que cobra caro depois |
|---|---|
| **`--ck-font-sans` / `--ck-font-mono`** | o contrato §4 elege Geist Sans + Geist Mono via `next/font/local` e faz de "mono = voz da máquina" a decisão tipográfica central. **Não existe nenhuma fonte declarada no app** — hoje tudo sai em fonte de sistema, e cada renderer vai declarar a sua |
| **`line-height` e `tracking`** | o contrato fixa 1.55 (corpo/mono), 1.2 (hero) e trackings −0.035em / −0.012em / +0.055em. Nenhum é token, então já nasceu uma divergência: eu havia escrito `0.08em` no overline (corrigido para 0.055em à mão, que é remendo, não solução) |
| **cor de link** | log de execução renderiza URL em saída de ferramenta. Sem token, o primeiro executor inventa |
| **scrim / véu** | existem as camadas `--ck-z-overlay/modal/toast` mas nenhuma cor de véu |
| **hover / pressed de superfície** | item da tropa, linha de tool. Cada executor escolheria um degrau diferente |
| **`::selection`** | log implica copiar trecho; sem token, o azul default do browser destoa |
| **duração de 200ms + easing de saída** | o contrato §5 define 120/200/320ms e **dois** easings; o CSS tem 120/320 e um easing só. Esta é da minha metade (§B esqueleto) — entra comigo |
| **paleta de syntax highlighting** | se bloco de código recebe cor, não há paleta. Se a decisão é "mono sem cor", vale escrever isso |

Também levantado: mapear `--text-*: var(--ck-text-*)` no `@theme`, senão `text-sm`
do Tailwind (14px) convive com `--ck-text-sm` (13px) e escrever `text-sm` parece
usar o token mas usa outro valor.

## 5.2 Rodada paralela de 30/07 03:08 — três frentes abertas ao mesmo tempo

Pedido do Rica: *"quero que a gente consiga distribuir mais esses trabalhos"*. A
crítica é justa pela metade e vale registrar de que metade: os passos 1 a 4 são
sequenciais **por decisão escrita** (§ordem de execução da fusão — paralelizar
scaffold é onde nascem os conflitos), mas duas peças eram paralelizáveis desde o
começo e não saíram. Saíram agora.

O critério que autoriza antecipar as duas, antes do spike do passo 5: **ambas
sobrevivem às duas hipóteses do spike.** O coalescedor é fronteira SSE→store e o
levantamento de renderers é sobre o classificador — nenhum dos dois muda se
`assistant-ui` cair para shadcn-only. Antecipar não gera retrabalho; se gerasse, não
antecipava.

| frente | quem | caminho exclusivo nesta rodada | por que é dele |
|---|---|---|---|
| tokens de pele que faltam (§5.1) | **Daniel** | `docs/cockpit-v2-estetica.md` | frontend master; eu não invento token de pele |
| coalescedor de stream puro | **Tara** | `packages/cockpit-core/src/stream-coalescer.ts` + `.test.ts` + a linha no `exports` | lógica pura, sem React, contrato fechado e testável — é o perfil dela |
| matriz payload→renderer (52 famílias) | **Hiro** | `docs/cockpit-v2-matriz-renderers.md` | cauda longa de frontend contra fixture real, papel do passo 7 |
| spike do chat + gate no iPhone | **Pavan** | `apps/cockpit/**`, harness de medição | decisão de arquitetura e medição no aparelho do Rica não delego |

Duas exceções conscientes ao que está escrito acima:

1. `docs/cockpit-v2-*.md` é meu por §2, e eu **cedi** `cockpit-v2-matriz-renderers.md`
   ao Hiro nesta rodada. Cessão explícita e por escrito é diferente de dois autores
   no mesmo arquivo por acidente.
2. `packages/cockpit-core/**` é meu por §2 e por §3.4 (mudança lá pausa as frentes).
   A Tara entra com **arquivo novo**, não edita os existentes, e a única mudança em
   arquivo compartilhado é uma linha em `exports` — colisão de uma linha se resolve
   na leitura.

## 5.3 Emenda ao "scaffold sequencial, feito por mim, sozinho"

A fusão fixou que o scaffold do chat é meu e sequencial. O **motivo** escrito lá é
específico: o executor não conhece a API do `assistant-ui`, então escreveria
integração inventada — *"pin de versão não corrige alucinação de modelo"*.

Ao construir, encontrei o custo real dessa regra: montar a integração exige
arqueologia de `.d.ts` num pacote bundlado de um dia de idade, e eu queimei parte do
meu contexto — que é o recurso da coordenação da rodada — lendo tipos que qualquer
executor lê igual. Ou seja, a regra transferiu o risco de alucinação para um gargalo
em mim, que é exatamente o que o Rica cobrou nesta rodada.

**Emenda:** o scaffold continua **fatiado por arquivo e revisado por mim**, mas a
implementação pode ser delegada **sob mitigação explícita**, que substitui a proteção
original:

1. **Citação obrigatória.** Cada API usada vem com `arquivo:linha` do pacote
   instalado em `node_modules`. Sem citação, a linha não entra.
2. **Proibido improvisar assinatura.** Se o tipo não existe onde o executor
   procurou, ele **para e relata** — não deduz. Foi assim que a ponte de conversão
   foi despachada, e funcionou.
3. **Teste contra fixture real**, nunca payload inventado à mão.
4. **Um autor por arquivo**, com transporte (`lib/spike/**`) e superfície
   (`app/spike/**`) separados de propósito — a regra de colisão do §3 continua valendo
   inteira.

O que **não** se delega segue igual: a decisão de qual API usar (foi minha, e
revoguei a primeira versão dela em 25 minutos), o gate numérico, e a medição no
aparelho do Rica.

## 6. O que não é ownership de ninguém

`apps/web` está congelado. Isso inclui o bug do clear, que **fica para o v2** por
decisão do Rica. Se o cockpit atual quebrar sozinho, o conserto é o mínimo para
voltar ao ar — não é oportunidade de melhoria.

Única exceção prevista: `fixtures/cockpit-v2/gravar-transcripts.py` consome o
`apps/web` **de fora**, pela mesma SSE que o front usa. Instrumentar de fora não é
tocar.
