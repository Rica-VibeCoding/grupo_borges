# Fase 3 — relato da cadeira `ui`

Claude Code `claude-opus-5-5` · 27/09/2026 · sem commit.

## Etapa 1 — pesquisa e direções

`fase3-pesquisa.md` (referências com link e as 3 linhas por direção) e `fase3-direcoes/` (Moldura, Mostrador,
Núcleo em HTML autônomo; `capturar.py` gera mosaico e vídeo com relógio simulado). O Rica escolheu a Moldura, com
a Esfera (o Núcleo) como opção dentro da tela.

## Etapa 2a — Moldura com duas variações e a chave de visual

### Entreguei (`apps/cockpit/components/conversa/`)

- `moldura-conversa.tsx` + `moldura-shader.ts`: a borda da tela como indicador, em WebGL cru. Luz sobe do pé
  (sua vez, âmbar), desce do topo (vez dele, ciano), orbita (pensando, violeta), corre a borda (detector baixando),
  abre uma falha no pé (erro). Clarão na troca de vez. Duas variações: **Fio** (linha nítida, brilho curto) e
  **Aurora** (sem linha, névoa larga em cortinas).
- `chave-de-visual.tsx`: ícone de 44 px no cabeçalho que abre uma folha (o `Drawer` vaul que já existia). Moldura
  com Fio/Aurora; Esfera e Esfera + Moldura aparecem como "Chega na próxima entrega". Escolha no `localStorage`
  (`ck-conversa-visual`), lida por `useSyncExternalStore` — sem erro de hidratação.
- `tela-conversa.tsx` reescrita: título grande à esquerda, "Você disse" com a última transcrição, a resposta do Zé
  enquanto ele fala, avisos e notas. Textos em `leitura-da-conversa.ts` (puro, testado).
- `app/globals.css`: tokens `--ck-conversa-voce/pensa/ze/erro/prepara` apontando para os de estado, mais
  `--ck-conversa-titulo` (48 px) e a entrelinha dele. Saíram `--ck-conversa-esfera*`.
- Apagados: `esfera-conversa.*` e `onda-conversa.*` (órfãos).

### Como funciona, no que importa

- **Zero `setState` por quadro.** O volume virou `ref` em `use-detector-de-fala.ts` e `use-fila-de-voz.ts`;
  `useModoConversa` expõe `leNivel()`. O laço de `requestAnimationFrame` dorme nas cenas paradas (parado, erro) e
  depois que a transição assenta.
- **Contraste por construção.** Dentro da faixa de texto, a partir de 22 px da borda, o shader comprime a luz para
  luminância ≤ 0,05: texto secundário fica ≥ 4,9:1 e o primário ≥ 9:1, qualquer que seja o estado. A luz ainda
  alcança no máximo ~90 px (Fio) ou ~120 px (Aurora) da borda.
- **Pé da moldura fora da barra.** O canvas tem a altura de `100dvh` e o pé da moldura sobe o `--ck-safe-bottom`
  (as laterais entram o `--ck-safe-left/right`); abaixo dele fica só o halo.
- **Movimento reduzido:** quadro fixo por estado, redesenhado só quando o estado muda.
- **Sem WebGL:** cai para uma reserva em CSS (borda e gradiente que ainda acompanham o volume). Contexto perdido
  também cai para ela. Ao desmontar, `WEBGL_lose_context` libera a GPU.
- Cores lidas dos tokens em tempo de execução (canvas 2D de 1 px converte `oklch`/`lab` para sRGB).

### Provas

- `npm test`: **1000 testes, 1000 passaram** (23 novos: `moldura-estado`, `preferencia-visual`, `leitura-da-conversa`). `npm run type-check`: verde.
- E2E da fase 2 adaptado em `docs/modo-conversa/e2e/fase3-ui.cjs` (a sonda de volume lê `data-nivel` da Moldura,
  o movimento reduzido lê `data-movimento`, a transcrição lê `[data-fala="voce"]`; o resto é o roteiro da fase 2):
  **4/4 com o Fio e 4/4 com a Aurora**, na rodada final, com o código entregue. Provas em
  `docs/modo-conversa/e2e/fase3-2a/e2e-fio-provas.json` e `e2e-aurora-provas.json`.
- Capturas da tela real (393 × 852, estados vividos com o `canarinho`, roteiro `e2e/fase3-capturas.cjs`):
  `e2e/fase3-2a/moldura-fio.png`, `moldura-aurora.png` (mosaicos), os 12 quadros soltos e `chave-de-visual.png`.

### Achados

- **R6 apareceu no E2E.** Numa rodada, depois da interrupção, o agente respondeu de novo o texto longo (40 s de
  voz) em vez de "Dois.", e o `longa-2` estourou a espera de 45 s. A tela fez o certo (tocou, voltou a ouvir). Isolado, o
  cenário passou. Não é defeito da tela; é o turno velho do agente, já listado como R6 no plano.
- O dev da 3009 neste PC (subido por outra sessão em 26/09) parou de ver mudança no `globals.css` e servia os
  tokens velhos. Reiniciei só ele, com o mesmo comando (`COCKPIT_DIST_DIR=.next-dev`, porta 3009).
- O primeiro desenho da Moldura, igual ao protótipo, manchava o miolo da tela de marrom com raios até o centro
  quando o volume subia. Só a tela real mostrou isso; o alcance da luz ficou limitado à borda.
- Saiu da tela a nota positiva "Tela mantida acesa"; ficaram só os problemas (não manteve, navegador sem suporte,
  reconectando) e o tempo de carga do detector no estado parado.

### Não fiz

- A Esfera e a combinação (etapa 2b), à espera da coordenação.
- Commit, build e publicação. Nada em `lib/conversa/`.
