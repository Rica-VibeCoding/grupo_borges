// A linha viva, parte pura — QUANDO ela existe e O QUE o tempo diz.
//
// Mora fora do `.tsx` pela mesma razão de `resumo-do-grupo.ts`: o `node
// --test` prova a régua sem transpilar JSX. O desenho (e o tick do relógio)
// fica no irmão `linha-viva.tsx`.
//
// A REGRA DE EXISTÊNCIA é a de sempre: a última linha do feed é o que está
// acontecendo agora. Quando há trabalho em voo no fim, essa linha JÁ existe —
// é o grupo de ferramentas (ou a execução sozinha) no gerúndio, e uma segunda
// linha diria a mesma coisa duas vezes. A linha viva cobre só o buraco: a
// corrida está de pé (`isRunning` do stream) e o fim do feed NÃO tem trabalho
// em voo — o intervalo entre o Rica mandar e a primeira ferramenta, e os
// silêncios entre uma ferramenta e a próxima.

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { execucaoDaParte, execucaoDoChip } from './execucao-do-item.ts';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { entradasDoGrupo, resumeGrupo } from './resumo-do-grupo.ts';

/** O fim do feed já é uma linha viva? Olha só o ÚLTIMO item: se ele tem
 *  execução em voo (rodando ou aguardando humano), o gerúndio dele já cumpre
 *  o papel — inclusive o `aguarda`, que é o agente esperando o Rica e não
 *  "pensando". */
export function trabalhoEmVooNoFim(
  itens: readonly ItemDoFeed[],
  lookup?: ToolResultLookup,
): boolean {
  const ultimo = itens[itens.length - 1];
  if (!ultimo) return false;

  if (ultimo.kind === 'grupo-ferramentas') {
    const { estado } = resumeGrupo(entradasDoGrupo(ultimo.itens, lookup));
    return estado === 'rodando' || estado === 'aguarda';
  }

  if (ultimo.kind === 'assistant') {
    // `running` aqui cobre também a ferramenta que espera ação do Rica
    // (pergunta, plano): sem resultado casado ela consta como em voo, e a
    // linha da própria execução já diz "aguardando" — "Pensando" seria
    // mentira em cima da verdade.
    return ultimo.parts.some(
      (parte) =>
        parte.type === 'tool_use' && execucaoDaParte(parte, lookup).estado === 'running',
    );
  }

  if (ultimo.kind === 'chip' && ultimo.classifierKind === 'tool') {
    return execucaoDoChip(ultimo, lookup).estado === 'running';
  }

  return false;
}

/** A âncora do tempo decorrido: o timestamp da ÚLTIMA mensagem do stream.
 *  Antes da primeira ferramenta, ela é a fala do Rica — "Pensando há…" conta
 *  exatamente a espera dele. Entre ferramentas, é o último resultado — conta
 *  o silêncio real. E abrindo a página no meio de uma corrida, conta da
 *  última atividade, não da abertura da tela. Null sem mensagens. */
export function desdeDaLinhaViva(messages: readonly MessagePayload[]): number | null {
  const ultima = messages[messages.length - 1];
  if (!ultima) return null;
  const parsed = Date.parse(ultima.timestamp);
  if (Number.isFinite(parsed)) return parsed;
  return ultima.created_at * 1000;
}

/** O tempo em português de conversa: segundos até um minuto, minutos depois.
 *  Negativo (relógio do cliente à frente do servidor) não existe — é zero. */
export function rotuloDoTempo(decorridoMs: number): string {
  const segundos = Math.max(0, Math.floor(decorridoMs / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  return `há ${Math.floor(segundos / 60)} min`;
}
