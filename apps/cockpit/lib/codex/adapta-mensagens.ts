/**
 * O TRADUTOR. `CodexMessage` (o que a Tara grava) → `MessagePayload` (o que o
 * feed inteiro já sabe desenhar).
 *
 * POR QUE TRADUZIR EM VEZ DE ENSINAR O FEED. O pipeline do chat
 * (`createIncrementalRenderItems` → `coalesceEntries`/`agrupaFerramentas` →
 * `Feed`) é puro e opera sobre `MessagePayload[]`. Ensinar uma segunda fonte a
 * ele custaria um ramo em cada etapa — e `components/feed/**` é território do
 * Hiro, que este arquivo só consome. Traduzindo na ENTRADA, a Tara herda o
 * desenho do Claude Code de graça e nenhuma peça de render sabe que Codex
 * existe. Foi o pedido do Rica em 09/08: *"tem que seguir a mesma UI que temos
 * no CC"*.
 *
 * ⚠️ A REGRA QUE NÃO PODE SER QUEBRADA — IDENTIDADE DE OBJETO.
 * O caminho rápido do incremental (`lib/spike/render-items-incremental.ts`,
 * `samePrefix`) compara mensagem a mensagem **por referência**, não por valor:
 * se o prefixo vier com objetos novos a cada rodada, ele reclassifica a
 * conversa inteira toda vez. O stream do CC não tropeça nisso porque só
 * concatena (`state.messages.concat(batch)`); um polling reconstrói a lista do
 * zero a cada resposta e tropeçaria.
 *
 * A doc oficial do React diz o mesmo do outro lado do problema, para quem lê de
 * fonte externa (react.dev/reference/react/useSyncExternalStore, consultada via
 * Context7 em 09/08): *"Do not return always different objects from
 * getSnapshot"* — isso derruba num laço infinito — e, nos Caveats, *"If the
 * underlying store has mutable data, return a new immutable snapshot if the
 * data has changed. Otherwise, return a cached last snapshot."*
 *
 * Daí o adaptador ser uma FÁBRICA com memória, e não uma função solta: ele
 * guarda o que já traduziu e devolve o mesmo objeto enquanto o conteúdo não
 * muda — e o mesmo ARRAY quando nada mudou.
 */

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

/** O que `GET /api/agents/{slug}/codex/messages` devolve em `messages[]`
 *  (`apps/api/services/codex_reader.py`, `CodexMessage.to_dict`). */
export type CodexMessage = {
  id: string;
  role: 'user' | 'assistant' | 'internal';
  text: string;
  timestamp: string;
  item_type: string;
  visible: boolean;
};

/** POR QUE `internal` FICA DE FORA. O reader marca `function_call` como
 *  `role: 'internal'` com um resumo do comando em `text` — texto, não a
 *  estrutura `{id, name, input}` que `execucao-do-item.ts` precisa pra desenhar
 *  uma linha de ferramenta. Promovido a bolha, viraria uma fala do agente que
 *  ele nunca disse; é mentira visual, e pior que a ausência. Fora, portanto,
 *  até o back expor a estrutura de verdade. */
function ehBolha(m: CodexMessage): boolean {
  return m.role === 'user' || m.role === 'assistant';
}

function instanteDe(timestamp: string): number {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : 0;
}

/** Duas mensagens com a mesma chave e o mesmo texto são a mesma mensagem — o
 *  rollout é append-only, mas um turno em voo pode ter a última linha crescendo
 *  entre um poll e outro. */
function mudou(anterior: MessagePayload, texto: string, ts: string): boolean {
  const corpo = anterior.message?.content;
  return corpo !== texto || anterior.timestamp !== ts;
}

export type AdaptadorCodex = (brutas: readonly CodexMessage[]) => MessagePayload[];

export function criaAdaptadorCodex(): AdaptadorCodex {
  const traduzidas = new Map<string, MessagePayload>();
  let ultimaLista: MessagePayload[] = [];

  return function adapta(brutas: readonly CodexMessage[]): MessagePayload[] {
    const lista: MessagePayload[] = [];
    const vistas = new Set<string>();
    let igualAAnterior = true;

    for (const bruta of brutas) {
      if (!ehBolha(bruta)) continue;

      // O `id` numérico é estrutural: índice do incremental e chave do
      // virtualizador (`components/feed/chave.ts`). Ordinal da POSIÇÃO na lista
      // já filtrada — estável porque o rollout só cresce no fim.
      const ordinal = lista.length;
      const chave = bruta.id || `codex-${ordinal}`;
      vistas.add(chave);

      const anterior = traduzidas.get(chave);
      if (anterior && !mudou(anterior, bruta.text, bruta.timestamp)) {
        lista.push(anterior);
        if (ultimaLista[ordinal] !== anterior) igualAAnterior = false;
        continue;
      }

      const papel = bruta.role === 'user' ? 'user' : 'assistant';
      const traduzida: MessagePayload = {
        id: ordinal,
        kind: papel,
        uuid: `codex-${chave}`,
        parent_uuid: null,
        session_id: null,
        is_sidechain: false,
        user_type: 'external',
        timestamp: bruta.timestamp,
        created_at: instanteDe(bruta.timestamp),
        message: {
          role: papel,
          content: bruta.text,
          stop_reason: papel === 'assistant' ? 'end_turn' : undefined,
        },
      };
      traduzidas.set(chave, traduzida);
      lista.push(traduzida);
      igualAAnterior = false;
    }

    // Thread trocada (o Rica abriu conversa nova) deixaria lixo crescendo pra
    // sempre no mapa — some com o que não veio nesta rodada.
    if (traduzidas.size !== vistas.size) {
      for (const chave of traduzidas.keys()) {
        if (!vistas.has(chave)) traduzidas.delete(chave);
      }
    }

    // Mesmo ARRAY quando nada mudou: é o que segura o `useMemo` do feed e
    // evita reclassificar a conversa a cada poll de agente parado.
    if (igualAAnterior && lista.length === ultimaLista.length) return ultimaLista;

    ultimaLista = lista;
    return lista;
  };
}
