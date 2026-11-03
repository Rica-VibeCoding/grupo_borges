import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  detalheDoErro,
  erroPedeReleitura,
  fraseDoErro,
  horaDoPonto,
  lerPontos,
  opcoesDoPonto,
  textoRestaurado,
  type PontoDeVolta,
} from './rewind.ts';

const ponto = (editado: boolean): PontoDeVolta => ({
  id: 'a',
  texto: 'oi',
  horario: '2026-11-01T14:05:00',
  arquivo_editado_depois: editado,
});

describe('lista de pontos', () => {
  it('lê a resposta real da API e descarta item malformado', () => {
    const lidos = lerPontos({
      session_id: 's',
      pontos: [
        { id: 'x', texto: '/clear', horario: '2026-10-31T14:05:52.472Z', arquivo_editado_depois: false },
        { id: 'y', texto: 'sem flag' },
        { id: 'z', texto: 'sem hora', arquivo_editado_depois: true },
      ],
    });
    assert.deepEqual(lidos.map((p) => p.id), ['x', 'z']);
    assert.equal(lidos[1].horario, null);
  });

  it('corpo sem pontos é erro, lista vazia não é', () => {
    assert.throws(() => lerPontos({ detail: 'sem_conversa_atual' }));
    assert.deepEqual(lerPontos({ pontos: [] }), []);
  });
});

describe('opções de um ponto', () => {
  it('sem edição de arquivo, as duas de código somem', () => {
    assert.deepEqual(opcoesDoPonto(ponto(false)).map((o) => o.acao), [
      'conversa',
      'resumir_daqui',
      'resumir_ate_aqui',
    ]);
  });

  it('com edição, as que desfazem arquivo vêm por último e marcadas', () => {
    const opcoes = opcoesDoPonto(ponto(true));
    assert.deepEqual(opcoes.map((o) => o.acao), [
      'conversa',
      'resumir_daqui',
      'resumir_ate_aqui',
      'conversa_e_codigo',
      'codigo',
    ]);
    assert.deepEqual(opcoes.filter((o) => o.desfazArquivo).map((o) => o.acao), ['conversa_e_codigo', 'codigo']);
  });
});

describe('hora na linha', () => {
  const agora = new Date(2026, 10, 1, 18, 0);
  it('hoje só a hora, ontem com a palavra, antes com a data', () => {
    assert.equal(horaDoPonto(new Date(2026, 10, 1, 9, 7).toISOString(), agora), '09:07');
    assert.equal(horaDoPonto(new Date(2026, 9, 31, 23, 59).toISOString(), agora), 'ontem 23:59');
    assert.equal(horaDoPonto(new Date(2026, 9, 30, 8, 0).toISOString(), agora), '30/10 08:00');
  });
  it('sem hora ou hora inválida, vazio', () => {
    assert.equal(horaDoPonto(null, agora), '');
    assert.equal(horaDoPonto('lixo', agora), '');
  });
});

describe('erros e resposta do POST', () => {
  it('cada detail conhecido vira frase própria; desconhecido cai no padrão', () => {
    assert.match(fraseDoErro('agente_ocupado'), /trabalhando/);
    assert.match(fraseDoErro('campo_ocupado'), /campo do agente/);
    assert.match(fraseDoErro('pane_incompativel'), /desligado/);
  });

  it('ponto de canal só volta a conversa', () => {
    assert.deepEqual(opcoesDoPonto({ ...ponto(true), canal: true }).map((o) => o.acao), ['conversa']);
    assert.match(fraseDoErro(null), /conexão/);
    assert.match(fraseDoErro('tela_nao_confirmada'), /não confirmou/);
    assert.ok(!fraseDoErro('qualquer_coisa').includes('_'));
  });

  it('ponto sumido pede releitura da lista', () => {
    assert.ok(erroPedeReleitura('ponto_nao_encontrado'));
    assert.ok(erroPedeReleitura('ponto_inexistente'));
    assert.ok(!erroPedeReleitura('agente_ocupado'));
  });

  it('texto restaurado vazio ou ausente é null', () => {
    assert.equal(textoRestaurado({ texto_restaurado: 'refaz isso', recarregar_feed: true }), 'refaz isso');
    assert.equal(textoRestaurado({ texto_restaurado: null }), null);
    assert.equal(textoRestaurado({ texto_restaurado: '' }), null);
    assert.equal(detalheDoErro({ detail: 'campo_ocupado' }), 'campo_ocupado');
    assert.equal(detalheDoErro({ detail: [{ msg: 'x' }] }), null);
  });
});
