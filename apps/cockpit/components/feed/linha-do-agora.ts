// A LINHA DO AGORA, parte pura — o estado da esfera e a frase ao lado dela.
//
// Mora fora do `.tsx` pela mesma razão de `linha-viva.ts`: o `node --test`
// prova a régua sem transpilar JSX.
//
// O ESTADO É O DA BOLINHA (`shell/bolinha-estado.ts`), a mesma régua que
// decidia a cara do bonequinho do composer. Só dois estados dela não têm vez
// aqui: `ouvindo` (a esfera não olha pra caixa) e `pronto` (transição, não
// estado). Os dois viram `parado`.

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { estadoDaBolinha, type EntradaDaBolinha } from '../shell/bolinha-estado.ts';
import { estaEmVoo, execucaoDaParte, execucaoDoChip } from './execucao-do-item.ts';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { entradasDoGrupo, resumeGrupo } from './resumo-do-grupo.ts';

export type EstadoDoAgora = 'offline' | 'parado' | 'pensando' | 'executando' | 'atencao';

/** `esperandoRica`: o fim do feed tem pergunta ao Rica em voo
 *  (`pedeAoRicaNoFim`). O `aguardando` da frota não basta — a API só o grava
 *  em falha —, e a pergunta não é output: sem esta entrada ela caía em
 *  `executando`, com brilho, em vez de chamar. */
export function estadoDoAgora({
  esperandoRica = false,
  ...entrada
}: Omit<EntradaDaBolinha, 'ouvindo'> & { esperandoRica?: boolean }): EstadoDoAgora {
  const estado = estadoDaBolinha(entrada);
  if (esperandoRica && estado !== 'offline') return 'atencao';
  return estado === 'ouvindo' || estado === 'pronto' ? 'parado' : estado;
}

/** O fim do feed é uma pergunta ao Rica sem resposta (`AskUserQuestion`,
 *  `ask_user` do MCP — `requires-action`)? Mesma régua do último item que a
 *  `fraseEmVoo` usa. */
export function pedeAoRicaNoFim(itens: readonly ItemDoFeed[], lookup?: ToolResultLookup): boolean {
  const ultimo = itens[itens.length - 1];
  if (!ultimo) return false;
  if (ultimo.kind === 'grupo-ferramentas') {
    return resumeGrupo(entradasDoGrupo(ultimo.itens, lookup)).estado === 'aguarda';
  }
  if (ultimo.kind === 'assistant') {
    return ultimo.parts.some(
      (parte) => parte.type === 'tool_use' && execucaoDaParte(parte, lookup).estado === 'requires-action',
    );
  }
  if (ultimo.kind === 'chip' && ultimo.classifierKind === 'tool') {
    return execucaoDoChip(ultimo, lookup).estado === 'requires-action';
  }
  return false;
}

/** A frase do passo em voo no fim do feed — "Transcreve o áudio",
 *  "Lendo feed.tsx". Null quando o fim não tem ferramenta rodando (o agente
 *  está escrevendo a resposta, ou parado). */
export function fraseEmVoo(itens: readonly ItemDoFeed[], lookup?: ToolResultLookup): string | null {
  const ultimo = itens[itens.length - 1];
  if (!ultimo) return null;

  if (ultimo.kind === 'grupo-ferramentas') {
    return resumeGrupo(entradasDoGrupo(ultimo.itens, lookup)).atual?.frase ?? null;
  }

  if (ultimo.kind === 'assistant') {
    const emVoo = ultimo.parts
      .filter((parte) => parte.type === 'tool_use')
      .map((parte) => execucaoDaParte(parte, lookup))
      .filter(estaEmVoo);
    return emVoo.length > 0 ? (resumeGrupo(emVoo).atual?.frase ?? null) : null;
  }

  if (ultimo.kind === 'chip' && ultimo.classifierKind === 'tool') {
    const entrada = execucaoDoChip(ultimo, lookup);
    return estaEmVoo(entrada) ? (resumeGrupo([entrada]).atual?.frase ?? null) : null;
  }

  return null;
}
