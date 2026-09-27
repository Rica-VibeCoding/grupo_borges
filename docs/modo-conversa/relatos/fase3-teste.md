# Fase 3 — relato da cadeira de teste

Claude Code (Sonnet 5) · 27/09/2026 · sem commit, sem código de produto editado. Horários em
America/Sao_Paulo (UTC-3), do relógio deste PC.

## Rodada 1 — equipamento e controle positivo

### Equipamento (`docs/modo-conversa/e2e/teste/`, novo — não mexe no E2E da `ui`)
- `equipamento.cjs`: dois motores. Chromium com dedo real por CDP
  (`Input.dispatchTouchEvent`) e `Emulation.setCPUThrottlingRate` 4×; WebKit com toque
  sintético pelos listeners reais. Perfil iPhone 390×844, `isMobile`/`hasTouch`.
- `controle-positivo.cjs`: os dois casos rodados nesta rodada (abaixo).
- Não há Playwright no repo (não é dependência do `apps/cockpit`). Usei o cache do npx
  deste PC — WebKit bate a revisão exata (2359); Chromium usei o binário já baixado
  (`chromium-1217`) via `executablePath`, porque a versão do pacote `playwright` no cache
  pede uma revisão mais nova que não está baixada aqui. Caminhos com default no próprio
  arquivo, ajustáveis por `PLAYWRIGHT_MODULE`/`CHROMIUM_EXECUTABLE`.
- Captura de brilho: screenshot real, decodificado dentro da própria página (`Image` +
  `canvas`, sem lib) — luminância média e amplitude min/max por amostra. Tela preta ou
  vazia = média < 12 (quase preto sólido) ou > 245 (quase branco sólido) com amplitude
  baixa. Não depende de conhecer a implementação da moldura/esfera.

### Controle positivo — chat → voz (o print do Rica: dx −296, mola 11 quadros, rota não trocou em 1,2 s)
- **13:50:33–13:50:39, WebKit:** dx −296 aplicado. Rota trocou em **872 ms**. Conteúdo real
  da voz (não o rosto) em 872 ms. Amostra a cada ~150-250 ms nos 2 s seguintes: nenhuma
  preta/vazia. **Não reproduziu.**
- **13:50:49–13:50:57, Chromium com CPU 4×:** dx −296 aplicado. Rota trocou em **1398 ms** —
  passou o limite de 1200 ms do print. Nenhuma amostra preta/vazia: o rosto fica parado
  cobrindo a tela (x: 0) de 467 ms até 1398 ms — quase 1 s parado —, mas com luminância
  ~25 e amplitude 150-220 (conteúdo real desenhado, não preto sólido nem branco).
  **Reprodução parcial**: bati o número de tempo do print (rota além de 1,2 s), não bati o
  preto — o rosto segura uma tela plausível durante a espera em vez de sumir.
- Sem carga fria de verdade: o dev da 3009 já está aquecido pelos testes da `ui` (mesmo
  processo desde 26/09). Recompilar do zero pediria derrubar o servidor, fora do que
  posso fazer. Fica para quando o Rica ou a coordenação derrubarem por outro motivo.

### Item novo do Daniel (recebido no meio desta rodada): a sequência do Rica
Direita abre a tropa · esquerda fecha · esquerda vai à voz · direita volta ao chat, duas
vezes seguidas.
- **13:50:39–13:50:49, WebKit:** `history.length` foi de **2 para 10** — exatamente 1 entrada
  nova por cada uma das 8 trocas de rota. Camadas iguais no início e no fim (1 rosto, 1
  gaveta, 2 véus, 0 diálogo) — nada dobrado.
- **13:50:57–13:51:09, Chromium:** mesmo resultado — **2 → 10**, camadas iguais.
- **Achado, reproduzido nos dois motores:** todo `ir()` da tropa
  (`superficie-otimista.tsx:153`) e toda troca de rota da conversa (`use-ida.ts:49`) chamam
  `router.push`, nunca `replace`. O gesto empilha tela, sim — 1 entrada de histórico por
  passo, sem falhar nenhuma vez. Não é intermitência de teste.

## Assumi
- **"Esquerda fecha" a tropa** virou toque no véu
  (`a.ck-surge-veu[aria-label="Fechar lista de agentes"]`), porque é o único jeito de
  fechar que existe no código hoje — arrasto sobre o conteúdo com a gaveta aberta é
  bloqueado (confirmado no código e no E2E da `ui`). Se o Rica fechou de outro jeito no
  aparelho, esse passo específico pode não bater com o real; os outros 6 passos da
  sequência (arrasto de verdade) valem do jeito que estão.

## Não fiz
- O resto do checklist do briefing: carga fria de verdade, 5 repetições, arrasto curto x
  passado da metade, rolagem/toque/composer depois do gesto, console e rede. Fica para a
  próxima rodada.
- Veredito final — é só a primeira rodada, por pedido do Daniel.

Rodada 1 concluída, sem veredito ainda.

## Rodada 2 — correções do Daniel e equipamento completo

### Correções aplicadas
- **Critério de tela preta**, corrigido: não precisa ser preto sólido. Rosto provisório
  cobrindo a tela sem conteúdo real por mais de 1,2 s agora conta como falha, mesmo com
  luminância normal (`avaliaTelaPreta` em `equipamento.cjs`). Preto/branco sólido continua
  valendo por si só.
- **"Esquerda fecha" a tropa**, corrigido: é ARRASTO para a esquerda com a tropa aberta —
  **não existe no código ainda**, a `ui` está criando (é o que ela reescreve agora, pelo
  `briefing-pager.md`). O equipamento já simula esse arrasto (não o toque no véu de antes).
  Contra o código de hoje, sem esse gesto, ele não fecha nada — o runner detecta e destrava
  pelo véu só pra não travar o resto da sequência, e marca isso à parte
  (`voltaGestoAindaNaoExiste`), sem contar como o gesto tendo funcionado.

### Equipamento completo (`docs/modo-conversa/e2e/teste/`)
- `bateria.cjs` (novo): os três gestos do briefing — chat⬅️voz, chat➡️tropa, voz➡️chat —,
  cada um com carga fria (1ª repetição, contexto novo) e quente (as 4 seguintes, mesma
  aba), 5 repetições ida-e-volta por padrão (`REPETICOES`). Depois de cada repetição que
  pousa no chat: rolagem vertical, toque e composer (digita e limpa, nada enviado).
  Console (`error`, `pageerror`) e requisições falhadas (`requestfailed`) contados desde a
  abertura da aba.
- `equipamento.cjs` ganhou: `pronto(estado)` por perna do gesto (chat, voz e tropa têm
  contrato de DOM diferente — `main[data-cena]` só existe na voz, então o "chegou" de cada
  um é definido à parte, não um só genérico); `confereRolagemToqueComposer`;
  `ligaThrottle4x`; captura de console/rede em `novoContexto`.
- **Não rodei a bateria cheia** — ordem do Daniel: a `ui` está reescrevendo o gesto de
  fechar a tropa nos mesmos arquivos agora. Só validei sintaxe (`node --check`, os três
  arquivos, ok) e um recorte mínimo (1 gesto, 1 repetição, 1 motor).
- **Esse recorte mínimo pegou o código no meio da reescrita**: o mesmo arrasto chat→voz
  que tinha funcionado na rodada 1 (rota trocou, WebKit) parou de navegar por completo
  (nenhum rosto, `palcoX` parado em 0). Confirmei que é o dev com overlay de erro do
  Next.js no ar agora (`[data-nextjs-dialog-overlay]` presente), não bug do equipamento —
  é exatamente o motivo de esperar o PRONTO-PARA-TESTE antes da bateria cheia.

Equipamento pronto pra rodar. Esperando PRONTO-PARA-TESTE da `ui` (pelo Daniel) pra rodar
a bateria cheia dos três gestos.

## Rodada 3 — PRONTO-PARA-TESTE do pager: bateria cheia

A `ui` avisou direto (27/09): arquitetura nova — chat e voz num pager nativo
(`scroll-snap`), URL por `replaceState` (nunca mais `push`), tropa pelo dedo sem
histórico, o rosto do deslize saiu. Contrato de DOM novo: `[data-painel-ativo]` (pager,
`scrollLeft`), `[data-painel=chat|voz]` (`inert` fora), `main[data-cena]` só dentro da voz.
Isso invalidava os seletores do equipamento das rodadas 1-2 — refeitos antes de rodar
qualquer coisa contra o pager (`equipamento.cjs`, `controle-positivo.cjs`, `bateria.cjs`).

### Controle positivo, de novo — chat → voz e voz → chat
**14:15:52–14:16:28**, WebKit e Chromium (CPU 4×): dois sentidos, os dois motores.
- **Não reproduziu em nenhum dos quatro.** Painel assenta e fica utilizável entre
  **199 ms e 665 ms** — sempre abaixo do limite de 1200 ms do print original. Nenhuma
  amostra preta/vazia (screenshot real, os 2 s inteiros depois de soltar).
- Faz sentido: não tem mais rota pra esperar nem rosto pra ficar preso — os dois painéis
  já estão montados, o gesto é rolagem nativa do navegador. A classe de defeito do print
  (rota que não chega, tela presa no provisório) não existe mais nesse desenho.

### Sequência do Rica, de novo — agora com o fechar por arrasto
**14:16:01–14:16:45**, WebKit e Chromium, duas voltas cada: direita abre a tropa ·
esquerda fecha (arrasto de verdade, criado pela `ui` depois da rodada 1) · esquerda vai
à voz · direita volta ao chat.
- **`history.length` ficou igual do início ao fim nos dois motores (2 → 2).** O achado da
  rodada 1 (2 → 10, um `push` por passo) está corrigido — confirmado, não só relatado.
- Camadas iguais no início e no fim (1 pager, 2 painéis, 1 voz montada, 0 canvas fora da
  tela, 1 gaveta, 2 véus, 0 diálogo). Nada dobrado.
- A tropa abriu e fechou pelo arrasto nas quatro voltas (duas por motor), sem precisar
  tocar no véu nenhuma vez.

### Bateria completa — os três gestos, fria + quente, 5 repetições, depois do gesto, console e rede
**14:17:17–14:20:11**, os dois motores. Chromium com CPU 4×.
- **30 idas-e-voltas** (chat⬅️voz, chat➡️tropa, voz➡️chat · 5 repetições cada · 2 motores):
  **zero falhou.** 1ª repetição de cada gesto é a carga fria (contexto novo), as 4
  seguintes são quentes (mesma aba) — sem diferença de comportamento entre elas.
- Tempos (soltar → utilizável), chat⬅️voz e voz➡️chat: **199-972 ms**, sempre abaixo de
  1200 ms, nos dois motores. Tropa: o flag lógico muda no toque (otimista, antes da mola
  visual terminar) — ver ressalva abaixo.
- **Depois do gesto**, quando pousa no chat: composer digita e recebe toque em 100% das
  vezes (10/10 por motor). Rolagem testada à parte (abaixo) porque o `canarinho` tem chat
  curto, sem o que rolar.
- **Zero erro de console e zero requisição falhada** nas 6 combinações (gesto × motor).

### Verificações à parte
- **Arrasto curto volta com mola, passado da metade vai** — chat⬅️voz e tropa,
  confirmado fora da bateria (ela só mede o gesto completo): arrasto de 60 px fica no
  chat (`rolagem: 0`); arrasto de 250 px vai (`ativo: voz`). Mesmo padrão na tropa: curto
  não abre, cheio abre; curto (com a tropa aberta) não fecha.
- **Rolagem de verdade**, com `/agente/daniel` (chat longo, o `canarinho` não tem o que
  rolar): `scrollAntes: 5553`, `scrollDepois: 200` depois de rolar — funciona, e não
  mexeu no pager nem na tropa (`ativo: chat`, `gavetaAberta: false` depois).

### Ressalva
- **O tempo "0 ms" da tropa não é preciso.** `gavetaAberta` (o estado otimista) muda no
  toque, antes da mola visual terminar — diferente do chat/voz, que só fica "pronto"
  quando o painel realmente assenta. Não é tela preta (a tropa nunca tem tela vazia por
  trás, é uma gaveta sobre o chat), mas o número não mede a suavidade visual da mola —
  só que o arrasto curto/longo comprova acima, visualmente (posição final certa).

### O que não testei (mesmas lacunas da própria `ui`)
- **iPhone de verdade.** Chromium e WebKit de desktop não são Safari nem têm o dedo do
  Rica — nenhum teste automatizado prova o aparelho.
- **"Sair falando"** (parar a voz com o Zé no meio da resposta): manda mensagem ao
  agente, fora do que o briefing libera em sessão viva.
- **Fechar a tropa tocando fora** ainda usa `router.push` e empilha uma entrada — a
  própria `ui` já registrou isso como não feito. Não testei porque a sequência do Rica
  fecha por arrasto, não por toque fora; fica registrado como pendência conhecida, não
  como achado meu.

## Veredito (rodada 3)

**APROVADO** — chat⬅️voz, chat➡️tropa e voz➡️chat, fria e quente, 5 repetições cada, nos
dois motores (Chromium com CPU 4×, WebKit sintético): sem tela preta/vazia, sem salto,
sem histórico empilhado, sem erro de console nem requisição falhada, rolagem/toque/
composer funcionam depois do gesto. Fica de fora do que este teste prova: o aparelho de
verdade (iPhone) e "sair falando" — únicas duas lacunas, e as duas já eram sabidas.

FIM-DO-TESTE

## Rodada 4 — reteste depois do FIM-DO-MENU

A `ui` mexeu de novo (27/09, aprovado pelo Daniel): tocar fora da tropa e o botão de três
linhas (`≡`) agora usam `replace` em vez de `push` — não empilham mais. Consequência
assumida: o voltar do navegador não fecha mais só a tropa, sai da tela (pedido do Rica).
Ela avisou `FIM-DO-MENU` às 15:52; o Daniel liberou o reteste.

**16:51:29–16:52:26**, WebKit e Chromium — a sequência do Rica de novo (regressão) mais
os três casos novos:

- **Sequência do Rica (regressão):** `history.length` 2 → 2 nos dois motores, tropa abre e
  fecha pelo arrasto normalmente. Nada quebrou com a mudança do menu.
- **Tocar fora fecha sem empilhar:** abre pelo gesto, fecha tocando fora do `aside`, duas
  vezes. `history.length` ficou em **2 → 2** nos dois motores, fecha e fica no chat, nas
  quatro voltas (duas por motor).
- **O `≡` abre sem empilhar:** toque no botão de três linhas abre a tropa
  (`?nav=aberto`). `history.length` **2 → 2** nos dois motores, nas quatro voltas.
- **Voltar do navegador sai da tela:** duas páginas de verdade no histórico
  (`/agente/daniel` → `/agente/canarinho`), tropa aberta em canarinho pelo gesto, voltar
  do navegador. Foi para **`/agente/daniel`** nos dois motores — saiu da tela, não ficou
  em canarinho só com a tropa fechada. Bate com o que a `ui` assumiu.
- **8/8 checagens passaram**, nos dois motores, sem exceção nem erro.

### O que não testei nesta rodada
- Console e requisições falhadas não foram re-observados aqui (já cobertos, sem erro, na
  bateria da rodada 3; esta rodada é focada nos três casos novos + regressão).
- iPhone de verdade — mesma lacuna de sempre.

## Veredito (reteste)

**APROVADO** — sequência do Rica sem regressão, tocar fora e o `≡` não empilham mais
histórico (2 → 2 em todas as voltas, nos dois motores), e o voltar do navegador sai da
tela em vez de só fechar a tropa, como o Rica pediu.

FIM-DO-RETESTE
