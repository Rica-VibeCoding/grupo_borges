# Mexer no composer sem quebrar o iPhone

> Escrito em 13/08/2026 a pedido do Rica, no fim de sete rodadas para acertar
> onde o composer para na tela. A saga inteira está em
> `cockpit-v2-viewport-iphone.md` — aqui está o que ela ensinou sobre **a
> peça**: quem manda em quê, o que não se toca, e como fatiar o arquivo de mil
> linhas sem repetir as rodadas.
>
> Leia isto antes de tocar em `components/shell/composer.tsx`,
> `app/agente/[slug]/palco-da-conversa.tsx` ou em qualquer coisa que decida
> altura, respiro ou posição de caixa de entrada.

## O composer é quatro peças, não uma

Quem entra por `composer.tsx` achando que ele se posiciona sozinho quebra o
aparelho do Rica. A responsabilidade está repartida assim:

| Peça | Arquivo | Responsabilidade |
|---|---|---|
| A janela | `components/shell/app-shell.tsx` + `.ck-janela` no `globals.css` | Altura da app inteira. Repouso é CSS; teclado é a variável do JS |
| A medida | `components/shell/sincroniza-altura-do-viewport.tsx` + `altura-do-viewport.ts` | Publica `--ck-viewport-altura` **só com o campo focado**, e zera o `--ck-safe-bottom` enquanto o teclado está em cena |
| O palco | `app/agente/[slug]/palco-da-conversa.tsx` | Sobrepõe o composer ao feed, paga o respiro de baixo e publica `--ck-composer-altura` para o feed não morrer atrás da caixa |
| O desenho | `components/shell/composer.tsx` | A caixa, os controles, as faixas de aviso. **Não mede nada e não se posiciona** |

Duas variáveis amarram tudo, e elas correm em sentidos opostos:

- **`--ck-viewport-altura`** desce do `<html>` e diz até onde a app vai. Some
  em repouso de propósito — quem manda ali é o `100lvh` do CSS.
- **`--ck-composer-altura`** sobe do palco para o feed, medida por
  `ResizeObserver`, e diz quanto respiro o feed precisa embaixo. Mora no palco
  e não no `:root` porque duas rotas abertas em tela dividida teriam alturas
  diferentes.

## A aritmética do fundo (a parte que ninguém adivinha)

Abaixo da caixa visual existem **quatro** termos somados, e olhar um de cada
vez leva ao conserto errado:

```
    4px   gap da coluna do composer
 + 17px   reservador da linha de status (div aria-hidden de altura fixa)
 +  Npx   padding-bottom do wrapper no palco
 + 34px   safe-area-inset-bottom — a barra de gestos do iPhone
```

A régua veio do Rica em 13/08, com print lado a lado: **o app do Claude deixa
34pt** abaixo da caixa, ou seja a barra de gestos e nada mais. Por isso o
padding do palco hoje soma só o que *falta* para a barra
(`max(space-2, safe-bottom − 21px)`), e por isso o `--ck-safe-bottom` vai a
zero com o teclado aberto — o teclado cobre a barra de gestos, e reservar
espaço para ela ali é folga morta entre a caixa e o teclado.

**O reservador de 17px não é gordura.** Ele segura o lugar da linha de status
antes de ela existir; sem ele o composer pula quando o fio de estado aparece.
Quem quiser recuperar aqueles pixels tem que resolver o pulo primeiro.

## As seis leis

1. **Altura da app não se resolve no composer.** Se o sintoma é "o composer
   está alto/baixo/atrás do teclado", o arquivo é `sincroniza-altura-do-viewport.tsx`
   ou o `.ck-janela` — nunca um padding no `composer.tsx`.
2. **Número do sistema se verifica antes de copiar.** `window.innerHeight` e
   `100dvh` atrasam nas duas direções no WebKit em `standalone`; `100lvh` e o
   par `visualViewport.height + offsetTop` não. Três rodadas foram gastas
   copiando a mentira mais depressa.
3. **Espaço embaixo se conta inteiro.** São os quatro termos acima. Ajustar um
   sem somar os outros dá 67px onde a régua pede 34.
4. **Bancada que não encena o aparelho mente.** No Chromium
   `env(safe-area-inset-bottom)` é 0, `dvh` e `lvh` valem o mesmo, e não existe
   teclado. Toda medição de folga ou de altura precisa injetar os números do
   iPhone antes de medir — é o que as bancadas de `docs/cockpit-v2-medicao/`
   fazem.
5. **Os dois regimes no mesmo teste.** Consertar o repouso armou o teclado na
   rodada 5, e o contrário quase aconteceu na 7. Repouso e teclado se validam
   juntos, sempre.
6. **A régua do aparelho é a `/diagnostico`.** Em repouso ela tem que dizer
   `--ck-viewport-altura (não publicada)`; o min/max de cada métrica conta a
   história da sessão inteira e já resolveu duas rodadas sozinho.

## A lógica já está fatiada — o que sobrou é o desenho

`composer.tsx` tem ~1060 linhas, mais de três vezes o teto de 300 do
`CLAUDE.md`. Antes de propor quebrar, entenda o que **já** saiu dele: a lógica
pura mora fora e é testada em `node --test` (262 testes na `components/shell/`).

| Módulo | O que carrega |
|---|---|
| `aparencia-envio.ts` | as seis fases do envio → frase, cor, ações |
| `porta-de-envio.ts` | o que pode sair, o que é recusado e por quê |
| `fila-de-envio.ts` | a espera entre mensagens |
| `voz.ts` · `usa-gravador.ts` | fases do microfone, diagnóstico de impedimento |
| `motor.ts` · `seletor-motor*.tsx` | modelo/esforço e o que o servidor autoriza |
| `gaveta-anexo.tsx` · `usa-anexo.ts` | anexo, do botão ao envio |
| `barra-compact.tsx` · `bloco-da-fila.tsx` | as duas faixas acima da caixa |

O que restou no arquivo é **JSX e fiação**: 7 estados, 5 efeitos e a árvore.

## Se for fatiar, esta é a ordem

Da menor para a maior chance de estragar:

1. **As faixas de aviso abaixo da caixa** (anexo, recusa da porta, microfone,
   voz, transcrito, estado+ações — hoje o último terço do arquivo). São função
   pura do estado que já existe, sem lógica própria; saem como
   `avisos-do-composer.tsx` recebendo props. **O reservador de 17px vai junto
   com elas** — ele é o `else` desse bloco, e separá-los é como o pulo volta.
2. **A caixa** (textarea + a barra de controles por dentro). Sai como
   `caixa-do-composer.tsx`, levando o `ck-caixa`, o rodapé de vidro e o
   invólucro da âncora **inteiro** — a gaveta do anexo mede o `bottom: 100%`
   desse invólucro, então quebrá-lo descola a gaveta do botão "+".
3. **A fiação** (estados, efeitos, handlers) para um `usa-composer.ts`. Por
   último e só com necessidade real: é onde moram o eco pendente do Codex, a
   fila e o canal de entrega, e nenhum deles tem teste de integração.

O que **não** se mexe sem ler o porquê no próprio arquivo: a ordem dos
elementos na coluna, o invólucro da âncora, o reservador, e o `position:
absolute` do palco (não é `sticky` nem `fixed`, e os dois têm motivo escrito).

## O ritual de prova

Antes de publicar qualquer mudança que toque geometria:

```bash
# do root do repo, contra a porta que você mexeu (3008 = produção)
python3 docs/cockpit-v2-medicao/folga-embaixo-do-composer.py 3008
python3 docs/cockpit-v2-medicao/altura-com-teclado-de-pe.py 3008
python3 docs/cockpit-v2-medicao/altura-com-a-janela-encolhida.py 3008
python3 docs/cockpit-v2-medicao/altura-que-cresce-sem-evento.py 3008
python3 docs/cockpit-v2-medicao/altura-no-aplicativo-instalado.py 3008

cd apps/cockpit && node --test "components/shell/*.test.ts" && pnpm exec tsc --noEmit
```

Cada bancada cobre um modo de falhar que já aconteceu de verdade — nenhuma
delas é hipótese. Se for mexer em espaço, a de folga é obrigatória; se for
mexer em altura, as quatro de altura.

Depois: **publicar é parte da tarefa** (regra 6 do `CLAUDE.md` do app), e a
validação final é o Rica no aparelho — fechar a app de vez, abrir pelo ícone,
olhar o repouso, tocar no campo.

## Checklist antes de dizer "pronto"

- [ ] o diff toca a camada certa (janela · medida · palco · desenho)?
- [ ] a folga embaixo continua batendo com a régua de 34pt em repouso?
- [ ] os dois regimes foram medidos, não só o que eu estava consertando?
- [ ] a bancada encena safe-area/`dvh`/teclado, ou está medindo um Chromium que
      não tem nenhum dos três?
- [ ] `composer.tsx` não cresceu — se cresceu, a fatia da seção anterior estava
      esperando por isto
