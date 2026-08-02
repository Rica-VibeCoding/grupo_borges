# OWNERSHIP.md — quem mexe onde, no Cockpit v2

> Passo 2 da ordem em `cockpit-v2-fusao.md`. Consenso dos dois lados da fusão:
> **ownership por caminho de arquivo, nunca por conceito.**
>
> O recorte conceitual falha por um motivo físico: o botão de push-to-talk mora
> *dentro* do composer, então "voz" e "chat" colidem no mesmo arquivo. Caminho não
> tem ambiguidade — ou o arquivo é seu, ou não é.

---

## 1. Fase de contrato — ENCERRADA

Esta seção descrevia a janela em que o contrato de estética e o esqueleto eram
escritos em paralelo. Ela **fechou**: `docs/cockpit-v2-estetica.md` está aberto e em
uso, o scaffold existe, e `app/globals.css` já é a fonte única de cor. O mapa que vale
hoje é o da §2.

O que sobrevive dela como regra: as sessões **consomem** o contrato de estética, não o
reescrevem. Divergência de estilo depois de aberto vira issue contra o contrato, não
edição local.

---

## 2. Fase de construção: o mapa vigente (30/07)

Os caminhos abaixo são os que **existem no disco** — conferido em 30/07. Quando o
recorte mudar, corrigir aqui no mesmo turno: ownership por caminho fantasma é
ownership nenhum.

| Caminho | Dono | Por quê este recorte |
|---|---|---|
| `components/shell/**`, `globals.css`, `layout.tsx` | **Daniel** | AppShell, composer, gaveta, navegação, pele |
| `components/feed/**`, `app/spike/sem-lib/**` | **Hiro** | o feed próprio, sem `assistant-ui` |
| `lib/envio.ts` + a exceção pontual em `apps/api/` | **Tara** | confirmação de envio por observação do eco |
| `components/renderers/**` | **consumo de todos** | um arquivo por família de payload; mudar aqui passa pelo Pavan |
| `components/ui/**` | shadcn | gerado; conferir se já existe antes de desenhar |
| `docs/cockpit-v2-medicao/**` | **Daniel** grava, todos leem | bancada e relatórios de medição |
| `packages/cockpit-core/**` | **Pavan** | núcleo compartilhado: mudança aqui afeta as três frentes |
| `app/globals.css` | **Pavan** | única fonte de cor. Ver §4 |
| `app/**/layout.tsx`, `page.tsx`, rotas | **Pavan** | topologia de rota é decisão de arquitetura |
| `apps/cockpit/CLAUDE.md`, `.claude/skills/**` | **Pavan** | infraestrutura de manutenção |
| `docs/cockpit-v2-*.md` | **Pavan** | os contratos |
| `fixtures/cockpit-v2/**` | **Pavan** grava, todos **leem** | baseline não se edita para passar no teste |
| `apps/web/**` | **ninguém** | congelado por decisão do Rica |
| `apps/api/**` | **fora de escopo**, com uma exceção escrita abaixo | o back não sai do lugar |

#### A exceção do `apps/api` — adição opcional para instrumentação (30/07)

"O back não sai do lugar" quer dizer **o back não muda de comportamento**. Não quer
dizer que ele seja intocável, e a diferença apareceu na primeira vez que a medição
precisou dele: o `?historico=N` nunca mordeu porque o replay do SSE entrega os `limit`
eventos **mais antigos** e o loop live puxa todo o resto — então `limit` dimensionava o
primeiro lote, nunca o histórico acumulado. Duas rodadas de medição morreram nisso, e
nenhuma delas era corrigível pelo lado do cliente.

Fica permitido, e **só** isto:

- **aditivo e desligado por padrão** — parâmetro novo com default que preserva byte a byte
  o comportamento atual. Se remover o parâmetro muda alguma coisa, não é exceção, é mudança.
- **com teste** que prove os dois caminhos, o velho e o novo.
- **passa por mim antes de virar commit.** O motivo é operacional: `cockpit-api.service`
  serve o painel que os 7 agentes usam.

O que continua proibido sem o Rica: alterar comportamento default, migração de schema, e
reiniciar o `cockpit-api.service` para "ver funcionar". O serviço roda `uvicorn` **sem
`--reload`** — o processo no ar carregou o código de quando subiu e ignora o disco, o que
protege o painel de trabalho em andamento, mas também significa que **testar a mudança
exige um segundo uvicorn em outra porta**, apontando para o mesmo banco. Nunca o de produção.

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

> ⚠️ **As três frentes dividem o MESMO working tree** — não há worktree por frente
> hoje (30/07). Daniel, Hiro e Tara escrevem no mesmo `/home/clawd/repos/grupo_borges`,
> com o mesmo `.git/index`. É o que torna as regras abaixo obrigatórias, não
> recomendadas: sem worktree, o recorte por caminho é a **única** proteção.

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

As frentes paralelas **não sobem um dev cada**. Elas compartilham o 3008, ou
verificam na Oracle. Três devs mais cinco sessões de CC
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

### Exceção aberta pelo Rica em 02/08 — a pasta do agente no cabeçalho

O Rica pediu ao vivo que o cockpit dissesse **em que pasta cada agente está**, para
não ter de perguntar. O gatilho foi a linha `// daniel` sob o nome no modal: ele
achava que ali estava o repositório, e ali estava o slug repetido — o nome completo
já vem na linha de cima.

Ele conhecia a regra do congelamento quando confirmou, e a exceção é deste tamanho:
`agent-modal.tsx:205` (a linha do subtítulo), `lib/cockpit-types.ts`
(`formatWorkspaceShort`) e `globals.css:144` (corte por reticências, porque caminho é
mais longo que apelido). **Exibição pura, nenhum comportamento.**

Duas consequências que quem vier depois precisa saber:

1. `apps/web/lib/cockpit-types.ts` e `packages/cockpit-core/src/cockpit-types.ts`
   eram cópias byte a byte — o relatório de paridade conta com isso. `formatWorkspaceShort`
   entrou **só no `apps/web`** e é a primeira divergência entre as duas. Ela morre junto
   com o v1; não é dívida a pagar no core.
2. O equivalente no v2 **não é o cabeçalho** — ele saiu do chat por ordem do Rica em
   30/07 (`cockpit-v2-estetica.md` §15) e a ordem continua de pé. A pasta entrou na
   TROPA, que é onde ele vê os nove de uma vez. Detalhe na §15.

Segue valendo o resto: `apps/web` não é oportunidade de melhoria. Melhoria só entra
aqui com o Rica pedindo pelo nome, como esta.

---

## Mapa vigente — 30/07 14h, com TRÊS agentes escrevendo no mesmo app ao mesmo tempo

A tabela por frente lá em cima era o **plano** (`components/chat/`, `components/render/`). O
recorte real ficou outro, e como agora há três pessoas com o editor aberto no mesmo `apps/cockpit`
**ao mesmo tempo**, o mapa que vale para consultar antes de tocar em arquivo é este:

| Caminho | Dono agora | O que está sendo feito |
|---|---|---|
| `components/shell/**` | **Daniel** | composer alto, barra de telas, gaveta, ícones, aparência das fases do envio |
| `app/globals.css`, `app/layout.tsx` | **Daniel** | paleta indo para cinza neutro (§13 da estética) + `theme-color` amarrado |
| `components/feed/**` | **Hiro** | feed real **sem** `assistant-ui` — o plano de fuga |
| `app/spike/sem-lib/**`, `docs/cockpit-v2-medicao/**` | **Hiro** | braço de controle e arranjos de medição |
| `lib/envio.ts` | **Tara** | motor da confirmação por eco |
| `apps/api/routers/agents.py`, `db/store.py` | **Tara**, exceção pontual aberta pelo Pavan | campo de fronteira no `POST /input` |
| `components/renderers/**` | **de consumo** | quem achar que precisa mudar, fala com o Pavan antes |
| `app/spike/page.tsx` (**com** a biblioteca) | **ninguém toca** | é a bancada de comparação até o Rica medir no iPhone |
| `apps/web/**` | **ninguém** | congelado |

Três regras que só existem por causa da simultaneidade:

1. **`git add` por caminho explícito, sempre.** Com três working sets vivos na mesma árvore,
   um `git add -A` arrasta trabalho pela metade de outra pessoa para dentro do seu commit.
2. **`components/renderers/**` é de leitura para todos.** São 90 testes escritos por duas
   pessoas diferentes; mudança ali quebra feed e chrome ao mesmo tempo.
3. **Bancada de medição não se desmonta antes do veredito.** O `/spike` com a biblioteca fica
   de pé mesmo depois de o plano de fuga entrar — quem tira a referência antes do número final
   repete o beco onde as duas primeiras tentativas de medir a escala morreram.
