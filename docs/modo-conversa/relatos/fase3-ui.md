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

## Etapa 2b — Esfera com duas variações e a combinação

### Entreguei (`apps/cockpit/components/conversa/`)

- `esfera-conversa.tsx` + `esfera-shader.ts` + `esfera-estado.ts`: a Esfera (o Núcleo do protótipo) em WebGL cru,
  por raymarching. Duas variações:
  - **Matéria**: corpo sólido com luz de frente. Ondula puxada para baixo quando você fala, solta ondas quando o Zé
    fala, acende veios quando pensa, vira gema na interrupção, encolhe e racha no erro, enche e esvazia de luz
    enquanto o detector baixa.
  - **Vidro**: casca escura, borda acesa e a luz morando dentro. A luz desce para você quando você fala, pulsa em
    anéis quando ele fala, vira duas luas orbitando quando pensa; no erro a fissura brilha.
- **Esfera e moldura**, duas variações:
  - **Juntas**: Matéria e Fio mostram o mesmo momento.
  - **Divididas**: a borda é a sua vez e a esfera é a vez dele; cada uma descansa na vez da outra. Na interrupção
    aparecem as duas: você sobe pela borda, ele congela na esfera.
- `preferencia-visual.ts`: as três opções liberadas na chave; `pecasDoVisual` decide que peça desenha qual cena
  (puro, testado). Saiu o "Chega na próxima entrega".
- Tela: com esfera, ela ocupa o palco entre o cabeçalho e as palavras, que descem para perto dos comandos; o título
  encolhe para 36 px (token novo `--ck-conversa-titulo-com-esfera`).

### Como funciona, no que importa

- Mesmo contrato da Moldura: volume em `ref`, zero `setState` por quadro, laço que dorme em parado e erro, contexto
  liberado ao desmontar, reserva em CSS (um círculo que ainda cresce com a voz) e quadro fixo por estado no
  movimento reduzido.
- **30 fps quando pesa**: média móvel do intervalo entre quadros; passou de 24 ms, a Esfera desenha um quadro sim,
  outro não, e fica assim (estável é melhor que oscilando).
- **A luz só existe no palco.** O desenho cobre a tela inteira, atrás de tudo, mas some nos últimos 48 px do palco:
  a esfera desliza quando a resposta do Zé cresce e encolhe o palco, sem ser cortada e sem passar por trás das
  palavras. Medido nas capturas, logo acima do título: luminância até 0,018 com a Esfera sozinha (o fundo é 0,010) e
  até 0,05 na combinação — o teto que a Moldura já garante.
- Canvas da Esfera transparente (alfa pré-multiplicado): na combinação, a Moldura aparece por trás dela.

### Provas

- `npm test`: **1012 testes, 1012 passaram** (12 novos: `esfera-estado` e as peças de cada visual em
  `preferencia-visual`). `npm run type-check`: verde.
- E2E da fase 2 (`e2e/fase3-ui.cjs`, agora lendo todas as peças: o maior volume entre elas, `data-movimento` e
  `data-desenho` em cada uma, a opção em `main[data-opcao]`): **4/4 em cada uma das seis variações** — Matéria,
  Vidro, Juntas, Divididas, e de novo Fio e Aurora, porque o código comum mudou. A Juntas perdeu o `longa` na
  primeira volta com 409 do backend ao semear o pedido (`agent_pane_unavailable`, antes de a conversa começar);
  rodada inteira de novo, 4/4. Provas em `e2e/fase3-2b/e2e-*-provas.json`.
- Capturas da tela real (393 × 852, estados vividos com o `canarinho`): mosaicos `e2e/fase3-2b/esfera-materia.png`,
  `esfera-vidro.png`, `esferaMoldura-juntas.png`, `esferaMoldura-divididas.png`, os 24 quadros soltos e
  `chave-de-visual.png` (as seis variações na folha). Mosaico feito por `e2e/mosaico.py`.

### Achados

- **Movimento reduzido pintava tudo de âmbar, inclusive a Moldura da 2a.** A regra global do reduzido dá transição
  de 0,01 ms a todo elemento, e a leitura das cores dos tokens reaproveitava a mesma sonda: cada troca de cor virava
  transição e a leitura devolvia a anterior. Todas as cores saíam iguais à primeira (âmbar), fundo inclusive.
  Corrigido com uma sonda nova por token. O E2E da 2a só conferia o atributo `data-movimento`, por isso passou.
- No dev (StrictMode), o efeito do WebGL roda duas vezes; o segundo pegava o mesmo canvas cujo contexto o primeiro
  tinha liberado, e a Esfera caía para CSS. Agora cada montagem cria o seu canvas (vale para a Moldura também).
- O halo da Esfera virava um disco com borda quando a voz subia (a conta mudava na esfera-limite da marcha) e um
  anel no erro (usava raio fixo com a esfera encolhida). Agora é radial e parte do raio real da forma.
- O dev da 3009 parou de novo de ver o `globals.css` (servia sem o token novo). Reiniciei só ele, com o mesmo comando.

### Não fiz

- Commit, build e publicação. Nada em `lib/conversa/`.
- Aparelho de verdade: a medida de 30 fps e a barra do Safari ficam para a fase 4, no iPhone.

## Ajuste pós-iPhone — tela limpa

### Entreguei (`apps/cockpit/components/conversa/`)

- Na tela ficam o visual, **um** botão (Começar / Encerrar / Retomar) e o cabeçalho com Voltar, o nome do agente e
  o ícone de configurações.
- `configuracao-da-conversa.tsx` (no lugar de `chave-de-visual.*`): a folha ganhou **Estou de fone** e **Mostrar
  texto** (desligado), acima da escolha de visual. As duas ficam no aparelho (`ck-conversa-fone`,
  `ck-conversa-texto`), lidas como o visual (`use-preferencias-conversa.ts`, no lugar de `use-visual-conversa.ts`).
- `useModoConversa(slug, fone)`: o fone chega da folha e cada troca vira o mesmo evento `fone` da máquina. O
  comportamento não mudou.
- Texto só com "Mostrar texto": título, detalhe, "Você disse" e a resposta. Desligado, o estado continua no nó
  `aria-live` (visualmente oculto), com "Você disse: “…”" enquanto ele pensa.
- Linha junto do botão (`avisoQuePedeAcao`, puro e testado), só para o que pede ação: erro, detector que não
  carregou, voz do Zé bloqueada pelo navegador, tela não mantida acesa.
- Esfera sem texto: palco inteiro, no meio da tela.
- Moldura sem texto: só segura a luz em volta do cabeçalho, então a borda aparece inteira nas laterais (antes
  a luz era comprimida em toda a faixa do texto).

### Provas

- `npm test`: **1017 testes, 1017 passaram** (5 novos: as chaves guardadas no aparelho, a linha junto do botão e o
  "Você disse" para o leitor de tela). `npm run type-check`: verde.
- E2E (`e2e/fase3-ui.cjs`, agora conferindo a tela limpa, ligando o fone pela folha e lendo a transcrição no nó
  `aria-live`): **4/4 com o Fio e 4/4 com a Matéria**. Provas em `e2e/fase3-limpa/e2e-*-provas.json`.
- Capturas da tela real (393 × 852, estados vividos com o `canarinho`): mosaicos `e2e/fase3-limpa/moldura-fio.png`
  e `esfera-materia.png`, os quadros soltos (mais o `parado` de cada uma) e `configuracoes.png` (a folha aberta).

### Achados

- **O `globals.css` velho no dev da 3009 era o cache do Turbopack**, não o observador de arquivos: reiniciar não
  resolvia, porque o dev relia o CSS antigo de `.next-dev/dev/cache/turbopack`. Apagar só esse cache (é do dev, a
  produção não usa) e subir de novo resolveu.
- A sessão do `canarinho` caiu às 00:53 e o backend recusava o envio (`sessao_ausente`). O E2E esperou ela
  voltar; nada da tela.

### Não fiz

- Commit, build e publicação. Nada em `lib/conversa/`.
