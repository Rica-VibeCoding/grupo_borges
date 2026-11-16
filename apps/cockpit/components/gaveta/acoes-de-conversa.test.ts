import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ATUAL,
  explicaRecusa,
  ondeMostra,
  textoDaEspera,
  textoDaTroca,
  trocaEmCurso,
  type Troca,
} from './acoes-de-conversa.ts';

import { leOperacao } from '../../lib/regua-da-troca.ts';

const retomar = (campos: Partial<Troca> = {}): Troca => ({ tipo: 'retomar', alvo: 'b', forcar: false, desligado: false, ...campos });
const nova: Troca = { tipo: 'nova', alvo: null, forcar: false, desligado: false };

describe('onde a ação aparece', () => {
  it('Retomar na linha da conversa pedida; Nova no cartão de cima', () => {
    assert.equal(ondeMostra({ fase: 'ocupado', troca: retomar() }), 'b');
    assert.equal(ondeMostra({ fase: 'ocupado', troca: nova }), ATUAL);
  });

  it('a espera que voltou sem alvo fica no cartão de cima', () => {
    assert.equal(ondeMostra({ fase: 'esperando', troca: null, etapa: 'religando', inicio: 0 }), ATUAL);
    assert.equal(trocaEmCurso({ fase: 'esperando', troca: null, etapa: 'religando', inicio: 0 }), true);
  });

  it('livre não mostra nada; exclusão fica na própria linha', () => {
    assert.equal(ondeMostra({ fase: 'livre' }), null);
    assert.equal(ondeMostra({ fase: 'confirmando-exclusao', id: 'c' }), 'c');
    assert.equal(trocaEmCurso({ fase: 'excluindo', id: 'c' }), false);
  });
});

describe('botão de troca, sem confirmação (rodada 2)', () => {
  it('parado: Continuar esta; no meio de um turno, interrompe', () => {
    assert.equal(textoDaTroca('retomar', false), 'Continuar esta');
    assert.equal(textoDaTroca('retomar', true), 'Interromper e continuar esta');
  });

  it('a Nova segue a mesma régua', () => {
    assert.equal(textoDaTroca('nova', false), 'Nova conversa');
    assert.equal(textoDaTroca('nova', true), 'Interromper e abrir nova');
  });
});

describe('espera em barra', () => {
  it('uma frase só, sem etapa nem contagem', () => {
    assert.equal(textoDaEspera(retomar(), 'Pavan'), 'Abrindo esta conversa…');
    assert.equal(textoDaEspera(retomar({ forcar: true }), 'Pavan'), 'Abrindo esta conversa…');
    assert.equal(textoDaEspera(nova, 'Pavan'), 'Abrindo a conversa nova…');
  });

  it('desligado liga; sem alvo conhecido, não promete destino', () => {
    assert.equal(textoDaEspera(retomar({ desligado: true }), 'Pavan'), 'Ligando Pavan nesta conversa…');
    assert.equal(textoDaEspera(null, 'Pavan'), 'Trocando a conversa de Pavan…');
  });
});

describe('leitura do /operacao', () => {
  it('em curso segue com a etapa', () => {
    assert.deepEqual(leOperacao({ id: 'op', session_id: null, fase: 'religando', desde: 1, detalhe: null }), { tipo: 'segue', etapa: 'religando' });
  });

  it('erro traz o detalhe da API como veio', () => {
    const detalhe = 'Não subiu na conversa pedida; voltou na conversa anterior.';
    assert.deepEqual(leOperacao({ id: 'op', session_id: null, fase: 'erro', desde: 1, detalhe }), { tipo: 'erro', texto: detalhe });
  });

  it('fase nula: a operação sumiu (restart da API)', () => {
    assert.deepEqual(leOperacao({ id: null, session_id: null, fase: null, desde: null, detalhe: null }), { tipo: 'sumiu' });
    assert.deepEqual(leOperacao({ id: 'op', session_id: null, fase: 'pronta', desde: 1, detalhe: null }), { tipo: 'pronta' });
  });
});

describe('recusas', () => {
  it('códigos da API viram frase; os já em português passam', () => {
    assert.match(explicaRecusa('desligado', 'Pavan'), /Pavan está desligado/);
    assert.match(explicaRecusa('motor_sem_conversas', 'Pavan'), /motor/);
    assert.equal(explicaRecusa('Conversa aberta na linha felipe', 'Pavan'), 'Conversa aberta na linha felipe');
  });
});
