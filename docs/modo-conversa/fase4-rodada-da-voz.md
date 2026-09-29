# Rodada da voz — pedidos do Rica (27–28/09/2026, ditados na própria tela de voz)

Modo de trabalho: cadeira `ui`/`logica`/`teste` no PC, sem VPS nem commit. UI se testa clicando na tela
(`browser-harness`); Playwright só para microfone falso, arrastar e WebKit. Commit na VPS com caminho explícito.
Build da 3008 e restart da API só com a janela do Pavan. Link único para o Rica: produção
`https://borges.tailfe77db.ts.net:3446`.

## Feito — em produção desde 28/09 (`9421f00`)
- 1 · Silêncio que entrega a fala: 2 s (`eac75e1`).
- 2 · Segurar a tela (dedo parado ≥ 0,5 s) para pensar sem entregar (`eac75e1`, `2881b22`).
- 4 · Marca 🗣 da tela de voz + skill `conversa-por-voz` (`a0ff331`; ze_claude `1f5561e`).
- 5 · Foto do agente, direções B e C com chave, avatares 512 (`c6cd90b`).
- 6 · Transcrição ao vivo com as palavras na tela e WAV de reserva (`f80d826`).
- 7 · Fala do agente palavra por palavra ao longo de cada áudio, janela de 3 linhas, estados
  pensando / trabalhando / falando só com som, animações (View Transition nativa, CSS) (`c6cd90b`).
- Consertos da rodada: flushSync do feed, menu de conta que rolava, hidratação no iPhone (`803e498`).
- Detalhe e provas: `relatos/fase4-ui.md`, `relatos/fase4-teste.md`; briefings em `briefings/fase4-*.md`.

## Próxima lista
1. **Conferir no iPhone (Rica):** falar por cima congela a legenda; o aviso "Não consegui manter a tela acesa" não
   aparece.
2. **Conversa que sobrevive a recarga:** hoje uma recarga da página (ou salvar arquivo no dev) volta a tela ao
   "parado" e perde a conversa em curso. Pedido do Rica em 28/09.
3. **Voz MiniMax só na tela de voz, uma voz para todos** (item 3). A rota é a mesma (`POST /api/tts/synth/stream`,
   motor no corpo); `falar.py` já tem o motor. Chave com o Pavan (cofre); contar uso em
   `~/.claude/metrics/tts-uso.jsonl`; o Rica escolhe a voz ouvindo opções.
4. **Versão enxuta só da voz para a Dani falar com a Miga** (item 8): a tela e quatro serviços (transcrever,
   entregar à sessão, ler a resposta, gerar voz), endereço próprio, Miga na Oracle.
5. **Arestas da voz:** avisar o agente quando o Rica corta a voz dele; limpar número e símbolo antes do TTS; nome
   técnico falado sai errado na transcrição (ex.: "Canário" → "Canada") — `keywords`/modelo do bilhete.
6. **Arestas de teste:** bateria B com "Mostrar texto" desligado (Chromium e WebKit) não terminou; erro no console do
   WebKit ao mudar configuração no meio da conversa ("URL is not valid or contains user credentials");
   `e2e/fase4-ao-vivo-2.cjs` ainda espera `origin: 'stt'` (o código manda `voz`).
7. **Miúdos:** o menu do motor na gaveta pode ter o mesmo problema de não virar pra cima que o de conta tinha; a
   moldura sem WebGL ainda repinta gradiente com `--nivel-da-voz` (decisão do Pavan).
