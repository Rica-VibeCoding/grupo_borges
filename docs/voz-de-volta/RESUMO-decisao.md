# Voz de volta no cockpit v2 — resumo pra decisão

> Consolidado por Daniel em 11/08/2026, sobre três frentes de pesquisa disjuntas:
> Canário (engines), Hiro (UI) e Tara (auditoria do código). Os documentos-fonte
> ficam nesta mesma pasta. Nada foi implementado — isto é plano, não entrega.

## A pergunta do Rica

O cockpit v2 deve responder em áudio, como já acontece no Telegram: ele manda
voz, o agente responde falando. Ele pediu pesquisa antes de código, quis ver as
opções e abriu a porta pra alternativa melhor do que copiar o Telegram.

## O que já existe (metade do caminho está pronta)

- `POST /api/tts/synth` já sintetiza voz: Google Chirp3-HD, voz própria por
  agente, fallback Microsoft edge-tts. Devolve MP3 binário completo.
  (`apps/api/routers/tts.py:153`)
- O cockpit **v1** já consome isso, com botão por mensagem e reprodução
  exclusiva. (`apps/web/lib/tts-context.tsx`)
- O **v2** tem a entrada de voz inteira — segurar pra gravar, travar, cancelar,
  transcrever, enviar — e **nada** de saída em áudio.
  (`apps/cockpit/components/shell/voz.ts`)

## Os quatro números que decidem

- **10,2s** — o que se espera hoje, em silêncio, antes da primeira palavra de
  uma resposta de 150 palavras. Média de três medições da Tara contra a API
  real. É espera até o áudio **completo**: a rota não tem streaming.
- **5,3×** — a síntese corre mais rápido do que a fala. Medição minha: 122
  palavras levaram 7,54s pra sintetizar e renderam 40,18s de áudio.
- **~1s** — o primeiro som se o servidor sintetizar por sentença e entregar
  progressivamente, em vez de esperar o texto inteiro.
- **US$ 0,00003** — custo de uma resposta falada no Chirp3-HD, com o primeiro
  milhão de caracteres por mês grátis (~1.000 respostas). Custo não é fator.

## A recomendação, em uma frase

Manter o Google Chirp3-HD, cortar o texto em sentenças no servidor e entregar o
áudio progressivamente, com a onda sonora se desenhando à frente do que está
sendo ouvido.

### Por que não trocar de engine

O Chirp3-HD é o melhor pt-BR do grupo avaliado, é a voz que cada agente já tem
no Telegram, e custa praticamente zero. As alternativas — OpenAI
`gpt-4o-mini-tts`, ElevenLabs, Kokoro/Piper locais — ou trocam a identidade
vocal da tropa, ou custam mais, ou disputam os 2 vCPU da VPS. Detalhe e fontes
em `pesquisa-canario-engines.md`.

### Por que não voz nativa (o modelo falando direto)

Faz sentido quando quem *decide* a resposta é quem *fala*. Não é o nosso caso:
Claude Code e Codex não têm modalidade de áudio, e o texto da resposta já está
pronto no JSONL. Usar um modelo multimodal pra ler texto pronto custa ~2.000×
mais (US$ 0,07 contra US$ 0,00003 por resposta) pra ganhar só prosódia. Fica
registrado como o caminho pro dia em que os agentes forem modelos de voz.

### O desenho da tela

Não dá pra ter primeiro som rápido **e** onda sonora exata desde o instante
zero: enquanto o áudio está chegando, o navegador não sabe a duração — a
propriedade devolve infinito, o cabeçalho HTTP que serviria nunca saiu de
provisional, e a marca de duração do MP3 exige saber o total antes de gerar.

A saída é que o servidor **conhece o texto antes de sintetizar**: ele estima a
duração pela taxa de palavras (medida: ~3 palavras/s) e trava a largura da onda
desde o início. A bolha nasce no tamanho final com barras-fantasma, e cada
sentença que chega substitui as fantasmas **no lugar que já era delas**. A
revelação corre ~5× à frente do que está sendo ouvido — a mesma gramática da
barra de carregamento do YouTube, que ninguém lê como defeito.

Descartadas, pela régua "o futuro pode chegar, o passado não pode mudar":
barra que vira onda no meio da reprodução, e onda apagada que acende de uma vez
(muda o que já foi ouvido). Detalhe em `pesquisa-hiro-ui.md` §7.

### O que o iPhone impõe

Não existe caminho sem gesto. Um único toque de opt-in destrava o áudio pra
sessão inteira, desde que o destrave seja síncrono no manipulador do toque e
exista **um** elemento de áudio persistente trocando de fonte — criar um novo a
cada resposta perde o destrave. Instalar como aplicativo não muda a política.

## Três achados da auditoria que mudam o plano

1. **A voz da frota já se perde hoje, em silêncio.** Se o Google falhar, o
   fallback não preserva a voz do agente: troca tudo por `pt-BR-AntonioNeural`.
   Todo agente vira a mesma voz e a resposta não diz que houve degradação.
   (`apps/api/routers/tts.py:141`)
2. **E o gatilho disso é o tamanho da resposta.** A rota aceita 8.192
   caracteres, mas o Google documenta 5.000 **bytes** por chamada. O código não
   mede nem fragmenta. Resposta longa → Google recusa → cai no Edge → voz
   trocada. Quanto mais longa a fala, maior a chance de sair na voz errada.
   (`apps/api/routers/tts.py:86`)
3. **"Esta mensagem nasceu de voz" hoje é um emoji no começo do texto.** Dá
   falso negativo pro Codex (a Tara não recebe a marca) e falso positivo pra
   texto digitado que comece com 🎙. Se a regra for "mandou áudio, recebe
   áudio", ela **não funciona pra Tara** sem virar metadado de verdade.
   (`apps/api/orchestrator/synthetic_message.py:42`)

O achado 3 é pré-requisito da decisão A abaixo. Os achados 1 e 2 são defeitos
existentes que a frente vai expor muito mais, porque hoje quase ninguém usa TTS
no v1.

## O que só o Rica decide

**A. Quando o agente fala.**
- *Espelho do Telegram* — falou por voz, recebe voz. Combina com o hábito e não
  gasta síntese à toa. **Recomendo esta**, com botão de ouvir disponível em
  qualquer mensagem pra quando ele digitou mas quer ouvir. Exige consertar o
  achado 3 antes.
- *Botão em cada mensagem* — mais simples, zero risco, mas obriga um toque toda
  vez. É o que o v1 faz hoje.
- *Tudo falado* — descartada por mim: o feed é 82% registro de execução, e ler
  isso em voz alta vira ruído.

**B. Quem fala.**
- *Só o agente aberto na tela* — **recomendo**. Sintetizar em segundo plano pra
  tropa inteira gasta CPU numa VPS que já vive apertada.
- *Qualquer agente* — só se ele quiser ouvir resposta de agente que não está
  olhando; aí vale discutir notificação em vez de fala automática.

## Sequência sugerida, se aprovado

1. Consertar o achado 3: origem "nasceu de voz" vira metadado explícito no
   `POST /voice`, carregado até os dois ramos de executor. Sem isso, a decisão A
   não se sustenta.
2. Rota de streaming por sentença, com duração estimada e picos por sentença.
   Fonte da conta é do Canário.
3. Consertar os achados 1 e 2 junto: limitar/fragmentar em 5.000 bytes e
   declarar a voz Edge correspondente de cada agente, expondo a degradação.
4. A bolha que fala, no v2, conforme `pesquisa-hiro-ui.md`. Front do Hiro.

## Fontes

- `pesquisa-canario-engines.md` — engines, streaming, custo, voz nativa.
- `pesquisa-hiro-ui.md` — autoplay iOS, anatomia da bolha, onda progressiva.
- `auditoria-tara-stack-atual.md` — contrato real, medição, dívidas, buracos.
