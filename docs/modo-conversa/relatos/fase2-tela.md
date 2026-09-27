# Fase 2 — relato da trilha TELA

Cadeira `tela` · 26/09/2026 · sem commit.

## Entreguei

- Esfera no lugar da onda, com volume RMS do microfone e envelope dos picos do TTS sincronizado à posição real da reprodução. O backend fornece picos de 0 a 31; a tela normaliza para 0 a 1. Gradiente e sombra ficam em tokens de `globals.css`.
- `prefers-reduced-motion`: elimina escala e transições; o volume ainda altera a opacidade, sem movimento.
- Chave **Estou de fone**, desligada inicialmente, com alvo de 44 px e evento `fone` do contrato. Explicação visível da diferença entre esperar a resposta e falar por cima.
- Silero: `onSpeechStart` → `falaIniciou`, `onSpeechRealStart` → `falaConfirmada`, misfire → `falaDescartada`. Durante `falando`/`interrompendo`, `minSpeechMs=500` e `redemptionMs=2000`; ao ouvir normalmente, restaura 400/1400. Usa `setOptions` da versão instalada 0.0.31, sem criar outro detector.
- Executor dos três efeitos novos; relógio de 250 ms também em `interrompendo`. Perda de captura/visibilidade também cobre a escuta com fones durante a resposta.
- Cancelamento invalida callbacks antigos, aborta síntese, esvazia textos e sequência de áudio, revoga URLs e zera os picos. Áudio tardio de uma geração descartada é revogado sem tocar.
- `mensagem-de-erro.ts` extraído para manter o hook abaixo de 300 linhas.
- Testes de reprodução/volume e roteiro reproduzível em `docs/modo-conversa/e2e/fase2-tela.cjs`. O roteiro usa Chrome de teste isolado, Silero e backend reais; mensagens somente para `canarinho`. A resposta longa inicial é preparada por um envio textual de teste, e a interrupção usa o `turno2.mp3` injetado no `MediaStream`, como na fase 1.

## Toque no arquivo de outro dono

`apps/cockpit/components/feed/reprodutor-unico.ts`: acrescenta `pausa()`/`retoma()` à sequência, com trava local de pausa para impedir autoplay de sentenças que chegam enquanto o usuário fala. Retomar usa o mesmo elemento e preserva `currentTime`. `para()` agora checa o dono antes de parar: uma sequência descartada não pode parar o turno seguinte. A fila já era descartada por `para()`; não foi criado outro reprodutor. A pausa que aborta uma promessa de `play()` ainda em voo não dispara mais falha de autoplay: teste reproduziu o falso erro antes do ajuste e passou depois.

## Provas finais

- `npm --prefix apps/cockpit test`: **971 testes, 971 passaram, 0 falharam**. Saída local: `%TEMP%/fase2-tela-testes.log`.
- `npm --prefix apps/cockpit run type-check`: **verde** após integração da lógica.
- `node --test apps/cockpit/components/conversa/*.test.ts`: **12/12 verdes**. Inclui posição preservada, fila pausada, descarte, isolamento entre donos, aborto de `play()` por pausa e escala correta dos picos de 0 a 31.
- `git diff --check`: sem erros. Nenhum arquivo da trilha ultrapassa 300 linhas. O projeto não define script de lint.
- E2E em Chrome headless isolado, **393 × 852**, backend e Silero reais, alvo único `canarinho`. **4/4 cenários passaram em duas rodadas completas**; a última foi executada depois do conserto da corrida de `play()`.
- Provas persistidas no repo: [eventos, posição, volume e requisições](../e2e/fase2-tela-provas.json), [captura mobile](../e2e/fase2-tela-mobile.png), [roteiro](../e2e/fase2-tela.cjs). O roteiro resolve Playwright normalmente ou pelo módulo indicado em `PLAYWRIGHT_MODULE`; exige dev na 3009, API acessível e os áudios da fase 1 na mesma pasta.

- **Sem fone:** chave inicialmente desligada; microfone fechado durante a voz; 0 transcrições e nenhum segundo envio apesar da tentativa de injetar fala. Esfera variou com os picos reais do TTS.
- **Fala curta de 200 ms:** pausa após 183 ms; retomada após 2.002 s. Mesmo blob, posição 0.855 → 0.855 s (avanço do relógio do áudio ao disparar `playing`, sem reiniciar); 0 transcrições. Estado `falando → interrompendo → falando`.
- **longa:** início injetado → pausa 144 ms; pausa → confirmação/descarte 453 ms; fim físico → transcrição 1.077 s; envio aceito → voz nova 3.845 s. Transcrição e segundo envio reais: “Agora responda só com a palavra: Dois.”; resposta “Dois.”; voltou a `ouvindo`.
- **longa-2:** início injetado → pausa 170 ms; pausa → confirmação/descarte 453 ms; fim físico → transcrição 1.062 s; envio aceito → voz nova 4.301 s. Transcrição e segundo envio reais: “Agora responda só com a palavra: Dois.”; resposta “Dois.”; voltou a `ouvindo`.

- Nas duas falas longas, todas as URLs criadas antes da confirmação foram revogadas; nenhuma voltou a emitir `playing`. A síntese ainda em voo foi abortada e a resposta seguinte usou URLs novas.
- Volume do microfone e volume da voz variaram; o roteiro confirma múltiplos níveis reais durante `falando`. `prefers-reduced-motion: reduce` resultou em `transform: none`. Chave medida com alvo ≥44 px. Captura mobile inspecionada, sem corte horizontal.
- Os 500 ms do Silero são quantizados por quadros de 32 ms: 15 quadros (480 ms), com `onSpeechStart` no primeiro e `onSpeechRealStart` no décimo quinto. Por isso o intervalo entre os dois callbacks fica perto de 448 ms; a tela usa exatamente `TEMPOS.confirmaFalaPorCima`.

## Assumi

- Não publicar nem construir produção nesta fase: o plano reserva publicação e aparelho físico à fase 3.
- A esfera segue picos reais da síntese, normalizados por sentença, e não faz uma animação genérica de fala. Isso evita criar outro `AudioContext`/reprodutor ou alterar a saída de áudio do Safari.

## Divergi do combinado / achados

- Configurei também os 2 s de silêncio do Silero durante fala por cima, além dos 500 ms de confirmação. O relógio da máquina continua sendo o limite independente de confirmação.
- Durante integração, identifiquei que `falaIniciou` apagava `zeAcabou`/`vozAcabou` anteriores. Avisei a cadeira lógica por `psmux -L conversa`; ela preservou os flags. Não editei `lib/conversa/`.
- Ensaios preliminares: uma tentativa foi invalidada por recarga do dev durante edição; outra confirmou a fala mas não recebeu `onSpeechEnd` dentro de 15 s. Essa segunda ocorrência não teve causa estabelecida e não é apresentada como corrigida. Não se repetiu nas duas rodadas completas finais. Evidência da tentativa permanece em `%TEMP%/fase2-tela-e2e-segunda/provas.json`; investigar se voltar a ocorrer no aparelho físico.
- Pesquisa: Context7 `/ricky0123/vad`, API `setOptions`, `onSpeechRealStart` e `onFrameProcessed`, confirmadas nas declarações e implementação do pacote instalado.

## Não fiz

- Sem commit, build, publicação, mudança de backend, core, composer, cockpit v1 ou arquivos da cadeira lógica.
- Sem teste físico de eco, iPhone ou tela bloqueada, reservados à fase 3.

## Estado de entrega

Fase 2 da trilha tela concluída, sem commit. Dev desta sessão permanece local em `127.0.0.1:3009`, com `.next-dev`; produção não foi tocada. Próximo passo do plano: revisão da coordenação e fase 3 no iPhone.
