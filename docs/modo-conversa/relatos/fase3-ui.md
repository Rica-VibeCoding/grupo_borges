# Fase 3 — relato da cadeira `ui`

Claude Code `claude-opus-5-5` · 27/09/2026 · sem commit.

## Etapa 1 — pesquisa e direções

`fase3-pesquisa.md` (referências com link e as 3 linhas por direção) e `fase3-direcoes/` (Moldura, Mostrador,
Núcleo em HTML autônomo; `capturar.py` gera mosaico e vídeo com relógio simulado). O Rica escolheu a Moldura, com
a Esfera (o Núcleo) como opção dentro da tela.

## Etapa 2a — Moldura com duas variações e a chave de visual

### Entreguei (`apps/cockpit/components/conversa/`)

- `moldura-conversa.tsx` + `moldura-shader.ts`: a borda da tela como indicador, em WebGL cru. Luz sobe do pé
  (sua vez, âmbar), desce do topo (vez dele, ciano), orbita (pensando, violeta), corre a borda (detector baixando),
  abre uma falha no pé (erro). Clarão na troca de vez. Duas variações: **Fio** (linha nítida, brilho curto) e
  **Aurora** (sem linha, névoa larga em cortinas).
- `chave-de-visual.tsx`: ícone de 44 px no cabeçalho que abre uma folha (o `Drawer` vaul que já existia). Moldura
  com Fio/Aurora; Esfera e Esfera + Moldura aparecem como "Chega na próxima entrega". Escolha no `localStorage`
  (`ck-conversa-visual`), lida por `useSyncExternalStore` — sem erro de hidratação.
- `tela-conversa.tsx` reescrita: título grande à esquerda, "Você disse" com a última transcrição, a resposta do Zé
  enquanto ele fala, avisos e notas. Textos em `leitura-da-conversa.ts` (puro, testado).
- `app/globals.css`: tokens `--ck-conversa-voce/pensa/ze/erro/prepara` apontando para os de estado, mais
  `--ck-conversa-titulo` (48 px) e a entrelinha dele. Saíram `--ck-conversa-esfera*`.
- Apagados: `esfera-conversa.*` e `onda-conversa.*` (órfãos).

### Como funciona, no que importa

- **Zero `setState` por quadro.** O volume virou `ref` em `use-detector-de-fala.ts` e `use-fila-de-voz.ts`;
  `useModoConversa` expõe `leNivel()`. O laço de `requestAnimationFrame` dorme nas cenas paradas (parado, erro) e
  depois que a transição assenta.
- **Contraste por construção.** Dentro da faixa de texto, a partir de 22 px da borda, o shader comprime a luz para
  luminância ≤ 0,05: texto secundário fica ≥ 4,9:1 e o primário ≥ 9:1, qualquer que seja o estado. A luz ainda
  alcança no máximo ~90 px (Fio) ou ~120 px (Aurora) da borda.
- **Pé da moldura fora da barra.** O canvas tem a altura de `100dvh` e o pé da moldura sobe o `--ck-safe-bottom`
  (as laterais entram o `--ck-safe-left/right`); abaixo dele fica só o halo.
- **Movimento reduzido:** quadro fixo por estado, redesenhado só quando o estado muda.
- **Sem WebGL:** cai para uma reserva em CSS (borda e gradiente que ainda acompanham o volume). Contexto perdido
  também cai para ela. Ao desmontar, `WEBGL_lose_context` libera a GPU.
- Cores lidas dos tokens em tempo de execução (canvas 2D de 1 px converte `oklch`/`lab` para sRGB).

### Provas

- `npm test`: **1000 testes, 1000 passaram** (23 novos: `moldura-estado`, `preferencia-visual`, `leitura-da-conversa`). `npm run type-check`: verde.
- E2E da fase 2 adaptado em `docs/modo-conversa/e2e/fase3-ui.cjs` (a sonda de volume lê `data-nivel` da Moldura,
  o movimento reduzido lê `data-movimento`, a transcrição lê `[data-fala="voce"]`; o resto é o roteiro da fase 2):
  **4/4 com o Fio e 4/4 com a Aurora**, na rodada final, com o código entregue. Provas em
  `docs/modo-conversa/e2e/fase3-2a/e2e-fio-provas.json` e `e2e-aurora-provas.json`.
- Capturas da tela real (393 × 852, estados vividos com o `canarinho`, roteiro `e2e/fase3-capturas.cjs`):
  `e2e/fase3-2a/moldura-fio.png`, `moldura-aurora.png` (mosaicos), os 12 quadros soltos e `chave-de-visual.png`.

### Achados

- **R6 apareceu no E2E.** Numa rodada, depois da interrupção, o agente respondeu de novo o texto longo (40 s de
  voz) em vez de "Dois.", e o `longa-2` estourou a espera de 45 s. A tela fez o certo (tocou, voltou a ouvir). Isolado, o
  cenário passou. Não é defeito da tela; é o turno velho do agente, já listado como R6 no plano.
- O dev da 3009 neste PC (subido por outra sessão em 26/09) parou de ver mudança no `globals.css` e servia os
  tokens velhos. Reiniciei só ele, com o mesmo comando (`COCKPIT_DIST_DIR=.next-dev`, porta 3009).
- O primeiro desenho da Moldura, igual ao protótipo, manchava o miolo da tela de marrom com raios até o centro
  quando o volume subia. Só a tela real mostrou isso; o alcance da luz ficou limitado à borda.
- Saiu da tela a nota positiva "Tela mantida acesa"; ficaram só os problemas (não manteve, navegador sem suporte,
  reconectando) e o tempo de carga do detector no estado parado.

### Não fiz

- A Esfera e a combinação (etapa 2b), à espera da coordenação.
- Commit, build e publicação. Nada em `lib/conversa/`.

## Etapa 2b — Esfera com duas variações e a combinação

### Entreguei (`apps/cockpit/components/conversa/`)

- `esfera-conversa.tsx` + `esfera-shader.ts` + `esfera-estado.ts`: a Esfera (o Núcleo do protótipo) em WebGL cru,
  por raymarching. Duas variações:
  - **Matéria**: corpo sólido com luz de frente. Ondula puxada para baixo quando você fala, solta ondas quando o Zé
    fala, acende veios quando pensa, vira gema na interrupção, encolhe e racha no erro, enche e esvazia de luz
    enquanto o detector baixa.
  - **Vidro**: casca escura, borda acesa e a luz morando dentro. A luz desce para você quando você fala, pulsa em
    anéis quando ele fala, vira duas luas orbitando quando pensa; no erro a fissura brilha.
- **Esfera e moldura**, duas variações:
  - **Juntas**: Matéria e Fio mostram o mesmo momento.
  - **Divididas**: a borda é a sua vez e a esfera é a vez dele; cada uma descansa na vez da outra. Na interrupção
    aparecem as duas: você sobe pela borda, ele congela na esfera.
- `preferencia-visual.ts`: as três opções liberadas na chave; `pecasDoVisual` decide que peça desenha qual cena
  (puro, testado). Saiu o "Chega na próxima entrega".
- Tela: com esfera, ela ocupa o palco entre o cabeçalho e as palavras, que descem para perto dos comandos; o título
  encolhe para 36 px (token novo `--ck-conversa-titulo-com-esfera`).

### Como funciona, no que importa

- Mesmo contrato da Moldura: volume em `ref`, zero `setState` por quadro, laço que dorme em parado e erro, contexto
  liberado ao desmontar, reserva em CSS (um círculo que ainda cresce com a voz) e quadro fixo por estado no
  movimento reduzido.
- **30 fps quando pesa**: média móvel do intervalo entre quadros; passou de 24 ms, a Esfera desenha um quadro sim,
  outro não, e fica assim (estável é melhor que oscilando).
- **A luz só existe no palco.** O desenho cobre a tela inteira, atrás de tudo, mas some nos últimos 48 px do palco:
  a esfera desliza quando a resposta do Zé cresce e encolhe o palco, sem ser cortada e sem passar por trás das
  palavras. Medido nas capturas, logo acima do título: luminância até 0,018 com a Esfera sozinha (o fundo é 0,010) e
  até 0,05 na combinação — o teto que a Moldura já garante.
- Canvas da Esfera transparente (alfa pré-multiplicado): na combinação, a Moldura aparece por trás dela.

### Provas

- `npm test`: **1012 testes, 1012 passaram** (12 novos: `esfera-estado` e as peças de cada visual em
  `preferencia-visual`). `npm run type-check`: verde.
- E2E da fase 2 (`e2e/fase3-ui.cjs`, agora lendo todas as peças: o maior volume entre elas, `data-movimento` e
  `data-desenho` em cada uma, a opção em `main[data-opcao]`): **4/4 em cada uma das seis variações** — Matéria,
  Vidro, Juntas, Divididas, e de novo Fio e Aurora, porque o código comum mudou. A Juntas perdeu o `longa` na
  primeira volta com 409 do backend ao semear o pedido (`agent_pane_unavailable`, antes de a conversa começar);
  rodada inteira de novo, 4/4. Provas em `e2e/fase3-2b/e2e-*-provas.json`.
- Capturas da tela real (393 × 852, estados vividos com o `canarinho`): mosaicos `e2e/fase3-2b/esfera-materia.png`,
  `esfera-vidro.png`, `esferaMoldura-juntas.png`, `esferaMoldura-divididas.png`, os 24 quadros soltos e
  `chave-de-visual.png` (as seis variações na folha). Mosaico feito por `e2e/mosaico.py`.

### Achados

- **Movimento reduzido pintava tudo de âmbar, inclusive a Moldura da 2a.** A regra global do reduzido dá transição
  de 0,01 ms a todo elemento, e a leitura das cores dos tokens reaproveitava a mesma sonda: cada troca de cor virava
  transição e a leitura devolvia a anterior. Todas as cores saíam iguais à primeira (âmbar), fundo inclusive.
  Corrigido com uma sonda nova por token. O E2E da 2a só conferia o atributo `data-movimento`, por isso passou.
- No dev (StrictMode), o efeito do WebGL roda duas vezes; o segundo pegava o mesmo canvas cujo contexto o primeiro
  tinha liberado, e a Esfera caía para CSS. Agora cada montagem cria o seu canvas (vale para a Moldura também).
- O halo da Esfera virava um disco com borda quando a voz subia (a conta mudava na esfera-limite da marcha) e um
  anel no erro (usava raio fixo com a esfera encolhida). Agora é radial e parte do raio real da forma.
- O dev da 3009 parou de novo de ver o `globals.css` (servia sem o token novo). Reiniciei só ele, com o mesmo comando.

### Não fiz

- Commit, build e publicação. Nada em `lib/conversa/`.
- Aparelho de verdade: a medida de 30 fps e a barra do Safari ficam para a fase 4, no iPhone.

## Ajuste pós-iPhone — tela limpa

### Entreguei (`apps/cockpit/components/conversa/`)

- Na tela ficam o visual, **um** botão (Começar / Encerrar / Retomar) e o cabeçalho com Voltar, o nome do agente e
  o ícone de configurações.
- `configuracao-da-conversa.tsx` (no lugar de `chave-de-visual.*`): a folha ganhou **Estou de fone** e **Mostrar
  texto** (desligado), acima da escolha de visual. As duas ficam no aparelho (`ck-conversa-fone`,
  `ck-conversa-texto`), lidas como o visual (`use-preferencias-conversa.ts`, no lugar de `use-visual-conversa.ts`).
- `useModoConversa(slug, fone)`: o fone chega da folha e cada troca vira o mesmo evento `fone` da máquina. O
  comportamento não mudou.
- Texto só com "Mostrar texto": título, detalhe, "Você disse" e a resposta. Desligado, o estado continua no nó
  `aria-live` (visualmente oculto), com "Você disse: “…”" enquanto ele pensa.
- Linha junto do botão (`avisoQuePedeAcao`, puro e testado), só para o que pede ação: erro, detector que não
  carregou, voz do Zé bloqueada pelo navegador, tela não mantida acesa.
- Esfera sem texto: palco inteiro, no meio da tela.
- Moldura sem texto: só segura a luz em volta do cabeçalho, então a borda aparece inteira nas laterais (antes
  a luz era comprimida em toda a faixa do texto).

### Provas

- `npm test`: **1017 testes, 1017 passaram** (5 novos: as chaves guardadas no aparelho, a linha junto do botão e o
  "Você disse" para o leitor de tela). `npm run type-check`: verde.
- E2E (`e2e/fase3-ui.cjs`, agora conferindo a tela limpa, ligando o fone pela folha e lendo a transcrição no nó
  `aria-live`): **4/4 com o Fio e 4/4 com a Matéria**. Provas em `e2e/fase3-limpa/e2e-*-provas.json`.
- Capturas da tela real (393 × 852, estados vividos com o `canarinho`): mosaicos `e2e/fase3-limpa/moldura-fio.png`
  e `esfera-materia.png`, os quadros soltos (mais o `parado` de cada uma) e `configuracoes.png` (a folha aberta).

### Achados

- **O `globals.css` velho no dev da 3009 era o cache do Turbopack**, não o observador de arquivos: reiniciar não
  resolvia, porque o dev relia o CSS antigo de `.next-dev/dev/cache/turbopack`. Apagar só esse cache (é do dev, a
  produção não usa) e subir de novo resolveu.
- A sessão do `canarinho` caiu às 00:53 e o backend recusava o envio (`sessao_ausente`). O E2E esperou ela
  voltar; nada da tela.

### Não fiz

- Commit, build e publicação. Nada em `lib/conversa/`.

## Toque na tela — um toque inicia, um toque para

### Entreguei (`apps/cockpit/components/conversa/` e `lib/conversa/`)

- **A tela inteira é o botão**, menos o cabeçalho e a folha aberta. É um `button` de verdade, sem texto
  visível, com rótulo Começar conversa / Encerrar conversa / Tentar de novo. `touch-action: manipulation`.
  O botão do rodapé saiu; a linha de aviso ficou.
- **Regra do toque, pura** (`toque-da-conversa.ts`):
  - parado e erro começam, no mesmo tick do clique;
  - qualquer estado ativo para;
  - com o detector preparando, o toque não faz nada (rótulo "Preparando…");
  - um segundo toque em menos de 400 ms não conta.
- **Freio do turno** (máquina, com teste): `parar` com o turno do Zé em voo pede `frearZe` e marca o turno como
  descartado. Em voo quer dizer esperando o Zé, ou ele falando antes do fim do stream.
  - Vale também em `interrompendo`: é o Zé falando com a voz pausada, e o turno segue vivo.
  - A marca atravessa o recomeço e só sai no fim do turno freado. O texto que ainda chegar não fala.
- **Envio logo depois do freio** (`envio-da-conversa.ts`):
  - turno descartado não conta como "agente ocupado", nem na fala por cima com fone;
  - `uncertain` segue como enviada, sem alarme e sem reenvio;
  - `refused` com `safe_to_resend` insiste com as esperas de `recusa-transitoria.ts`.
- **Stream lido na ordem** (`passosDoZeDepoisDe`): o fim de um turno e o começo do seguinte podem vir no
  mesmo lote.
- **Retorno sem texto:** dó→sol ao começar e sol→dó ao parar, diferentes do tique. Vibração só onde existe.

### Provas

- `npm test`: **1042 testes, 1042 passaram** (25 novos). `npm run type-check`: verde.
- **E2E do toque** (`e2e/fase3-toque.cjs`, com o `canarinho`, toque por coordenada no meio da tela):
  **5/5 com o Fio e 5/5 com a Matéria**. Os casos:
  - **começar:** preparando ignora o toque; o cabeçalho fica fora; o toque duplo liga uma vez só.
  - **parar ouvindo:** a fala em curso é jogada fora, sem transcrever.
  - **parar antes da resposta:** o "Um." chega só no chat; a voz não volta depois do recomeço.
  - **parar esperando** (o Zé lendo arquivos): `interromper` 200 e `[Request interrupted by user]` no
    registro; o "pronto" nunca chegou.
  - **parar falando:** a voz para, sai o freio e o final da resposta não chegou; recomeçando, nada volta.
- **Regressão da fase 2** (`e2e/fase3-ui.cjs`): 4/4 com o Fio e 4/4 com a Matéria.
- Provas e telas em `e2e/fase3-toque/`.
- Fala nova de teste `e2e/turno-toque.mp3`, gerada pelo TTS do cockpit; o `turno1.mp3` não mudou.

### Achados

- 🔴 **Freio antes da primeira resposta trava o agente.** Com o Escape antes de o Zé escrever qualquer
  linha, o Claude Code cancela o pedido e o devolve à caixa de entrada do pane, sem marca de fim no registro.
  Visto no `canarinho` em 27/09. Três efeitos:
  - o envio seguinte, de voz ou de texto, é recusado (`input_ocupado_ou_travado`);
  - o cockpit acha que o agente segue trabalhando até outro turno terminar;
  - o `destrava` não limpa com segurança: no teste respondeu `enter` e deixou uma quebra de linha solta, que a
    coordenação apagou.

  Por isso a tela **só freia depois que o Zé começou a responder**. Antes disso ela para sem frear, e a
  resposta fica no chat de texto. Fechar o caso inteiro pede `apps/api`: o `interromper` limpar o pedido
  devolvido quando é o nosso (o envio já prova posse do texto e usa C-u). O `■` do composer de texto tem o
  mesmo risco.
- **Tarefa em segundo plano do Zé sobrevive ao freio.** Com um `sleep` jogado para segundo plano, o aviso de
  fim abriu um turno novo e ele respondeu. É do Claude Code; o E2E passou a usar leitura de arquivo.

### Não fiz

- Commit, build e publicação. Nada em `apps/api`.
- Parar entre o tique e o "Pensando" não freia: a mensagem já saiu, e a resposta fica no chat.

## Escuta que emudece no iPhone — a vigia da escuta

### Entreguei (`apps/cockpit/components/conversa/` e `lib/conversa/`)

- **Reproduzi antes de consertar**, no código do 43b23a4, com o E2E novo (`e2e/fase3-escuta.cjs`):
  - contexto de áudio do detector suspenso durante a resposta falada → tela em "Pode falar" e **nenhum POST
    de `transcription`** depois, o sintoma do Rica;
  - caso de borda do toque → a resposta nova não falou e a tela **ficou presa em "Pensando"**.
- **O contexto de áudio do detector agora é nosso** (opção `audioContext` do MicVAD). Nasce no mesmo ponto em
  que o MicVAD o criava, logo depois do microfone; o anterior fecha na troca. É nele que a vigia olha.
- **Vigia da escuta** (`vigia-da-escuta.ts`, pura, com teste). Com o detector ligado, confere três sinais:
  - o contexto fora de `running` (`suspended`, ou `interrupted`, que só o Safari tem);
  - a faixa do microfone muda (`muted`);
  - nenhum quadro de áudio processado há 1 s.

  Confere na hora em que o detector liga (a volta de "falando" para "ouvindo"), a cada 250 ms e a cada
  `statechange`, `mute` ou `unmute`. A escada:
  - caiu → `resume()`;
  - não voltou em ~1 s → reabre: detector, contexto e microfone novos (`reabre()` no controlador, com teste);
  - não voltou em 4 s → erro **"Parei de te ouvir — O microfone ficou mudo. Toque para voltar a ouvir."**;
  - no toque, o `resume()` sai síncrono, dentro do gesto, que é o que o iOS aceita.
- **Caso de borda do toque** (máquina e `passosDoZeDepoisDe`, com teste). Parar antes da resposta não freia, e
  a pergunta seguinte vai para a fila do Claude Code. Medido no canarinho: ela entra no turno velho como anexo,
  numa fronteira de ferramenta, **sem fim entre os dois**. O stream agora lê o `queued` e o primeiro anexo
  depois dele; nessa hora sai o evento novo `pedidoEntrou`, que limpa o descarte. O que o Zé escrever dali em
  diante fala. Se o turno velho acabar antes, a fila drena como pedido novo, como já era. Vale também para a
  fala por cima com fone, que descarta o turno do mesmo jeito.
- **Contrato** (`tipos.ts`): evento `pedidoEntrou` e motivo `escutaMuda`.

### Provas

- `npm test`: **1057 testes, 1057 passaram** (15 novos). `npm run type-check`: verde.
- **E2E da escuta** (`e2e/fase3-escuta.cjs`, com o `canarinho`). O Chrome simula a queda na hora em que a voz
  do Zé começa. Depois de uma resposta falada, a fala seguinte tem de virar transcrição, envio e voz de novo.
  **5/5 com o Fio e 5/5 com a Matéria**:
  - **escuta suspensa:** o contexto volta a `running` na volta a ouvir, sem reabrir;
  - **escuta com `resume()` recusado:** reabre em ~1,1 s (contexto novo);
  - **faixa muda:** `mute` → reabre em ~1,1 s (microfone novo);
  - **escuta perdida** (nada volta): "Parei de te ouvir" em ~5 s; o toque retoma no gesto e a fala passa;
  - **pergunta emendada no turno velho:** `queued` sem fim entre os turnos, e o "Pronto. Dois." é falado.
- **Regressão:** toque 5/5 e fase 2 4/4, nos dois visuais. Na Matéria, "parar falando" falhou uma vez
  por um erro do roteiro: o recomeço saiu ~360 ms depois do toque que parou e caiu na regra do toque duplo
  (400 ms). Com uma folga de 500 ms no `fase3-toque.cjs`, passou.
- Provas em `e2e/fase3-escuta/` (`antes/` é o código do 43b23a4 falhando). Fala nova `e2e/turno-fila.mp3`.

### O que o E2E não prova

- **Só o iPhone confirma a causa.** O Chrome não suspende o contexto nem emudece a faixa sozinho: o E2E força
  a queda e prova que a tela sai dela. Se o iOS mata a escuta de outro jeito, a vigia ainda pega pelos quadros
  parados, mas não sei qual degrau resolve lá.
- Também não sei se `resume()` fora do gesto funciona no iOS com o microfone aberto. Se não funcionar, a tela
  reabre e, no pior caso, pede o toque.
- **Roteiro no iPhone:** várias respostas seguidas com o `daniel`.
  - Voltou a ouvir sozinho → um dos dois primeiros degraus resolveu.
  - Apareceu "Parei de te ouvir" → a queda é a que só o toque destrava. Anotar depois de qual resposta.
  - Nenhum dos dois, e mudo de novo → a vigia não enxerga a queda; o próximo passo é telemetria do aparelho.

### Achados

- **Resposta gravada em duas linhas, em lotes diferentes:** a primeira linha vazia com o fim chega antes do
  texto. A tela vai de "Pensando" para "ouvindo", abre o microfone por ~200 ms e só então fala. Visto em todo
  E2E. No iPhone, abrir e fechar o microfone logo antes da voz é suspeito de ajudar a travar o áudio. Consertar
  pede uma folga curta antes de fechar o turno; fica para depois, fora deste briefing.
- Antes do conserto, o caso de borda era pior que a resposta calada: a tela ficava em "Pensando" para sempre.

### Não fiz

- Commit, build e publicação. Nada em `apps/api`.
- Telemetria do iPhone (o que caiu, qual degrau resolveu).
- A entrada da pergunta é o primeiro anexo depois do `queued`; o backend não diz o tipo do anexo. Se outro
  anexo vier antes do que traz a pergunta, o texto do turno velho entre os dois fala. Nas duas medições não
  veio nenhum.

## Gestos no lugar dos botões — chat, voltar e configurações

### Entreguei (`apps/cockpit/components/conversa/` e duas linhas em `app/agente/[slug]/page.tsx`)

- **Regra pura dos gestos** (`gesto-de-arrasto.ts`, com teste):
  - até 10 px o dedo não andou: é toque. Gesto a partir de 56 px no eixo, e o eixo vale o dobro do outro;
  - gesto de lado não começa a menos de 24 px das bordas (o voltar e o avançar do Safari); do meio funciona;
  - para cima só conta começado acima da faixa de baixo (área segura + 40 px), a borda do iPhone;
  - no chat, não conta o que começou em campo, no composer (`form`), em gaveta (`aside`), em folha (`dialog`) ou
    no que rola de lado;
  - o clique que sobra de um arrasto não é toque; o do teclado sempre é.
- **Na conversa** (`use-gestos-da-conversa.ts`, Pointer Events no `<main>`, só dedo; mouse segue sendo clique):
  - esquerda → chat; cima → folha de configurações. O gesto vale ao soltar o dedo;
  - `touch-action: none` e `overscroll-behavior: none` seguram o Safari: nada rola, nada dá zoom;
  - o Voltar saiu. O canto superior direito virou o ícone do chat. O nome do agente ficou ao lado: na
    captura, "Canário" + balão lê como "chat do Canário", sem ambiguidade;
  - o botão das configurações segue para teclado e leitor de tela, fora da vista até ganhar foco de teclado;
  - a folha fecha como antes, arrastando para baixo e tocando fora;
  - dica "Arraste para cima: configurações" por 2 s na primeira vez, guardada no aparelho. Só conta como vista
    quando some.
- **Sair é parar** (`use-modo-conversa.ts`). Com a conversa ativa, o gesto e o ícone do chat param na hora, com
  o freio se o Zé já respondia. Qualquer outra saída (voltar do navegador, tropa) para quando a tela desmonta.
  Ctrl/Cmd-clique no ícone abre o chat em outra aba sem parar esta.
- **No chat** (`arrasto-do-chat.tsx`): direita → `/conversa/{slug}`. Escuta Touch Events passivos, que seguem
  chegando com o chat rolando, e decide ao soltar. Ignora com gaveta aberta e com texto selecionado. Enquanto o
  chat está aberto, liga `overscroll-behavior-x: none` na raiz: no Chrome o arrasto de lado também é o "voltar"
  do histórico. No Safari não muda nada.

### Provas

- `npm test`: **1067 testes, 1067 passaram** (10 novos). `npm run type-check`: verde.
- **E2E dos gestos** (`e2e/fase3-gestos.cjs`, com o `canarinho`). O dedo é simulado pelo CDP e passa por
  `touch-action`, Pointer Events e rolagem, como no celular. **5/5 com o Fio e 5/5 com a Matéria**:
  - **cabeçalho:** a dica aparece e some em ~2 s e não volta; o ícone do chat está no canto; o Tab chega nas
    configurações, que aparecem, e o Enter abre; o toque no ícone leva ao chat;
  - **cima:** parado, abre a folha sem começar; fecha arrastando e tocando fora, e o toque de fora não começa;
    da faixa de baixo não abre; com a conversa ouvindo, abre sem parar; arrasto indeciso ou para a direita não é
    toque;
  - **esquerda:** do meio leva ao chat sem começar; da borda direita não; com a conversa ouvindo, sair fecha o
    microfone;
  - **direita no chat:** do meio volta, sem começar a conversa. Não voltam: rolar, diagonal, arrasto curto,
    composer, bloco que rola de lado (e o bloco rolou), texto selecionado, gaveta aberta;
  - **sair falando:** o Zé falando com o turno em voo → gesto → a voz para, `interromper` 200,
    `[Request interrupted by user]` no registro, turno sem fim normal, a voz não volta, microfone fechado.
- **Regressão:** toque 5/5 e fase 2 (`fase3-ui.cjs`) 4/4, nos dois visuais. Os dois roteiros abriam as
  configurações pelo botão; agora abrem por foco e Enter.
- Provas e telas em `e2e/fase3-gestos/`.

### O que o E2E não prova

- **É Chrome, não Safari.** Só o iPhone confirma:
  - que o Safari entrega o arrasto inteiro na conversa com `touch-action: none`;
  - no chat, que o fim do toque chega com o feed rolando;
  - que o arrasto para cima começado logo acima da faixa de baixo não briga com a barra do iPhone.
- **Roteiro no iPhone:**
  - na conversa, arrastar do meio para cima → folha; para a esquerda → chat;
  - no chat, arrastar do meio para a direita → conversa. Rolar o chat e arrastar num bloco de código não voltam;
  - com o Zé falando, arrastar para a esquerda → a voz para e a resposta fica só no chat.

### Achados

- **No Chrome, arrasto de lado no chat voltava o histórico**, além do gesto novo. Com o composer, o E2E voltou
  para a página anterior sem o meu código agir. Resolvido com `overscroll-behavior-x` enquanto o chat está aberto.
- **Na Matéria, "sair falando" falhou uma vez por um erro do roteiro.** O Zé já tinha começado o final da
  resposta quando o freio chegou; o turno foi cortado no meio, com `[Request interrupted by user]`. A checagem
  virou "turno sem fim normal e voz que não volta", que é o que o briefing pede. Na rodada seguinte passou.

### Não fiz

- Commit, build e publicação. Nada em `apps/api`.
- A tela não acompanha o dedo durante o arrasto: o gesto vale ao soltar, sem animação intermediária.

## Freio sempre e folga antes de fechar o turno

### Entreguei (`apps/cockpit/components/conversa/` e um comentário em `lib/conversa/tipos.ts`)

- **Freio sempre.** Parar em "esperando" freia no servidor mesmo antes da primeira linha do Zé. Saiu a
  restrição `freiaNoServidor`, junto com o teste dela.
  - Freado antes da primeira linha, o Claude Code não grava fim nenhum desse turno. Desde o 7d749a9, o servidor
    grava a marca `[Request interrupted by user]` quando limpa o pedido. A leitura dos passos fecha o turno com
    ela na hora, porque é linha do usuário, e o `isRunning` cai pelo próprio stream.
  - O conserto que eu tinha posto na tela para esse caso saiu (`freioSemFim` e o fim despachado no retorno do
    `interromper`): com a marca no stream, o turno fecharia duas vezes. Fica só `zeOcupado` (turno descartado
    não é ocupação), a mesma checagem de antes, agora pura e testada.
- **Folga antes de fechar** (`textos-do-ze.ts`, com teste, e `use-turno-do-ze.ts`):
  - o fim que vem numa linha do Zé sem fala espera **800 ms**, em vez de fechar no fim do lote;
  - o texto que chega dentro dela entra no mesmo turno: a tela vai direto de "esperando" para a voz;
  - pedido novo fecha na hora; a marca de interrupção, do Claude Code ou do servidor, também;
  - a regra olha a linha que trouxe o fim, não o turno inteiro. Assim cobre também o turno que falou antes de uma
    ferramenta e cuja resposta final chega partida. É um desvio consciente do "turno que já falou fecha como
    hoje": fim com fala continua fechando na hora, então resposta normal não ganha espera.
- A leitura do stream saiu de `use-modo-conversa.ts` para `use-turno-do-ze.ts`: com a folga, o hook passaria de
  300 linhas. Saiu também o passo `respondeu`, que só servia à restrição do freio.

### Por que 800 ms

- As linhas de uma resposta são gravadas juntas. A primeira, vazia, é o raciocínio (`thinking`). O servidor lê o
  banco a cada 250 ms.
- Medi 8 respostas no canarinho. As linhas do fim chegaram juntas ou com até 21 ms de diferença. Quando partem
  entre duas leituras, a diferença é ~240 ms: visto no E2E da escuta e, na medição, numa linha de ferramenta.
- 800 ms cobrem três leituras. Só custam quando o fim vem mesmo sem fala, o que é raro: aí o "ouvindo" chega
  800 ms depois.

### Provas

- `npm test`: **1072 testes, 1072 passaram**. `npm run type-check`: verde.
- **E2E do toque** (`e2e/fase3-toque.cjs`, com o `canarinho`, servidor 7d749a9): **6/6 no Fio e 6/6 na Matéria**.
  - **Parar antes da resposta**, com duas partes:
    - na mesma página: toque em "esperando", sem linha do Zé → `interromper` 200 com `pedido_limpo: true`. A
      `interromper` responde em 0,4 a 0,7 s e a marca chega pelo stream em seguida. A tela recomeça, o "dois" entra com 200 e o "Dois." é
      falado, sem o microfone abrir antes da voz. O "um" nunca chega;
    - freio de novo e página aberta do zero: nada de "ocupado". O "dois" entra e é respondido.
  - **Folga** (caso novo). O roteiro parte a resposta como o servidor faz às vezes: segura por 300 ms as linhas
    que vêm depois do fim sem fala. A tela vai de "esperando" para "falando" sem passar por "ouvindo" e sem abrir
    o microfone.
  - Começar, parar ouvindo, parar esperando e parar falando seguem passando. Parar falando passou na segunda
    rodada; veja os achados.
- **Regressão da fase 2** (`fase3-ui.cjs`, rodada antes da retirada do conserto, que não toca nesse caminho): 4/4
  no Fio e 4/4 na Matéria. Nenhuma resposta passou por "ouvindo" entre a espera e a voz.
- Provas em `e2e/fase3-freio/`:
  - `fio-freio-antes-do-conserto-provas.json` é a primeira rodada, com servidor 8bb6c2a e a tela presa;
  - `*-servidor-7d749a9-*` é a bateria com a marca do servidor;
  - `e2e-parar-falando-*` é a segunda rodada desse caso.

### O que o E2E não prova

- **A resposta partida é simulada.** A de verdade é sorte: nas 8 medidas, nenhuma partiu entre leituras. O
  roteiro reproduz o atraso medido (300 ms, contra ~240 ms reais).
- **Que o áudio do iPhone deixa de travar.** A suspeita era o microfone abrir e fechar logo antes da voz. Isso
  não acontece mais, mas só o iPhone confirma o efeito.
- **Roteiro no iPhone:**
  - perguntar algo de uma palavra várias vezes → a voz sai sempre, sem o anel de "ouvindo" piscar antes;
  - tocar logo depois de perguntar, antes de qualquer resposta → recomeçar e perguntar de novo → ele responde;
  - fazer o mesmo e fechar e reabrir a tela → a pergunta nova entra, sem "ocupado".

### Achados

- **Freio antes da resposta deixava o log sem fim.** Com o servidor 8bb6c2a, página nova logo depois do freio
  dizia "O agente está ocupado" até outro turno terminar. Resolvido no servidor (7d749a9); o E2E da página nova
  prova.
- **Parar falando falhou duas vezes por corrida do roteiro, não da tela.** O canarinho escreve rápido:
  - no Fio, o toque pegou o Zé no meio da parte final, que ficou no registro cortada e seguida da interrupção. É
    a mesma corrida já vista nos gestos. A checagem virou "o turno freado não terminou";
  - na Matéria, o Zé terminou as 20 linhas finais ~500 ms depois do toque, antes de o Escape chegar: turno
    fechado normal, `pedido_limpo: false`. O pedido agora tem 60 linhas finais, para o toque cair com o turno em
    voo;
  - nas duas, a voz parou no toque e não voltou.

### Não fiz

- Commit, build e publicação. Nada em `apps/api` nem em `packages/cockpit-core`.

## Barra do chat enxuta — microfone, ⧉, retrato e gestos novos

### Entreguei (`components/shell/`, `components/conversa/` e três linhas em `app/agente/[slug]/page.tsx`)

- **Microfone fora da barra** (`barra-de-telas.tsx`). O link para `/conversa/{slug}` continua existindo para teclado
  e leitor de tela, fora da vista até ganhar foco de teclado (`sr-only` + `focus-visible:not-sr-only`). Com Tab
  depois da cápsula, ele aparece no lugar de antes.
- **⧉ do painel fora.** Antes de tirar, provei que o painel fecha sem ele, nos dois tamanhos: pelo × da gaveta e
  tocando fora. No celular a gaveta ocupa quase a largura toda, mas o toque abaixo dela e na faixa lateral fecha.
  - A coluna da direita ficou vazia de propósito: é ela que mantém o pill "Chat" no centro (colunas iguais, medido
    antes e depois).
  - Órfãos que saíram junto: o `BotaoPainel` (`superficie-otimista.tsx`), o `IconePainel` (`icones.tsx`) e as
    props `hrefFecharPainel`/`painelAberto` da barra. A página deixou de passá-las: são as duas linhas em `page.tsx`.
- **Retrato desenquadrado** (`capsula-do-agente.tsx`, `pastilha-do-chrome.ts`):
  - O que estava fora: no celular de 390 px, a foto ficava descentrada na pastilha. A coluna da cápsula tem ~144 px,
    o nome truncava até sumir, mas o vão de 8 px e o respiro de 14 px à direita ficavam. A foto aparecia encostada
    à esquerda de uma pílula meio vazia. Corte do rosto e círculo achatado não havia: a foto é 128×128 num quadro de
    22×22.
  - Conserto na causa: a cápsula mede a própria coluna (consulta de contêiner do Tailwind). A partir de 10rem
    entra o nome; abaixo, só a foto, com 4 px dos dois lados, centrada numa cápsula redonda. O nome segue no rótulo
    do link.
  - No desktop nada muda: foto e nome, como antes. Em 393 px fica só a foto; em 430 px (Pro Max) o nome cabe e
    aparece inteiro.
- **Gestos, como o Rica definiu** (`gesto-de-arrasto.ts`, com teste, `arrasto-do-chat.tsx`):
  - no chat, esquerda abre a voz e direita abre a tropa. A tropa abre pelo mesmo caminho otimista do `≡`, o
    `ir()` da navegação da tropa, sem `<Link>` seco nem estado novo. No desktop (acima de `md`) a direita não faz
    nada: lá a tropa é fundo permanente e o `≡` nem aparece;
  - na voz, direita volta ao chat e a esquerda deixou de valer. Cima continua abrindo as configurações;
  - limiar, bordas e origem (composer, gaveta, rolagem de lado, seleção) ficaram como estavam. Com gaveta aberta,
    gesto nenhum dispara;
  - comentários com a direção antiga atualizados, inclusive o da página.

### Provas

- `npm test`: **1072 testes, 1072 passaram**. `npm run type-check`: verde. O teste puro do gesto cobre as três
  direções novas; a esquerda na voz e a direita no chat para a voz (as antigas) não disparam mais.
- **E2E dos gestos** (`e2e/fase3-gestos.cjs`, casos reescritos). O dedo é simulado pelo CDP. **4/4 no Fio e 4/4 na
  Matéria**:
  - **direita** (na voz): leva ao chat sem começar nada. Com a conversa ouvindo, a esquerda não sai mais nem vira
    toque, e da borda esquerda não começa. Do meio, sai para o chat e fecha o microfone;
  - **chat:** esquerda abre a voz, parada. Direita abre a tropa (URL `?nav=aberto`), e com ela aberta nenhum gesto
    dispara; tocar fora fecha. Não disparam, para nenhum dos lados: rolar, diagonal, curto, composer, bloco que
    rola de lado (e o bloco rolou), texto selecionado, bordas;
  - **cima** e **cabeçalho** seguem passando. A checagem "arrasto lateral não é toque" passou para a esquerda.
  - "Sair falando" não rodei: ele envia mensagem ao canarinho, e o briefing pede nada em sessão viva. A saída que
    ele testa (sair é parar) não mudou, só a direção do dedo, já trocada no roteiro.
- "Antes" do gesto: os casos antigos rodados no código anterior (`gesto-antes-*`). "Depois": `gesto-depois-*`,
  com a tropa aberta pelo gesto em `gesto-depois-*-chat-tropa.png`.
- Capturas em `e2e/fase3-barra/`, `antes-*` e `depois-*`, em 390×844 e 1440×900, com Canário e Daniel:
  - `*-barra.png` e `*-capsula.png`: a barra inteira e a cápsula ampliada;
  - `*-painel-aberto.png` e `*-painel-fechado.png`: o painel abrindo pela cápsula e fechando;
  - `depois-*-teclado.png`: o link da voz aparecendo com Tab;
  - `depois-canarinho-393-barra.png` e `depois-canarinho-430-barra.png`: os dois tamanhos de iPhone;
  - medidas e resultados em `antes-provas.json`, `depois-provas.json` e `depois-fora-celular-provas.json`.
- Nada em sessão viva: as capturas só abrem a página do chat, sem enviar nada.

### O que o E2E não prova

- **É Chrome, não Safari.** No iPhone falta ver:
  - no chat, a direita do meio abre a tropa sem brigar com o voltar do Safari (que é só da borda);
  - na voz, a direita do meio volta ao chat.

### Não fiz

- Commit, build da 3008 e publicação.

## Gestos que deslizam — e a tropa que não abria no iPhone

### Causa do defeito (direita no chat não abre a tropa)

Provada em WebKit 26.6 (Playwright), com toque sintético pelos listeners reais, no código de `e4488f1`:

- **Eliminadas:** o `usaNavegacaoDaTropa` existe nessa árvore (o layout `/agente` monta o `NavProvider`), a gaveta
  abre e anima, e a origem não barra: num chat cheio (Daniel, Pavan), 0 de 248 pontos da tela recusam o gesto.
  Do meio, em linha reta — o que o E2E fazia —, abre.
- **Causa 1, a borda:** começando a menos de 24 px da borda esquerda, nada acontece. É lá que nasce o dedo que
  abre uma lateral. A faixa existe para não brigar com o voltar do Safari, mas o Rica usa o app instalado
  (`standalone`), onde esse gesto não existe: a faixa só engolia o dedo.
- **Causa 2, o arco:** a regra pedia o eixo valendo o dobro do outro, medido do começo ao fim. O polegar faz
  arco: um arrasto que sobe 0,6 do que anda de lado era recusado; 0,4 passava. Não dá para saber qual das duas
  pegou o Rica; as duas estão reproduzidas e as duas saíram.

### Entreguei (`components/conversa/` e uma linha em `app/agente/[slug]/page.tsx`)

- **Os três gestos seguem o dedo** e assentam com a mola da folha: 500 ms, `cubic-bezier(0.32, 0.72, 0, 1)`,
  lidos no vaul 1.1.2. Soltou antes da metade e sem pressa, volta. Passou da metade ou arremessou (0,4 px/ms,
  o mesmo número da folha), vai. Abaixo de 56 px, o limiar de sempre, nunca vai. Arremessar de volta desiste.
  - chat ⬅️ voz: o chat anda e a voz entra pela direita;
  - chat ➡️ tropa: a gaveta sai da esquerda com o dedo. Ao soltar para ir, abre na hora pelo `ir()` do `≡`, o
    mesmo estado otimista, e a mola só termina o movimento;
  - voz ➡️ chat: a voz anda e o chat entra pela esquerda. O freio sai na soltura, antes da mola.
- **O eixo trava nos primeiros 10 px** e fica: de lado se anda mais de lado que na vertical (até 45°). O arco
  que vem depois não desfaz o gesto. Vertical, a rolagem do chat segue intocada.
- **A borda vale só no Safari.** No app instalado, o gesto começa de qualquer ponto.
- **Arquivos novos:**
  - `deslize.ts` (regra pura) com teste;
  - `mola.ts` (o `transform` no DOM, sem render do React);
  - `rostos-do-deslize.tsx` e `deslize.module.css` (os rostos dos destinos);
  - `use-ida.ts` (a troca de rota com a rede da tropa).
- **Mudados:** `arrasto-do-chat.tsx`, `use-gestos-da-conversa.ts`, `tela-conversa.tsx`, `gesto-de-arrasto.ts`
  (a direita da voz e o `gestoDoChat` saíram de lá, agora andam com o dedo). `page.tsx` passa o nome ao arrasto.
  Nada em `components/shell/`.

### Por que este caminho, e não View Transitions

- Li no Context7 (Next 16.2.9) e conferi na instalação (16.2.6). O `<ViewTransition>` do React embutido existe,
  e o `router.push` aceita `transitionTypes`.
- Mas a transição de vista fotografa a tela velha e anima só depois do commit. Ela **não segue o dedo**: durante
  o arrasto o destino de verdade ainda não existe, é outra rota. De um jeito ou de outro, algo tem de entrar pelo
  lado enquanto o dedo arrasta.
- Esse algo é o **rosto do destino**: uma camada com a cara da primeira pintura dele. O rosto da voz é o fundo e
  o cabeçalho; o do chat, a barra de cima de verdade e a caixa do composer. Medi no pixel: posição e tamanho
  iguais aos da tela real.
- **A mola assenta no rosto, e só então a rota troca**, pré-carregada com `router.prefetch(kind: full)`:
  - trocar no meio da mola seria o salto que o Rica reprovou;
  - com View Transitions, a tela congelaria esperando o servidor. No dev da 3009, isso é segundo inteiro.
  - com o rosto, o que aparece enquanto a rota chega é o próprio destino, sem branco nem vazio.
- A voz é pré-carregada quando o chat abre (só leva o nome do agente). O chat, só quando o dedo trava rumo a
  ele: carregado antes, chegaria com a âncora do relógio da statusline velha.
- **Só `transform`, nada de layout:** o dedo escreve direto no estilo (um valor por quadro, sem render) e a mola
  é transição de CSS, que roda no compositor.
- **Achado no caminho:** a tela da voz está no fluxo da página. Andando para a direita, alargava o documento
  (393 → 751 px) e o celular afastava o zoom no meio do gesto. Durante o arrasto ela fica presa ao vidro
  (`position: fixed`) e a largura não muda mais. O E2E confere.

### Provas

- `npm test`: **1083 testes, 1083 passaram** (13 novos da soltura, os do gesto antigo ajustados).
  `npm run type-check`: verde.
- **E2E novo** (`e2e/fase3-deslize.cjs`, só o `canarinho`; o Daniel só aberto, para ter o que rolar). Tamanho do
  iPhone 15. **14/14 em WebKit e 14/14 em Chromium**:
  - no WebKit, o toque é sintético, pelos listeners reais;
  - no Chromium, o dedo é de verdade, pelo CDP: passa pela rolagem e pelo `touch-action`.
- **Os casos:**
  - chat ⬅️ voz: volta com mola antes da metade, vai depois dela, e arremesso de 120 px vai;
  - chat ➡️ tropa: volta e some, vai e fica aberta, com o CSS devolvido nos dois casos. Com a gaveta aberta,
    gesto nenhum dispara;
  - voz ➡️ chat: volta sem começar a conversa (arrasto não vira toque) e vai. Para cima segue abrindo as
    configurações;
  - o defeito: o arco abre a tropa. Da borda, nada no Safari; no app instalado, abre;
  - o que não pode disparar: rolar (e o chat rola), diagonal íngreme, começo no composer;
  - no chat cheio, de lado abre a tropa no meio dos blocos de ferramenta;
  - movimento reduzido: nada anda com o dedo, e 80 px bastam;
  - no meio do arrasto: o chat (ou a voz) anda, o rosto entra e a largura da página fica em 393.
- **Regressão:** o E2E antigo (`fase3-gestos.cjs`: cabeçalho, cima, direita, chat) passou 4/4 no Chrome. "Sair
  falando" não rodei: ele manda mensagem ao agente.
- Resultados em `e2e/fase3-deslize/provas.json`. Sem vídeo, pelo adendo 2.

### O que o E2E não prova

- **O dedo do Rica.** O WebKit do Playwright não tem o voltar do Safari nem o polegar dele. O toque sintético
  não passa pela rolagem nativa do iPhone.
- **Os 60 fps no iPhone 15:** é só `transform`, mas só o aparelho mede.
- **Roteiro no iPhone, no app instalado:**
  - no chat, puxar da borda esquerda para a direita, devagar: a tropa vem colada no dedo. Soltar antes da metade
    e ela volta; depois da metade, abre;
  - no chat, arrastar para a esquerda: a voz entra pela direita. Soltar no meio do caminho volta;
  - na voz, arrastar para a direita: o chat entra pela esquerda. Com a conversa andando, sair para;
  - rolar o chat para cima e para baixo: nada mais pode se mexer de lado.

### Assumi

- **Travar o eixo a 45° nos primeiros 10 px** no lugar do dobro medido do começo ao fim. É o que deixa o arco
  do polegar passar. A diagonal íngreme continua com a rolagem (E2E).
- **Borda livre no app instalado**, pela leitura de `display-mode: standalone` e `navigator.standalone`. No Safari
  a faixa de 24 px segue.

### Divergi do combinado

- **"Limiar para decidir que é gesto horizontal" mudou**, e de propósito: a regra antiga é a causa 2 do defeito.
  O limiar de distância (56 px) e o do toque (10 px) seguem os mesmos.
- **"Bordas do Safari" valem só no Safari:** no app instalado não há voltar pela borda, e a faixa era a causa 1.

### Não fiz

- Commit, build da 3008 e publicação. Nada em sessão viva: os E2E só abrem páginas, sem enviar nada.
- O `next dev` da 3009 no PC ficou no ar, servindo este código.

## Diagnóstico do gesto no iPhone (temporário, fora do commit)

O Rica testou pelo dev (Safari, `:3447` → 3009 do PC): no chat, a esquerda só rola o texto e a direita não abre a
tropa. Sem conserto no escuro: entrou um painel que só liga com `?diag=gesto`.

- `components/conversa/diagnostico-do-gesto.tsx` (novo) e pontos de anotação em `arrasto-do-chat.tsx`. A decisão do
  gesto não mudou. **Nada disto vai para commit.**
- O painel fica fixo no topo e mostra, a cada arrasto no chat:
  - se `pointerdown` e `touchstart` chegaram à página, e se o ouvinte do gesto rodou;
  - o alvo e, se barrou, por quê: gaveta aberta, origem (qual elemento e medida), borda, seleção, desktop;
  - o eixo travado, com dx, dy, ângulo e se o `touchmove` era cancelável;
  - quantos `touchmove` vieram, quantos o gesto segurou e se houve rolagem;
  - dx, dy, ângulo e velocidade finais, standalone (as duas leituras), e a decisão.
- Conferido em WebKit e Chromium: rolar, arrasto curto que volta e arrasto que abre a tropa aparecem certos.

## Conserto D1 e D2 (decisões do Rica, 27/09)

### Entreguei

- **D1, a mola roda sempre:**
  - O defeito: um ramo navegava seco quando o dedo soltava antes de o React montar o rosto do destino. No dev
    do iPhone isso acontecia com frequência, e parecia código concorrente.
  - Os dois rostos agora montam na hidratação, fora da tela, e a ida é sempre pela mola: a rota só troca quando
    ela termina, com ou sem rosto (`assentaJuntas` em `mola.ts`).
  - A voz no desktop também anda com o dedo.
  - A única troca direta que sobrou é a de movimento reduzido, por regra de acessibilidade do briefing.
- **D2, sem faixa de borda:** o `comecoValido` e a `LIMIAR.borda` saíram. O gesto começa de qualquer ponto, no
  Safari e no app instalado, no chat e na voz.
- **O painel `?diag=gesto` saiu de dentro do gesto.** Virou `apps/cockpit/instrumentation-client.ts`, que o Next
  carrega sozinho e que só observa de fora: ouvintes na `window` e posição das camadas a cada quadro. Nenhum
  arquivo do gesto o importa.
  - O painel mostra: se o toque chegou, o alvo, o motivo de barrar, o eixo, dx/dy/ângulo, a velocidade,
    standalone, quantos quadros seguiram o dedo, quantos de mola, quando a rota trocou e a decisão.
  - **Fora do commit:** `instrumentation-client.ts`.

### Provas

- **Testes que falharam antes** (`e2e/fase3-deslize.cjs`, resultado em `fase3-deslize/antes-do-conserto.json`):
  8 de 8 falharam no código anterior, nos dois motores.
  - `seca-chat` e `seca-voz`: arremesso mais rápido que a montagem da tela. Antes, 0 quadros de mola e a troca
    aos 182–945 ms. Depois, 26 a 29 quadros de mola e o rosto assentado antes da troca.
  - `defeito-borda-safari` (tropa a 6 px da borda esquerda, voz a 5 px da direita) e `borda-voz` (chat a 6 px).
- **Depois:** `fase3-deslize.cjs` passou 17/17 no WebKit e 17/17 no Chromium. A bateria antiga `fase3-gestos.cjs`
  passou 4/4, com as duas checagens da faixa de borda trocadas pela regra do D2.
- `npm test`: **1081 testes, 1081 passaram** (saíram os 2 testes da faixa de borda). `npm run type-check`: verde.

### Não fiz

- Commit e build. O `next dev` da 3009 no PC está no ar com este código e o painel.

## Pager chat ⇄ voz — substitui o deslize entre rotas

Briefing `briefings/fase3-pager-chat-voz.md` (hoje em `~/briefing-pager.md`), com o adendo do Rica de 13:41.

### Plano

- **Uma árvore, uma instância de cada painel.** `pager-do-agente.tsx` (cliente) mora na página do chat: painel do
  chat (barra + palco, do servidor) e painel da voz (`TelaConversa`, import dinâmico). `/conversa/[slug]` redireciona
  para `/agente/[slug]?tela=voz`, e o pager troca a URL de volta para `/conversa/[slug]`. Nada se monta em dobro.
  Sem piscar o chat na entrada direta: antes de hidratar, a voz vem primeiro por CSS; o efeito de layout desfaz e
  posiciona antes da primeira pintura.
- **Arrasto nativo:** `overflow-x: auto`, `scroll-snap-type: x mandatory`, `scroll-snap-stop: always`,
  `overscroll-behavior-x: none`, barra escondida. Nenhum listener de toque entre chat e voz.
- **URL sem navegar:** assentou (`scrollend`, iOS 26.2+; reserva por `IntersectionObserver` a 99%) →
  `replaceState`, nunca `pushState`. `popstate` leva o pager ao painel da URL. O `replaceState` do Next 16 copia a
  árvore do roteador e não pede nada ao servidor (lido no `app-router.js` instalado).
- **Voz fora da tela:** `inert`, sem WebGL (moldura e esfera só montam com o painel à vista), sem microfone e sem
  wake lock (os dois já só ligam no toque). A `TelaConversa` monta na primeira vez que o painel aparece; o chunk
  pré-carrega em ocioso. Assentou no chat com a conversa andando → `parar()`, freio incluso.
- **Voz dentro do pager:** `touch-action: pan-x` (a direita é do pager; cima e toque seguem nos Pointer Events). O
  que era `fixed` na voz fica contido no painel (`contain`), e as alturas `100dvh` viram `100%` do painel.
- **Tropa (sequência do adendo):** direita no chat, com o pager no começo, abre; esquerda com a tropa aberta fecha e
  fica no chat. Segue o dedo com a mola da folha (`deslize.ts` + `mola.ts`, que ficam). O estado é o do `≡`, lido
  da URL: o gesto troca `?nav=aberto` por `replaceState` — sem entrada nova no histórico e sem ida ao servidor.
- **Disputa com o snap:** no começo do pager a direita não tem dono nativo (o pager não anda antes do começo e o
  overscroll está desligado), então é da tropa; a esquerda é sempre do pager. Com a tropa aberta o dedo está na
  gaveta ou no véu, fora do pager. O eixo trava nos primeiros 10 px; vertical é a rolagem do chat.
- **Some:** `rostos-do-deslize.tsx`, `deslize.module.css`, `use-ida.ts`, `assentaJuntas`, o arrasto manual
  chat→voz e voz→chat e o `router.push` no fim da mola. `use-gestos-da-conversa` volta a só toque e cima.
- **Provas:** `npm test`, `type-check` e E2E novo `e2e/fase3-pager.cjs` (WebKit e Chromium com dedo de CDP),
  incluindo a sequência do adendo com `history.length` e contagem de painéis.

### Entreguei (`components/conversa/`, as duas páginas e uma linha em `components/shell/tropa-ao-vivo.tsx`)

- **`pager-do-agente.tsx`** (novo, com `.module.css`): chat à esquerda, voz à direita, montados na mesma página.
  - Arrasto nativo: `scroll-snap-type: x mandatory`, `scroll-snap-stop: always`, `overscroll-behavior-x: none`,
    barra escondida. Nenhum listener de toque entre chat e voz.
  - Assentou (`scrollend`, ou `IntersectionObserver` a 99% onde não há): o painel vira o ativo e a URL troca por
    `replaceState` — `/agente/canarinho` ⇄ `/conversa/canarinho`, sem entrada nova. `popstate` leva o pager ao
    painel da URL, sem animar.
  - O painel de fora é `inert`. O link da voz na barra (teclado) e o ícone do chat na voz trocam de painel sem
    navegar. Movimento reduzido: a troca pelo link e pelo ícone não anima.
- **`rota-do-pager.ts`** (novo, puro, com teste): painel da URL, URL do painel, quando a rolagem assentou, a URL com
  a tropa.
- **`/conversa/[slug]`** agora redireciona para `/agente/[slug]?tela=voz`. Antes de hidratar, a voz vem primeiro por
  CSS; o efeito de layout desfaz e posiciona no mesmo quadro. O pager devolve a URL para `/conversa/[slug]`.
- **`tela-conversa.tsx`** ganhou `ativa`, `visivel` e `aoIrAoChat`:
  - moldura e esfera (o WebGL) só montam com o painel à vista, a partir de 1%;
  - assentou no chat com a conversa andando → `parar()`, freio incluso;
  - a dica "Arraste para cima" só corre com a voz na tela.
- **CSS da voz:** `touch-action: pan-x` (a direita é do pager; cima e toque seguem nos Pointer Events). O painel da
  voz tem `contain: layout paint`, então o `fixed` da moldura, da esfera e da faixa de baixo anda com ele; as
  alturas `100dvh` viraram `100%`. Saiu a regra `html:has(.tela)`: o documento não rola mais.
- **Tropa** (`arrasto-do-chat.tsx`, reescrito): direita no chat com o pager no começo abre; esquerda com a tropa
  aberta fecha e fica no chat. Segue o dedo e assenta com a mola da folha. Abrir e fechar trocam só o `?nav=aberto`
  por `replaceState`: o estado otimista do `≡` lê essa URL, e nada vai ao histórico nem ao servidor.
- **`use-gestos-da-conversa.ts`** voltou a só toque e cima; `gesto-de-arrasto.ts` sem o gesto do chat.
- **`tropa-ao-vivo.tsx`:** o agente segue aceso na tropa com a URL `/conversa/{slug}` (no desktop ela está à vista).
- **Saíram:** `rostos-do-deslize.tsx`, `deslize.module.css`, `use-ida.ts`, `assentaJuntas` (`mola.ts`), o arrasto
  manual chat→voz e voz→chat e o `router.push` no fim da mola.
- **Painel `?diag=gesto`** (fora do commit) agora mostra o pager: painel ativo, rolagem, quadros seguindo o dedo e
  assentando, voz montada quantas vezes, `history.length` e a decisão (FOI para voz, ABRIU a tropa…).

### Disputa da tropa com o snap

- No começo do pager a direita não tem dono nativo: o pager não anda antes do chat e o `overscroll-behavior-x: none`
  tira a mola da ponta. Então a direita, ali, é da tropa. A esquerda é sempre do pager.
- Com a tropa aberta, o dedo cai na gaveta ou no véu, que estão fora do pager: a esquerda fecha sem disputa.
- O eixo trava nos primeiros 10 px; vertical fica com a rolagem do chat.
- Os ouvintes são passivos, de propósito: nenhum `touchmove` bloqueante fica na frente da rolagem do pager.
- Achado no caminho: a checagem de "origem que rola de lado" barrava tudo, porque o próprio pager rola de lado. Ela
  agora para no pager e só olha o que rola dentro do chat (bloco de código, tabela).

### Provas

- `npm test`: **1087 testes, 1087 passaram** (novo `rota-do-pager.test.ts`). `npm run type-check`: verde.
- **E2E novo** (`e2e/fase3-pager.cjs`, só o `canarinho`; o Daniel só aberto, para rolar). iPhone 15 (393×852).
  **10/10 no Chromium, 10/10 no Chromium com CPU 4× e 10/10 no WebKit.** Nenhum erro de console nem requisição que
  falhou.
  - Chromium com dedo de verdade pelo CDP, passando pela rolagem e pelo snap. No WebKit o toque sintético não rola;
    lá o pager anda por `scrollTo` e a tropa vai pelo toque sintético.
- **Os casos:**
  - entrada direta pela `/conversa`: fica na `/conversa`, o chat não aparece em nenhum quadro antes da voz e o
    histórico guarda o estado do Next;
  - chat → voz → chat pelo dedo: URL certa, `history.length` igual, a voz monta uma vez e fica sem WebGL fora da tela,
    o arrasto não vira toque e o composer digita depois;
  - **do soltar à voz utilizável: 176 ms (CPU 4×: 180 ms), a volta ao chat 177 ms**, com 10 quadros de mola no
    caminho, sem salto;
  - arrasto curto volta; tropa curta volta, para abrir e para fechar;
  - **a sequência do adendo, duas voltas** (direita abre · esquerda fecha · esquerda voz · direita chat): `history.length`
    2 → 2, um pager, dois painéis, uma voz, zero WebGL fora da tela, gaveta sem estilo sobrando;
  - voltar e avançar do navegador levam o pager ao painel certo;
  - link da voz na barra (teclado) e ícone do chat trocam de painel sem navegar; movimento reduzido troca sem animar;
  - rolar o chat não mexe no pager nem na tropa, e o chat rola;
  - na voz, para cima abre as configurações sem começar a conversa (com o `pan-x`).
- Resultados em `e2e/fase3-pager/provas-cpu1.json` e `provas-cpu4.json`. Capturas `393-*` e `1440-*` (chat e voz).

### O que o E2E não prova

- **O iPhone.** Chromium não é Safari, e o WebKit do Playwright não rola com toque sintético. Só o aparelho mostra:
  - o snap do iOS assentando e o `scrollend` chegando (iOS 26.2+; antes disso vale a reserva a 99%);
  - que a direita no começo do pager chega inteira aos ouvintes da tropa, sem o iOS entregar o dedo ao chat.
- **"Sair falando"** não rodei: manda mensagem ao agente, e o briefing pede nada em sessão viva. O caminho é o
  mesmo `parar()` de antes, agora disparado quando o pager assenta no chat.
- **Roteiro no iPhone** (app instalado): a sequência do adendo duas vezes e depois o voltar do sistema, que deve sair
  do cockpit sem "desvoltar" nada; rolar o chat; arrastar um bloco de código de lado.

### Assumi

- **`/conversa/{slug}` redireciona** para a página do chat com `?tela=voz`, em vez de montar outra árvore. É o que
  garante uma instância só de cada painel quando algo navega de verdade (painel, tropa).
- **No desktop a voz fica dentro da folha**, com a tropa à esquerda, como o chat. Antes ela ocupava a janela inteira.
  É consequência do mesmo pager nas duas URLs.
- **A voz aberta uma vez fica montada**, então fica também aberto o stream dela enquanto o chat está na tela.
- **Sair da voz para no assentar**, não no soltar: com arrasto nativo, é o assentar que diz que ela saiu.

### Divergi do combinado

- Nada.

### Não fiz

- Commit e build da 3008. Nada em sessão viva.
- Os E2E antigos `fase3-deslize.cjs` e `fase3-gestos.cjs` testam o desenho que saiu (rosto, troca de rota); ficaram
  como histórico e não valem mais.
- Fechar a tropa **tocando fora** ainda é o caminho do `≡` (`router.push`) e empilha uma entrada. O adendo fala do
  gesto; se o Rica quiser o toque igual, é uma linha no `superficie-otimista.tsx`.

PRONTO-PARA-TESTE — aguardando o veredito da cadeira `teste` (`relatos/fase3-teste.md`).

### Veredito da cadeira `teste` (rodada 3, `relatos/fase3-teste.md`)

- **APROVADO.** Três gestos, carga fria e quente, 5 repetições, WebKit e Chromium com CPU 4×: 30 idas e voltas,
  zero falha.
- Do soltar ao destino utilizável: 199–972 ms, nunca tela preta ou vazia, sem salto.
- Sequência do adendo: `history.length` 2 → 2; camadas iguais no começo e no fim.
- O controle positivo da tela preta não reproduz mais: a classe de defeito saiu com a troca de rota.
- Lacunas, as mesmas daqui: o iPhone e "sair falando".

FIM-DO-PAGER

## Tocar fora fecha a tropa sem empilhar (aprovado pelo Daniel, 27/09)

### Entreguei (`components/shell/superficie-otimista.tsx` e `rede-de-navegacao.ts`)

- **O véu da tropa troca a entrada, não empilha.** O `ir()` ganhou `substitui`, e o véu passa `true`: `router.replace`
  no lugar do `push`. O `<Link>` do véu ganhou `replace`, para o caminho sem JavaScript fazer o mesmo.
- **`levaAUrl`** (novo, puro, em `rede-de-navegacao.ts`, com teste): decide entre `replace` e `push`.
- **A rede de segurança desarma quando a URL muda.** Achado no caminho, e ela dizia que fazia isso, mas só
  desarmava no desmonte:
  - ela conferia 1,2 s depois se a URL tinha saído da de partida;
  - tocar fora e reabrir pelo dedo na hora devolve a URL de partida (`?nav=aberto`);
  - ela lia "não navegou" e **recarregava a página**, empilhando uma entrada e fechando a tropa;
  - agora uma mudança de URL a desarma na hora. A aba velha sem servidor, que é o caso dela, segue coberta: lá a
    URL não muda.
- O `≡` abrindo continua empilhando, como antes; não foi pedido.

### Provas

- `npm test`: **1088 testes, 1088 passaram** (1 novo). `npm run type-check`: verde.
- **E2E, antes e depois** (`e2e/fase3-pager.cjs`, casos novos):
  - `tropa-toque-fora` (abrir pelo dedo e tocar fora, duas vezes): antes, `history.length` **2 → 4** nos dois motores
    (`fase3-pager/antes-do-toque/`); depois, **2 → 2**;
  - `tropa-toque-e-reabre` (tocar fora e reabrir pelo dedo na hora): sem o desarme, a página recarrega, a tropa fica
    fechada e `history.length` vai **2 → 3**, nos dois motores (`fase3-pager/antes-do-desarme/`); com ele, sem recarga,
    tropa aberta, **2 → 2**.
- Bateria inteira do pager: **12/12 no Chromium e 12/12 no WebKit**.

### Não fiz

- Commit e build. Nada em sessão viva.

FIM-DO-TOQUE

## O `≡` também não empilha (aprovado pelo Daniel, 27/09)

### Entreguei (`components/shell/superficie-otimista.tsx`)

- O `BotaoNav` (`≡`) abre e fecha a tropa com `substitui`: `router.replace` no lugar do `push`, e `replace` no
  `<Link>` para o caminho sem JavaScript. Revoga o "o `≡` abrindo continua empilhando" da seção anterior.
- Agora nenhum caminho de abrir ou fechar a tropa empilha: gesto, `≡` e toque fora. Escolher um agente na tropa
  segue empilhando, porque é outra tela.
- Consequência: o voltar do navegador (e o do Android) não fecha mais a tropa; ele sai da tela, como o Rica pediu.

### Provas

- `npm test`: **1088 testes, 1088 passaram**. `npm run type-check`: verde.
- **E2E, antes e depois** (`tropa-pelo-menu`: abrir pelo `≡` e fechar tocando fora, duas vezes): antes,
  `history.length` **2 → 4** nos dois motores (`fase3-pager/antes-do-menu/`); depois, **2 → 2**.
- Bateria inteira do pager: **13/13 no Chromium e 13/13 no WebKit**.

### Não fiz

- Commit e build. Nada em sessão viva.

FIM-DO-MENU
