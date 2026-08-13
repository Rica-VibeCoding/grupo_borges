# A altura da app no iPhone — o modelo inteiro, depois de seis rodadas

> Consolidado em 13/08/2026, a pedido do Rica ("documente tudo antes de aplicar").
> Este arquivo é a fonte única do assunto: o que o aparelho faz, por que cada
> rodada falhou, o desenho que está no ar e como se valida. Quem for mexer em
> altura/teclado/viewport lê ISTO antes de escrever a primeira linha.
>
> Para mexer na **peça** — quem manda em quê, o que não se toca, como fatiar o
> `composer.tsx` — o par deste arquivo é `cockpit-v2-composer.md`.

## O problema em uma frase

No aplicativo instalado (ícone da tela inicial, `standalone`), o composer ora
subia ~60pt do fundo em repouso, ora sumia atrás do teclado — e cada conserto
de um regime quebrava o outro.

## O aparelho (os números que mandam)

iPhone 15 do Rica, tela 393×852pt, WebKit "Version 26.6" (UA reporta iOS 18_7).
App servida na `:3446` com `black-translucent` + `viewport-fit=cover`.

- **852** — janela de tela inteira (modo `black-translucent`, doc da Apple
  "Configuring Web Applications")
- **793** = 852 − 59 — janela SEM a faixa da status bar (59pt é a status bar do
  iPhone 15). É o valor "do outro modo", e é onde os números atrasados ficam
  presos
- **655 / 449 / 216** — com o teclado aberto (12/08): `innerHeight` 655,
  `visualViewport.height` 449, `visualViewport.offsetTop` 216

## As quatro verdades do WebKit standalone (todas medidas, não teorizadas)

1. **`window.innerHeight` é ATRASADO NAS DUAS DIREÇÕES.** Ele só atualiza em
   gesto do usuário. Depois do teclado fechar, fica preso em 793 até um arraste
   (IMG_7701: composer subido em repouso, voltando no instante do toque). Com o
   teclado aberto, NÃO desce: o min/max da `/diagnostico` no IMG_7704 registrou
   "viu 793–852" — o 655 nunca apareceu na sessão. Nenhum evento avisa quando
   ele muda. Família conhecida: WebKit bugs 301857, 170595, 150401.
2. **A pintura e o CSS se corrigem sozinhos em repouso.** Antes da variável JS
   existir (`h-dvh` puro, até o `9e522ab`) o composer nunca subia em repouso —
   "no início funcionava". O motor CSS re-resolve o `100dvh`; o número do JS
   não.
3. **Com o teclado em cena, o par do COMPOSITOR é honesto e vivo:**
   `visualViewport.height` e `visualViewport.offsetTop` atualizam na hora e têm
   eventos (`resize` e `scroll`). O "role para revelar o campo" do WebKit é
   panorâmica do layout viewport (muda o `offsetTop`), não rolagem do documento.
4. **`100dvh` MENTE junto — quem não mente é `100lvh`.** Na `/diagnostico` do
   IMG_7704, em repouso e com a tela parada: `100dvh` 852 mas "viu 793–852",
   `100svh` 793 fixo, `100lvh` **852 fixo**. Não é a API: é a janela inteira
   alternando entre os dois modos, e a app desenhada com 793 dentro de uma tela
   de 852 deixa 59px de fundo aparecendo embaixo. No IMG_7706 (13/08) o
   composer alternou entre 122,5pt e 63,9pt de sobra em quadros do MESMO vídeo
   — os 58,6pt de diferença são esta janela. `lvh` é a única medida imune, e é
   a certa aqui: em `standalone` não existe barra de navegador para retrair.

## A fórmula

```
campo de texto focado (teclado em cena):
    --ck-viewport-altura = round(visualViewport.height + visualViewport.offsetTop
                                 + max(0, 100lvh − 100dvh))
    → "fundo da app = fundo da área visível", panorâmica compensada por
      construção (449 + 216 = 665 = topo do teclado; com pan 0 idem), e o
      último termo devolve os 59px quando a janela está no modo encolhido
      (390 + 216 + 59 = 665). Janela inteira → o termo é zero e a conta é a
      mesma de antes; não há caminho em que ele subtraia.

nenhum campo focado (repouso):
    variável REMOVIDA → height cai no fallback do CSS, e o fallback é
    100dvh no navegador · 100lvh no aplicativo instalado (`.ck-janela`)
    → no navegador a barra do Safari muda a altura útil DE VERDADE; no
      aplicativo instalado não há barra nenhuma e o dvh só oscila por
      defeito
```

Detalhes de execução (`components/shell/sincroniza-altura-do-viewport.tsx`):

- A escrita espera o número **firmar** (mesmo valor por 5 quadros) — um
  re-layout só, com o teclado assentado; escrever 60×/s durante a animação
  re-layouta a app sob os pés do "revelar" e as rolagens se somam (IMG_7704:
  app voando para fora da tela).
- Escrita só na mudança de valor — escrita em laço piscava a tela (`ff8cce5`).
- Na transição para o repouso, `scrollTo(0,0)` como gesto sintético (destrava
  medidas presas; a página inteira não rola por desenho, é sempre inofensivo).
- Eventos escutados: `visualViewport.resize`, `visualViewport.scroll` (o pan do
  revelar só avisa por aqui), `resize`, `orientationchange`, `focusin`,
  `focusout`, `pageshow`, `visibilitychange` — cada um abre ~1s de releitura em
  rAF — mais uma ronda de 500ms como rede (teclado que fecha por arraste sem
  blur).
- O helper puro da fórmula é `altura-do-viewport.ts` (testes de unidade no
  arquivo irmão).

## Por que cada rodada falhou (o mapa dos commits)

| Rodada | Commit | O que fez | Por que não bastou |
|---|---|---|---|
| 1 | `9e522ab` (11/08) | criou a variável JS copiando medidas | consertou o teclado aberto de então, importou a dependência de números atrasados |
| 2 | `dd23112` | régua = `innerHeight` (visual sozinho errava 206px) | o visual sem o `offsetTop` era a peça errada — faltava a SOMA |
| 3 | `61d9846` | relê por 1s após cada evento | copiava a mentira mais depressa; evento nenhum dispara quando o número volta |
| 4 | `6f0fd4c` | ronda de 500ms + pageshow/visibilitychange | idem — a fonte continuava mentirosa |
| 5 | `dad4317` | **repouso = CSS, JS só com foco** (fechou o repouso) | com foco ainda lia `innerHeight`, que não desce com teclado |
| 5b | `f993596` | estabilização + scrollTo pós-escrita | firmava 852 (o atrasado); o scrollTo pós-escrita era no-op (o revelar é pan, não scroll) |
| 6 | `e1197c5` | **teclado = `vv.height + vv.offsetTop`** | aprovado pelo Rica ("temos avanços"), mas sobrou folga nos dois regimes |
| 7 | — | **âncora na TELA**: `100lvh` no repouso (CSS) e `+ (lvh − dvh)` no teclado | — no ar; pendente de validação no aparelho |

## As provas (docs/cockpit-v2-medicao/)

- `altura-que-cresce-sem-evento.py` — o repouso do aparelho encenado: janela
  852, `innerHeight` mentindo 793 (defineProperty), eventos engolidos em
  captura. A app tem que medir a janela. Vermelho legítimo contra o código da
  rodada 4 (sobra de 59px = o vídeo IMG_7701 em bancada).
- `altura-com-teclado-de-pe.py` — o teclado do aparelho encenado:
  `visualViewport` fake com 449/216, `innerHeight` atrasado em 852. A variável
  tem que firmar 665px. Quem copiar `innerHeight` publica 852 e reprova.
- `altura-com-a-janela-encolhida.py` — o modo de 793 com o teclado de pé:
  visual 390, panorâmica 216 e a sonda do `100dvh` presa em 793 enquanto a do
  `100lvh` mede a tela. A app tem que publicar 665 assim mesmo. Sem a âncora
  publicaria 606 — os 59px de folga do IMG_7706.
- `altura-no-aplicativo-instalado.py` — o contrato das transições: carga em
  repouso sem variável e app na janela; foco publica; desfoco remove; sem laço
  de escrita nem de rolagem.
- Régua de versão no aparelho: `/diagnostico` em repouso →
  `--ck-viewport-altura` = **"(não publicada)"**. Número parado = cache/versão
  velha, não conserto falhando. O min/max de cada métrica conta a história da
  sessão inteira (foi ele que condenou o `innerHeight`).

## Fontes externas

- Apple, "Configuring Web Applications" (developer.apple.com, library/archive):
  os dois modos de janela (`black-translucent` = tela inteira; `default`/
  `black` = abaixo da status bar). `black-translucent` consta como deprecado
  em avisos do Safari — se um dia mudarmos, a janela vira 793 FIXA e esta
  classe de bug morre, ao custo de 59pt e da faixa preta.
- WebKit Bugzilla: 301857 (viewport não recalcula pós-teclado, "resolvido" em
  iOS 26.1 — não no nosso caso), 170595/150401 (innerHeight bogus), 259770
  (`interactive-widget` inexistente no WebKit — `dvh` nunca reage a teclado).
- Comunidade (batedor de 13/08): github.com/mattpilott/ios-chat (chat PWA iOS
  usa `visualViewport` como fonte com teclado); saricden.com e vuetify#22923
  (`offsetTop` fica velho DEPOIS do teclado fechar — não nos alcança porque em
  repouso o par nem é lido); Capacitor#5638 (iOS standalone não fecha teclado
  sem `.blur()` — o composer mantém foco após enviar por decisão de UX, ciente).

## O que ainda está aberto

- Validação da rodada 7 no aparelho, nos dois regimes. Se ainda sobrar folga, o
  vídeo que decide é a **`/diagnostico` com o teclado aberto** (tocar no "toque
  aqui" de lá): os números ao vivo + min/max dizem em que modo a janela estava
  quando o teclado subiu, e é o único dado que ainda falta do modelo.
- **O respiro que sobra é design, não defeito.** Abaixo da caixa do composer
  há 67px medidos em bancada: 12 de padding, 34 do `safe-area-inset-bottom` (a
  barra de gestos do iOS, intocável) e ~21 da régua embaixo. Era isso e mais os
  59 do bug que somavam os 122,5pt do IMG_7706. Se o Rica ainda achar alto
  depois da rodada 7, o que dá para apertar são os 12.
- Plano B documentado (não aplicado): `statusBarStyle: 'black'` — janela fixa
  793, sem modo duplo, bug estruturalmente impossível; custa a faixa preta no
  topo e 59pt de tela.
