# Composer v2 — proposta de refatoração

> Escrita em 20/08 por Daniel, depois de: mapa do código (`cockpit-v2-composer-mapa.md`),
> padrão da stack em documentação oficial (`cockpit-v2-composer-stack.md`), dois vídeos do
> Rica (o nosso e o do claude.ai) e a F1 já publicada (`b8c9d7c`).
>
> **Nada aqui foi implementado.** É desenho para aprovação.

## O diagnóstico em uma frase

O composer não é grande demais nem duplicado — a lógica pesada já mora em máquinas
externas testadas (`envio.ts`, `voz.ts`, `compact.ts`, `usa-anexo.ts`, `fila-de-envio.ts`).
O que apodrece é que **o modo visual não existe como valor**: são 13 modos derivados de
~10 booleanos recombinados em cada ponto do JSX.

Por isso cada ajuste de tela quebra outro. Não é falta de cuidado de quem mexeu — é a
forma que convida ao erro.

## O que NÃO vamos fazer

**Reescrever do zero.** As máquinas externas estão certas, testadas e são a parte cara.
Jogar fora o que funciona para reconstruir o mesmo comportamento é risco sem prêmio.

**Copiar a posição dos botões do claude.ai sem entender o desenho por trás.** O ■ saiu do
lugar do microfone em 20/08 (`678f598`) por um motivo real: o slot tinha quatro donos em
cascata e, com o campo vazio durante a geração, o ■ vencia o microfone — quem fala ficava
sem gesto para COMEÇAR a próxima mensagem. Mover de volta sem separar os slots reabre
exatamente esse bug.

---

## F2.1 — o modo vira um valor

Uma função pura recebe as fases das máquinas que já existem e devolve **um** modo. O JSX
passa a ler o modo, não a recombinar predicados.

```
modo-composer.ts   (puro, testado, ao lado de voz.ts)

modoDoComposer({ faseVoz, faseEnvio, faseCompact, gerando, temConteudo, … })
  → 'repouso' | 'ouvindo' | 'travada' | 'transcrevendo'
  | 'compactando' | 'enviando' | 'impedido' | 'recusado'
```

Isto é literalmente o que a documentação recomenda: derivar flags de **um** status
(`const isSending = status === 'sending'`) em vez de manter booleanos que podem se
contradizer, e calcular durante o render em vez de guardar
(`react.dev/learn/choosing-the-state-structure`, princípios 2 e 3).

**Regra de ouro desta fase: a tela não muda.** É refatoração comportamentalmente neutra.

**Prova:** tabela de teste com os 13 modos de hoje mapeados um a um, cada linha citando de
onde veio (seção 3 do mapa). Os 868 testes do cockpit seguem verdes sem alteração — se
algum precisar mudar, o modo está errado, não o teste.

## F2.2 — um nó só para "gesto recusado"

`avisoDaPorta` (`:327`), `sinalRecusa` (`:332`) e `falhaDaFala` (`:396`) são três estados
para o mesmo conceito. Viram um.

Isso mata de brinde o efeito de `:334`, que zera o aviso a partir de quatro fontes
combinadas — a documentação nomeia esse padrão e manda não fazer
(`react.dev/learn/you-might-not-need-an-effect`, "Adjusting state on prop change in an
Effect").

**Prova:** cada aviso continua aparecendo no mesmo gatilho e sumindo na mesma condição.
Teste por gatilho, não por implementação.

## F2.3 — dois slots, um para cada assunto

Este é o coração, e é onde a referência ensina algo estrutural.

**No claude.ai são dois slots independentes:**

- o microfone tem lugar **fixo e próprio**. Durante a captura ele vira "parar gravação" no
  mesmo pixel — o dedo que abriu é o dedo que fecha.
- o botão de enviar tem o **seu** lugar, e é ele que vira ■ quando o agente está gerando.

Nunca há disputa, porque cada slot fala de um assunto: **entrada** e **estado do agente**.

**Hoje no nosso**, microfone e enviar dividem um slot (`:1029` decide qual aparece), e o ■
mora fora da caixa, colado na bolinha.

**Proposta:** adotar a separação. Microfone ganha slot próprio permanente; o slot de enviar
hospeda enviar e o ■ de parar geração. O ■ volta para dentro da caixa — que é o que o Rica
quer — **sem** poder comer o microfone, porque estruturalmente não divide lugar com ele.

A lição de `678f598` passa a ser garantida pela forma, não por ordem de ternário. Quem
fala nunca fica sem gesto de partida.

**Prova:** a bancada de `678f598` já cobre "o microfone existe durante a geração" — ela tem
de continuar verde com o ■ dentro da caixa. Se ficar vermelha, a separação falhou.

## F2.4 — a faixa para de empurrar a tela

A faixa de aviso da voz (`:1246`) é irmã do form, fora da caixa. Renderiza em `pedindo` e
`transcrevendo` e some em `gravando` (`:1248`) → empurra 16–20px de tudo que está acima.
É o solavanco que o Rica sente, e ele aparece **ao soltar**, não ao apertar.

A MDN cita `content-visibility` + `contain-intrinsic-size` exatamente para "evitar layout
shift ao esconder linha de texto" (`0 1.1em`). Desmontar com condicional é o que move o
layout.

`visibility:hidden` reserva o espaço mas some da árvore de acessibilidade — não serve para
uma faixa que existe para **avisar**.

**Prova — e aqui falta ferramenta:** nenhuma medição atual cobre altura em captura. A
bateria do composer mede crescimento com conteúdo, a folga mede repouso e teclado. Esta
fase **começa** pela bancada que mede a altura da caixa e a posição do topo da conversa
entre `ocioso → pedindo → gravando → transcrevendo → ocioso`. Ela precisa falhar contra o
build de hoje antes de qualquer correção.

---

## F3 — transcrever enquanto fala (depois, separado)

Existe e o custo cabe: sessão de transcrição em tempo real por WebSocket, mesmo modelo que
já usamos, com texto parcial chegando em pedaços
(`POST /v1/realtime/transcription_sessions`, evento
`conversation.item.input_audio_transcription.delta`).

- hoje, arquivo no fim: US$ 0,006/min
- tempo real, modelo pequeno: US$ 0,006/min — mesmo preço
- tempo real, modelo grande: US$ 0,019/min

A conversão minuto→token é estimada em ~600 tokens/min, batendo com exemplo da própria
doc. Dá para medir de verdade: o evento de conclusão devolve `usage.input_tokens`.

**O que pesa não é a conta, é o encanamento.** Hoje o gravador junta o áudio inteiro e
manda um arquivo (`usa-gravador.ts` sem timeslice, de propósito — o comentário em `:262`
explica por quê). Streaming quer PCM16 em pedaços por WebSocket, com chave efêmera. É peça
nova ao lado da atual, não alteração dela.

Fica para depois de F2 fechada.

---

## Ordem, e quem faz

| Fase | Decide | Executa | Entra sozinha? |
|---|---|---|---|
| F2.1 modo como valor | Daniel (tabela dos 13) | canário (mecânico, tabela pronta) | sim |
| F2.2 nó de recusa | Daniel | canário | sim, depois de F2.1 |
| F2.3 dois slots | Daniel | Daniel (é desenho, não mecânica) | sim, depois de F2.1 |
| F2.4 faixa sem empurrão | Daniel | canário (bancada primeiro) | sim, independente |
| F3 streaming | Daniel + Rica (custo) | a definir | só depois de F2 |

Cada fase entra publicada e testada pelo Rica antes da seguinte. Nada de refatoração
grande de uma vez — foi assim que a F1 saiu limpa.

O simplificador roda **no fim de F2**, não antes: simplificar antes de o modo existir é
polir a bagunça.

## O que fica de fora, de propósito

- **Silêncio com duração legítima.** A F1 barra o toque acidental por tempo. Microfone
  aberto por 3 segundos sem fala ainda pode voltar frase inventada — o conserto é barrar
  por falta de som, e o medidor de nível já roda para desenhar a onda. Não entrou porque
  não houve caso real, só o meu de bancada.
- **`useOptimistic` / `useActionState`.** Cabem em pedaços (o balão otimista, o POST até o
  200), mas não na máquina inteira: nossa confirmação vem por eco de stream 12s depois, e a
  documentação não cobre esse ciclo. Trocar máquina testada por API nova sem ganho claro é
  o oposto de menor diff.
