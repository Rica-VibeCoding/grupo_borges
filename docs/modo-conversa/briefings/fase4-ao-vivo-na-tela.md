# Fase 4 — item 6, segunda volta: bug no iPhone + palavras na tela enquanto o Rica fala (cadeira `ui`)

Publicado `ce4bce7` na 3008. Rica testou no iPhone (Safari), 28/09 ~05:17 UTC, com gravação de tela do iOS ligada.

## 1. Bug (primeiro, com teste vermelho)
- Vídeo: ~17 s em "Estou ouvindo", depois direto para **"Não entendi o áudio"** (`transcricaoFalhou`), e embaixo
  "Você disse: “Melhor Estou aproveitando e fazendo os testes aqui, entendeu? Mas aparentemente não tem nada em
  tempo real aqui não”" — o texto DESSA fala.
- Log da API (`/tmp/cockpit-api.log` na VPS): um `POST /daniel/transcription/live-token` 200 e **nenhum**
  `/transcription` (o WAV não chegou ao servidor) nem `/input` com essa fala. A fala não chegou ao agente.
- `ultimaTranscricao` só é gravada dentro de `transcreveu` (`use-modo-conversa.ts`), e a máquina só mostra o erro se
  `falhou` chegou com a cena em `transcrevendo`. Ou seja: `falhou` e `transcreveu` foram chamados os dois, `falhou`
  primeiro. Achar o caminho (suspeitas: WAV lançando no cliente antes da rede — `criaWav` nulo, fetch recusado no
  Safari — somado a texto atrasado do canal; `decide` duplo; dois `transcreveFala` para a mesma fala).
- Regra que não pode quebrar: com texto em mãos, a fala vai ao `/input`. Nunca "Não entendi" com texto na tela.

## 2. O que o Rica imaginou (a entrega do item 6 foi só velocidade)
- Enquanto ele fala, **as palavras aparecem na tela** em tempo real (os `delta` do canal, hoje ignorados), no lugar
  de "Estou ouvindo / Quando você parar, eu envio.". Quando a fala fecha, o texto firme substitui o parcial.
- Canal fora do ar ou lento: a tela segue como hoje, sem texto inventado. Texto parcial nunca vai ao agente.
- Legível no iPhone (fala longa rola, última linha visível). Respeita "Mostrar texto" da configuração, se couber.

## Fecha quando
- Teste vermelho do bug antes do conserto; `npm test` e `type-check` verdes, com números.
- E2E no dev 3009 em **WebKit** também (o bug é do Safari): fala normal chega ao `/input`; palavras aparecem durante a
  fala; OpenAI lenta e WAV falhando não dão "Não entendi" com texto na tela.
- Sem commit. Relato em `relatos/fase4-ui.md` (seção nova). Última linha sozinha: `FIM-DO-AO-VIVO-2`.
