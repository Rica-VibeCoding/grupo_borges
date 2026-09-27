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
