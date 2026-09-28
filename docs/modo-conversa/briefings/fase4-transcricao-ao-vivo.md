# Fase 4 — item 6: transcrição ao vivo na tela de voz (cadeira `ui`)

Pauta: `docs/modo-conversa/fase4-rodada-da-voz.md`, item 6. Objetivo único: o texto da fala do Rica ficar pronto
quando ele termina de falar, em vez de subir o WAV fechado e esperar a transcrição.

## Medido antes (servidor, VPS, 28/09)
- `/tmp/cockpit-api.log`, 58 envios reais da tela de voz (`POST /api/agents/{slug}/voice`, WAV):
  `elapsed_ms` mínimo 749, **mediana 1531**, p90 2129, máximo 3304. Isso é só o servidor: o envio do WAV
  (170–620 KB) do iPhone pela rede não está contado.

## O que já existe (reusar, não reescrever)
- `components/shell/usa-fala-ao-vivo.ts` + `fala-ao-vivo.ts`: WebSocket do navegador para a OpenAI Realtime,
  bilhete em `POST /api/agents/{slug}/transcription/live-token`, commit manual, espera o texto `firme`.
  Hoje o fim é o dedo do Rica no chat. Aqui o fim é o **detector de fala** (VAD) dos itens 1 e 2.
- Entrega de texto já pronto, sem mudar a API: `POST /api/agents/{slug}/input` com `origin: "stt"` chega ao agente
  como `🎙 <texto>`, exatamente como o `/voice` entrega, e devolve `event_boundary_id` (ver `lib/usa-envio.ts`).

## Regras
- O VAD continua sendo quem decide o fim da fala (silêncio de 2 s, segurar com o dedo). O canal ao vivo só adianta
  o texto: no fim da fala → commit → texto firme → `/input`.
- Rede de segurança obrigatória: bilhete falhou, canal não abriu, texto firme não veio a tempo, texto vazio →
  sobe o WAV pelo `/voice` como hoje. O Rica nunca perde a fala.
- Fala descartada pelo VAD (curta demais, misfire) não pode ir para o agente nem sobrar colada no próximo turno:
  limpar o buffer do canal.
- Canal só aberto enquanto a vez é do Rica (`ouvindo`); fechar ao sair. Nada de áudio do agente entrando no canal.
- A API não muda (se achar que precisa, pare e me diga por quê antes).
- Context7 antes de mexer no protocolo Realtime (eventos de commit/clear).

## Fecha quando
- Teste vermelho antes para a regra pura nova (ex.: qual caminho usar e quando cair no WAV).
- Medição dos dois caminhos com o MESMO instrumento no cliente: do fim da fala (VAD) até a resposta do envio
  (`/voice` antigo × `/input` novo). No dev 3009, Chrome com áudio falso de arquivo
  (`--use-file-for-fake-audio-capture`), pelo menos 5 falas por caminho, pt-BR de verdade. Números no relato.
- Queda para o WAV provada: bilhete negado ou canal fechado → a fala chega pelo `/voice`.
- `npm test` e `type-check` verdes, com números.
- Não falar com agente de verdade além do Canário (`canarinho`), e só se precisar provar a entrega real.
- Sem commit. Relato em `relatos/fase4-ui.md` (seção nova). Última linha: `FIM-DO-AO-VIVO`.
