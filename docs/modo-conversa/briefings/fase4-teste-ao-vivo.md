# Fase 4 — item 6: cadeira `teste` valida a transcrição ao vivo

Relato da `ui`: `relatos/fase4-ui.md`, última seção ("transcrição ao vivo na tela de voz"). Briefing dela:
`briefings/fase4-transcricao-ao-vivo.md`. Código no PC, sem commit (`git status` mostra os arquivos).

## Validar, no dev 3009, com seu próprio roteiro (não reuse o `e2e/fase4-ao-vivo.cjs` dela sem ler)
- Fala normal: o texto chega pelo canal ao vivo, **sem** subir o WAV, e vai ao `/input` com `origin: "stt"`.
- Queda: bilhete negado e canal que cai no meio → a fala chega pelo WAV, uma vez só, sem duplicar `/input`.
- Texto firme que não vem em 1 s → WAV decide; texto atrasado do canal **não** vai ao agente depois.
- Fala descartada pelo detector (estalo curto) não vai ao agente nem sobra colada no turno seguinte.
- Segurar (item 2) com o canal ligado: texto inteiro, fim ~2 s depois de soltar.
- Sair de `ouvindo` (parar, agente falando) fecha o canal; nenhum WebSocket fica aberto.
- Regressão: toque, segurar, gestos (seus E2E da fase 4).

## Ajuste seu
- `e2e/teste/fase4-segurar.cjs` conta o bilhete (`/transcription/live-token`) como transcrição. Corrija a contagem.

## Regras
- Não edite código de produto. Não fale com agente de verdade (só `/input` interceptado, ou Canário se precisar).
- Relato em `relatos/fase4-teste.md`, seção nova. Última linha da resposta: `APROVADO` ou `REPROVADO`, e depois
  `FIM-DO-TESTE-AO-VIVO` sozinha na linha.
