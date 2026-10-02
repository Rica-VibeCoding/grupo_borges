// A FERRAMENTA ÓRFÃ — `tool_use` que nunca recebeu `tool_result`.
//
// Sem resultado, a execução é `running` (`execucao-do-item.ts`), e um membro
// rodando prende o grupo inteiro em `rodando` (`resumo-do-grupo.ts`). Quando o
// turno morre no Claude Code, o resultado não vem nunca: medido 2 em 15.583
// (`docs/pesquisas/feed-do-turno-2026-10.md`, dedução 1), e cada um deixava o
// grupo dourado para sempre, contradizendo a esfera que já dizia "parado".
//
// A régua: SÓ O ÚLTIMO TURNO EM VOO PODE TER `running`. A ferramenta sem
// resultado deixa de estar em voo em dois casos:
//
//   1. veio DEPOIS dela outra resposta do agente no mesmo fluxo (principal ou
//      o mesmo subagente). O Claude Code devolve todos os resultados antes da
//      resposta seguinte, então quem ficou para trás não volta mais. "Outra"
//      é outro `message.id`: uma resposta com várias ferramentas chega como
//      várias linhas de MESMO id, e as irmãs ainda esperam juntas.
//   2. o turno acabou — o feed já sabe (`isRunning`, o prazo da linha viva e a
//      frota offline, em `feed-da-conversa.tsx`). `AskUserQuestion` fica de
//      fora deste caso: esperar o Rica não tem prazo, e o prazo de 5 min da
//      linha viva a encerraria no meio da espera legítima.
//
// O desfecho é um resultado sintético de ERRO no lookup: tudo a jusante (linha,
// grupo, memo por valor do `mesmo-item.ts`) já sabe desenhar falha, e o texto
// diz o que houve. Falha e não neutro: neutro concluído é a cápsula com ✓, que
// diria que deu certo — e não se sabe. A palavra `interrompido` no saldo do
// grupo cumpre "cor nunca é portadora única".
//
// Lógica pura, sem React — o `node --test` prova a régua sem transpilar JSX.

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { pedeAoRica } from './execucao-do-item.ts';

/** O corpo do resultado sintético — o que a expansão da linha mostra. */
export const INTERROMPIDO = 'Interrompido: o turno acabou antes desta ferramenta responder.';

/** A execução foi encerrada por esta régua, não por um erro de verdade. */
export function foiInterrompida(entrada: { result?: unknown; isError?: boolean } | undefined): boolean {
  return entrada?.isError === true && entrada.result === INTERROMPIDO;
}

function fluxoDe(payload: MessagePayload): string {
  return payload.is_sidechain ? `sub:${payload.agent_id ?? ''}` : 'principal';
}

/** O lookup com as órfãs encerradas. Devolve o MESMO lookup quando não há
 *  nenhuma — a identidade é o atalho do memo do feed. */
export function encerraOrfas(
  messages: readonly MessagePayload[],
  lookup: ToolResultLookup,
  turnoAcabou: boolean,
): ToolResultLookup {
  let saida: ToolResultLookup | null = null;
  // De trás para frente: por fluxo, os `message.id` de resposta já vistos.
  const idsDepois = new Map<string, Set<string>>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const payload = messages[i]!;
    const message = payload.message;
    if (payload.kind !== 'assistant' || message?.role !== 'assistant') continue;

    const fluxo = fluxoDe(payload);
    const vistos = idsDepois.get(fluxo) ?? new Set<string>();
    const proprio = message.id;
    const temRespostaDepois = [...vistos].some((id) => id !== proprio);

    if (Array.isArray(message.content)) {
      for (const parte of message.content as ContentPart[]) {
        if (parte?.type !== 'tool_use' || lookup.has(parte.id)) continue;
        const encerra = temRespostaDepois || (turnoAcabou && !pedeAoRica(parte.name));
        if (!encerra) continue;
        saida ??= new Map(lookup);
        saida.set(parte.id, { content: INTERROMPIDO, isError: true });
      }
    }

    if (proprio !== undefined) {
      vistos.add(proprio);
      idsDepois.set(fluxo, vistos);
    }
  }

  return saida ?? lookup;
}
