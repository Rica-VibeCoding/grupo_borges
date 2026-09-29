# Rodada da voz — pedidos do Rica (27–28/09/2026, ditados na própria tela de voz)

Modo de trabalho: cadeira `ui`/`logica`/`teste` no PC, sem VPS nem commit. UI se testa clicando na tela
(`browser-harness`); Playwright só para microfone falso, arrastar e WebKit. Commit na VPS com caminho explícito.
Build da 3008 e restart da API só com a janela do Pavan. Link único para o Rica: produção
`https://borges.tailfe77db.ts.net:3446`.

## Feito — em produção desde 28/09 (`9421f00`)
- 1 · Silêncio que entrega a fala: 2 s (`eac75e1`).
- 2 · Segurar a tela (dedo parado ≥ 0,5 s) para pensar sem entregar (`eac75e1`, `2881b22`).
- 4 · Marca 🗣 da tela de voz + skill `conversa-por-voz` (`a0ff331`; ze_claude `1f5561e`).
- 5 · Foto do agente, direções B e C com chave, avatares 512 (`c6cd90b`). Header (foto + nome) confirmado
  centralizado no teste do Rica em 29/09 — nada a fazer.
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

## Feito — provado com o Canário real em 29/09, ainda sem commit/publicação (cadeira `ui`)
- **Frases de apoio na mesma voz/rota das respostas** (5 de espera + 5 de demora, sem repetir a anterior, sem
  contar como turno fechado). ⚠️ Divergiu do combinado: erro que acontece enquanto o agente fala agora corta a
  fala (só com fone — um alto-falante só não toca os dois juntos).
- **Cor do "pensando" na esfera**: mistura entre o dourado de "ouvindo" e o azul de "falando", com prova de
  matiz medida (com WebGL 41°→133°→190°; sem WebGL 37°→131°→194°; moldura 40°→131°→190°). 🟡 Decisão do Rica: o
  meio saiu verde-sálvia claro (apagado) — ver ao vivo antes de fechar.
- Detalhe e prova: `relatos/fase4-ui.md` (seções "Frases de apoio" e "Mistura de cor"). Falta: commitar e
  publicar na 3008 (janela do Pavan), e o Rica conferir no iPhone.

## Em andamento (cadeira `ui`, ordem do Rica 29/09)
- **Cor própria pro aviso "agente ocupado"**, separada do vermelho de erro real — `briefings/fase4-cor-agente-ocupado.md`.
  Depois dela: item 1 da "Próxima lista" (conversa que sobrevive a recarga).

## Achados de 29/09 (registrados)
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
