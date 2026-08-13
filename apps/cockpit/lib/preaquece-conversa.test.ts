import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { canarioStreamCache } from './spike/canario-stream-cache.ts';
import type {
  EventSourceConstructor,
  EventSourceLike,
} from './spike/canario-stream-controller.ts';
import { HISTORICO_PADRAO, preaqueceConversa } from './preaquece-conversa.ts';

const MENSAGEM = (JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../fixtures/cockpit-v2/familias/borda__content_string.json'),
    'utf8',
  ),
) as { evento: MessagePayload }).evento;

/** Conta aberturas e deixa disparar os eventos do replay. O número de aberturas
 *  é o que decide se o pré-aquecimento ajudou ou dobrou o custo: chave de cache
 *  divergente abriria uma SEGUNDA conexão para o mesmo agente, com outro replay
 *  de 300 mensagens atrás. */
class FonteFalsa implements EventSourceLike {
  static aberturas: string[] = [];
  static viva: FonteFalsa | null = null;
  private ouvintes = new Map<string, (e: { data: string }) => void>();
  onerror: (() => void) | null = null;
  constructor(url: string) {
    FonteFalsa.aberturas.push(url);
    FonteFalsa.viva = this;
  }
  addEventListener(tipo: string, ouvinte: (e: { data: string }) => void): void {
    this.ouvintes.set(tipo, ouvinte);
  }
  emite(tipo: string, dados = ''): void {
    this.ouvintes.get(tipo)?.({ data: dados });
  }
  close(): void {}
}

const CONSTRUTOR = FonteFalsa as unknown as EventSourceConstructor;

function zera(): void {
  canarioStreamCache.disposeAll();
  FonteFalsa.aberturas = [];
  FonteFalsa.viva = null;
}

test('sem EventSource no ambiente o pré-aquecimento não faz nada', () => {
  zera();
  preaqueceConversa('daniel', undefined);
  assert.equal(canarioStreamCache.size(), 0);
});

test('o toque e o feed compartilham a MESMA entrada de cache', () => {
  zera();
  preaqueceConversa('daniel', CONSTRUTOR);

  // O que o `useCanarioStream` pede dentro do `FeedDaConversa` — os mesmos
  // três parâmetros, com a constante importada daqui para não divergirem.
  const doFeed = canarioStreamCache.get({
    slug: 'daniel',
    limit: HISTORICO_PADRAO,
    recentes: true,
    eventSourceConstructor: CONSTRUTOR,
  });
  const solta = doFeed.subscribe(() => {});

  assert.equal(canarioStreamCache.size(), 1);
  assert.equal(FonteFalsa.aberturas.length, 1);
  assert.match(FonteFalsa.aberturas[0]!, /limit=300/);
  assert.match(FonteFalsa.aberturas[0]!, /recentes=1/);

  solta();
  zera();
});

test('o que chegou antes do commit já está no PRIMEIRO snapshot do feed', () => {
  zera();
  // O toque: a conexão abre e o replay corre enquanto a navegação ainda está
  // em voo. Nesta janela ninguém está inscrito — é o cache que segura.
  preaqueceConversa('pavan', CONSTRUTOR);
  const fonte = FonteFalsa.viva!;
  fonte.emite('replay-start');
  fonte.emite('message', JSON.stringify(MENSAGEM));
  fonte.emite('replay-end');

  // A navegação commitou: o feed monta e pede o stream.
  const doFeed = canarioStreamCache.get({
    slug: 'pavan',
    limit: HISTORICO_PADRAO,
    recentes: true,
    eventSourceConstructor: CONSTRUTOR,
  });
  const solta = doFeed.subscribe(() => {});

  const primeiro = doFeed.getSnapshot();
  assert.equal(primeiro.messages.length, 1, 'o feed nasceria vazio — o branco de ~700ms');
  assert.equal(primeiro.status, 'live');
  assert.equal(FonteFalsa.aberturas.length, 1);

  solta();
  zera();
});
