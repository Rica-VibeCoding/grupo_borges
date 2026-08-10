import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMANDOS,
  comandoInerte,
  descreveComando,
  diagnosticaComando,
  rotulaComando,
  type Comando,
} from './comandos-do-painel.ts';

const acha = (id: string): Comando => {
  const comando = COMANDOS.find((c) => c.id === id);
  if (!comando) throw new Error(`comando ${id} sumiu da lista`);
  return comando;
};

describe('a lista', () => {
  it('é a que o Rica passou em 10/08, na escada de custo', () => {
    assert.deepEqual(
      COMANDOS.map((c) => c.comando),
      ['/compact', '/encerrar', '/clear'],
    );
  });

  it('confirma só o que destrói', () => {
    // Pedir segundo toque no `/compact` seria copiar a proteção sem o perigo —
    // o erro que a pressão longa do cockpit antigo cometia com o destrava.
    assert.deepEqual(
      COMANDOS.filter((c) => c.confirma).map((c) => c.id),
      ['clear'],
    );
  });

  it('dá a frase de largura cheia a quem confirma, e só a ele', () => {
    for (const comando of COMANDOS) {
      assert.equal(Boolean(comando.aviso), comando.confirma);
    }
  });
});

describe('rótulo', () => {
  it('em repouso é o comando literal — é ele que sai no terminal', () => {
    assert.equal(rotulaComando(acha('clear'), 'ocioso'), '/clear');
  });

  it('armado é sempre o curto, nunca a frase que não cabe no botão', () => {
    assert.equal(rotulaComando(acha('clear'), 'confirmando'), 'Confirmar?');
  });

  it('com a espera do compact correndo, diz a espera', () => {
    assert.equal(rotulaComando(acha('compact'), 'aguardando'), 'Compactando…');
  });
});

describe('nome acessível', () => {
  it('em repouso soma rótulo e descrição, rótulo primeiro (WCAG 2.5.3)', () => {
    const texto = descreveComando(acha('encerrar'), 'ocioso');
    assert.equal(texto.startsWith('/encerrar: '), true);
    assert.match(texto, /salva memória/);
  });

  it('armado anuncia o que se perde — a frase que o botão não mostra', () => {
    assert.equal(descreveComando(acha('clear'), 'confirmando'), acha('clear').aviso);
  });

  it('fora do ocioso não promete o que a fase não está fazendo', () => {
    // "Enviando… apaga o contexto desta conversa" seria a promessa errada no
    // instante errado.
    assert.equal(descreveComando(acha('clear'), 'enviando'), 'Enviando…');
  });
});

describe('botão inerte', () => {
  it('sai de circulação enquanto envia e enquanto o compact corre', () => {
    assert.equal(comandoInerte('enviando'), true);
    assert.equal(comandoInerte('aguardando'), true);
  });

  it('volta a ser alvo no recibo — o segundo comando não espera o pisca', () => {
    assert.equal(comandoInerte('entregue'), false);
    assert.equal(comandoInerte('confirmando'), false);
    assert.equal(comandoInerte('ocioso'), false);
  });
});

describe('diagnóstico', () => {
  it('manda destravar quando o pane recusou — a saída certa está logo acima', () => {
    const impedimento = diagnosticaComando(new Error('agent_pane_unavailable'), acha('compact'));
    assert.match(impedimento.saida, /Destravar/);
  });

  it('nomeia o comando que falhou, não "a ação"', () => {
    assert.match(diagnosticaComando(new Error('500'), acha('clear')).resumo, /\/clear/);
  });

  it('detail desconhecido cai no caso geral, e ele continua acionável', () => {
    const impedimento = diagnosticaComando(new Error('coisa nova do back'), acha('encerrar'));
    assert.match(impedimento.resumo, /\/encerrar/);
    assert.match(impedimento.saida, /tente de novo/);
  });
});
