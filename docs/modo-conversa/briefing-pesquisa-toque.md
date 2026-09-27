# Briefing — um toque inicia, um toque para (Daniel → Canário, 27/09/2026)

**Pedido do Rica:** "1 toque inicia; 1 toque, se já iniciado, para. Mas tem que ser completo, entender as
nuances da conversa." A tela inteira vira o botão (menos Voltar e configuração, no topo). Antes de codar,
quero o desenho VALIDADO por quem já faz isso, e o que o nosso backend faz em cada caso.

**Leia antes:** `grupo_borges/docs/cockpit-v2-modo-conversa-PLANO.md` (riscos, em especial R6),
`docs/modo-conversa/pesquisa-desenho.md` (a sua pesquisa de 26/09) e a máquina
`apps/cockpit/lib/conversa/tipos.ts` + `maquina.ts` (estados: parado, ouvindo, transcrevendo, esperandoZe,
falando, interrompendo, erro).

**Perguntas, nesta ordem:**
1. **Apps de referência** (ChatGPT voz, Gemini Live, Siri, Claude voz, ElevenLabs/Hume, walkie-talkie tipo
   Zello): o que um toque na tela faz em cada momento — ouvindo, pensando, falando. Toque durante a fala
   dele: corta a voz e volta a ouvir, ou encerra tudo? E toque acidental: como protegem (área, tempo, retomar)?
2. **Cada estado nosso:** proponha o que o toque faz em cada um dos sete, com o porquê. Em especial:
   parar enquanto eu ainda falo (a frase vai ou é descartada?), parar enquanto transcreve, parar
   esperando o Zé, parar enquanto ele fala.
3. **Backend — o turno do Zé:** quando a conversa para com o Zé pensando ou falando, o que acontece hoje do
   lado do servidor (`apps/api`): o turno continua gerando? a resposta aparece no chat de texto depois? a
   próxima fala chega colada (R6, `absorbed_mid_turn`)? Existe hoje um jeito de mandar Esc/cancelar o turno
   pela API? Leia o código, não suponha — cite arquivo e linha.
4. **Retorno ao usuário:** o que se usa para confirmar um toque sem texto na tela (som curto, mudança de
   forma, vibração — e o que o Safari do iPhone permite de verdade).

**Entrega:** `grupo_borges/docs/modo-conversa/pesquisa-toque.md`, até ~120 linhas. Por pergunta:
ACHADO · EVIDÊNCIA (link com data, ou arquivo:linha) · RECOMENDAÇÃO. Fecha com uma lista
"estado → o que o toque faz". Separe o que a fonte PROVA do que você supõe.

**Limites:** não toque em código, não commite. Só crie o arquivo.
**Ao terminar:** `tmux -L borges-daniel send-keys -t daniel -l '[canario] pesquisa do toque pronta em <caminho>'`
e o Enter numa segunda chamada.
