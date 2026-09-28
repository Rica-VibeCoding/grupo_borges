import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { NOME_DO_VOO, voaParaBolha } from './voo-do-envio.ts';

type Transicao = { updateCallbackDone: Promise<void>; finished: Promise<void> };

const globais = globalThis as Record<string, unknown>;

/** Um `document` mínimo: o suficiente para o voo decolar e achar a bolha. */
function montaDocumento(opcoes: { reduzMovimento?: boolean; bolha?: { style: { viewTransitionName: string } } | null; falhaNoCallback?: boolean } = {}) {
  const raiz = { dataset: {} as Record<string, string> };
  const chamadas: string[] = [];
  const doc = {
    documentElement: raiz,
    querySelector: (seletor: string) => {
      chamadas.push(seletor);
      return opcoes.bolha ?? null;
    },
    startViewTransition: (atualiza: () => void): Transicao => {
      let feito: Promise<void>;
      try {
        if (opcoes.falhaNoCallback) throw new Error('callback');
        atualiza();
        feito = Promise.resolve();
      } catch (erro) {
        feito = Promise.reject(erro);
      }
      return { updateCallbackDone: feito, finished: feito };
    },
  };
  globais.document = doc;
  globais.window = { matchMedia: () => ({ matches: opcoes.reduzMovimento === true }) };
  globais.CSS = { escape: (s: string) => s };
  return { raiz, chamadas };
}

afterEach(() => {
  delete globais.document;
  delete globais.window;
  delete globais.CSS;
});

describe('voaParaBolha', () => {
  it('sem campo, roda a atualização direto e devolve o id', async () => {
    montaDocumento();
    let vezes = 0;
    const id = await voaParaBolha(null, () => {
      vezes += 1;
      return 'eco-1';
    });
    assert.equal(id, 'eco-1');
    assert.equal(vezes, 1);
  });

  it('com menos movimento pedido, não voa', async () => {
    const { chamadas } = montaDocumento({ reduzMovimento: true });
    const campo = { style: { viewTransitionName: '' } } as unknown as HTMLElement;
    const id = await voaParaBolha(campo, () => 'eco-2');
    assert.equal(id, 'eco-2');
    assert.equal(chamadas.length, 0);
    assert.equal(campo.style.viewTransitionName, '');
  });

  it('voando, passa o nome do campo para a bolha do eco registrado', async () => {
    const bolha = { style: { viewTransitionName: '' } };
    const { chamadas } = montaDocumento({ bolha });
    const campo = { style: { viewTransitionName: '' } } as unknown as HTMLElement;
    const id = await voaParaBolha(campo, () => {
      assert.equal(campo.style.viewTransitionName, '', 'o campo solta o nome antes da atualização');
      return 'eco-3';
    });
    assert.equal(id, 'eco-3');
    assert.deepEqual(chamadas, ['[data-eco="cc-otimista-eco-3"]']);
    await Promise.resolve();
    assert.equal(bolha.style.viewTransitionName, '', 'o nome sai quando o voo termina');
  });

  it('voo de anexo marca a raiz com o tipo, para o CSS escalar a foto', async () => {
    const bolha = { style: { viewTransitionName: '' } };
    const { raiz, chamadas } = montaDocumento({ bolha });
    const campo = { style: { viewTransitionName: '' } } as unknown as HTMLElement;
    let tipoDuranteOVoo: string | undefined;
    const id = await voaParaBolha(
      campo,
      () => {
        tipoDuranteOVoo = raiz.dataset.voo;
        return 'anexo-1';
      },
      'anexo',
    );
    assert.equal(id, 'anexo-1');
    assert.equal(tipoDuranteOVoo, 'anexo');
    assert.deepEqual(chamadas, ['[data-eco="cc-otimista-anexo-1"]']);
  });

  it('se o voo falhar antes da atualização, o envio acontece mesmo assim', async () => {
    montaDocumento({ falhaNoCallback: true });
    const campo = { style: { viewTransitionName: '' } } as unknown as HTMLElement;
    let vezes = 0;
    const id = await voaParaBolha(campo, () => {
      vezes += 1;
      return 'eco-4';
    });
    assert.equal(id, 'eco-4');
    assert.equal(vezes, 1);
    assert.notEqual(campo.style.viewTransitionName, NOME_DO_VOO);
  });
});
