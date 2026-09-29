import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { cenaVisivel, ferramentaEmCurso } from './estado-da-vez.ts';

let id = 0;
const msg = (kind: string, role: 'user' | 'assistant' | null, content: unknown, extra: object = {}) =>
  ({ id: (id += 1), kind, is_sidechain: false, message: role ? { role, content } : null, ...extra }) as unknown as MessagePayload;
const pedido = msg('user', 'user', 'Qual a previsão?');
const texto = (t: string) => msg('assistant', 'assistant', [{ type: 'text', text: t }]);
const usa = msg('assistant', 'assistant', [{ type: 'text', text: 'Vou olhar.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }]);
const resultado = msg('user', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]);
const raciocinio = msg('assistant', 'assistant', [{ type: 'thinking', thinking: 'hmm' }]);

describe('o agente está usando ferramenta agora?', () => {
  it('pedido feito, nada ainda: não', () => {
    assert.equal(ferramentaEmCurso([pedido]), false);
  });

  it('pediu ferramenta (mesmo depois de falar "vou olhar"): sim', () => {
    assert.equal(ferramentaEmCurso([pedido, usa]), true);
  });

  it('o resultado voltou e ele ainda não escreveu: continua trabalhando', () => {
    assert.equal(ferramentaEmCurso([pedido, usa, resultado]), true);
    assert.equal(ferramentaEmCurso([pedido, usa, resultado, raciocinio]), true);
  });

  it('voltou a escrever: não', () => {
    assert.equal(ferramentaEmCurso([pedido, usa, resultado, texto('Está ensolarado.')]), false);
  });

  it('subagente (sidechain) não decide: vale a linha do agente principal', () => {
    const lateral = msg('assistant', 'assistant', [{ type: 'text', text: 'sub' }], { is_sidechain: true });
    assert.equal(ferramentaEmCurso([pedido, usa, lateral]), true);
  });
});

describe('o estado que a tela mostra é a verdade', () => {
  const turno = ['esperandoZe', 'falando'] as const;

  it('"falando" só com áudio tocando', () => {
    for (const cena of turno) assert.equal(cenaVisivel({ cena, tocando: true, ferramenta: false }), 'falando', cena);
    assert.equal(cenaVisivel({ cena: 'falando', tocando: true, ferramenta: true }), 'falando');
  });

  it('sem som e sem ferramenta: pensando (mesmo com a máquina em "falando", entre áudios)', () => {
    for (const cena of turno) assert.equal(cenaVisivel({ cena, tocando: false, ferramenta: false }), 'esperandoZe', cena);
  });

  it('sem som e usando ferramenta: trabalhando', () => {
    for (const cena of turno) assert.equal(cenaVisivel({ cena, tocando: false, ferramenta: true }), 'trabalhando', cena);
  });

  it('fora do turno dele, a cena é a da conversa', () => {
    for (const cena of ['parado', 'preparando', 'ouvindo', 'transcrevendo', 'interrompendo', 'erro'] as const) {
      assert.equal(cenaVisivel({ cena, tocando: true, ferramenta: true }), cena, cena);
    }
  });

  it('agente ocupado não pinta de erro: a tela desenha "ocupado" (Rica, 29/09)', () => {
    assert.equal(cenaVisivel({ cena: 'erro', tocando: false, ferramenta: false, motivo: 'agenteOcupado' }), 'ocupado');
    for (const motivo of ['envioFalhou', 'capturaCaiu', 'transcricaoFalhou', undefined] as const) {
      assert.equal(cenaVisivel({ cena: 'erro', tocando: false, ferramenta: false, motivo }), 'erro', motivo);
    }
    // O motivo que sobra de um erro velho não pinta outra cena.
    assert.equal(cenaVisivel({ cena: 'ouvindo', tocando: false, ferramenta: false, motivo: 'agenteOcupado' }), 'ouvindo');
  });
});
