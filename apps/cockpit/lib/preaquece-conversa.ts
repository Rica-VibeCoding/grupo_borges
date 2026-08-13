'use client';

/**
 * O STREAM ABRE NO TOQUE, NÃO NO COMMIT DA NAVEGAÇÃO.
 *
 * Medido na 3008 em 12/08 (6 repetições, load 0,55, dev da 3009 derrubado): a
 * URL commita em 316ms de mediana e a primeira mensagem só pinta em 1014ms.
 * Os ~700ms de branco no meio são o Rica olhando uma tela vazia com o item já
 * aceso na tropa — é o que ele filmou e descreveu como *"picotada"* na troca.
 *
 * A ordem dos eventos explica o vão: o `EventSource` da conversa nasce dentro
 * do `FeedDaConversa`, que só monta DEPOIS que a navegação commita. Servidor e
 * cliente ficam em série quando podiam correr juntos — o replay leva 338–902ms
 * para 300 mensagens (`replay-do-servidor.py`), e ele nem começou quando o
 * commit terminou.
 *
 * Aqui a conexão passa a abrir no mesmo instante em que o toque despacha a
 * navegação. Quando o feed monta, o cache já tem o que chegou e o
 * `useSyncExternalStore` devolve mensagens no primeiro render — sem o branco.
 *
 * Nada disso cria conexão a mais: o `canarioStreamCache` é global, guarda por
 * `slug|sessionId|limit|recentes` e derruba o stream sozinho após 30s sem
 * ninguém inscrito. Toque que não vira navegação (rede fora, toque desfeito)
 * fecha sozinho nesse prazo — e é o MESMO prazo que já segurava a conversa
 * anterior durante a troca, medido em `conta-eventsources.py`.
 */

import { canarioStreamCache } from './spike/canario-stream-cache.ts';
import type { EventSourceConstructor } from './spike/canario-stream-controller.ts';

/** Era 1000 até 09/08, quando o Rica cravou 100 — *"as mensagens ficam nas
 *  sessões do CC (…) pode mandar 100 mensagens, no máximo"*. Em 10/08 ele
 *  subiu para 300: rolando o chat do Pavan para trás a conversa acabava antes
 *  do começo da própria sessão, e 100 mensagens não cobriam nem uma tarde.
 *
 *  Medido em 10/08 no replay de uma sessão longa do `pavan`: 100 mensagens
 *  custam 220 KB e 300 custam 723 KB (~2,5 KB por mensagem a mais). Longe das
 *  2,82 MB que o teto de 1000 custava, que foi o que motivou o corte.
 *
 *  Isto NÃO alcança o que veio antes de um `/clear`: o replay é filtrado pela
 *  sessão atual, então o arquivo morto continua sendo o JSONL da sessão.
 *
 *  MORA AQUI, e não no `feed-da-conversa.tsx` que o consome, porque o
 *  pré-aquecimento precisa do MESMO número: chave de cache diferente não
 *  reaproveita nada — abre uma segunda conexão e piora o que veio consertar. */
export const HISTORICO_PADRAO = 300;

/** Abre (ou reaproveita) o stream da conversa de `slug` sem ninguém para ouvir.
 *
 *  A inscrição imediatamente desfeita não é truque: `subscribe` é o que acorda
 *  o controller, e soltar já entrega o stream ao prazo de ociosidade do cache
 *  em vez de deixar um ouvinte pendurado fora da árvore do React. */
export function preaqueceConversa(
  slug: string,
  eventSourceConstructor: EventSourceConstructor | undefined = globalThis.EventSource as unknown as
    | EventSourceConstructor
    | undefined,
): void {
  if (!eventSourceConstructor) return;
  const stream = canarioStreamCache.get({
    slug,
    limit: HISTORICO_PADRAO,
    recentes: true,
    eventSourceConstructor,
  });
  stream.subscribe(() => {})();
}
