// `enxuto=1` no stream (28/09): o back tira `signature` do thinking e
// `message.usage` do evento — ~20% do replay de 300 mensagens. Esta suíte prova
// que o feed não percebe: o pipeline inteiro (itens, lookup de resultado,
// família do renderer rico, corpo normalizado, thinking, filtro de visível,
// agrupamento) sai igual com e sem as duas chaves.
//
// Fonte: as 52 famílias reais versionadas. Com `FEED_ENXUTO_REPLAYS=<dir>`, roda
// também sobre pares `<slug>-antes.jsonl`/`<slug>-depois.jsonl` gravados do
// próprio endpoint — um evento por linha, sem e com `enxuto` — que não vão para
// o repo (dado de conversa real).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import {
  buildRenderItems,
  buildToolResultLookup,
  coalesceSidechainGroups,
  deriveSubagentStatusesFromMessages,
} from '@grupo_borges/cockpit-core/render-items';

import { execucaoDaParte, familiaDoRich } from '../../components/feed/execucao-do-item.ts';
import { agrupaFerramentas } from '../../components/feed/grupo-ferramentas.ts';
import { normalizarAgentResult } from '../../components/renderers/agent-result.ts';
import { normalizarFetchResult } from '../../components/renderers/fetch-result.ts';
import { normalizarConteudoDeArquivo } from '../../components/renderers/file-content.ts';
import { normalizarPaginaPublicada } from '../../components/renderers/published-page.ts';
import { normalizarListaResultado } from '../../components/renderers/result-list.ts';
import { normalizarSaidaDeShell } from '../../components/renderers/shell-output.ts';
import { normalizarLinhaDeStatus } from '../../components/renderers/status-line.ts';
import { buildThinkingRenderModel } from '../thinking.ts';
import { temConteudoVisivel } from './conteudo-visivel.ts';

const FAMILIAS = join(import.meta.dirname, '../../../../fixtures/cockpit-v2/familias');

/** O mesmo corte de `apps/api/services/feed_enxuto.py`, sobre uma cópia. */
function enxuga(m: MessagePayload): MessagePayload {
  const copia = structuredClone(m);
  const message = copia.message as Record<string, unknown> | null;
  if (message && typeof message === 'object') {
    delete message.usage;
    if (Array.isArray(message.content)) {
      for (const parte of message.content as Record<string, unknown>[]) {
        if (parte && parte.type === 'thinking') delete parte.signature;
      }
    }
  }
  return copia;
}

/** Tudo o que o feed desenha a partir de uma lista de eventos. `payload` é o
 *  evento cru que o chip carrega; `signature`/`usage` são as chaves cortadas —
 *  o que se compara é todo o resto, e a prova de que nenhum renderer lê as
 *  duas é o grep do relato mais os normalizadores rodados abaixo. */
function oQueOFeedVe(messages: MessagePayload[]): string {
  const lookup = buildToolResultLookup(messages);
  const itens = coalesceSidechainGroups(buildRenderItems(messages));
  const ricos = [...lookup.entries()].map(([id, entrada]) => ({
    id,
    content: entrada.content,
    isError: entrada.isError,
    familia: familiaDoRich(entrada.rich),
    normalizado: [
      normalizarFetchResult(entrada.rich),
      normalizarListaResultado(entrada.rich),
      normalizarAgentResult(entrada.rich),
      normalizarConteudoDeArquivo(entrada.rich),
      normalizarLinhaDeStatus(entrada.rich),
      normalizarPaginaPublicada(entrada.rich),
      normalizarSaidaDeShell(entrada.rich),
    ],
  }));
  const execucoes = messages.flatMap((m) =>
    Array.isArray(m.message?.content)
      ? m.message.content
          .filter((p) => p.type === 'tool_use')
          .map((p) => execucaoDaParte(p as Parameters<typeof execucaoDaParte>[0], lookup))
      : [],
  );
  const thinking = messages.map((m) => buildThinkingRenderModel(m.message?.content ?? null));
  const visiveis = itens.map(temConteudoVisivel);
  const feed = agrupaFerramentas(itens.filter(temConteudoVisivel));
  const subagentes = [...deriveSubagentStatusesFromMessages(messages).entries()];
  return JSON.stringify(
    { itens, ricos, execucoes, thinking, visiveis, feed, subagentes },
    (chave, valor) =>
      chave === 'payload' || chave === 'signature' || chave === 'usage' ? undefined : valor,
  );
}

function familias(): MessagePayload[] {
  return readdirSync(FAMILIAS)
    .filter((nome) => nome.endsWith('.json') && !nome.startsWith('_'))
    .sort()
    .map((nome) => JSON.parse(readFileSync(join(FAMILIAS, nome), 'utf8')).evento as MessagePayload);
}

test('as 52 famílias reais: o feed vê o mesmo com e sem signature/usage', () => {
  const eventos = familias();
  assert.equal(eventos.length, 52);
  const enxutos = eventos.map(enxuga);

  // O corte acontece de verdade nas fixtures — senão a igualdade é vazia.
  const temAssinatura = (ms: MessagePayload[]) =>
    ms.some((m) => JSON.stringify(m.message ?? null).includes('"signature"'));
  assert.ok(temAssinatura(eventos));
  assert.ok(!temAssinatura(enxutos));

  assert.equal(oQueOFeedVe(enxutos), oQueOFeedVe(eventos));
});

test('cada família sozinha também não muda', () => {
  for (const evento of familias()) {
    assert.equal(oQueOFeedVe([enxuga(evento)]), oQueOFeedVe([evento]), String(evento.id));
  }
});

test('o bloco thinking continua na lista, só sem a assinatura', () => {
  const evento = familias().find((m) =>
    Array.isArray(m.message?.content) && m.message.content.some((p) => p.type === 'thinking'),
  );
  assert.ok(evento);
  const antes = evento.message!.content as unknown as Record<string, unknown>[];
  const depois = enxuga(evento).message!.content as unknown as Record<string, unknown>[];
  assert.equal(depois.length, antes.length);
  const thinking = depois.find((p) => p.type === 'thinking')!;
  assert.equal('signature' in thinking, false);
  assert.equal(thinking.thinking, antes.find((p) => p.type === 'thinking')!.thinking);
});

const REPLAYS = process.env.FEED_ENXUTO_REPLAYS;

test('replays reais do endpoint (opcional, FEED_ENXUTO_REPLAYS)', { skip: !REPLAYS }, () => {
  const le = (arquivo: string) =>
    readFileSync(join(REPLAYS!, arquivo), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((linha) => JSON.parse(linha) as MessagePayload);
  const slugs = readdirSync(REPLAYS!)
    .filter((nome) => nome.endsWith('-antes.jsonl'))
    .map((nome) => nome.replace(/-antes\.jsonl$/, ''));
  assert.ok(slugs.length > 0);
  for (const slug of slugs) {
    const antes = le(`${slug}-antes.jsonl`);
    const depois = le(`${slug}-depois.jsonl`);
    assert.equal(depois.length, antes.length, slug);
    assert.equal(oQueOFeedVe(depois), oQueOFeedVe(antes), slug);
  }
});
