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

export function estadoDoAgora(entrada: Omit<EntradaDaBolinha, 'ouvindo'>): EstadoDoAgora {
  const estado = estadoDaBolinha(entrada);
  return estado === 'ouvindo' || estado === 'pronto' ? 'parado' : estado;
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
