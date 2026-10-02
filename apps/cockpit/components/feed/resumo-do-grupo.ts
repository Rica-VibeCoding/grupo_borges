// O resumo do grupo de ferramentas — a frase que o Rica fotografou no app do
// Claude e pediu igual: "Executou 6 comandos, leu um arquivo, criou… +64 −0 >".
//
// Lógica pura, sem React: mora fora do `.tsx` para o `node --test` provar a
// frase sem transpilar JSX — mesma razão de `execucao-do-item.ts` e
// `gramatica.ts`.
//
// DUAS FORMAS, uma por momento:
//
//   1. ENQUANTO TRABALHA, a linha mostra a execução em voo no gerúndio
//      ("Executando npm test") — o gerúndio é sempre verdade, porque é o que
//      está acontecendo AGORA. O passado agregado aqui seria mentira por
//      omissão: "Executou 6 comandos" enquanto o sétimo roda esconde o que
//      importa.
//
//   2. QUANDO TERMINA, a linha vira o resumo em passado, agregado por verbo:
//      "Executou 6 comandos, leu um arquivo e editou 2 arquivos". A contagem é
//      por ferramenta (a `unidade` da gramática sabe o substantivo), na ordem
//      em que cada verbo apareceu pela primeira vez — a ordem da conversa, não
//      alfabética.
//
// O SALDO é a soma dos diffs estruturados dos membros (+N −M). Só aparece
// quando algum membro tem diff — um grupo de leituras não inventa número.

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import {
  leExecucao,
  verboDe,
  type Desfecho,
  type Rendimento,
  type Verbo,
} from '../renderers/gramatica.ts';
import {
  execucaoDaParte,
  execucaoDoChip,
  type EntradaDaExecucao,
} from './execucao-do-item.ts';
import type { MembroDoGrupo } from './grupo-ferramentas.ts';
import { foiInterrompida } from './orfas-do-turno.ts';

/** Achata os membros nas execuções individuais: um chip é uma execução; um
 *  assistant pode trazer VÁRIOS tool_use — cada um é uma linha do grupo. */
export function entradasDoGrupo(
  itens: readonly MembroDoGrupo[],
  lookup?: ToolResultLookup,
): EntradaDaExecucao[] {
  const entradas: EntradaDaExecucao[] = [];
  for (const item of itens) {
    if (item.kind === 'chip') {
      entradas.push(execucaoDoChip(item, lookup));
      continue;
    }
    for (const parte of item.parts) {
      if (parte.type === 'tool_use') entradas.push(execucaoDaParte(parte, lookup));
    }
  }
  return entradas;
}

export type ResumoDoGrupo = {
  /** O desfecho agregado. `aguarda` vence tudo (é o único estado que chama o
   *  Rica); `rodando` vence `falhou` (a corrida continua). `falhou` só quando o
   *  grupo TERMINOU falhando (a última execução falhou): passo com erro que o
   *  agente refez e seguiu é retentativa, não falha do grupo. */
  estado: Desfecho;
  /** A execução em voo — a linha viva. `frase` é o que a linha mostra (a
   *  intenção do Bash quando existe). Null quando o grupo terminou. */
  atual: { verbo: string; alvo: string; frase: string } | null;
  /** Quantas execuções o grupo tem. */
  passos: number;
  /** Execuções que falharam sem ser a última — o agente refez e seguiu. */
  retentativas: number;
  /** O resumo em passado, agregado por verbo — a linha quando terminou. */
  frase: string;
  /** Saldo de diff somado, quando algum membro tem. `erro` quando o grupo
   *  falhou — a palavra cumpre "cor nunca é portadora única" (§3). */
  rendimento: Rendimento | null;
};

/** Junta as partes do resumo: vírgula entre elas, "e" antes da última —
 *  português de frase, não de lista técnica. */
function junta(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

export function resumeGrupo(entradas: readonly EntradaDaExecucao[]): ResumoDoGrupo {
  const lidas = entradas.map((entrada) => ({
    lida: leExecucao(entrada),
    verbo: verboDe(entrada.toolName),
  }));

  let estado: Desfecho = 'feito';
  for (const { lida } of lidas) {
    if (lida.desfecho === 'aguarda') { estado = 'aguarda'; break; }
    if (lida.desfecho === 'rodando') estado = 'rodando';
  }
  const ultima = lidas[lidas.length - 1];
  if (estado === 'feito' && ultima?.lida.desfecho === 'falhou') estado = 'falhou';
  const retentativas = lidas.filter(
    ({ lida }, indice) => lida.desfecho === 'falhou' && indice < lidas.length - 1,
  ).length;

  // A última em voo é a que os olhos procuram — é a que acabou de começar.
  const emVoo = [...lidas].reverse().find(
    ({ lida }) => lida.desfecho === 'rodando' || lida.desfecho === 'aguarda',
  );
  const atual = emVoo
    ? { verbo: emVoo.lida.verbo, alvo: emVoo.lida.alvo, frase: emVoo.lida.frase }
    : null;

  // Contagem por verbo, na ordem de primeira aparição. Ferramentas com o
  // MESMO verbo (Bash+BashOutput, os Task*) fundem numa parte só — são a
  // mesma ação para quem lê.
  const porVerbo: { verbo: Verbo; n: number }[] = [];
  for (const { verbo } of lidas) {
    const achado = porVerbo.find((parte) => parte.verbo === verbo);
    if (achado) achado.n++;
    else porVerbo.push({ verbo, n: 1 });
  }
  const frase = junta(
    porVerbo.map(({ verbo, n }, indice) => {
      const parte = `${verbo.passado} ${verbo.unidade(n)}`;
      // Só a primeira parte vai capitalizada — as seguintes continuam a frase.
      return indice === 0 ? parte : parte.charAt(0).toLowerCase() + parte.slice(1);
    }),
  );

  let adicoes = 0;
  let remocoes = 0;
  let temDiff = false;
  for (const { lida } of lidas) {
    if (lida.rendimento?.adicoes !== undefined) {
      temDiff = true;
      adicoes += lida.rendimento.adicoes;
      remocoes += lida.rendimento.remocoes ?? 0;
    }
  }
  const rendimento: Rendimento | null =
    estado === 'falhou'
      ? // A órfã encerrada pelo fim do turno diz o que houve, não "erro".
        { texto: foiInterrompida(entradas[entradas.length - 1]) ? 'interrompido' : 'erro' }
      : temDiff
        ? { texto: `+${adicoes} −${remocoes}`, adicoes, remocoes }
        : null;

  return { estado, atual, frase, rendimento, passos: entradas.length, retentativas };
}

/** Do primeiro ao último membro, pelo carimbo de cada mensagem. É o tempo até
 *  o ÚLTIMO pedido de ferramenta — o resultado dele não traz carimbo no lookup.
 *  Null quando não há o que medir (carimbo torto, grupo de um instante). */
export function duracaoDoGrupo(itens: readonly MembroDoGrupo[]): number | null {
  if (itens.length === 0) return null;
  const inicio = Date.parse(itens[0].payload.timestamp);
  const fim = Date.parse(itens[itens.length - 1].payload.timestamp);
  const ms = fim - inicio;
  return Number.isFinite(ms) && ms >= 1000 ? ms : null;
}

/** "20 s", "1 min", "2 h" — a duração na linha do resumo. */
export function duracaoCurta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}
