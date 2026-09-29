# Fase 4 — frases de apoio na voz do agente, cinco variações (cadeira `ui`)

Base: main `5cdf43e` (já inclui seu conserto do microfone). A API já manda o canal `canarinho` para o Google, voz
`pt-BR-Chirp3-HD-Kore` (commit `7c18efb`; vale na 3008 depois do restart da API).

## Ordem do Rica (29/09)
Todo som falado na tela de voz sai **na mesma voz e pela mesma rota das respostas** (`POST /api/tts/synth/stream`,
slug do agente). Hoje três falas saem pela voz do navegador (`sons().fala()` → `speechSynthesis`) em
`use-modo-conversa.ts`: `falarPonte` (`FRASE_PONTE`), `avisarDemora` (`FRASE_DEMORA`) e `avisarErro`.

## Pedido
1. As três passam pela rota de TTS do agente. `speechSynthesis` só como reserva se a própria rota falhar (o aviso de
   erro não pode ficar mudo quando o TTS é que caiu).
2. Cinco frases para a ponte e cinco para a demora, sorteadas sem repetir a anterior, no espírito do Rica:
   "Só um momento, Rica", "Já estou vendo isso pra gente", "Um instante", "Deixa comigo", "Estou pensando".
   Curtas, naturais, sem pontuação que o TTS leia estranho.
3. **Cuidado (medido pelo Canário):** a frase de apoio NÃO entra na `useFilaDeVoz` do turno sem marca — o
   `aoTerminar` dela dispara `vozTerminou` e a máquina contaria a ponte como resposta pronta. Chame o TTS fora da fila
   do turno (ou item marcado que não fecha turno). Resposta real que chega com a ponte tocando: a ponte corta, sem
   sobrepor.
4. Latência: a ponte existe para cobrir espera; se a síntese da ponte demorar mais que ~600 ms, pré-sintetize as
   frases ao abrir a tela (cache por agente) em vez de pedir na hora.

## Regras
- Teste vermelho antes: efeito `falarPonte` não chama `speechSynthesis` e não emite `vozTerminou`; sorteio não repete.
- Teste real: `browser-harness` + Playwright com microfone falso e o Canário real, ouvindo pela rede que a ponte sai
  de `/api/tts/synth/stream` com `slug=canarinho`. Console limpo.
- Não reinicie o dev 3009 sem parar antes. Proibido: VPS, commit, agente real além do Canário. Teto 30%.

## Fecha quando
`npm test` e `type-check` verdes, com números; relato em `relatos/fase4-ui.md` (seção nova). Última linha sozinha:
`FIM-DAS-FRASES`.
