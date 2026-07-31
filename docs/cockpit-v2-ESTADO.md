# ESTADO.md — onde o Cockpit v2 está, e como retomar com contexto zerado

> **Ponto de entrada.** Quem retomar lê este arquivo primeiro e só abre os outros
> conforme precisar. Ele descreve o **presente** — a história de como chegamos aqui
> está no git, não aqui.
>
> Última faxina: **30/07 ~16:45**. Se a data estiver velha e o texto contradizer o
> código, o código ganha.
>
> Ordem de leitura, se precisar de mais: `cockpit-v2-gate.md` (o que decide) →
> `cockpit-v2-ownership.md` (quem mexe onde) → `cockpit-v2-data-contract.md` →
> `cockpit-v2-estetica.md` → `cockpit-v2-stack.md` → `cockpit-v2-fusao.md` (por que
> as decisões são assim).

---

## 1. Em uma frase

A `assistant-ui` **está condenada pela medição** e o feed próprio já existe; a
pergunta viva agora não é mais *qual biblioteca*, é **quanto custa o nosso próprio
render por item** — e ela está sendo medida.

## 2. Escopo — duas fases, decisão do Rica (30/07 16:11)

- **Fase 1 — chat com a tropa.** É o que está em execução. Tudo o que se constrói
  agora pertence a ela.
- **Fase 2 — kanban de tarefas.** **Não existe nesta fase.** Só começa depois de a
  cultura visual do chat estar validada pelo Rica.

A ordem não é cronograma, é dependência: o chat **funda** a gramática visual que o
kanban vai herdar. Pelos números do baseline, 82% do tráfego é `tool_use` e só o Bash
tem 738 chamadas por sessão — a **linha de ferramenta é a tela**, não um detalhe dela.

---

## 3. O que está decidido — não remexer sem fato novo

| Decisão | Onde está escrita | Como foi decidida |
|---|---|---|
| `assistant-ui` **sai** | gate + `RESULTADO-feed-real.md` | remedida nos **três braços na mesma sessão**: 19,33× o controle, escala 2,23×, **um décimo** dos frames e um frame de **56 s** de tela parada |
| G1 é **pareado**, corte absoluto de 32 ms **morreu** | `cockpit-v2-gate.md` §14 | o p95 é quantizado em 16,67 ms e 32 caía no vão entre dois degraus |
| "enviado" só por **observação do eco** | `cockpit-v2-data-contract.md` §3.1 | `tmux_delivered=True` era literal no `agents.py`, emitido antes do Enter |
| `offline` = **sessão tmux ausente** | decisão da Tara, 30/07 | morto e ocioso produziam a mesma linha — foi a cegueira das 6 h de 29→30/07 |
| Sidebar: no desktop a Tropa é **fundo permanente**, o chat **sobrepõe** | decisão da Tara, 30/07 | gaveta fechada por default está errada nesse breakpoint |
| UI definitiva sai em **rodada dedicada**, contexto limpo, skill `frontend-design` | `cockpit-v2-estetica.md` §9.1 | régua é *"vale largar o cockpit antigo?"* |
| **Verificar se o componente já existe** (MCP `shadcn`) antes de desenhar | ordem do Rica, 30/07 | não vale para trocar o que já está aprovado |
| Referência do Codex adotada no **composer e na barra de telas**; paleta **neutra** | `cockpit-v2-estetica.md` §12 e §13 | ordem do Rica; o feed **não** entra — a referência é a tela vazia |
| Diff fica no **LCS**, com guard rail por tamanho | `cockpit-v2-ESTADO` histórico, `diff-viewer.tsx` | corpus real: mediana 18 linhas, p95 70, máximo 90 |
| `apps/web/**` **congelado**; `apps/api/**` fora de escopo, com exceção escrita | `cockpit-v2-ownership.md` | o back não muda de **comportamento** |

## 4. Onde a construção está

**O feed próprio existe** (`apps/cockpit/components/feed/**`) e passou a consumir
renderers reais. Ainda **não está plugado** na rota que o Rica usa, mas o custo dele é
bem menor do que se acreditava até 30/07 ~16h: remedido nos três braços, entrega
**~78% dos frames** do controle — pior em ~1,3× de fluidez, não em 2×.

> ⚠️ **Relatar por `frames`, não por p95.** O p95 é quantizado em degraus de 16,67 ms e
> a mediana de 3 rodadas pula um degrau inteiro sozinha: o **mesmo** feed, sem uma linha
> alterada, deu 100,1 ms numa série e 50,0 ms na seguinte. Foi assim que o "1,67× a 2,0×
> pior" nasceu — ruído reportado como se fosse tendência. `frames` é contínua, não tem
> degrau, e mede o que importa: quanta tela o Rica recebeu.

O custo restante **não é estrutura de virtualização** — a estimativa está em cache por
identidade e o classificador incremental é o mesmo nos dois braços. Sobrou o render por
item, e o alvo é o **`Thinking`**: a carga tem 11.880 caracteres de `text` contra
**503.272 de `thinking`** (`composicao-da-carga-canario.md`). Perfilar o markdown
primeiro seria gastar hora no lugar errado.

**O "enviado" está fechado nas quatro peças**, todas conferidas rodando os testes:
redutor `lib/envio.ts`, fronteira `event_boundary_id` no `POST /input`, hook
`lib/usa-envio.ts` e a **ligação no composer** (`composer.tsx:47,123`).

**Auditoria de tema: limpa.** Um único hex na árvore inteira de `apps/cockpit` — o
`themeColor` do `layout.tsx:13`, que a API Viewport do Next não deixa tokenizar.

**Paridade v1 × v2 provada** (`cockpit-v2-paridade-relatorio.md`): saída idêntica nas
52 famílias e nos 4 transcripts SSE, com o comparador provado por 4 mutantes. Lacunas
que ficam: reconexão real e `sidechain-cluster`.

## 5. Quem está com o quê — mapa vigente

| Agente | Frente **em voo agora** (30/07 ~17h30) | Caminhos |
|---|---|---|
| **Daniel** | **a sidebar**, em rodada dedicada com contexto limpo | `components/shell/**`, `globals.css`, `layout.tsx` |
| **Hiro** | **os 2 renderers P0** + o plano de execução do encanamento | `components/renderers/**` |
| **Tara** | livre — entregou `agent-result` (G7), sem commit, falta revisão cruzada | `components/renderers/agent-result.*` |

**O que foi pedido a cada um, para conferir a entrega contra o pedido:**

- **Daniel — sidebar.** Desktop: a Tropa vira plano de fundo permanente, o chat é a
  superfície elevada que **sobrepõe sem fechar** a sidebar; a coluna estática da raiz
  (`app/page.tsx:72-76`) e o vazio "Escolha um agente" **morrem**; celular continua uma
  superfície por vez. Minerar o **CSS** do `sidebar-08` (inset), **não** o
  `SidebarProvider` — ele colide com superfície-mora-na-URL + shell como Server Component
  (deep-link do Telegram, botão voltar do Android). Entrega vem com prints em 390×844 @3x
  dark, nome novo em `/tmp/cockpit-v2-prints/`. Régua: *"vale largar o cockpit antigo?"*.
- **Hiro — renderers P0.** `fetch-result` (500 eventos) e `result-list`/WebSearch (336),
  arquivo novo por família em `components/renderers/`, **teste contra fixture real**. Mais
  o plano de execução do pré-requisito do `tool_use_result` — plano, não implementação.
  O pipeline **ficou livre** quando a bancada do Daniel fechou; quem executar, executa
  agora sem colidir.

`components/renderers/**` é de **consumo** para todos — quem achar que precisa mudar,
fala com o Pavan antes. Ninguém audita o próprio trabalho.

**Ordem de custo do Rica (30/07):** Tara (Codex) e Hiro (Kimi) rodam fora da cota do
Claude Code e assumem a frente; o Daniel fica na camada visual, que é o que exige o
modelo caro.

## 6. O que só o Rica resolve — e nada disso trava as frentes

1. **A medição no iPhone** — v2 em `:3444`, baseline em `:3443`. Benchmark em notebook
   **não** é aceito como evidência (gate §2): o furo número um do plano era ser desktop
   enquanto o usuário é celular.
2. **O veredito estético da TROPA v2** — prints em `/tmp/cockpit-v2-prints/`.
3. **O conflito 32 px × 44 px** (`cockpit-v2-estetica.md` §11) — densidade contra alvo
   de toque; só resolve com o dedo dele na tela.

## 7. A dívida que a Fase 1 tem de pagar — o "pendurado"

Sintoma visto três vezes em 30/07: texto aparece no input de um agente sem ninguém
ter mandado. A origem é o próprio painel (`POST /api/agents/{slug}/input`, do iPhone e
do notebook do Rica) e a causa é `tmux_driver.py:425` — `send-keys C-u → load-buffer →
paste-buffer → sleep 150 ms → send-keys Enter`. Com o CC ocupado ou com overlay aberto,
**o Enter se perde e o texto fica armado** no input: some da tela do Rica, não chega ao
agente, e o próximo Enter naquela pane submete algo fora de contexto.

Requisito, e é por isso que o §3.1 do data-contract existe: **ou o painel confirma que
entrou, ou não diz que enviou.** Silêncio otimista é o defeito.

## 8. Bancada de medição — como rodar

```bash
cd /home/clawd/repos/grupo_borges/docs/cockpit-v2-medicao
python3 escala_g1_feed.py      # /spike/feed
python3 escala_g1_sem_lib.py   # /spike/sem-lib — SEMPRE na mesma sessão
```

Os dois resetam a carga do canário no mesmo SQLite e **não rodam em paralelo**.

Medição no aparelho do Rica, com carga longa (a sincronia manual não funciona):

```bash
cd /home/clawd/repos/grupo_borges
python3 fixtures/cockpit-v2/gerar-carga.py --reset --fase historico
# Rica abre https://srv1061129.tailfe77db.ts.net:3444/spike e AVISA
python3 fixtures/cockpit-v2/gerar-carga.py --fase preenchimento
python3 fixtures/cockpit-v2/gerar-carga.py --fase medicao --medicao-segundos 300
# Rica: Iniciar · rolar pra cima e ficar · digitar no campo · Copiar ao parar
```

Ao terminar, **desmontar a bancada** (gate §7): o `canario` precisa sair do
`agents.yaml` — ele aparece na lista de agentes do Rica desde 30/07.

## 9. Armadilhas já pagas — não repetir

- **Comparar com número de outro dia inventa veredito.** O piso da máquina subiu ~1,5×
  entre rodadas do **mesmo** código (33,4 → 49,9 ms). O controle roda **sempre na mesma
  sessão**.
- **Zero num gate é "não mediu" até prova em contrário.** Duas rodadas deram verde sem
  medir nada. Conferir `duracao_s`, `mensagens_observadas` e os campos `indisponivel`.
- **Provar que o parâmetro morde antes de medir.** Duas tentativas de variar o histórico
  morreram com os três níveis abrindo na mesma contagem — qualquer p95 dali é inválido.
- **`estimateSize` tem de ser O(1).** Ela é chamada para todo índice ainda não medido a
  cada recálculo; trabalho por item ali reintroduz escala com o histórico, que é
  exatamente o que o G1 mata.
- **A bancada subiu sem instrumento uma vez** — o probe existia, a página tinha os
  `data-attributes`, e nada carregava um no outro. Nenhum teste pega integração ausente.
- **`index.d.ts` de pacote bundlado é uma linha só** — grep nele despeja o arquivo
  inteiro no contexto. Ler o `.d.ts` específico por path.
- **`client/ExternalThread` não é o caminho** — é `Resource` de outro runtime. O spike
  usa `useExternalStoreRuntime` (ver `cockpit-v2-stack.md`).

## 10. Pendências técnicas conhecidas

- **O `tool_use_result` rico já chega ao core e ao tipo React** — resolvido em 30/07:
  `ToolResultLookup` no `packages/cockpit-core` (Hiro, `48de5c8` + `706a04f`) e
  `EntradaDaExecucao` ganhando `rich?: unknown` a partir de `achado?.rich` (Daniel,
  `08ec99f`). **O que falta é só a ramificação:** `corpo-do-item.tsx` ainda não lê
  `rich` pra escolher o renderer (zero ocorrências, conferido 30/07 ~20h30) —
  território do Hiro, próxima peça dele por decisão do próprio Daniel (nota do
  `08ec99f`). Enquanto não fechar, `fetch-result`, `result-list` e `agent-result`
  ficam **órfãos**: construídos, testados contra fixture, sem aparecer na tela real.
- **Lacunas P0 da matriz:** `fetch-result` (500 eventos) e `result-list`/WebSearch (336).
  Inventário completo em `cockpit-v2-medicao/auditoria-tema-30-07.md`.
- **`/destrava` e `/clear` não ganham campo `confirmed`.** Não há sinal observável
  confiável de que o modal fechou — comparar panes gera falso positivo por relógio,
  spinner e output concorrente. Registrado para ninguém tentar de novo achando que é
  fácil: campo novo que também mente é pior que campo ausente.
- **Supervisão** é um cron de 5 min **session-only** — morre com a sessão do Pavan e
  para sem avisar ninguém. Este arquivo é o antídoto.
- **`agent-result` (Tara, G7, 30/07 noite):** 3 arquivos novos em
  `components/renderers/` (normalizador + componente + teste), 3/3 testes novos,
  suíte completa 248/248, `tsc --noEmit` limpo. Ela mesma corrigiu 2 furos num passo
  interno (`--ck-text-tertiary` indevido em corpo 13px; cor de `completed` mapeada
  pro estado errado) — mas o `collab_tool_call` que deveria acionar revisor externo
  voltou com `receiver_thread_ids` vazio, então **nenhuma revisão de Kimi/Hiro
  aconteceu ainda** (`cockpit-v2-ownership.md` §"papéis fixos": revisão de frontend
  é sempre Kimi/Hiro, nunca o próprio autor). Sem commit. Mesmo revisado, só aparece
  na tela depois que a ramificação em `corpo-do-item.tsx` (item acima) escolher
  `AgentResult` pra essa família.
