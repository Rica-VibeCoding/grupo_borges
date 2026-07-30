import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aparenciaDe,
  emTransito,
  rotulaAcao,
  type FaseEnvio,
} from './aparencia-envio.ts';
import { descreveMotor, leMotor, rotulaEsforco, rotulaModelo, textoDoMotor } from './motor.ts';

const TODAS: FaseEnvio[] = [
  'ocioso',
  'enviando',
  'aceito',
  'confirmado',
  'pendurado',
  'falhou',
];

describe('aceito × confirmado — o defeito de hoje é os dois parecerem a mesma coisa', () => {
  it('difere em QUATRO sinais, e nenhum deles exige ler texto', () => {
    const a = aparenciaDe('aceito', 'Daniel');
    const c = aparenciaDe('confirmado', 'Daniel');

    assert.notEqual(a.fio, c.fio, 'movimento: o que se mexe ainda não chegou');
    assert.notEqual(a.assentada, c.assentada, 'fio de luz + peso do texto');
    assert.notEqual(a.filete, c.filete, 'filete de estado à esquerda');
  });

  it('aceito NÃO pode parecer sucesso — é espera', () => {
    const a = aparenciaDe('aceito', 'Daniel');
    assert.equal(a.assentada, false);
    assert.equal(a.fio, 'correndo');
    assert.match(a.frase ?? '', /esperando/);
  });

  it('confirmado é o único que canta sucesso, e canta calado', () => {
    const c = aparenciaDe('confirmado', 'Daniel');
    assert.equal(c.frase, null, 'sucesso é silêncio — igual à linha de ferramenta');
    assert.equal(c.assentada, true);
    assert.deepEqual(c.acoes, []);
  });
});

describe('pendurado — diagnóstico, não erro', () => {
  it('avisa que reenviar duplica: é a informação que impede o dano', () => {
    const p = aparenciaDe('pendurado', 'Daniel');
    assert.match(p.frase ?? '', /duplica/i);
    assert.match(p.anuncio, /duplicar/i);
  });

  it('nomeia o agente onde o texto pode ter ficado', () => {
    assert.match(aparenciaDe('pendurado', 'Hiro').frase ?? '', /Hiro/);
  });

  it('oferece a decisão ao humano e nunca decide sozinho', () => {
    assert.deepEqual(aparenciaDe('pendurado', 'Daniel').acoes, ['reenviar', 'copiar']);
  });

  it('o fio TRAVA no meio: a imagem do que aconteceu', () => {
    assert.equal(aparenciaDe('pendurado', 'Daniel').fio, 'travado');
  });

  it('usa o âmbar de ESPERA HUMANO, não o vermelho — não é erro', () => {
    assert.equal(aparenciaDe('pendurado', 'Daniel').filete, 'var(--ck-state-attention)');
    assert.equal(aparenciaDe('falhou', 'Daniel').filete, 'var(--ck-state-fail)');
  });
});

describe('falha', () => {
  it('perde o fio de luz — luz é vida, e esta mensagem não vive', () => {
    assert.equal(aparenciaDe('falhou', 'Daniel').assentada, false);
    assert.equal(aparenciaDe('falhou', 'Daniel').fio, 'nenhum');
  });
});

describe('anúncio para leitor de tela', () => {
  it('só interrompe quem precisa de decisão humana', () => {
    const assertivas = TODAS.filter((f) => aparenciaDe(f, 'Daniel').urgencia === 'assertive');
    assert.deepEqual(assertivas, ['pendurado', 'falhou']);
  });

  it('toda fase visível tem anúncio, mesmo as que não escrevem na tela', () => {
    for (const fase of TODAS) {
      if (fase === 'ocioso') continue;
      assert.ok(aparenciaDe(fase, 'Daniel').anuncio.length > 0, fase);
    }
  });
});

describe('em trânsito', () => {
  it('só enviando e aceito ainda mudam sozinhos', () => {
    assert.deepEqual(TODAS.filter(emTransito), ['enviando', 'aceito']);
  });
});

describe('rótulo de ação', () => {
  it('é voz ativa e diz o que acontece', () => {
    assert.equal(rotulaAcao('reenviar'), 'Reenviar');
    assert.equal(rotulaAcao('tentar-de-novo'), 'Tentar de novo');
  });
});

describe('motor — modelo e esforço dentro do composer', () => {
  it('traduz as três famílias para o nome que o Rica usa — mesma tabela da tropa', () => {
    assert.equal(rotulaModelo('claude-opus-5'), 'Opus 5');
    assert.equal(rotulaModelo('claude-opus-4-8'), 'Opus 4.8');
    assert.equal(rotulaModelo('codex-gpt-5-6-sol'), 'GPT-5.6 Sol');
    assert.equal(rotulaModelo('kimi-for-coding-highspeed'), 'K2.7 rápido');
    assert.equal(rotulaModelo('k3'), 'K3');
  });

  it('alias curto sem versão (visto em produção: state_model="opus") vira só a família', () => {
    assert.equal(rotulaModelo('opus'), 'Opus');
    assert.equal(rotulaModelo('sonnet'), 'Sonnet');
  });

  it('modelo desconhecido devolve o slug cru — nome bonito inventado é mentira', () => {
    assert.equal(rotulaModelo('claude-opus-9'), 'claude-opus-9');
    assert.equal(rotulaModelo(null), 'sem modelo');
  });

  it('esforço sai em português', () => {
    assert.equal(rotulaEsforco('xhigh'), 'extra alto');
    assert.equal(rotulaEsforco('max'), 'máximo');
    assert.equal(rotulaEsforco(null), null);
  });

  it('prefere o modelo da SESSÃO ao da config — é o que está rodando', () => {
    const m = leMotor({ modeloSessao: 'claude-opus-5', modeloPadrao: 'claude-opus-4-8' });
    assert.equal(m.modelo, 'Opus 5');
  });

  it('sem valor de sessão, o que sobra é config e a certeza CAI', () => {
    const m = leMotor({ modeloSessao: null, modeloPadrao: 'claude-opus-4-8' });
    assert.equal(m.modelo, 'Opus 4.8');
    assert.equal(m.certeza, 'pode-divergir');
  });

  it('a ressalva do back não some: entra por extenso no anúncio', () => {
    const m = leMotor({ modeloPadrao: 'claude-opus-5', esforco: 'xhigh' });
    assert.match(descreveMotor(m), /pode estar em outro valor/);
  });

  it('valor lido da sessão não carrega ressalva', () => {
    const m = leMotor({
      modeloSessao: 'claude-opus-5',
      esforco: 'high',
      podeDivergir: false,
    });
    assert.equal(m.certeza, 'lido');
    assert.equal(descreveMotor(m), 'Motor: Opus 5, esforço alto');
  });

  it('o texto do controle cabe numa linha e some o esforço quando não há', () => {
    assert.equal(textoDoMotor(leMotor({ modeloSessao: 'claude-opus-5', esforco: 'xhigh' })), 'Opus 5 · extra alto');
    assert.equal(textoDoMotor(leMotor({ modeloSessao: 'claude-opus-5' })), 'Opus 5');
  });
});
