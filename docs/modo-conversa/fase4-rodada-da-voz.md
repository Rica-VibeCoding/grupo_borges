# Rodada da voz — oito pedidos do Rica (27/09/2026, ditados na própria tela de voz)

Levantados com o Rica testando a 3008 (`6bef077`). Nada implementado ainda: esta página é o ponto de partida da
próxima rodada, com contexto limpo. Cada item diz o que ele pediu, o que já existe no código e o que falta decidir.
O modo de trabalho não muda: cadeira `ui`/`logica` no PC, **APROVADO da cadeira `teste` antes de qualquer link**
(`briefings/fase3-cadeira-de-teste.md`), commit na VPS, build da 3008 e restart da API só com janela do Pavan.

## 1. Silêncio que entrega a fala: 1,4 s → 2 s
- ✅ Feito (`eac75e1`, publicado na 3008 em 27/09, cadeira `teste` APROVADO, relatos `fase4-ui.md`/`fase4-teste.md`).
- Hoje: `TEMPOS.silencioFimDeFala = 1400` em `apps/cockpit/lib/conversa/tipos.ts` (o `redemptionMs` do Silero em
  `use-detector-de-fala.ts`).
- Pedido: 2 s. Recomendação dada e aceita: não passar de 2 s (cada resposta começa 0,6 s mais tarde).

## 2. Segurar a tela para pensar sem entregar a fala
- ✅ Feito (`eac75e1`, mesmo relato). Ressalva: com CPU 4× o detector ocupa a thread principal ~1,6 s e o segurar
  acende tarde; o vigia do microfone também pode dar alarme falso. Conferir no iPhone antes de mexer.
- Pedido: no meio da própria vez, apertar e segurar a tela para parar a contagem do silêncio; soltar retoma os 2 s.
- Conflito conhecido: **um toque para a conversa** (`43b23a4`, `pesquisa-toque.md`). Desenho proposto e aceito:
  toque rápido continua parando; dedo **parado** por ≥ 0,5 s segura a vez; ao soltar volta a contar.
- Cuidar da convivência com os gestos da voz (direita → chat, cima → configurações): segurar é dedo parado, gesto é
  dedo que anda.
- Palavra falada para segurar ("peraí") não dá: o detector é VAD (voz/silêncio), não entende palavra ao vivo. Encher a
  pausa com "éééé" já segura hoje.

## 3. Voz MiniMax só na tela de voz — uma voz para todos os agentes
- Hoje: o áudio sai de `POST /api/tts/synth/stream` (`apps/api/routers/tts.py`, Google Chirp3-HD/WaveNet com
  Edge de reserva), cliente `apps/cockpit/components/feed/stream-voz.ts` — a MESMA rota do "ouvir" do chat.
- Pedido: MiniMax **só** no modo conversa; o resto da frota segue no Google. **Uma voz só** para todos os agentes, e
  a escolha da voz é do Rica (levar opções para ele ouvir).
- Antes de codar: confirmar com o Pavan onde está a chave MiniMax (ele tem; possivelmente no cofre) e registrar o
  uso no contador `~/.claude/metrics/tts-uso.jsonl` como os outros motores. Context7/doc oficial da API MiniMax.
- Como separar: a tela de voz pede o motor na mesma rota (campo no corpo), sem rota paralela.

## 4. Hook + skill de conversa por voz
- 🟡 Feito, esperando publicação. Rica aprovou em 28/09 as 11 regras da pesquisa (guias OpenAI, ElevenLabs, Vapi,
  LiveKit, Deepgram e VoiceMode). Skill `ze-shared/.claude/skills/conversa-por-voz` + ramo 🗣 no
  `cockpit-load-skill.sh` (ze_claude `1f5561e`); `/input` com origem `voz` entrega `🗣 ` (`a0ff331`).
  ⚠️ Publicar a API ANTES do cockpit: cliente novo com API velha = 422 em toda fala.
  Fica para depois: avisar o agente quando o Rica corta a voz dele, e limpar número/símbolo antes do TTS.
- Pedido: quando a mensagem vem da tela de voz, o agente conversa de um jeito natural: avisa antes de tarefa longa
  ("vou pesquisar e já volto"), responde curto e falado (sem lista, tabela nem código) e manda o que é de ler/detalhe
  **pelo Telegram**, dizendo na voz "deixei os detalhes no Telegram".
- Hoje: a fala chega ao agente com o prefixo `🎙 ` (`agents.py`, `send_message(sessão, f"🎙 {transcribed}")`); o
  cockpit já carrega a skill `canal-cockpit` por hook (`ze-shared/hooks/cockpit-load-skill.sh`).
- Falta: **distinguir a tela de voz do microfone do chat** — os dois chegam com `🎙` hoje. Marca própria para o modo
  conversa, hook `UserPromptSubmit` que injeta a skill nova, skill em `ze-shared/.claude/skills/` (frota inteira).
  Hook e skill moram no `ze_claude`, não neste repo.

## 5. Foto do agente na tela de voz
- 28/09 — Rica escolheu **B (Atividade ao vivo) e C (Eclipse)**, `fase4-direcoes/`, com uma chave em
  "Configurações da conversa" para alternar. Junto: a tela parada nova (vale para as duas). Foto dos agentes tem
  128 px — a C pede ≥ 512 px. Entra depois do conserto do item 6 (mesma tela).
- Hoje a tela mostra o nome do agente e um ícone de chat. Pedido: a foto do agente, com cara da UI futurística.
- Desenho aceito: retrato redondo, escurecido e dessaturado (não briga com a esfera), aro de luz na cor da moldura,
  aro pulsa quando o agente fala. O ícone de chat sai (o gesto direita → chat já leva).
- A foto é a mesma da cápsula do chat (`components/shell/capsula-do-agente.tsx`).

## 6. Transcrição ao vivo na tela de voz
- 🟡 Em conserto. `ce4bce7` foi ao ar em 28/09 sem teste no iPhone e travou em "Não entendi" com texto de fala
  anterior; revertido (`32bb0a2`). Para o Rica, "ao vivo" é a palavra aparecendo na TELA enquanto fala, não latência.
  Causa: a 3008 reiniciou 11 vezes durante o teste (85 s fora às 05:16 UTC) e o WAV que caía não subia de novo.
  Segunda volta (briefing `fase4-ao-vivo-na-tela.md`): WAV re-sobe na queda, texto da vez (`fala-da-vez.ts`) e
  palavras parciais na tela. Vai ao ar só depois do teste do Rica no iPhone pelo dev.
  Pendente: precisão de nome técnico falado (modelo do bilhete ou `keywords`), depois do teste do Rica no iPhone.
- Hoje: a tela de voz espera o fim da fala e sobe o arquivo fechado (`POST /api/agents/{slug}/voice` →
  `gpt-4o-transcribe` por script, com `ffmpeg`). Estimativa de 1 a 2 s só nisso — **medir antes**, não está medido.
- Já existe o caminho ao vivo no microfone do chat: `components/shell/usa-fala-ao-vivo.ts` (WebSocket direto do
  navegador para a OpenAI Realtime, `gpt-live-transcribe`, bilhete cunhado em `agents.py`, `_LIVE_STT_*`). O texto fica
  pronto quando a fala acaba. Reusar na tela de voz.
- Cuidado: o VAD que decide o fim da fala (itens 1 e 2) continua sendo o do cockpit; o ao vivo só adianta o texto.

## 7. Legenda em tempo real da fala do agente
- Pedido: com "Mostrar texto" ligado (folha de configurações, `configuracao-da-conversa.tsx`), a fala do agente
  aparece como legenda enquanto ele fala.
- Viável: o texto chega antes do áudio e a voz já é sintetizada frase por frase. Começar **por frase** (troca junto
  com o áudio de cada frase). Palavra por palavra fica para depois — o tempo seria estimado e escorrega.

## 8. Versão enxuta só da voz, para a Dani falar com a Miga
- Pedido: a tela de voz sozinha, sem o cockpit inteiro, num endereço próprio. O Rica instala o Tailscale no celular
  da Dani e ela conversa com a Miga (que roda na Oracle, não na VPS).
- Estimativa dada: cerca de um décimo do cockpit. Leva a tela e quatro serviços: transcrever a fala, entregar o texto
  à sessão da agente, ler a resposta, gerar a voz. Fica de fora painel da frota, feed, tropa.
- Entra depois dos itens 1–7, reaproveitando o que eles deixarem pronto (transcrição ao vivo, voz, legenda).

## Ordem sugerida
1 e 2 (lógica, pequenos) → 6 (latência, o maior ganho de experiência) → 7 → 5 → 3 (depende da chave e da escolha
de voz do Rica) → 4 (fora deste repo) → 8. Medir a latência ponta a ponta (fim da fala → primeira sílaba do agente)
antes do 6 e depois do 3, para o ganho ser número e não impressão.

## Anotações do Rica durante o teste (não esquecer)
- 28/09 — **Tela parada da voz** ("Conversa por voz / Um toque para começar. Depois é só falar." + "Detector pronto em
  2,2 s"): "horrível perto da ideia da UI que estamos criando, não comunica com o que a gente está fazendo". Refazer
  junto com o item 5 (foto do agente, cara futurística).
