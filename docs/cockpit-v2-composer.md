# O composer do Cockpit V2 — documento único

> Escrito em 15/08/2026 a pedido do Rica, no fim de um dia de sete publicações:
> *"quero que você e o Pavan façam um documento único do composer dentro do
> Cockpit V2. Escrito o que deu certo, o que não deu certo, o que funcionou.
> Temos que documentar tudo referente ao composer. Um guia do que vamos ter que
> ir fazendo e melhorando, onde pesquisar, o que deu pra fazer hoje, o que vai
> ter que ficar pra depois. A gente ir eliminando na medida que vai testando."*
>
> Este arquivo substitui `cockpit-v2-composer-contrato.md` (contrato funcional) e
> absorve `cockpit-v2-composer.md` (geometria). É **doc vivo**: a fila da §2 se
> risca conforme o Rica testa e aprova — nada sai daqui por ter sido codado, só
> por ter sido testado por ele.
>
> Antes de tocar em `components/shell/composer.tsx`,
> `app/agente/[slug]/palco-da-conversa.tsx` ou em qualquer coisa que decida
> altura, respiro ou posição da caixa de entrada: ler a §5.

---

## 1. Onde estamos

**Veredito do Rica em 15/08, depois de testar:** *"parece que melhorou, mas está
longe do ideal"* · sobre o anexo, *"já não existe um padrão"* · sobre a foto
vinda do Telegram, *"ruim também, para um Opus 5"*.

Ou seja: os três defeitos que ele reportou de manhã caíram e ele confirmou a
melhora, mas ele achou **quatro defeitos novos** que ninguém tinha visto, todos
em caminhos que a bateria automatizada não cobria — anexo, canal cruzado e
recuperação depois do botão parar.

### O que ficou provado funcionando (número medido, não impressão)

| O que | Antes | Depois |
|---|---|---|
| Tela muda depois do Enter (Claude Code, agente ocioso) | 18,8 s de tela muda | 0,0 s |
| Botão parar aparece quando o agente gera | nunca em 100 s | 1,54 s |
| Alarme "não consegui confirmar se entrou" | disparava em **todo** envio a agente ocioso | não dispara |
| Repouso nos dois motores | `■` pendurado, comendo o lugar do microfone | microfone |
| Bateria de ponta a ponta, Claude Code | — | **30/30** |
| Bateria de ponta a ponta, Codex | — | **25/30** (5 falhas, causa única: item 34) |

Publicado em 15/08: `0b62a75`, `dfddaaa`, `59348cb`, `ce37d05`, `ce5d39f`,
`70f9256` (Pavan) · `363d48f` alvo de toque de 44px, `1e7b43e` atalho vence
espalhamento, `7fe89d0` (Daniel). Commitado e **não** publicado: `fe1ebc6`
(tabela `delivery_attempts`).

### O que não deu certo

O caro do dia não foi o produto — foi o instrumento. **Sete vezes** em 15/08 a
medição (ou o ambiente dela) acusou o composer por defeito que não existia.
Todas com a mesma assinatura: filtro largo demais, falha silenciosa, resultado
plausível. A §7 lista uma por uma; é a seção que mais protege quem chegar depois.

---

## 2. A fila — o que falta, em ordem

Risca-se com `[x]` **quando o Rica testar e aprovar**, não quando o commit subir.

### Achados dele em 15/08 — não reproduzidos por bancada nenhuma

- [ ] **F1 · O composer fica preso em vermelho depois de uma recusa.** Palavras
      dele: *"mandei a mensagem, dei parar. Quando fui mandar outra, o composer já
      ficou vermelho e não foi. Tive que destravar ele no painel."* São **dois**
      defeitos colados, e separá-los é o que evita consertar metade:
      **(a)** a recusa que aconteceu — item F2 abaixo; **(b)** a máquina de seis
      fases não sabe voltar de `falhou` sem gesto externo. O (b) é o que dói: ele
      bate de novo no próximo 409 de qualquer origem. **Dono: Pavan.**
- [ ] **F2 · `409 agent_pane_unavailable` logo depois do parar, no motor Claude
      Code.** Sequência no `/tmp/cockpit-api.log`: `input 200` ×3 → `interromper
      200` → **`input 409`** → `interromper 200` → `input 200`. ⚠️ **Não
      reproduzido**: o caminho simples por `curl` (input → interromper → input
      imediato) devolve 200. A condição é mais estreita que "mandar logo depois
      do Escape" e **a causa ainda não é conhecida** — não tratar como fechado.
      **Dono: Daniel.**
- [ ] **F3 · O anexo renderiza diferente em cada motor.** Na Tara: uma bolha só,
      foto em cima e legenda embaixo, dentro da mesma caixa — *"a forma como
      renderiza na Tara foi aprovada"*. No Canário: a legenda vira bolha à
      direita e a foto cai embaixo, solta, sem caixa e sem alinhamento. Causa
      levantada: o envelope do Claude Code chega **picado em duas mensagens**
      (`[Image #N]Caption:` numa, `[Image: source:]` noutra) e vira dois itens no
      feed; a Tara vem inteira numa mensagem só, com data-URL.
      **Alvo: a renderização da Tara, que é a aprovada. Dono: Daniel.**
- [ ] **F4 · Foto que chega pelo Telegram aparece como a palavra `(photo)`.** No
      chat do Daniel, mensagem do Rica com texto + foto virou duas bolhas de
      canal: uma com o texto, outra com o literal `(photo)`. Nenhuma imagem.
      **Dono: Daniel.**

### Herdados, com desenho pronto

- [ ] **F5 · A fila não atravessa canais** (item 34 do contrato). `409
      shared_turn_in_flight` no Codex — a fila do composer só conhece o envio em
      voo daquela aba, e a conversa da Tara é compartilhada com o Telegram.
      Explica as 5 falhas do Codex na bateria. Desenho na §4, item 34.
      **Dono: Pavan.** Fica atrás de F1: é o mesmo `catch`.
- [ ] **F6 · Microfone desabilitado durante envio em voo** (item 32). Precisa de
      rodada própria — soltar o microfone dispara `enviarVoz` na **mesma** máquina
      de seis fases já ocupada.
- [ ] **F7 · Bolha otimista da voz só existe no Codex** (item 33). Depende de F6.
- [ ] **F8 · `derive_agent_status` reporta `trabalhando` para agente sem
      processo.** Raiz do defeito do `■`, tratada na tela por guarda. Mexe no que
      a lista inteira da frota pinta — rodada própria. **Dono: a decidir.**

### Dívida estrutural

- [ ] **F9 · `composer.tsx` tem ~1060 linhas**, mais de três vezes o teto de 300
      do `CLAUDE.md`. A ordem de fatiar está na §5 — da menor para a maior chance
      de estragar. Não é urgente; é o que torna tudo acima mais barato.

---

## 3. Como esta lista se prova

```bash
python3 docs/cockpit-v2-medicao/bateria-do-composer.py
python3 docs/cockpit-v2-medicao/tela-muda-depois-do-enter.py canarinho:cc tara:codex
python3 docs/cockpit-v2-medicao/freio-no-repouso-e-gerando.py
```

A bateria roda a tela de verdade na `:3008`, em viewport de iPhone, **nos dois
motores**, e cada caso vai até o fim do caminho: a mensagem sai, chega no agente,
ele responde, a resposta volta. "O campo esvaziou, logo funcionou" não conta como
prova — foi exatamente assim que 18,8 segundos de tela muda passaram meses
despercebidos.

A segunda bancada existe porque **um requisito sem número não é requisito**: ela
cronometra o intervalo entre o Enter e a bolha aparecer, com o agente ocioso e
com o agente ocupado.

**O que a bancada não cobre, e o Rica cobriu em cinco minutos:** anexo, canal
cruzado (Telegram → cockpit) e recuperação depois do parar. Os quatro achados da
§2 saíram todos dessa lacuna. Enquanto ela existir, teste automatizado verde não
autoriza dizer "pronto".

---

## 4. O contrato — o que o composer tem de entregar

> Lista escrita com as palavras do Rica: *"eu faria uma lista de tudo que um
> composer tem que entregar em 8/2026, zeraria essa lista, testaria de ponta a
> ponta e me chamaria"*.

### Entrada de texto

1. A caixa cresce com o conteúdo e encolhe ao apagar.
2. A caixa tem teto e rola por dentro — texto longo não empurra a tela.
3. Fonte de 16px ou mais. Abaixo disso o Safari do iPhone dá zoom no foco e
   desloca tudo.
4. Aceita colar texto muito longo sem perder caractere.
5. Aceita acento, emoji e caractere especial sem escapar nada pelo caminho.

### Acentuação (o que quebra em português e não em inglês)

6. Enter no meio de uma composição de acento **não envia**. Segurar a tecla no
   teclado do iPhone para escolher "ã"/"ç" abre uma sessão de composição, e o
   Enter que confirma a escolha chegava como Enter comum: "não" e "ação"
   mandavam a mensagem pela metade.
7. A guarda cobre as **duas bordas** do IME. `isComposing` vale `false` no
   primeiro e no último caractere da composição (MDN); o `keyCode === 229` é o
   que fecha o buraco, e é normativo no W3C UI Events §7.2.1.

### Envio

8. O campo esvazia no aceite, não no retorno da rede — senão um segundo Enter
   durante a viagem duplica a mensagem.
9. **Nada evapora.** Recusa devolve o texto e diz o motivo; nenhum caminho
   descarta o que a pessoa escreveu.
10. Toda recusa com gesto na mão tem recado. Borda vermelha sem palavra é a
    queixa literal do Rica: *"desloca, fica vermelho, mas não fala o que
    acontece, nunca vi isso em nenhum chat"*.
11. **A mensagem vira bolha na tela em até 2 segundos.** Estava reprovado e
    ninguém tinha medido — 18,8 s. Hoje 0,0 s.
12. A mensagem chega no agente de verdade, e a resposta dele volta para a tela.

### Mandar enquanto ele ainda responde (double-texting)

13. Escrever durante o turno anterior **não é bloqueado**. A mensagem entra na
    fila e sai sozinha quando liberar — é a estratégia `enqueue` do LangGraph
    ("allows the current run to finish before processing any new input").
14. O que está na fila aparece à vista, com o texto inteiro, e dá para trazer de
    volta ao campo — cancelar e editar são o mesmo gesto.
15. A fila drena sozinha, sem segundo toque.

### Parar

16. Existe um botão de parar enquanto o agente gera, nos dois motores. Parar é
    recurso de primeira classe — o ChatGPT documenta até atalho dedicado
    (`Command + .`).
17. Ele **aparece no tempo do turno**, não no tempo do painel.
18. Ele **some no toque**, não quando o servidor concorda.
19. Ele **não cobre o envio**: com texto escrito, o alvo é mandar. Copiar a troca
    seta→quadrado ao pé da letra criou um beco no celular — sem gesto nenhum para
    despachar, porque o Enter do teclado virtual quebra linha e não há Shift.
20. O campo continua editável durante a geração.

### Anexo

21. O `+` existe, abre a gaveta e a foto escolhida vira miniatura.
22. Dá para remover a foto antes de enviar.
23. O `+` continua clicável **enquanto a anterior processa** — escolher arquivo é
    gesto local, nada sobe até o envio.
24. Colar imagem do clipboard anexa a foto.
25. Um gesto, uma entrega: o arquivo sobe com o texto como legenda, no mesmo
    multipart.

### Celular

26. Com o teclado de pé, o composer continua na tela e a última mensagem não
    morre atrás dele.
27. Nenhum aviso que exija leitura mora **abaixo** do composer: ali o teclado o
    esconde, e o Rica lê como "engoliu a mensagem".
28. Alvo de toque de 44px nos controles da base.
29. O rascunho não enviado sobrevive ao reload — puxar a tela para recarregar é
    gesto acidental no iPhone.

### Voz

30. Segurar para falar, com trava para gravação longa.
31. A transcrição volta para a tela antes de virar mensagem — STT erra, e
    descobrir isso pela resposta errada do agente três minutos depois é caro.
32. **Pendente (F6).** O microfone fica desabilitado enquanto o envio anterior
    está em trânsito. É parente do defeito do `+` do item 23 — gravar é gesto
    local — e no Codex esse trânsito chega a minutos, o que dói mais aqui do que
    ali, porque o Rica fala muito mais do que digita.

    Não foi consertado junto com o `+`, e o motivo é diferença de risco, não
    esquecimento: escolher arquivo não toca a máquina de envio, enquanto soltar o
    microfone dispara `enviarVoz` na **mesma** máquina de seis fases que já está
    ocupada com o envio anterior. Habilitar sem antes decidir o que acontece com
    duas entregas concorrentes trocaria um botão morto por um estado ambíguo.

33. **Pendente (F7).** A bolha otimista da voz só é registrada para o Codex
    (`composer.tsx`, dentro de `subirAudio`), mesmo depois de o texto passar a
    registrá-la nos dois motores.

### Fila que atravessa canais

34. **Reprovado (F5).** A fila do composer só conhece o envio em voo **daquela
    aba**. A conversa da Tara é compartilhada com o Telegram: turno aberto por
    outro canal, por outra aba, ou por um envio que a aba recém-carregada não viu
    passa direto pela porta, e o backend recusa com `409 shared_turn_in_flight`
    (`apps/api/routers/agents.py`, `send_agent_input`). A tela então vai para
    `falhou` e oferece "Tentar de novo".

    É o cenário comum do Rica: falar com a Tara pelo Telegram e depois abrir o
    cockpit. A mensagem não se perde — mas ela **deveria entrar na fila**, que já
    existe e já drena sozinha, em vez de virar erro que pede gesto novo.
    Desenho proposto: o `catch` de `usa-envio.ts` distinguir o 409 de turno
    concorrente dos demais erros HTTP e devolver isso ao composer, que reenfileira
    em vez de publicar `falhar`. Medido: 2 ocorrências na bateria de 15/08, ambas
    com o teste já isolando as categorias — não é artefato de instrumento.

### Acessibilidade

35. Botão de enviar com nome acessível.
36. Existe região viva anunciando mudança de estado.
37. Alvo de toque conforme WCAG 2.2 §2.5.8.
38. **Agente offline não oferece freio.** O `■` lia só `lifecycle_status`, que é
    histórico de evento e não expira quando o agente morre sem despedida: cinco
    dos nove da frota apareciam como `trabalhando` sem processo nenhum, e o toque
    devolvia `200` com `parado: false` calado. A guarda é o `status` do mesmo
    payload, que cruza sessão e processo.

### Acrescentados pelo teste do Rica em 15/08

39. **O composer se recupera sozinho de uma recusa.** Vermelho é aviso, não
    estado terminal: a próxima tentativa não pode exigir gesto no painel (F1).
40. **O anexo renderiza igual nos dois motores**, no formato da Tara: uma bolha,
    foto em cima, legenda embaixo (F3).
41. **Foto que entra por outro canal aparece como imagem no feed**, não como a
    palavra `(photo)` (F4).
42. **Parar não inutiliza o canal de entrega** para a mensagem seguinte (F2).

---

## 5. A peça — quem manda em quê

> Da saga de sete rodadas para acertar onde o composer para na tela. A história
> completa está em `cockpit-v2-viewport-iphone.md`; aqui está o que ela ensinou.

### O composer é quatro peças, não uma

Quem entra por `composer.tsx` achando que ele se posiciona sozinho quebra o
aparelho do Rica.

| Peça | Arquivo | Responsabilidade |
|---|---|---|
| A janela | `components/shell/app-shell.tsx` + `.ck-janela` no `globals.css` | Altura da app inteira. Repouso é CSS; teclado é a variável do JS |
| A medida | `components/shell/sincroniza-altura-do-viewport.tsx` + `altura-do-viewport.ts` | Publica `--ck-viewport-altura` **só com o campo focado**, e zera o `--ck-safe-bottom` enquanto o teclado está em cena |
| O palco | `app/agente/[slug]/palco-da-conversa.tsx` | Sobrepõe o composer ao feed, paga o respiro de baixo e publica `--ck-composer-altura` para o feed não morrer atrás da caixa |
| O desenho | `components/shell/composer.tsx` | A caixa, os controles, as faixas de aviso. **Não mede nada e não se posiciona** |

Duas variáveis amarram tudo, e elas correm em sentidos opostos:

- **`--ck-viewport-altura`** desce do `<html>` e diz até onde a app vai. Some
  em repouso de propósito — quem manda ali é o `100lvh` do CSS.
- **`--ck-composer-altura`** sobe do palco para o feed, medida por
  `ResizeObserver`, e diz quanto respiro o feed precisa embaixo. Mora no palco
  e não no `:root` porque duas rotas abertas em tela dividida teriam alturas
  diferentes.

### A aritmética do fundo (a parte que ninguém adivinha)

Abaixo da caixa visual existem **quatro** termos somados, e olhar um de cada
vez leva ao conserto errado:

```
    4px   gap da coluna do composer
 + 17px   reservador da linha de status (div aria-hidden de altura fixa)
 +  Npx   padding-bottom do wrapper no palco
 + 34px   safe-area-inset-bottom — a barra de gestos do iPhone
```

A régua veio do Rica em 13/08, com print lado a lado: **o app do Claude deixa
34pt** abaixo da caixa, ou seja a barra de gestos e nada mais. Por isso o padding
do palco hoje soma só o que *falta* para a barra (`max(space-2, safe-bottom −
21px)`), e por isso o `--ck-safe-bottom` vai a zero com o teclado aberto — o
teclado cobre a barra de gestos, e reservar espaço para ela ali é folga morta.

**O reservador de 17px não é gordura.** Ele segura o lugar da linha de status
antes de ela existir; sem ele o composer pula quando o fio de estado aparece.
Quem quiser recuperar aqueles pixels tem que resolver o pulo primeiro.

### As seis leis

1. **Altura da app não se resolve no composer.** Se o sintoma é "o composer está
   alto/baixo/atrás do teclado", o arquivo é `sincroniza-altura-do-viewport.tsx`
   ou o `.ck-janela` — nunca um padding no `composer.tsx`.
2. **Número do sistema se verifica antes de copiar.** `window.innerHeight` e
   `100dvh` atrasam nas duas direções no WebKit em `standalone`; `100lvh` e o
   par `visualViewport.height + offsetTop` não. Três rodadas foram gastas
   copiando a mentira mais depressa.
3. **Espaço embaixo se conta inteiro.** São os quatro termos acima. Ajustar um
   sem somar os outros dá 67px onde a régua pede 34.
4. **Bancada que não encena o aparelho mente.** No Chromium
   `env(safe-area-inset-bottom)` é 0, `dvh` e `lvh` valem o mesmo, e não existe
   teclado. Toda medição de folga ou de altura precisa injetar os números do
   iPhone antes de medir.
5. **Os dois regimes no mesmo teste.** Consertar o repouso armou o teclado na
   rodada 5, e o contrário quase aconteceu na 7. Repouso e teclado se validam
   juntos, sempre.
6. **A régua do aparelho é a `/diagnostico`.** Em repouso ela tem que dizer
   `--ck-viewport-altura (não publicada)`; o min/max de cada métrica conta a
   história da sessão inteira e já resolveu duas rodadas sozinho.

### A lógica já está fatiada — o que sobrou é o desenho

`composer.tsx` tem ~1060 linhas. Antes de propor quebrar, entenda o que **já**
saiu dele: a lógica pura mora fora e é testada em `node --test` (262 testes na
`components/shell/`).

| Módulo | O que carrega |
|---|---|
| `aparencia-envio.ts` | as seis fases do envio → frase, cor, ações |
| `porta-de-envio.ts` | o que pode sair, o que é recusado e por quê |
| `fila-de-envio.ts` | a espera entre mensagens |
| `voz.ts` · `usa-gravador.ts` | fases do microfone, diagnóstico de impedimento |
| `motor.ts` · `seletor-motor*.tsx` | modelo/esforço e o que o servidor autoriza |
| `gaveta-anexo.tsx` · `usa-anexo.ts` | anexo, do botão ao envio |
| `barra-compact.tsx` · `bloco-da-fila.tsx` | as duas faixas acima da caixa |
| `lib/codex/eco-pendente.ts` | a bolha otimista e o teto de pendência por motor |
| `lib/textos-do-usuario.ts` | o que encerra a pendência otimista (inclui `queued`) |
| `lib/turno-vivo.ts` | o `isRunning` do stream chegando ao botão de parar |

O que restou no arquivo é **JSX e fiação**: 7 estados, 5 efeitos e a árvore.

### Se for fatiar, esta é a ordem

Da menor para a maior chance de estragar:

1. **As faixas de aviso abaixo da caixa** (anexo, recusa da porta, microfone,
   voz, transcrito, estado+ações — hoje o último terço do arquivo). São função
   pura do estado que já existe; saem como `avisos-do-composer.tsx` recebendo
   props. **O reservador de 17px vai junto com elas** — ele é o `else` desse
   bloco, e separá-los é como o pulo volta.
2. **A caixa** (textarea + a barra de controles por dentro). Sai como
   `caixa-do-composer.tsx`, levando o `ck-caixa`, o rodapé de vidro e o
   invólucro da âncora **inteiro** — a gaveta do anexo mede o `bottom: 100%`
   desse invólucro, então quebrá-lo descola a gaveta do botão "+".
3. **A fiação** (estados, efeitos, handlers) para um `usa-composer.ts`. Por
   último e só com necessidade real: é onde moram o eco pendente, a fila e o
   canal de entrega, e nenhum deles tem teste de integração.

O que **não** se mexe sem ler o porquê no próprio arquivo: a ordem dos elementos
na coluna, o invólucro da âncora, o reservador, e o `position: absolute` do palco
(não é `sticky` nem `fixed`, e os dois têm motivo escrito).

### O ritual de prova antes de publicar geometria

```bash
python3 docs/cockpit-v2-medicao/folga-embaixo-do-composer.py 3008
python3 docs/cockpit-v2-medicao/altura-com-teclado-de-pe.py 3008
python3 docs/cockpit-v2-medicao/altura-com-a-janela-encolhida.py 3008
python3 docs/cockpit-v2-medicao/altura-que-cresce-sem-evento.py 3008
python3 docs/cockpit-v2-medicao/altura-no-aplicativo-instalado.py 3008

cd apps/cockpit && node --test "components/shell/*.test.ts" && pnpm exec tsc --noEmit
```

Cada bancada cobre um modo de falhar que já aconteceu de verdade — nenhuma delas
é hipótese. Se for mexer em espaço, a de folga é obrigatória; se for mexer em
altura, as quatro de altura.

Depois: **publicar é parte da tarefa** (regra 6 do `CLAUDE.md` do app), e a
validação final é o Rica no aparelho.

---

## 6. Anexo de imagem

A imagem entra por três portas e, até 15/08, cada porta desenhava de um jeito.
O Rica testou as três em cinco minutos e resumiu: *"já não existe um padrão, a
forma com renderiza na tara, com a mansagem em baixo foi aprovada"*. O alvo,
daqui pra frente, é o cartão da Tara — **foto em cima, o que ele escreveu
embaixo, uma caixa só**. Não é um quarto desenho conciliando os três.

### Como o envelope chega, por porta

**Upload pelo cockpit, motor Codex (Tara).** `POST /file` grava em
`uploads/agents/<slug>/` e o turno nasce com `image_path`; o adaptador
(`lib/codex/adapta-mensagens.ts`) embute a foto como data-URL na própria
mensagem. Chega **inteira, numa mensagem só** — daí o cartão único. É a porta
que funciona, e funciona por acidente de formato, não por desenho compartilhado.

**Upload pelo cockpit, motor Claude Code (Canário, Daniel…).** O mesmo `POST
/file` grava o arquivo, mas quem anexa a imagem é o CC, e ele **pica o envelope
em duas mensagens**: a primeira perde a linha que cita a imagem e ganha o
prefixo `[Image #N]` (às vezes sobra só `[Image #N]Caption: …`); a segunda é uma
linha só, `[Image: source: /caminho]`. Duas mensagens no JSONL viravam dois
itens no feed: balão de texto à direita e foto solta embaixo, sem caixa e sem
alinhamento. **Pôr o nome do arquivo no cabeçalho não resolve** — já foi
tentado, o CC come a linha do cabeçalho junto por citar a imagem.

**Foto vinda de canal (Telegram/WhatsApp).** Não passa por `uploads/`: o plugin
grava no inbox do canal e injeta `<channel … image_path="…">` com o corpo
`(photo)`. O feed do v2 desenhava o corpo — a palavra literal `(photo)` — e a
imagem não aparecia em lugar nenhum.

### O que foi consertado (`4320e03`)

- **F3.** `juntaMetadesDoAnexo` remonta as duas metades no envelope canônico
  antes de desenhar, e o pipeline incremental costura o par. O ramo do CC passa
  a produzir o mesmo cartão da Tara.
- **F4.** `leEnvelopeDeCanal` lê `image_path` (Telegram) e `attachment_path`
  (WhatsApp); a URL sai por `GET /api/agents/{slug}/channel-attachment`. Essa
  rota **já existia na API desde o v1** — o comentário do `envelope-de-canal.ts`
  afirmava que o v2 não tinha rota de anexo e por isso não desenhava mídia.
  Afirmação errada, sustentada por meses; só faltava o front chamar.
- O cartão ganhou linha de procedência, para a foto de canal usar o **mesmo**
  desenho em vez de inaugurar um quarto.

**Armadilha que o teste pegou e nenhuma bancada pegaria.** A junção funcionava
no primeiro desenho e se desfazia depois: em qualquer `update` que não traz
mensagem nova, a fronteira do incremental vira `previous.length - 1` — exatamente
o meio de um par no fim da conversa —, a cauda enxerga só o caminho e a legenda
some. Na tela isso apareceria como *"a legenda sumiu sozinha"*, minutos depois,
sem ninguém tocar em nada. Quem pegou foi o oráculo de paridade por prefixo, não
o Playwright. Daí o `rewindAtravesDoAnexoPicado`.

### Aberto — com decisão já tomada, faltando execução

**O `accept` do seletor está errado e é bug vivo, não hipótese.**
`apps/cockpit/lib/anexo.ts:118` usa `image: 'image/*'`. A regra do WebKit (bug
212489) só transcodifica HEIC quando o `accept` traz **um MIME concreto que o
CoreGraphics saiba escrever** — `image/*` não é concreto e não dispara nada. No
Mac, foto HEIC continua HEIC. E `image/heic` no `accept` faz o Safari 17+ agir ao
contrário, devolvendo `.heic` para um JPEG de verdade (Apple 743049): **nunca
pôr**.

O lado do servidor **já está pronto**: `pillow-heif` 1.5.0 instalado no `.venv`,
`_IMAGE_HEIF_MIMES` aceito pela `/file` e convertido na gravação, no mesmo ponto
onde a orientação EXIF já é normalizada. Quem chega em HEIC hoje **entra**.

Por isso a troca do `accept` não é a linha óbvia que parece: restringir para
`image/jpeg,image/png,image/webp` faria o Safari converter no Mac, mas pode
**apagar o `.heic` da lista** ao escolher pelo app Arquivos — e aí ele deixa de
conseguir anexar o que hoje anexa. É uma troca que se mede no aparelho dele,
com o Rica escolhendo uma foto do iCloud, não se decide no papel.

**O resto do plano** (miniatura no composer, colar e arrastar, medidas das
capturas de referência, as fontes de cada decisão) segue em
`anexo-imagem-composer-PLANO.md`, com as etapas e a régua de pronto.

---

## 7. O que já custou caro (para não repetir)

**Premissa escrita como fato.** Estava em dois arquivos que *"no Claude Code o
eco volta pelo stream em milissegundos"*. Nunca foi medido. São **18,9 s**. Essa
frase sozinha custou: a bolha otimista não ligada neste ramo, um prazo de alarme
calibrado errado, e três sintomas que o Rica reportou como um só.

**Número calibrado sobre a amostra errada.** `PRAZO_ECO_MS = 12_000` saiu de uma
amostra local de 30/07 com pior caso de 1,434 s. No caminho real o eco leva
18,9 s — o prazo estourava antes da confirmação e **toda** mensagem para agente
ocioso terminava dizendo "não consegui confirmar se entrou". Falso, e é o que
pausava a fila e pendurava a mensagem seguinte em vermelho. Hoje o teto é por
motor: 45 s no Claude Code (2,4× o eco real medido), 180 s no Codex.

**Sinal de painel usado como sinal de turno.** O `■` nasceu lendo
`lifecycle_status`, alimentado por hook e por vigia de JSONL, que chega no tempo
do painel. Medido: **o botão não apareceu na tela em 100 segundos**, enquanto o
"Pensando há 2 s" — que lê outra fonte, na mesma tela — afirmava o contrário.

**A guarda certa levou três rodadas, e cada queda tinha causa que a anterior não
enxergava.** `lifecycle_status` sozinho não acendia; com guarda de `offline`
pegou os agentes mortos mas não os **vivos e ociosos** com `lifecycle` preso; e
publicar o `isRunning` cru deu `Pensando=False` com `■=True` na mesma tela,
porque a linha viva consome esse booleano com duas travas a mais (`vencida` e o
corte da frota) que eu não tinha aplicado.

**Medidor com `except` largo mente calado, e mentiu aqui.** A primeira apuração
daquele caso concluiu que o `lifecycle_status` não acendia; a função que "provou"
isso lia `/api/fleet` como lista quando a rota devolve `{agents: [...]}`, e o
`except Exception` devolvia `null` em toda amostra. Com o parser certo o campo
acende. O defeito na tela era o mesmo; a causa que se escreveu primeiro, não.
Prova negativa exige olhar o instrumento antes da conclusão.

**Teste que não isola acusa o produto por concorrência que ele mesmo criou.**
Três vezes num dia: o `■` do Codex, o B2 da régua do Daniel, e as categorias da
bateria mandando mensagem em sequência sem esperar o agente sossegar — que
rendeu um `input_nao_observavel` e um `shared_turn_in_flight`, os dois lidos como
falha do composer. Categoria que envia espera o agente ficar ocioso antes de
medir.

**Duas armadilhas de bancada mobile.** As duas produziram números plausíveis, que
é o que as torna caras:

- **Apertar Enter não envia em viewport mobile.** Com `pointer: coarse` o Enter
  quebra linha por desenho (`usaTecladoTouch`). Duas rodadas deram "■ nunca em
  60 s" sem que um único POST tivesse saído do browser. Em bancada mobile,
  **clicar o botão**, nunca apertar Enter.
- **Localizador largo pega o elemento errado.** Procurar o texto da mensagem em
  qualquer elemento-folha casa com o conteúdo de dentro do próprio `textarea` —
  virou "bolha em 0,06 s" de uma bolha que não existia. Mesmo erro de contar
  `img` na página inteira em vez de dentro de `.ck-miniatura`.

**Pane sujo reprova conserto bom.** A prova do freio deu "■ nunca em 60 s" numa
rodada e passou na seguinte, sem mudança de código: o pane do agente tinha texto
**armado** de um envio anterior, e o driver recusa colar em campo ocupado. Antes
de acusar a mudança, olhar o estado do alvo.

**Pesquisa que não vira régua de teste não protege ninguém.**
`docs/chat-patterns-research.md` já listava a atualização otimista como TOP 1,
com a frase exata do conserto: *"input limpa na hora, bubble aparece na hora"*,
complexidade baixa, ROI alto. Foi feita e ficou na gaveta.

**Bancada verde não é aprovação.** Claude Code 30/30 e o Rica achou quatro
defeitos em cinco minutos. O que a bancada não encena, ela não reprova.

---

## 8. Onde pesquisar

- Padrões de chat, com a atualização otimista em primeiro lugar —
  `docs/chat-patterns-research.md` §2, e `useOptimistic` do React 19
- Double-texting e a estratégia `enqueue` —
  [docs.langchain.com/langgraph-platform/double-texting](https://docs.langchain.com/langgraph-platform/double-texting)
- Limites de tempo de resposta (0,1 s · 1 s · 10 s) —
  [nngroup.com/articles/response-times-3-important-limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- Parar geração como recurso de primeira classe —
  [help.openai.com/en/articles/9703738](https://help.openai.com/en/articles/9703738)
- Rascunho salvo automaticamente — Slack e
  [core.telegram.org/api/drafts](https://core.telegram.org/api/drafts)
- IME e `keyCode 229` — MDN `KeyboardEvent.isComposing` e W3C UI Events §7.2.1
- Alvo de toque — WCAG 2.2, critério 2.5.8
- Geometria no iPhone, a saga inteira — `cockpit-v2-viewport-iphone.md`
- Doc de biblioteca externa: **Context7 antes de codar**, nunca memória de
  treino. Foi assim que o número do `backdrop-filter` saiu certo.
