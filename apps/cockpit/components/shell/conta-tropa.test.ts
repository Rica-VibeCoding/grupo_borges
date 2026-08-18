import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentInputError } from '@grupo_borges/cockpit-core/api';

import {
  contaExibida,
  listaDeContas,
  mensagemDeErroTroca,
  nomeDaConfirmada,
  pctDaFracao,
  rotuloDaConta,
} from './conta-tropa.ts';

describe('pctDaFracao — fração 0..1 vira o inteiro do card', () => {
  it('null e não-número são "sem leitura", nunca zero', () => {
    assert.equal(pctDaFracao(null), null);
    assert.equal(pctDaFracao(Number.NaN), null);
    assert.equal(pctDaFracao(Number.POSITIVE_INFINITY), null);
  });

  it('ceil, mesma régua do card de cota: 0.811 vira 82, não 81', () => {
    assert.equal(pctDaFracao(0), 0);
    assert.equal(pctDaFracao(0.811), 82);
    assert.equal(pctDaFracao(0.8), 80);
    assert.equal(pctDaFracao(1), 100);
  });

  it('centésimo exato não sobe 1pp: 0.07 é 7%, não 8%', () => {
    // `0.07 * 100` dá 7.000000000000001 em ponto flutuante, e o `ceil` cru
    // promovia isso a 8 — o back dizia 7% e a tela mostrava 8%.
    assert.equal(pctDaFracao(0.07), 7);
    assert.equal(pctDaFracao(0.29), 29);
    assert.equal(pctDaFracao(0.57), 57);
    // E o ceil continua valendo pro que não é exato.
    assert.equal(pctDaFracao(0.0701), 8);
  });

  it('fração fora do contrato fica presa em 0..100', () => {
    assert.equal(pctDaFracao(1.4), 100);
    assert.equal(pctDaFracao(-0.2), 0);
  });
});

describe('rotuloDaConta — o nome que o Rica reconhece', () => {
  it('o rótulo dado por ele ganha do email', () => {
    assert.equal(rotuloDaConta({ rotulo: 'woodpro', email: 'a@b.com' }), 'woodpro');
  });

  it('sem rótulo, o prefixo do email — mesma régua do leiaConta', () => {
    assert.equal(rotuloDaConta({ rotulo: '', email: 'ricardo.incasa@gmail.com' }), 'ricardo.incasa');
    assert.equal(rotuloDaConta({ rotulo: '   ', email: 'x@y.com' }), 'x');
  });

  it('sem nada, admite — não inventa nome', () => {
    assert.equal(rotuloDaConta({}), 'conta sem nome');
  });
});

describe('listaDeContas — a ativa se casa por email', () => {
  const resposta = {
    ativa: { email: 'ricardo.incasa@gmail.com', display_name: 'Ricardo' },
    contas: [
      { id: 'woodpro', email: 'woodpromais@gmail.com', rotulo: 'woodpro', cota_5h: 0.12, cota_7d: 0.81 },
      { id: 'incasa', email: 'ricardo.incasa@gmail.com', rotulo: 'incasa', cota_5h: null, cota_7d: 0.34 },
    ],
  };

  it('marca a ativa pelo email e converte as frações', () => {
    const lista = listaDeContas(resposta);
    assert.equal(lista.length, 2);
    assert.equal(lista[0].ativa, false);
    assert.equal(lista[1].ativa, true);
    assert.equal(lista[0].pct5h, 12);
    assert.equal(lista[0].pct7d, 81);
    assert.equal(lista[1].pct5h, null);
  });

  it('valorFalado carrega dono, estado e as duas janelas', () => {
    const [woodpro, incasa] = listaDeContas(resposta);
    assert.equal(
      woodpro.valorFalado,
      'woodpro, cota de 5 horas 12% usada, cota de 7 dias 81% usada',
    );
    assert.equal(
      incasa.valorFalado,
      'incasa, conta ativa, cota de 5 horas sem leitura, cota de 7 dias 34% usada',
    );
  });

  it('sem ativa ou sem lista ninguém explode', () => {
    assert.deepEqual(listaDeContas(null), []);
    assert.deepEqual(listaDeContas({ ativa: null, contas: [] }), []);
    assert.equal(listaDeContas({ ativa: null, contas: resposta.contas })[0].ativa, false);
  });
});

describe('contaExibida — depois da troca manda o que o back confirmou', () => {
  const confirmada = { email: 'woodpromais@gmail.com', display_name: 'Wood Pro' };

  it('a confirmada ganha do painel, que pode estar velho', () => {
    assert.equal(contaExibida(confirmada, 'Ricardo'), 'Wood Pro');
  });

  it('sem confirmação, o painel é quem fala', () => {
    assert.equal(contaExibida(null, 'Ricardo'), 'Ricardo');
    assert.equal(contaExibida(null, null), null);
  });

  it('display_name vazio cai pro prefixo do email', () => {
    assert.equal(nomeDaConfirmada({ email: 'woodpromais@gmail.com', display_name: '' }), 'woodpromais');
  });
});

describe('mensagemDeErroTroca — o 409 fala, o resto não finge', () => {
  it('o detail do back vai inteiro pra tela', () => {
    const erro = new AgentInputError('conta indisponível no momento', 409, 'conta indisponível no momento');
    assert.equal(mensagemDeErroTroca(erro), 'conta indisponível no momento');
  });

  it('falha de rede vira o genérico — sem prometer o estado da troca', () => {
    assert.equal(
      mensagemDeErroTroca(new TypeError('fetch failed')),
      'Não foi possível trocar a conta — tente de novo.',
    );
  });
});
