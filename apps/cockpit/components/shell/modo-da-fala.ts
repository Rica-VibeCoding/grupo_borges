/**
 * O MODO DA FALA — um valor, calculado, no lugar de cinco predicados que o JSX
 * recombinava em dez pontos.
 *
 * Antes desta peça, o estado da caixa durante um gesto de voz não existia como
 * valor: `emCaptura`, `travada`, `faseVoz` e `avisoDaVoz` eram remontados em
 * cada ternário, e ternários vizinhos podiam discordar sobre o que estava
 * acontecendo. Cada ajuste de tela quebrava outro — não por descuido de quem
 * mexeu, mas porque a forma convidava ao erro.
 *
 * A documentação do React chama isso pelo nome: derive as flags de UM status em
 * vez de manter booleanos que podem se contradizer, e calcule durante o render
 * em vez de guardar (`react.dev/learn/choosing-the-state-structure`, princípios
 * 2 e 3). Nenhum estado novo nasce aqui.
 *
 * ## Por que só a fala
 *
 * A primeira versão desta peça era um modo do composer INTEIRO, com
 * `compactando`, `enviando` e `insucesso` no mesmo enum. Estava errado, e o
 * canário achou o furo ao ligar: um `/compact` em curso CONVIVE com o microfone
 * aberto, e um envio em voo convive com a gravação da mensagem seguinte. Enum é
 * para estados que se excluem; forçar precedência entre eixos que coexistem
 * teria escondido um comportamento (o aviso do compact sumia durante o STT) —
 * a mesma armadilha que a peça existe para eliminar, com nome novo.
 *
 * Os outros eixos seguem o padrão que o repositório já usa: uma função de
 * aparência por região (`aparenciaDaVoz`, `aparenciaDe` em `aparencia-envio.ts`).
 *
 * E o que o agente está fazendo fica de fora em qualquer hipótese: `gerando` é
 * estado do AGENTE, não da caixa, e vive na linha da bolinha. Misturar os dois
 * foi o que fez o ■ comer o microfone em 20/08 (`678f598`).
 */
import type { FaseVoz } from './voz.ts';

export type ModoDaFala =
  /** Microfone parado. */
  | 'repouso'
  /** Microfone aberto e capturando — com o dedo em cima. */
  | 'ouvindo'
  /** Gravação travada: o gesto acabou, a gravação não. Quem encerra é botão. */
  | 'travada'
  /** Pedindo o microfone ao navegador, ou esperando a transcrição voltar. */
  | 'transcrevendo'
  /** Microfone barrado ou transcrição que não veio — a fala falhou. */
  | 'impedido';

export type EntradaDaFala = {
  faseVoz: FaseVoz;
  /** `true` quando o microfone não abriu OU a transcrição falhou — os dois são
   *  o mesmo momento do mesmo gesto e nunca coexistem (`composer.tsx:434`). */
  falaFalhou: boolean;
};

/**
 * A ordem dos ramos É a precedência. `impedido` encabeça porque é o único que
 * pede uma decisão do Rica; os outros passam sozinhos.
 */
export function modoDaFala({ faseVoz, falaFalhou }: EntradaDaFala): ModoDaFala {
  if (faseVoz === 'impedida' || falaFalhou) return 'impedido';
  if (faseVoz === 'travada') return 'travada';
  if (faseVoz === 'gravando' || faseVoz === 'cancelando') return 'ouvindo';
  if (faseVoz === 'pedindo' || faseVoz === 'transcrevendo') return 'transcrevendo';
  return 'repouso';
}

/**
 * O equivalente exato de `capturando(faseVoz)` (`voz.ts:447`) lido do modo:
 * microfone aberto, com o dedo ou travado.
 *
 * NÃO inclui `transcrevendo`. Parece detalhe e não é: é ele que decide o
 * `readOnly` do campo (`composer.tsx:832`), e trancar o campo enquanto a
 * transcrição volta tiraria do Rica a única janela em que ele corrige o
 * rascunho com o teclado.
 */
export function emCaptura(modo: ModoDaFala): boolean {
  return modo === 'ouvindo' || modo === 'travada';
}
