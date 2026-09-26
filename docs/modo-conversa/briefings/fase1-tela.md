# Fase 1 — trilha TELA (cadeira `tela`)

Plano guia: `docs/cockpit-v2-modo-conversa-PLANO.md` (leia inteiro, inclusive os achados da Fase 0). Contrato: `apps/cockpit/lib/conversa/tipos.ts`. Leia `AGENTS.md` do repo e o `CLAUDE.md`/`AGENTS.md` de `apps/cockpit` antes do primeiro edit.

## O que entregar
- Rota `apps/cockpit/app/conversa/[slug]/` + `components/conversa/`: tela separada; o composer e a tela do agente ficam intocados.
- Botão de entrada: atalho na barra do agente (`components/shell/barra-de-telas.tsx:86`).
- Um toque em "Começar conversa" destrava, no MESMO gesto: áudio (`destravaNoGesto`, `components/feed/reprodutor-unico.ts`), microfone e Wake Lock (readquirir no `visibilitychange`).
- Detector: `@ricky0123/vad-web` 0.0.31, `model: 'v5'`, tempos de `TEMPOS` do contrato. Na fala terminada: `utils.encodeWAV` → `Blob` `audio/wav` → `postAgentTranscription` (a rota já aceita WAV desde `efda525`).
- Envio: `postAgentInput(slug, texto, {origin:'stt'})`. Fim do turno: `isRunning` de `useCanarioStream`. Voz: cada texto novo do assistente → `pedeFala` (`components/feed/stream-voz.ts:86`).
- A máquina é da cadeira `logica` (`lib/conversa/maquina.ts`, função `avanca` do contrato), sendo escrita EM PARALELO. Construa contra o tipo `Avanca`; enquanto ela não existir, um stub seu em `components/conversa/` resolve — nunca escreva em `lib/conversa/`.
- Visual simples: estado escrito + onda. Estado "preparando" visível enquanto o motor carrega, botão travado até ficar pronto.

## Achados da Fase 0 que viram requisito
- Motor `ort-wasm-simd-threaded.wasm` = 13,9 MB e o `next.config` tem `compress: false`: no iPhone levou ~28 s. Comece a baixar ao abrir a tela, antes do toque. Meça e relate o tempo.
- Os arquivos do motor/modelo vão para `public/` por cópia a partir do `node_modules` (script), NÃO commitados no git (16 MB de binário).

## Regras
- Você é dono do lockfile: `pnpm install` na raiz (o clone está sem `node_modules`) e a única dependência nova, `@ricky0123/vad-web`.
- Inclua `lib/conversa/*.test.ts` e os testes seus no glob de `test` do `apps/cockpit/package.json`.
- Context7 da versão exata do `vad-web` e do Next 16 antes de codar.
- Fecha quando: `npm test` e `npm run type-check` verdes; tela aberta no `next dev` (porta 3009) do PC mostrando os estados. A conversa de 3 turnos com um Zé real é o teste da coordenação.
- NÃO tocar: backend, `reprodutor-unico.ts` (outro dono; se precisar, relate), `lib/conversa/`.
- Não commitar. Relato em `docs/modo-conversa/relatos/fase1-tela.md`: o que fez, saída de teste/type-check, tempo de carga do motor, dúvidas.
- Se enxergar furo no contrato ou neste briefing, o seu caminho vale: você está com o código na frente. Escreva no relato.
