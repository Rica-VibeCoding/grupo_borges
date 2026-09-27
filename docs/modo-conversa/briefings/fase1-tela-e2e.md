# Fase 1 — teste de ponta a ponta (cadeira `tela`)

Alvo: agente **`canarinho`** (alvo de teste de envio da casa; nenhum outro). Tela: `http://localhost:3009/conversa/canarinho` no seu `next dev`.

Áudios prontos em `docs/modo-conversa/e2e/turno1.mp3`, `turno2.mp3`, `turno3.mp3` (voz sintética; cada um pede ao Canário uma resposta de uma palavra). Não commitar essa pasta.

## Fazer
- Substituir o microfone por esses arquivos (ex.: `getUserMedia` devolvendo um `MediaStreamAudioDestinationNode` que toca `turnoN.mp3` quando o detector estiver em `ouvindo`), sem mudar código de produção — só no navegador de teste.
- Rodar os 3 turnos seguidos, sem clique entre eles: fala → fim detectado → transcrição → envio → resposta falada → volta a ouvir → próximo arquivo.

## Provas que eu quero no relato (seção nova "E2E canarinho")
1. Para cada turno: texto transcrito, horário do envio, texto que o Canário respondeu, e se o `POST /api/tts/synth/stream` saiu e tocou até o fim.
2. Tempos por turno: fim da fala → envio; envio → primeira voz; fim da voz → detector ligado de novo.
3. Confirmação de que o detector ficou DESLIGADO enquanto a voz tocava (estado da máquina ou log).
4. Se a frase-ponte ou o aviso de demora dispararam em algum turno.
- Eco no alto-falante e tela bloqueada ficam para o iPhone do Rica — não simular.
- Sem commit. Se algo quebrar, relate o defeito com o passo que reproduz antes de consertar.
