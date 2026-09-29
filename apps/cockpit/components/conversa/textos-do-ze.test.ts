import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ContentPart, MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { maiorIdDasMensagens, passosDoZeDepoisDe, textosDoZeDepoisDe } from './textos-do-ze.ts';

function mensagem(
  id: number,
  kind: MessagePayload['kind'],
  content: string | ContentPart[],
): MessagePayload {
  return {
    id,
    kind,
    uuid: String(id),
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-09-26T00:00:00Z',
    created_at: id,
    message: {
      role: kind === 'assistant' ? 'assistant' : 'user',
      content,
    },
  };
}

describe('textos novos do Zé', () => {
  it('ignora o replay e entrega só texto posterior ao cursor', () => {
    const mensagens = [
      mensagem(10, 'assistant', 'histórico'),
      mensagem(11, 'user', 'pedido'),
      mensagem(12, 'assistant', 'resposta nova'),
    ];

    assert.deepEqual(textosDoZeDepoisDe(mensagens, 11), [
      { id: 12, texto: 'resposta nova' },
    ]);
  });

  it('entrega cada bloco de texto e ignora thinking e tool_use', () => {
    const mensagens = [
      mensagem(20, 'assistant', [
        { type: 'thinking', thinking: 'interno' },
        { type: 'text', text: 'primeiro' },
        { type: 'tool_use', id: 't1', name: 'Read', input: {} },
        { type: 'text', text: ' segundo ' },
      ]),
    ];

    assert.deepEqual(textosDoZeDepoisDe(mensagens, 0), [
      { id: 20, texto: 'primeiro' },
      { id: 20, texto: 'segundo' },
    ]);
  });

  it('o cursor avança também sobre eventos sem fala', () => {
    const mensagens = [mensagem(7, 'user', 'oi'), mensagem(15, 'system', '')];
    assert.equal(maiorIdDasMensagens(mensagens, 4), 15);
    assert.equal(maiorIdDasMensagens([], 4), 4);
  });
});

function doZe(id: number, texto: string, stop: string | null): MessagePayload {
  const base = mensagem(id, 'assistant', [{ type: 'text', text: texto }]);
  return { ...base, message: { ...base.message!, stop_reason: stop } } as MessagePayload;
}

const semLinha = (id: number, kind: MessagePayload['kind'], content?: string): MessagePayload =>
  ({ ...mensagem(id, kind, ''), uuid: kind === 'queued' ? null : String(id), message: null, content }) as MessagePayload;
const naFila = (id: number, texto: string) => semLinha(id, 'queued', texto);
const anexo = (id: number) => semLinha(id, 'attachment');
const resultado = (id: number) => mensagem(id, 'user', [{ type: 'tool_result', tool_use_id: `t${id}`, content: 'ok' }]);

describe('passos do Zé na ordem do lote', () => {
  it('um turno inteiro: abre, cada texto, fecha no fim', () => {
    const lote = [
      mensagem(1, 'user', 'pedido'),
      doZe(2, 'vou olhar', 'tool_use'),
      mensagem(3, 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      doZe(4, 'pronto', 'end_turn'),
    ];
    assert.deepEqual(passosDoZeDepoisDe(lote, 0, false, false), [
      { tipo: 'abre' },
      { tipo: 'texto', texto: 'vou olhar' },
      { tipo: 'texto', texto: 'pronto' },
      { tipo: 'fecha' },
    ]);
  });

  it('dois turnos colados: o fim do descartado vem antes da fala que estava na fila', () => {
    const lote = [doZe(5, 'resto velho', 'end_turn'), mensagem(6, 'user', 'nova fala'), doZe(7, 'resposta', null)];
    assert.deepEqual(passosDoZeDepoisDe(lote, 4, true, true), [
      { tipo: 'texto', texto: 'resto velho' },
      { tipo: 'fecha' },
      { tipo: 'abre' },
      { tipo: 'texto', texto: 'resposta' },
    ]);
  });

  it('pedido novo com o turno velho sem fim: fecha o velho antes — a resposta é de um turno novo', () => {
    // Um freio com o Zé parado não grava fim nenhum (29/09, depois do /compact): o turno
    // fantasma ficava aberto, gastava a marca de descarte com o fim da resposta nova e a tela
    // calava até recarregar. Pedido que entra direto, sem passar pela fila, prova que o Zé
    // estava parado.
    const lote = [mensagem(80, 'user', 'nova fala'), doZe(81, 'resposta', 'end_turn')];
    assert.deepEqual(passosDoZeDepoisDe(lote, 79, true, false), [
      { tipo: 'fecha' },
      { tipo: 'abre' },
      { tipo: 'texto', texto: 'resposta' },
      { tipo: 'fecha' },
    ]);
  });

  it('resultado de ferramenta no meio do turno não fecha nada', () => {
    const lote = [resultado(90), doZe(91, 'segue', 'tool_use')];
    assert.deepEqual(passosDoZeDepoisDe(lote, 89, true, true), [{ tipo: 'texto', texto: 'segue' }]);
  });

  it('resposta gravada em duas linhas com o fim: fecha só depois do texto', () => {
    const lote = [mensagem(20, 'user', 'pedido'), doZe(21, '', 'end_turn'), doZe(22, 'Um.', 'end_turn')];
    assert.deepEqual(passosDoZeDepoisDe(lote, 19, false, false), [
      { tipo: 'abre' },
      { tipo: 'texto', texto: 'Um.' },
      { tipo: 'fecha' },
    ]);
  });

  it('resposta partida em dois lotes: o fim sem fala espera a folga e o texto entra no mesmo turno', () => {
    // Medido no canarinho: a linha vazia com o fim chega ~250 ms antes da linha com o texto.
    const historico = [mensagem(60, 'user', 'pedido'), doZe(61, '', 'end_turn'), doZe(62, 'Um.', 'end_turn')];
    assert.deepEqual(passosDoZeDepoisDe(historico.slice(0, 2), 59, false, false), [
      { tipo: 'abre' },
      { tipo: 'fechaNaFolga' },
    ]);
    assert.deepEqual(passosDoZeDepoisDe(historico, 61, 'acabando', false), [
      { tipo: 'texto', texto: 'Um.' },
      { tipo: 'fecha' },
    ]);
  });

  it('a folga vale também no fim partido de um turno que já falou antes da ferramenta', () => {
    const lote = [doZe(70, 'Vou ler.', 'tool_use'), resultado(71), doZe(72, '', 'end_turn')];
    assert.deepEqual(passosDoZeDepoisDe(lote, 69, true, false), [
      { tipo: 'texto', texto: 'Vou ler.' },
      { tipo: 'fechaNaFolga' },
    ]);
  });

  it('fim sem fala seguido de pedido novo: fecha na hora, sem esperar a folga', () => {
    const lote = [mensagem(81, 'user', 'outro pedido'), doZe(82, 'Dois.', null)];
    assert.deepEqual(passosDoZeDepoisDe(lote, 80, 'acabando', true), [
      { tipo: 'fecha' },
      { tipo: 'abre' },
      { tipo: 'texto', texto: 'Dois.' },
    ]);
  });

  it('lote sem nada novo durante a folga: o fim segue esperando', () => {
    assert.deepEqual(passosDoZeDepoisDe([], 90, 'acabando', false), [{ tipo: 'fechaNaFolga' }]);
  });

  it('freio antes da resposta: a marca que o servidor grava fecha o turno na hora, sem folga', () => {
    // O Claude Code não grava fim quando o Escape vem antes da primeira linha; o servidor grava esta.
    assert.deepEqual(passosDoZeDepoisDe([mensagem(95, 'user', 'pedido')], 94, false, true), [{ tipo: 'abre' }]);
    const marca = mensagem(96, 'user', '[Request interrupted by user]');
    assert.deepEqual(passosDoZeDepoisDe([marca], 95, true, false), [{ tipo: 'fecha' }]);
  });

  it('pedido e freio no mesmo lote ainda fecham o turno', () => {
    const lote = [mensagem(8, 'user', 'pedido'), mensagem(9, 'user', '[Request interrupted by user]')];
    assert.deepEqual(passosDoZeDepoisDe(lote, 7, false, false), [{ tipo: 'abre' }, { tipo: 'fecha' }]);
  });

  it('pergunta na fila do turno em voo: entra pelo anexo, sem fim entre os dois turnos', () => {
    // O formato medido no canarinho em 27/09: `queued` na hora do envio, anexo na fronteira de ferramenta.
    const lote = [
      naFila(30, 'nova pergunta'),
      doZe(31, '', 'tool_use'),
      resultado(32),
      anexo(33),
      anexo(34),
      doZe(35, 'Pronto. Dois.', 'end_turn'),
    ];
    assert.deepEqual(passosDoZeDepoisDe(lote, 29, true, false), [
      { tipo: 'pedidoEntrou' },
      { tipo: 'texto', texto: 'Pronto. Dois.' },
      { tipo: 'fecha' },
    ]);
  });

  it('o `queued` e o anexo em lotes diferentes: a fila é lida no histórico inteiro', () => {
    const historico = [naFila(40, 'nova pergunta'), doZe(41, '', 'tool_use'), resultado(42), anexo(43), doZe(44, 'dois', null)];
    assert.deepEqual(passosDoZeDepoisDe(historico.slice(0, 3), 39, true, true), []);
    assert.deepEqual(passosDoZeDepoisDe(historico, 42, true, true), [
      { tipo: 'pedidoEntrou' },
      { tipo: 'texto', texto: 'dois' },
    ]);
  });

  it('turno que acaba antes: a fila drena como pedido novo e nenhum anexo conta como entrada', () => {
    const lote = [
      naFila(50, 'nova pergunta'),
      doZe(51, 'resto velho', 'end_turn'),
      mensagem(52, 'user', 'nova pergunta'),
      anexo(53),
      doZe(54, 'nova', 'end_turn'),
    ];
    assert.deepEqual(passosDoZeDepoisDe(lote, 49, true, false), [
      { tipo: 'texto', texto: 'resto velho' },
      { tipo: 'fecha' },
      { tipo: 'abre' },
      { tipo: 'texto', texto: 'nova' },
      { tipo: 'fecha' },
    ]);
  });

  it('o isRunning do stream vence quando o lote não explica a mudança', () => {
    assert.deepEqual(passosDoZeDepoisDe([], 9, true, false), [{ tipo: 'fecha' }]);
    assert.deepEqual(passosDoZeDepoisDe([], 9, false, true), [{ tipo: 'abre' }]);
  });
});
