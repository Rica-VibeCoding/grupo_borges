// O que este teste protege não é o formato — é a IDENTIDADE DE OBJETO.
// Traduzir campo a campo é a parte fácil e o TypeScript já cobre; o que quebra
// em silêncio é o adaptador devolver objetos novos a cada poll, porque aí o
// `samePrefix` do incremental (`lib/spike/render-items-incremental.ts`) para de
// casar e a conversa inteira é reclassificada de 3 em 3 segundos, com o feed
// remontando por baixo. Nada disso aparece como erro: só como tela que pisca e
// CPU que sobe. Por isso metade dos casos abaixo compara com `assert.equal`
// (identidade), não `deepEqual`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { criaAdaptadorCodex, type CodexMessage } from './adapta-mensagens.ts';

function bruta(over: Partial<CodexMessage> & { id: string }): CodexMessage {
  return {
    role: 'assistant',
    text: 'texto',
    timestamp: '2026-08-09T20:00:00.000Z',
    item_type: 'message',
    visible: true,
    ...over,
  };
}

describe('adaptaMensagensCodex', () => {
  it('traduz user e assistant preservando a ordem', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({ id: 't:0', role: 'user', text: 'roda o teste' }),
      bruta({ id: 't:1', role: 'assistant', text: 'rodei, 6 verdes' }),
    ]);

    assert.equal(saida.length, 2);
    assert.equal(saida[0].kind, 'user');
    assert.equal(saida[0].message?.content, 'roda o teste');
    assert.equal(saida[1].kind, 'assistant');
    assert.equal(saida[1].message?.stop_reason, 'end_turn');
    // `id` numérico é índice do incremental e chave do virtualizador.
    assert.deepEqual(saida.map((m) => m.id), [0, 1]);
  });

  it('carrega a proveniência de voz ao evento canônico', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({
        id: 't:voz',
        role: 'user',
        text: 'abre o relatório',
        meta: { kind: 'stt', raw_text: '🎙 abre o relatório' },
      }),
    ]);

    assert.deepEqual(saida[0].meta, {
      kind: 'stt',
      raw_text: '🎙 abre o relatório',
    });
  });

  it('deixa o internal de fora e não gasta ordinal com ele', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({ id: 't:0', role: 'user', text: 'sobe' }),
      bruta({ id: 't:1', role: 'internal', text: 'bash -lc "pytest -q"' }),
      bruta({ id: 't:2', role: 'assistant', text: 'subiu' }),
    ]);

    assert.equal(saida.length, 2);
    assert.deepEqual(saida.map((m) => m.id), [0, 1]);
    assert.equal(saida[1].message?.content, 'subiu');
  });

  it('devolve o MESMO array quando o poll não trouxe novidade', () => {
    const adapta = criaAdaptadorCodex();
    const entrada = [bruta({ id: 't:0', role: 'user', text: 'oi' })];

    const primeira = adapta(entrada);
    const segunda = adapta([...entrada]); // array novo, conteúdo idêntico

    assert.equal(primeira, segunda);
  });

  it('preserva a identidade do PREFIXO quando chega mensagem nova', () => {
    const adapta = criaAdaptadorCodex();
    const antes = adapta([bruta({ id: 't:0', role: 'user', text: 'oi' })]);
    const depois = adapta([
      bruta({ id: 't:0', role: 'user', text: 'oi' }),
      bruta({ id: 't:1', role: 'assistant', text: 'olá' }),
    ]);

    assert.notEqual(antes, depois);
    // É este o casamento que o `samePrefix` procura.
    assert.equal(antes[0], depois[0]);
    assert.equal(depois.length, 2);
  });

  it('troca só o objeto que mudou quando a última resposta cresce', () => {
    const adapta = criaAdaptadorCodex();
    const antes = adapta([
      bruta({ id: 't:0', role: 'user', text: 'oi' }),
      bruta({ id: 't:1', role: 'assistant', text: 'estou pen' }),
    ]);
    const depois = adapta([
      bruta({ id: 't:0', role: 'user', text: 'oi' }),
      bruta({ id: 't:1', role: 'assistant', text: 'estou pensando' }),
    ]);

    assert.equal(antes[0], depois[0]);
    assert.notEqual(antes[1], depois[1]);
    assert.equal(depois[1].message?.content, 'estou pensando');
  });

  it('timestamp ilegível vira 0 em vez de NaN', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([bruta({ id: 't:0', timestamp: 'nao-e-data' })]);

    // NaN em `created_at` envenena qualquer ordenação ou comparação depois.
    assert.equal(saida[0].created_at, 0);
  });

  it('esquece as mensagens da thread anterior quando a conversa troca', () => {
    const adapta = criaAdaptadorCodex();
    adapta([
      bruta({ id: 'velha:0', role: 'user', text: 'conversa antiga' }),
      bruta({ id: 'velha:1', role: 'assistant', text: 'resposta antiga' }),
    ]);
    const nova = adapta([bruta({ id: 'nova:0', role: 'user', text: 'conversa nova' })]);

    assert.equal(nova.length, 1);
    assert.equal(nova[0].message?.content, 'conversa nova');
    assert.equal(nova[0].uuid, 'codex-nova:0');
  });

  it('lista vazia não quebra e continua estável entre chamadas', () => {
    const adapta = criaAdaptadorCodex();
    const primeira = adapta([]);
    const segunda = adapta([]);

    assert.deepEqual(primeira, []);
    assert.equal(primeira, segunda);
  });
});
