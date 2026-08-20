# Mapa do Composer — terreno para a refatoração de UI/UX

> Leitura de `apps/cockpit/components/shell/composer.tsx` (1316 linhas) — mapa pré-refatoração, sem proposta de solução.
> Toda afirmação cita a linha no formato `composer.tsx:NNN`. Referências a módulos externos citam o arquivo deles.
> Gerado em 20/08 a pedido do Daniel.

**Contagem de hooks no componente** (corrige a estimativa inicial de 9 useState + 8 useEffect):
- **8 `useState`** diretos no arquivo: `composer.tsx:164,196,252,258,321,327,332,396` — mais 2 vindos do hook `usaRascunho` (`texto` e `origemDoRascunho`, `composer.tsx:191`), totalizando 10 fontes de estado local.
- **5 `useEffect`** diretos: `composer.tsx:171,334,349,371,658` — mais **1 `useEffectEvent`** (`drenarFila`, `composer.tsx:635`). Os demais efeitos vivem dentro dos hooks compostos (ex.: `usa-rascunho.ts` tem 2).

---

## 1) Inventário de estado

### 1.1 `useState` locais

| Estado | Tipo | Quem escreve | Quem lê |
|---|---|---|---|
| `texto` (via `usaRascunho`, `:191`) | `string` | onChange do campo (`:819`), seleção da bolha (`:796`), `mesclaTranscricao` no STT (`:405`), limpeza no envio (`:522`,`:558`,`:583`), `armarNovaConversaTara` (`:477`), `editarDaFila` (`:669`) | value do textarea (`:811`), placeholder (`:897`), slot enviar/voz (`:1029`), `bolhaComandosAberta` (`:283`), auto-grow (`:376`) |
| `origemDoRascunho` (via `usaRascunho`, `:191`) | `'text' \| 'stt'` (`usa-rascunho.ts:47`) | `origemDepoisDaEdicao` (`:821`), STT (`:406`), limpeza (`:523`,`:559`,`:584`,`:478`), bolha (`:798`), `editarDaFila` (`:670`) | `enviar` para decidir `origem` (`:464`) → eco pendente (`:602`,`:608`) |
| `pesquisaAtiva` (`:196`) | `boolean` | toggle do botão (`:972`) | `prefixaPesquisa` (`:470`), aria/título/cor do botão (`:973`–`:984`) |
| `parando` (`:252`) | `boolean` | `interromper` (`:266`,`:276`) | prop `parando` da `BolinhaAgente` (`:731`) |
| `interrompido` (`:258`) | `boolean` | `interromper` (`:270`), reset no `enviar` (`:532`) | `gerando` (`:259`) |
| `fila` (`:321`) | `EstadoDaFila` (`fila-de-envio.ts:44`) | enfileira (`:520`), drenagem (`:640`,`:643`,`:648`), `editarDaFila` (`:668`), `soltaPausa` (`:742`) | `drenarFila` (`:637`), `BlocoDaFila` (`:740`) |
| `avisoDaPorta` (`:327`) | `string \| null` | `enviar` (`:505`), `subirAudio` (`:400`), efeito de limpeza (`:345`) | render (`:1177`) |
| `sinalRecusa` (`:332`) | `boolean` | `enviar` (`:511`,`:566`), `onAnimationEnd` limpa (`:1047`) | classe do botão enviar (`:1051`) |
| `falhaDaFala` (`:396`) | `Impedimento \| null` | `subirAudio` (`:401`,`:414`), `enviar` (`:586`), botão dispensar (`:1217`) | `avisoDaVoz` (`:434`), render (`:1198`) |
| `touch` (`usaTecladoTouch`, `:164`) | `boolean` | `matchMedia` (`:167`), listener de mudança (`:174`) | `enterKeyHint` (`:858`), guarda do Enter (`:882`) |

### 1.2 `useRef`

| Ref | Tipo | Escrita | Leitura |
|---|---|---|---|
| `textoAtualRef` (`:192`) | `string` | todo render (`:193`) | só limpa o campo se nada mudou (`:557`) |
| `substituicaoIntegralRef` (`:194`) | `boolean` | `onBeforeInput` (`:832`) | lido+reset no `onChange` (`:825`) — detecta seleção integral pra origem do rascunho |
| `origemDoUltimoEnvio` (`:195`) | `OrigemEnvio` | `enviar` (`:614`) | reenvio na `acionar` (`:700`,`:716`) |
| `compactPendenteRef` (`:316`) | `boolean` | `enviar` (`:574`), reset nos efeitos (`:351`,`:358`) | efeito de cancelamento (`:357`) |
| `contadorFila` (`:322`) | `number` | `enviar` (`:518`) | id do item da fila (`:519`) |
| `textareaRef` (`:288`) | `HTMLTextAreaElement` | — (atribuído pelo React) | auto-grow (`:372`), foco pós-STT (`:408`), `editarDaFila` (`:671`), `BolhaDeComandos` (`:800`) |
| `botaoAnexoRef` (`:302`) | `HTMLButtonElement` | — | costura o foco entre o `+` e a gaveta (`:957`,`:1160`) |

### 1.3 Máquinas de estado EXTERNAS (estado que não mora no componente)

O componente já delega a maior parte do estado a máquinas próprias, em libs:

| Máquina | Instância | Fases | Fonte |
|---|---|---|---|
| Envio (texto) | `envio.estado` (`:284`) | `ocioso\|enviando\|aceito\|confirmado\|nao-confirmado\|falhou` | `lib/envio.ts:15` |
| Anexo | `anexo.estado` (`:295`) | `ocioso\|escolhido\|enviando\|erro\|sucesso` | `usa-anexo.ts:50` |
| Compact | `estadoCompact` (`:310`) | `ocioso\|compactando\|concluindo\|sem-retorno` | `lib/compact.ts:36` |
| Voz/gravador | `gravador.fase` (`:420`) | `ociosa\|pedindo\|gravando\|cancelando\|travada\|transcrevendo\|impedida` | `voz.ts:32` |
| Canal de entrega | `canalBloqueado/destravaFalhou` (`:381`) | — | `usa-canal-entrega.ts:47` |
| Turno vivo (feed) | `turnoVivo` (`:246`) | stream externo | `useSyncExternalStore`, `:246` |
| Escrita viva (feed) | `escrevendo` (`:251`) | stream externo | `useSyncExternalStore`, `:251` |
| Frota | `agents` (`:206`) | — | `usaFrota`, `frota-provider` |

### 1.4 Candidatos a reducer / máquina única

- **`avisoDaPorta` + `sinalRecusa` + `falhaDaFala`** (`:327`,`:332`,`:396`) são três estados para o mesmo conceito — "um gesto foi recusado" — e poderiam ser um único nó de feedback de recusa.
- **`parando` + `interrompido` + `gerando`** (`:252`,`:258`,`:259`) descrevem o ciclo do ■; hoje `gerando` é derivado e `interrompido` é um override local (`:259`). Candidato a estado de "turno" explícito.
- **`pesquisaAtiva`** (`:196`) é a única configuração persistente local; trivial de absorver.
- **Não são candidatos**: `texto`/`origemDoRascunho` (persistidos, `usa-rascunho.ts`), `fila` (máquina própria), e todas as máquinas externas da seção 1.3.
- A máquina maior — o **modo visual do composer inteiro** — é derivada (seção 3) e é o alvo natural de um estado único.

---

## 2) Inventário de efeitos

| Efeito | Deps | Dispara | O que faz | Risco |
|---|---|---|---|---|
| `usaTecladoTouch` (`:171`) | `[]` | montagem | assina `matchMedia('(pointer: coarse)')` e atualiza `touch` (`:174`) | nenhum; cleanup presente (`:176`) |
| Limpeza do aviso da porta (`:334`) | `[travaCompact, faseLocal, anexoEmVoo, gerando]` (`:347`) | qualquer trava/fase mudar | zera `avisoDaPorta` quando nenhum impedimento está ativo (`:345`) | escreve estado derivado de **4 fontes combinadas** — o aviso nasce em `enviar` (`:505`) e morre aqui; é efeito que implementa um modo implícito |
| Pendência do compact (`:349`) | `[faseLocal, estadoCompact.fase, cancelarCompact]` (`:361`) | fase do envio ou do compact mudar | reseta `compactPendenteRef` no `concluindo`/`sem-retorno` (`:351`); cancela o compact se o envio falhou (`:357`) | sincroniza duas máquinas externas via ref; janela entre `enviar` (`:574`) e o eco do compact |
| Auto-grow do campo (`:371`) | `[texto]` (`:376`) | texto mudar | `height='auto'` → `scrollHeight` (`:374`) | leitura de DOM; depende só de `texto`, não do anexo (a miniatura cresce por flex, `:791`) |
| Drenagem da fila (`:658`) | `[estadoCompact.fase, faseLocal, fila]` (`:660`) | espera ou fila mudar | chama `drenarFila` (`useEffectEvent`, `:635`) que despacha o próximo item com `retomada:true` (`:647`) | **dupla execução** mitigada por `reagiuAsFases` devolver o MESMO objeto sem novidade (`:632`, `fila-de-envio.ts:104`); corrida de despacho é serializada pela porta (`envio-em-voo`) |

**Nota:** o `drenarFila` é `useEffectEvent` (`:635`) justamente para ler a fila sem depender dela como reação (`:624`) — o que dispara é a espera, não a fila; a fila está nas deps para a drenagem continuar (`:652`).

---

## 3) Modos do composer

**Não existe um `modo`. O modo visual é DERIVADO de uma combinação implícita de booleanos e fases** — não há fonte única de verdade. Cada modo abaixo é decidido por variável diferente, e vários ramos condicionais re-combinam os mesmos predicados.

| Modo visual | Variável(ais) que decidem | Onde aparece |
|---|---|---|
| **Idle / repouso** | `emCaptura === false` + `travada === false` + `travaCompact === false` + `faseLocal === 'ocioso'` | campo editável (`:818`), botão voz (`:1066`) |
| **Ouvindo (captura)** | `emCaptura = capturando(faseVoz)` = `gravando\|cancelando\|travada` (`:429`, `voz.ts:446`) | placeholder "Ouvindo…" (`:898`), `readOnly` (`:818`), `OndaCompacta` (`:962`), fio (`:1109`) |
| **Gravação travada (áudio longo)** | `travada = faseVoz === 'travada'` (`:430`) | botão Descartar (`:922`), botão ■ (`:1010`), instrução (`:1248`) |
| **Transcrevendo / pedindo STT** | `faseVoz === 'transcrevendo' \| 'pedindo'` (`:1109`,`:1124`) | fio percorrendo (`:1124`), botão de voz desabilitado (`:1069`) |
| **Microfone impedido / STT falhou** | `faseVoz === 'impedida'` (`:435`) ou `falhaDaFala` (`:436`) | faixa `avisoDaVoz` (`:1198`), instrução suprimida (`:1247`) |
| **Compactando** | `travaCompact = fase compactando\|concluindo` (`:312`) | placeholder (`:901`), `+` desabilitado (`:956`), `BarraCompact` (`:735`) |
| **Enviando / aceito / confirmado** | `faseLocal` (`:285`) → `aparenciaDe` (`:385`) | borda/filete (`:393`,`:768`), fio (`:1109`), linha de estado (`:1266`) |
| **Insuficiência na porta** | `faseLocal === 'nao-confirmado'\|'falhou'` (`:383`) | `usaCanalEntrega` consulta o back (`:381`), ações na linha (`:1266`,`:679`), fio travado (`:1132`) |
| **Agente gerando** | `gerando = !interrompido && (sessaoCodexProcessando \|\| (vivo && (trabalhando \|\| turnoVivo)))` (`:259`) | ■ na `BolinhaAgente` (`:730`), trava na porta (`:496`) |
| **Rascunho pronto p/ enviar** | `texto.trim() \|\| retidoAnexo !== null` (`:1029`) | botão enviar sólido (`:1039`) |
| **Pesquisa do canarinho** | `pesquisaAtiva` (`:196`, só quando `agentSlug === 'canarinho'`, `:197`) | botão toggle (`:969`), `prefixaPesquisa` (`:470`) |
| **Fila de espera** | `fila.itens.length > 0` | `BlocoDaFila` (`:739`) |
| **Rascunho de voz (edição)** | `origemDoRascunho === 'stt'` (`:191`) + texto | eco com `MARCA_VOZ` (`:602`), mescla (`:405`) |

**Conclusão para o Rica:** hoje o estado visual do composer é o produto implícito de ~10 booleanos/fases que se sobrepõem em vários pontos do JSX (os dois ternários de botão `:922`/`:1010` e o da base `:961` recombinam os MESMOS predicados `travada`/`emCaptura`/`texto`). Uma refatoração teria um modo explícito único como alvo — mas isso é desenho, não este mapa.

---

## 4) Fronteiras: layout/apresentação × lógica

**Lógica misturada em apresentação (pontos de acoplamento):**

- **Auto-grow do campo** (`:371`–`:376`): lógica de layout via efeito de DOM no meio de estados de negócio — é a ÚNICA lógica que escreve na árvore.
- **`sinalRecusa` via animação** (`:1051`,`:1047`): estado transportado por classe CSS e limpo por `onAnimationEnd` — apresentação carregando estado de decisão.
- **`key` distinta nos ramos de botão** (`:1012`,`:1040`,`:1067`): o comentário (`:1006`) explica que sem a `key` o React muta o `type` do nó e o clique vira submit — comportamento de runtime resolvido por detalhe de apresentação.
- **Guarda de composição IME** no `onKeyDown` (`:859`–`:892`): lógica de entrada de texto (acentuação em português) dentro de prop de evento.
- **`origemDepoisDaEdicao` + `onBeforeInput`** (`:830`–`:834`,`:821`): lógica de proveniência do rascunho (voz vs texto) costurada ao evento DOM.
- **`onPaste` de imagem** (`:843`–`:850`): lógica de anexo dentro do textarea (colar foto = escolher anexo).
- **`placeholder`** (`:897`–`:903`): modo derivado codificado como texto.
- **`fileteDoEstado`/borda** (`:393`,`:768`): apresentação dirigida por máquina de envio.

**Separado (bom):**
- `OndaCompacta` (`:121`) é puramente apresentacional.
- As máquinas (envio, anexo, compact, voz, fila, porta) já vivem em libs testáveis — o componente só as consome.

---

## 5) Acoplamentos externos

### Props recebidas (`:105`)
`agentSlug: string` · `agentName: string` · `motor: Motor` (`:78`) · `esforcoCobrePedido: boolean` (repasse ao `SeletorMotor`, `:990`).

### Chamadas de API — `import()` dinâmico de `@grupo_borges/cockpit-core/api`
- `postAgentInterromper` (`:268`)
- `postAgentTranscription` (`:403`)
- `patchAgentCodexNewThread` (`:445`)

### Canais externos (assinatura / publicação)
- Turno vivo: `assinaTurnoVivo`/`leTurnoVivo` (`:243`) → `turnoVivo` via `useSyncExternalStore` (`:246`)
- Escrita viva: `assinaEscritaViva`/`leEscritaViva` (`:249`) → `escrevendo` (`:251`)
- Eco pendente: `registraEcoPendente` (`:600`) / `descartaEcoPendente` (`:617`) + `PRAZO_CC_MS`/`PRAZO_CODEX_MS` (`:607`)
- Nova conversa: `publicaNovaConversa` (`:447`)

### Importa do shell (componentes e estado)
- **Apresentação**: `BolinhaAgente` (`:725`), `BarraCompact` (`:735`), `BlocoDaFila` (`:739`), `MiniaturaAnexo` (`:791`), `BolhaDeComandos` (`:793`), `BotaoAnexo` (`:942`), `PainelAnexo` (`:1156`), `AvisoAnexo` (`:1166`), `PilulaDeTokens` (`:989`), `SeletorMotor` (`:990`), `icones` (`:92`, `:114`)
- **Estado/helpers**: `usaFrota` (`:206`), `usaEnvio` (`:284`), `usaGravador` (`:420`), `usaCanalEntrega` (`:381`), `fila-de-envio` (`:321`), `porta-de-envio` (`:490`), `pesquisa-canario` (`:470`), `voz` (`:396`), `aparencia-envio` (`:385`)

### Importa de libs externas ao shell
`alvo-de-toque` (`:44`), `clipboard`/`copyText` (`:46`), `usaCompact` (`:310`), `usa-anexo` (`:295`), `usa-rascunho` (`:191`), `codex/eco-pendente` (`:50`), `codex/nova-conversa` (`:56`), `turno-vivo` (`:57`), `escrita-viva` (`:58`), `usa-envio` (`:60`), `copia-fallback` (`:76`).

---

**Pendência para a próxima fase:** o Rica quer o terreno; este mapa termina aqui. A decisão de desenho (modo único, reducer de recusa, fronteira do auto-grow) fica para a proposta.

---

## 6) Por que a caixa pula ao entrar em voz

Defeito relatado: *"a caixa PULA ao clicar no botão de voz."* Dois movimentos, em momentos diferentes — um dentro da caixa (só canarinho), um fora dela (todos os agentes).

**Resposta curta:**
1. **Linha de instrução entra/sai ABAIXO da caixa** (todos): `pedindo` e `transcrevendo` renderizam uma linha fora do form, `gravando` não — empurra o que estiver abaixo da caixa.
2. **Linha da base encolhe ~4px** (só canarinho): o botão de pesquisa (40px líquidos) sai em `gravando` e a linha cai para o piso de 36px.

### 6.1 Respostas às perguntas

**1) O que muda de `ociosa` → `gravando` (por elemento):**

| Elemento | Em `gravando` | Linha | Classificação |
|---|---|---|---|
| `BotaoAnexo` (esquerda) | some — `emCaptura ? null` | `composer.tsx:942` + `:429` | SAÍDA |
| botão de pesquisa (centro) | some | `:969` | SAÍDA |
| `PilulaDeTokens` (centro) | some | `:989` | SAÍDA |
| `SeletorMotor` (centro) | some | `:990` | SAÍDA |
| `OndaCompacta` (centro) | entra, 24px fixos | `:963`, `:126` | ENTRADA |
| fio | NÃO aparece em `gravando` (só `pedindo`/`transcrevendo`); quando aparece é `position:absolute; bottom:0` no form `overflow:hidden` → não desloca | `:1109`, `:783`, `:1110` | NÃO-CAUSA |
| linha de instrução da voz | NÃO aparece em `gravando` (guarda `!emCaptura`, `:1248`); aparece em `pedindo` ('liberando o microfone…', `voz.ts:376`) e `transcrevendo` ('transcrevendo…', `voz.ts:410`) | `:1246`, `:1248`, `voz.ts:376`, `voz.ts:410` | ENTRADA/SAÍDA (fora do form) |
| faixa `avisoDaVoz` | não aparece em captura normal (só `impedida`/`falhaDaFala`, `:434`) | `:1198` | NÃO-CAUSA |
| `BarraCompact` | ausente (compact não roda junto com voz) | `:735` | NÃO-CAUSA |

**2) A altura da caixa é fixa, min-height ou natural?** **Natural.** O `form.ck-caixa` é `flex flex-col` com padding `var(--ck-space-3)` (`:758`) e gap `var(--ck-space-2)` (`:759`) — sem `height` nem `min-height` no form. O único piso é o da linha da base: `min-height: calc(var(--ck-touch-min) - var(--ck-space-2))` = `calc(44px − 8px)` = **36px** (`:919`, `globals.css:282`, `globals.css:259`). O textarea tem teto `--ck-h-campo-max: 200px` (`:909`, `globals.css:273`). Os botões de 32px não mexem no layout: `ALVO_DE_TOQUE` é `content-box` + margem negativa (`alvo-de-toque.ts:26`–`31`).

**3) O textarea recalcula ao entrar em captura?** **Não.** O auto-grow tem deps `[texto]` (`:376`) e o texto não muda na captura — o efeito nem roda. O placeholder vira 'Ouvindo…' (`:898`), mas placeholder não entra no `scrollHeight` de campo vazio e, de qualquer forma, o efeito não dispara. O `readOnly={emCaptura}` (`:818`) não muda altura.

**4) Linha que só existe na captura empurrando?** A linha de instrução da voz (`:1246`) — com o detalhe de que ela **não renderiza durante `gravando`** (a captura de verdade), renderiza em `pedindo` e `transcrevendo` (`:1248`). E o fio (`:1109`), embora só exista em `pedindo`/`transcrevendo`, é absoluto → não empurra.

**5) Medição existente?** **Nenhuma cobre altura em captura.** Levantei `docs/cockpit-v2-medicao/`:
- `bateria-do-composer.py` (15/08): E2E de texto/fila/parar/anexo — mede a caixa crescer com conteúdo e ter teto (`:289`–`:299`) e posição com teclado (`:355`), mas nunca segura o microfone.
- `folga-embaixo-do-composer.py` (13/08): folga **abaixo** da caixa em repouso vs teclado — não toca captura.
- `altura-que-cresce-sem-evento.py` / `altura-com-teclado-de-pe.py` / `altura-no-aplicativo-instalado.py` (13/08): a saga do `innerHeight` preso pós-teclado — outra causa, não captura.
- `microfone-sobrevive-a-geracao.py` (20/08): o slot de gesto (microfone vs ■ durante geração) — mede presença de controle, não altura da caixa.

Conclusão: os números abaixo são **cálculo a partir do contrato de CSS** (valores de `globals.css`), não pixels medidos em browser — uma bancada de captura ainda não existe.

### 6.2 Causas mecânicas (cada causa classifica em entrada/saída/troca/recálculo)

**Causa A — linha da base encolhe de 40→36px em `gravando`, SÓ para o canarinho (saída de elemento + recálculo para o piso).**
- Em repouso, o maior item da linha é o botão de pesquisa: `minHeight: var(--ck-touch-min)` = 44px (`:980`) com `marginBottom: calc(var(--ck-space-1) * -1)` = −4px (`:981`) → **40px líquidos**. O `BotaoAnexo` contribui 44−8 = 36 (`gaveta-anexo.tsx:84`,`:86`). Linha = **40px**.
- Em `gravando`, `emCaptura` (`:429`) tira `BotaoAnexo` (`:942`), pesquisa (`:969`), `PilulaDeTokens` (`:989`) e `SeletorMotor` (`:990`); entra `OndaCompacta` de **24px** (`:126`). Linha = `max(36 piso, 24, 22) = 36px` (`:919`).
- Delta: **−4px** ao entrar em captura, +4px ao sair. Nos demais agentes a linha já está no piso (`:919`) e **não muda** — o botão de pesquisa só existe no canarinho (`:197`).

**Causa B — linha de instrução entra/sai fora da caixa, ~16–20px (entrada/saída de elemento).**
- A linha (`:1246`) é irmã do form na coluna externa (`:720`, gap `--ck-space-1` de 4px, `globals.css:258`) — ela empurra tudo abaixo do composer.
- `pedindo` renderiza 'liberando o microfone…' (`voz.ts:376`) → a caixa e o feed descem.
- `gravando` esconde (guarda `!emCaptura`, `:1248`) → sobem.
- `transcrevendo` renderiza 'transcrevendo…' (`voz.ts:410`) → descem de novo e ficam durante o STT inteiro (a fase mais longa do gesto).
- É por isso que o pulo é mais visível ao **soltar** o dedo (`gravando`→`transcrevendo`): a caixa cresce (canarinho: +4px) E a linha entra (+~16–20px).

**Causa C — o que NÃO é causa:**
- O fio (`:1109`) só aparece em `pedindo`/`transcrevendo` e é `position:absolute; bottom:0` dentro do form `overflow:hidden` (`:783`, `:1110`) → sobrepõe, não desloca.
- O textarea não muda (auto-grow só em `[texto]`, `:376`).
- `avisoDaVoz` (`:1198`) e `BarraCompact` (`:735`) não aparecem em captura normal.

**Nota sobre a referência do claude.ai:** nela os controles somem e a onda ocupa a MESMA linha — no nosso isso já acontece para os agentes sem botão de pesquisa (linha no piso, `:919`). O pulo que resta é a **linha de instrução** (`:1246`) e, no canarinho, os **4px do teto de 40px** (`:980`).
