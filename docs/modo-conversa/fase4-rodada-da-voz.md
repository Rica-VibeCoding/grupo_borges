# Rodada da voz — pedidos do Rica (27–28/09/2026, ditados na própria tela de voz)

Modo de trabalho: cadeira `ui`/`logica`/`teste` no PC, sem VPS nem commit. UI se testa clicando na tela
(`browser-harness`); Playwright só para microfone falso, arrastar e WebKit. Commit na VPS com caminho explícito.
Build da 3008 e restart da API só com a janela do Pavan. Link único para o Rica: produção
`https://borges.tailfe77db.ts.net:3446`.

## Feito — em produção desde 28/09 (`9421f00`)
- 1 · Silêncio que entrega a fala: 2 s (`eac75e1`).
- 2 · Segurar a tela (dedo parado ≥ 0,5 s) para pensar sem entregar (`eac75e1`, `2881b22`).
- 4 · Marca 🗣 da tela de voz + skill `conversa-por-voz` (`a0ff331`; ze_claude `1f5561e`).
- 5 · Foto do agente na pílula presa no alto (`c6cd90b`); o Eclipse, a chave de direção e os avatares 512
  saíram em 30/09 (`6fa1b31`). A pílula deixou de ser centralizada
  em 30/09 (ver abaixo).
- 6 · Transcrição ao vivo com as palavras na tela e WAV de reserva (`f80d826`).
- 7 · Fala do agente palavra por palavra ao longo de cada áudio, janela de 3 linhas, estados
  pensando / trabalhando / falando só com som, animações (View Transition nativa, CSS) (`c6cd90b`).
- Consertos da rodada: flushSync do feed, menu de conta que rolava, hidratação no iPhone (`803e498`).

## Feito — em produção desde 29/09 (`5cdf43e`)
- **Microfone:** um `getUserMedia` por conversa — não pede permissão de novo a cada volta (`5cdf43e`,
  módulo `microfone-da-conversa.ts`). Confirmado no ar; volume/rota da voz dele com microfone aberto no iPhone
  ainda não medido de verdade (WebKit de teste não tem áudio nem microfone).
- **Voz do canal do Canário** (parte do item 3): fora do `FLEET_VOICES` ele caía na `FranciscaNeural` do edge,
  degradado. Agora fala pela key do Google, `pt-BR-Chirp3-HD-Kore` (feminina, não divide com a Tara), reserva
  Francisca (`7c18efb`). Confirmado ao vivo na rota. **Ainda falta** decidir se isso é a voz MiniMax do item 3
  (Rica não decidiu) — hoje é só Google, não MiniMax.
- Detalhe e provas: `relatos/fase4-ui.md`, `relatos/fase4-teste.md`; briefings em `briefings/fase4-*.md`.

## Feito — em produção desde 29/09 01:16 (`6bc8b16`, publicado pelo Daniel, sem cadeira)
- **Microfone no fim do composer, só no desktop** (pedido do Rica em 29/09): primeiro botão da direita com o
  composer em repouso; o clique rola o pager para a tela de voz. Aparece só com mouse (`pointer: fine`); no
  celular fica como estava (deslize). Disco de véu, recua durante a gravação. Build anterior guardado em
  `apps/cockpit/.next-anterior-011555`.

## Feito — em produção desde 29/09 01:40 (`1575e90`, publicado pelo Daniel; build anterior em `apps/cockpit/.next-anterior-014035`)
- **Frases de apoio na mesma voz/rota das respostas** (5 de espera + 5 de demora, sem repetir a anterior, sem
  contar como turno fechado). ⚠️ Divergiu do combinado: erro que acontece enquanto o agente fala agora corta a
  fala (só com fone — um alto-falante só não toca os dois juntos).
- **Cor do "pensando" na esfera**: mistura entre o dourado de "ouvindo" e o azul de "falando", com prova de
  matiz medida (com WebGL 41°→133°→190°; sem WebGL 37°→131°→194°; moldura 40°→131°→190°). **Decidido (Rica,
  29/09): mantém o verde-sálvia apagado, sem mudar para a alternativa de verde vivo no meio do caminho** — o
  meio passa a ~131–133°, perto demais do `--ck-state-ok` (150°, "concluído" em todo o cockpit); passar pelo
  verde vivo aumentaria essa colisão. Nada a fazer aqui.
- Detalhe e prova: `relatos/fase4-ui.md` (seções "Frases de apoio" e "Mistura de cor"). Falta: commitar e
  publicar na 3008 (janela do Pavan), e o Rica conferir no iPhone.

- **Cor própria do aviso "agente ocupado"** (`briefings/fase4-cor-agente-ocupado.md`): lilás 270°, contraste
  5,55:1 (raised) e 5,29:1 (composer); o erro real segue vermelho (1°). A esfera fica **inteira e parada** no
  ocupado — a rachada lia como "quebrou" (decisão do Daniel, delegada pelo Rica). Provado com o Canário ocupado
  de verdade (409 real, marca `OCUPADO-REAL-OK`). Captura: `e2e/fase4-ocupado/lado-a-lado.png` (no PC).
- **Tudo desta seção está só no clone do PC, sem commit.** Em produção (3446) ainda roda a versão velha: uma
  frase de apoio fixa (`FRASE_PONTE`), noutra voz — é o que o Rica ouviu no teste de 29/09 01:1x.

- **Conversa que sobrevive a recarga** (`briefings/fase4-conversa-sobrevive-recarga.md`, fechou 29/09 ~01:45):
  o aparelho guarda só até que texto do agente a voz tocou inteiro (`sessionStorage`, 30 min, por aba); depois
  da recarga a tela mostra "pensando"/"trabalhando"/"resposta pronta" lendo o stream, e **um toque** ("toque
  para continuar") toca o que ficou e volta a ouvir. Parar ou sair da tela apaga a marca. Um toque em todo
  aparelho: iOS exige gesto para áudio (MDN); o Chrome deixaria sem toque (medido). Provado com o Canário real
  no Chrome (recarga no pensando, no meio da voz, depois de parar); 1352/1353 testes, `tsc` limpo. Divergência:
  `lib/conversa/tipos.ts` ganhou o evento `retomar` (só acréscimo). Detalhe: `relatos/fase4-ui.md`.

## Feito — em produção desde 30/09 (`c5256f0`, publicado pelo Pavan)
- **Agente desligado** na tela: esfera apagada com brasa, e o botão Ligar no rodapé (`cfd997a`, `1402c4b`).
- **Pílula:** borda esquerda presa, a foto não anda; só o fundo (camada própria, `motion` `layout`) estica em
  mola quando o estado muda (`b622be3`, `24ca624`).
- **Arrastar para cima está livre:** a folha de configurações saiu; os controles moram só na gaveta do agente,
  aberta pela foto (`a20bbd3`). O gesto segue lido (`'cima'` em `gesto-de-arrasto.ts`), sem ação.
- **Frase de apoio variada:** abertura sorteada antes ("Rica…", "Olha,") e, 1 em 5, fecho depois ("Já volto.")
  — `enfeite-do-apoio.ts`. **Volume no iPhone:** microfone aberto prende o WebKit em modo de chamada (som de
  telefone, botões de volume mortos), e soltar e religar a cada frase de apoio fazia a voz alternar entre os dois.
  Sem fone, o microfone fica fechado enquanto o agente pensa ou fala; falar por cima na espera só com "Estou de
  fone" (`e48e294`, `dc6dfb1`). Conferido pelo Rica no iPhone em 30/09.
- **Permissão do microfone:** web app da Tela de Início no iOS pergunta a cada abertura, e de novo com o
  microfone parado mais de 1 min (WebKit 215884). Não há ajuste do nosso lado; aba do Safari com o site em
  "Permitir" não pergunta.

## Próximo passo (Rica)
- Conferir no notebook e no iPhone as quatro entregas acima, e repetir o gesto de parar o Canário e falar por
  cima (o "Não entendi o áudio" de 01:16:58), agora sem publicação no meio.
- `apps/cockpit/instrumentation-client.ts` (diagnóstico do gesto) ficou só no clone do PC, fora do commit.

## Achados de 29/09 (registrados)
- **Teste do Rica no notebook, 29/09 01:12–01:18 (Canário, 3446):**
  - *Voz de apoio diferente da do agente e poucas frases* — é a versão velha em produção (acima); o conserto
    está no PC, não publicado.
  - *Parar o agente e falar por cima: a fala seguinte deu "Não entendi o áudio"* (01:16:58). Nenhum áudio saiu
    do navegador (sem `live-token` nem `transcription` no `/tmp/cockpit-api.log`), e a aba tinha sido forçada a
    recarregar 1 min antes pela publicação do microfone (restart da 3008 às 01:15:55). A fala seguinte
    (01:17:51) chegou inteira. Hipótese: efeito da publicação, não defeito do interromper. **Pendente:** o Rica
    repetir o gesto sem publicação no meio; se falhar de novo, reproduzir com microfone falso e consertar.
  - Nome na transcrição: "Canário" saiu "Canábis" e "Canar" (item 4 da próxima lista).
- **Canário estava desligado de propósito** (cockpit, 28/09 23:12, junto com o Vinicius); religado pelo Daniel
  em 29/09 ~01:00 para as provas da `ui`. Desligar de novo quando a rodada fechar, se era por memória.
- **Permissão de microfone a cada início de conversa:** esclarecido que não deveria pedir de novo sem recarregar a
  aba (o navegador guarda a permissão por site); se acontecer de novo mesmo sem reload, é caso à parte do conserto
  do `5cdf43e` — investigar quando reproduzir.

## Próxima lista
1. **Conversa que sobrevive a recarga:** hoje uma recarga da página (ou salvar arquivo no dev) volta a tela ao
   "parado" e perde a conversa em curso. Pedido do Rica em 28/09.
2. **Voz MiniMax só na tela de voz, uma voz para todos** (item 3, ainda em aberto — a voz do Canário acima foi só
   Google). A rota é a mesma (`POST /api/tts/synth/stream`, motor no corpo); `falar.py` já tem o motor. Chave com
   o Pavan (cofre); contar uso em `~/.claude/metrics/tts-uso.jsonl`; o Rica escolhe a voz ouvindo opções.
3. **Versão enxuta só da voz para a Dani falar com a Miga** (item 8): a tela e quatro serviços (transcrever,
   entregar à sessão, ler a resposta, gerar voz), endereço próprio, Miga na Oracle.
4. **Arestas da voz:** avisar o agente quando o Rica corta a voz dele; limpar número e símbolo antes do TTS; nome
   técnico falado sai errado na transcrição (ex.: "Canário" → "Canada") — `keywords`/modelo do bilhete.
5. **Arestas de teste:** bateria B com "Mostrar texto" desligado (Chromium e WebKit) não terminou; erro no console do
   WebKit ao mudar configuração no meio da conversa ("URL is not valid or contains user credentials");
   `e2e/fase4-ao-vivo-2.cjs` ainda espera `origin: 'stt'` (o código manda `voz`).
6. **Miúdos:** o menu do motor na gaveta pode ter o mesmo problema de não virar pra cima que o de conta tinha; a
   moldura sem WebGL ainda repinta gradiente com `--nivel-da-voz` (decisão do Pavan).
