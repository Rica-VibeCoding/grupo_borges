# Fase 4 — cor própria pro aviso "agente ocupado" (cadeira `ui`)

Base: main `87e9089` (o clone do PC tem `frases de apoio` + `mistura de cor` sem commit por cima — não resete
nem stash; puxe por rebase se puxar).

## Achado (registrado em 29/09, decidido agora pelo Rica)
`agenteOcupado` é só um `motivo` dentro da cena `'erro'` (`use-modo-conversa.ts:149`,
`leitura-da-conversa.ts:24`) — visualmente indistinguível do erro de verdade: esfera, moldura e retrato pintam
tudo de `--ck-conversa-erro` (= `--ck-state-fail`, o vermelho de falha real) via `data-tom='erro'`
(`esfera-conversa.module.css:79`, `moldura-conversa.module.css:45`, `retrato-da-voz.module.css:8`). Quando o
Rica fala com o agente ainda ocupado processando outra coisa, a tela mostra o mesmo vermelho de "quebrou" —
pode confundir "só demorou" com falha de verdade.

## Pedido
Uma cor própria para `agenteOcupado`, sem tocar no texto nem no comportamento (continua "Tentar de novo",
continua motivo/mensagem de hoje — só o VISUAL muda).

- **`moldura-estado.ts`**: novo item em `Cena` (`'ocupado'`, ao lado de `preparando`/`trabalhando` — não é
  estado da máquina, é a tela desenhando diferente). Nova camada em `CAMADAS`/`Pesos` e item em `Tom`
  (`'ocupado'`). `alvosDaMoldura('ocupado')` e `tomDaCena('ocupado')` devolvem essa camada/tom, peso 1 —
  mesmo padrão de `case 'erro'`.
- **`estado-da-vez.ts`**: `EntradaDaCena` ganha `motivo?: MotivoDeErro` (ou só o booleano que já existe em
  `use-modo-conversa`); `cenaVisivel` devolve `'ocupado'` quando `cena === 'erro' && motivo === 'agenteOcupado'`,
  senão segue como hoje.
- **`tela-conversa.tsx`**: repassar o motivo até `cenaVisivel` (ele já lê `modo.conversa.motivo` na linha 88/99
  pra outra coisa — mesma fonte).
- **Token novo em `globals.css`**, ao lado do bloco `--ck-conversa-*` (linha ~1969): `--ck-conversa-ocupado`,
  cor própria — **não** reusar `--ck-state-fail` (é o erro real), **nem** colidir visualmente com
  `--ck-conversa-voce` (dourado, "ouvindo") nem `--ck-conversa-ze` (azul, "falando") nem a mistura do "pensa"
  que vocês acabaram de fazer. Contraste mínimo AA, na régua das outras cinco (~5,2–7,3:1 medido). Escolha o
  matiz e traga a prova de contraste + captura, como fez com a mistura — deixe pro Rica ver ao vivo antes de
  fechar, é decisão dele igual à do meio da mistura.
- **`esfera-conversa.tsx`/`.module.css`, `moldura-conversa.tsx`/`.module.css`, `retrato-da-voz.tsx`/`.module.css`**:
  novo `data-tom='ocupado'` mapeando pro token novo, ao lado do `erro` existente nos três.
- **`leitura-da-conversa.ts`**: confirme se a palavra da pílula/estado ("O agente está ocupado") já está certa
  ou se junto da cor nova cabe ajuste — sem inventar texto novo além do que já existe.

## Regras
- Teste vermelho antes: `cenaVisivel`/`tomDaCena` com `motivo: 'agenteOcupado'` esperando `'ocupado'`, hoje
  cai em `'erro'`.
- UI se testa clicando na tela (`browser-harness`). Provar com o Canário real: forçar 409
  `agent_pane_unavailable` de propósito (falar duas vezes rápido, ou o jeito que já usou nas rodadas
  anteriores) e capturar a tela nova ao lado do erro real, pra comparar as duas cores.
- Não reinicie o dev sem parar antes. Proibido: VPS, commit, agente real além do Canário. Teto 30%.

## Fecha quando
`npm test` e `type-check` verdes, com números; captura das duas cores lado a lado (ocupado vs. erro real);
relato em `relatos/fase4-ui.md` (seção nova) com a prova de matiz/contraste do token novo. Última linha
sozinha: `FIM-DO-OCUPADO`.
