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
 *
 * PARTES TIPADAS (`bruta.parts`), quando o back já separa texto/imagem/
 * contexto em vez do `text` achatado: a tradução continua produzindo só
 * vocabulário que o CC já fala, pela mesma razão do parágrafo acima —
 * nenhuma peça de render pode aprender que existe Codex.
 *   - `image` vira o MESMO envelope de texto que `leAnexoImagem`
 *     (`components/feed/anexo-imagem.ts`) já sabe ler pro CC — só que a
 *     "linha do caminho" é a data-URL pronta, não um arquivo em `uploads/`.
 *     `AnexoImagemView` desenha os dois sem saber a diferença.
 *   - `context` (régua do cockpit, prefixo de skill de áudio) não é fala do
 *     Rica e não pode se misturar com o que ele disse de verdade — mas
 *     `MessagePayload` só tem UM `content`. A saída é abrir a mensagem em
 *     DUAS: uma com `user_type: 'internal'` (o mesmo campo que já rebaixa
 *     hook/sistema no CC pro balão discreto `user-internal`, sem caixa) só
 *     com o contexto, e a de sempre com a fala real — nessa ordem, porque o
 *     contexto é preâmbulo. Cada metade ganha sua própria chave de memória
 *     (`<chave>:contexto` / `<chave>`), então a identidade de objeto vale
 *     para as duas independentemente.
 */

import type { MessagePayload, SyntheticMeta } from '@grupo_borges/cockpit-core/messages-types';

/** Uma peça da mensagem, quando `GET /api/agents/{slug}/codex/messages`
 *  já separa estrutura em vez do `text` achatado
 *  (`apps/api/services/codex_reader.py`). `image_url` é uma data-URL em
 *  base64 — a Tara nunca grava o anexo em `uploads/agents/**`. */
export type CodexMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; image_url: string }
  | { type: 'context'; text: string; source: 'developer' };

/** O que `GET /api/agents/{slug}/codex/messages` devolve em `messages[]`
 *  (`apps/api/services/codex_reader.py`, `CodexMessage.to_dict`). */
export type CodexMessage = {
  id: string;
  role: 'user' | 'assistant' | 'internal';
  text: string;
  timestamp: string;
  item_type: string;
  visible: boolean;
  meta?: SyntheticMeta;
  /** Presente só em quem já migrou pro contrato tipado — ausente cai no
   *  fallback do `text` de sempre. Nunca some: back mantém os dois em
   *  paralelo. */
  parts?: CodexMessagePart[];
};

/** Empacota a imagem no MESMO envelope que `leAnexoImagem` já reconhece —
 *  a URL da Tara chega pronta (data-URL), então a "linha do caminho" é a URL
 *  inteira em vez de um relativo de `uploads/`; `leAnexoImagem` aceita as
 *  duas formas (`components/feed/anexo-imagem.ts`). */
function envelopeDeImagem(imageUrl: string, legenda: string): string {
  return legenda.trim() ? `${imageUrl}\nCaption: ${legenda}` : imageUrl;
}

function ehParteDeTipo<T extends CodexMessagePart['type']>(
  tipo: T,
): (p: CodexMessagePart) => p is Extract<CodexMessagePart, { type: T }> {
  return (p): p is Extract<CodexMessagePart, { type: T }> => p.type === tipo;
}

/** O `content` achatado da mensagem principal — texto real, com a imagem (se
 *  houver) empacotada no envelope. O `context` NUNCA entra aqui: quem chama
 *  já extraiu e mandou pra bolha própria antes. */
function conteudoPrincipal(partes: readonly CodexMessagePart[]): string {
  const imagem = partes.find(ehParteDeTipo('image'));
  const texto = partes.filter(ehParteDeTipo('text')).map((p) => p.text).join('\n');
  return imagem ? envelopeDeImagem(imagem.image_url, texto) : texto;
}

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
function mesmaMeta(a: SyntheticMeta | undefined, b: SyntheticMeta | undefined): boolean {
  return a?.kind === b?.kind && a?.raw_text === b?.raw_text;
}

function mudou(
  anterior: MessagePayload,
  texto: string,
  ts: string,
  meta: SyntheticMeta | undefined,
): boolean {
  const corpo = anterior.message?.content;
  return corpo !== texto || anterior.timestamp !== ts || !mesmaMeta(anterior.meta, meta);
}

export type AdaptadorCodex = (brutas: readonly CodexMessage[]) => MessagePayload[];

export function criaAdaptadorCodex(): AdaptadorCodex {
  const traduzidas = new Map<string, MessagePayload>();
  let ultimaLista: MessagePayload[] = [];

  return function adapta(brutas: readonly CodexMessage[]): MessagePayload[] {
    const lista: MessagePayload[] = [];
    const vistas = new Set<string>();
    let igualAAnterior = true;

    // Uma chave, um lugar de memória: usado tanto pela bolha de contexto
    // quanto pela fala principal, cada uma com seu próprio sufixo — ver
    // comentário do topo do arquivo.
    const emite = (
      chave: string,
      papel: 'user' | 'assistant',
      conteudo: string,
      interna: boolean,
      bruta: CodexMessage,
    ): void => {
      vistas.add(chave);
      const ordinal = lista.length;

      const anterior = traduzidas.get(chave);
      if (anterior && !mudou(anterior, conteudo, bruta.timestamp, bruta.meta)) {
        lista.push(anterior);
        if (ultimaLista[ordinal] !== anterior) igualAAnterior = false;
        return;
      }

      const traduzida: MessagePayload = {
        // O `id` numérico é estrutural: índice do incremental e chave do
        // virtualizador (`components/feed/chave.ts`). Ordinal da POSIÇÃO na
        // lista já filtrada — estável porque o rollout só cresce no fim.
        id: ordinal,
        kind: papel,
        uuid: `codex-${chave}`,
        parent_uuid: null,
        session_id: null,
        is_sidechain: false,
        user_type: interna ? 'internal' : 'external',
        timestamp: bruta.timestamp,
        created_at: instanteDe(bruta.timestamp),
        message: {
          role: papel,
          content: conteudo,
          stop_reason: papel === 'assistant' ? 'end_turn' : undefined,
        },
        ...(bruta.meta ? { meta: bruta.meta } : {}),
      };
      traduzidas.set(chave, traduzida);
      lista.push(traduzida);
      igualAAnterior = false;
    };

    for (const bruta of brutas) {
      if (!ehBolha(bruta)) continue;

      const chave = bruta.id || `codex-${lista.length}`;
      const papel = bruta.role === 'user' ? 'user' : 'assistant';

      if (!bruta.parts) {
        // Fallback de sempre: quem ainda não migrou manda só `text` achatado.
        emite(chave, papel, bruta.text, false, bruta);
        continue;
      }

      // O contexto só existe amarrado à fala do Rica (régua do cockpit,
      // prefixo de skill de áudio) — nunca ao que o agente respondeu.
      const contexto = papel === 'user' ? bruta.parts.find(ehParteDeTipo('context')) : undefined;
      if (contexto) emite(`${chave}:contexto`, 'user', contexto.text, true, bruta);

      emite(chave, papel, conteudoPrincipal(bruta.parts), false, bruta);
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
