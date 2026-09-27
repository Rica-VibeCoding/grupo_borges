import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  criaControladorDetector,
  type DetectorControlado,
} from './controlador-detector.ts';

function detector(overrides: Partial<DetectorControlado> = {}): DetectorControlado {
  return {
    start: async () => {},
    pause: async () => {},
    destroy: async () => {},
    ...overrides,
  };
}

describe('controlador do detector de fala', () => {
  it('recria o MicVAD depois que a primeira abertura do microfone falha', async () => {
    let destruicoes = 0;
    let criacoes = 0;
    let partidasDoNovo = 0;
    const primeiro = detector({
      start: async () => {
        throw new DOMException('negado', 'NotAllowedError');
      },
      destroy: async () => {
        destruicoes += 1;
      },
    });
    const substituto = detector({
      start: async () => {
        partidasDoNovo += 1;
      },
    });
    const controlador = criaControladorDetector(primeiro, async () => {
      criacoes += 1;
      return substituto;
    });

    await assert.rejects(controlador.liga(), { name: 'NotAllowedError' });
    await controlador.liga();

    assert.equal(destruicoes, 1);
    assert.equal(criacoes, 1);
    assert.equal(partidasDoNovo, 1);
  });

  it('recria mesmo quando o MicVAD quebrado também falha ao destruir', async () => {
    let partidasDoNovo = 0;
    const controlador = criaControladorDetector(detector({
      start: async () => {
        throw new DOMException('ocupado', 'NotReadableError');
      },
      destroy: async () => {
        throw new Error('instância incompleta');
      },
    }), async () => detector({
      start: async () => {
        partidasDoNovo += 1;
      },
    }));

    await assert.rejects(controlador.liga(), { name: 'NotReadableError' });
    await controlador.liga();

    assert.equal(partidasDoNovo, 1);
  });

  it('espera uma ligação em voo antes de pausar a captura criada', async () => {
    let concluiPartida!: () => void;
    let partidaConcluida = false;
    let pausouDepoisDaPartida = false;
    const partida = new Promise<void>((resolve) => {
      concluiPartida = () => {
        partidaConcluida = true;
        resolve();
      };
    });
    const controlador = criaControladorDetector(detector({
      start: async () => partida,
      pause: async () => {
        pausouDepoisDaPartida = partidaConcluida;
      },
    }), async () => detector());

    const ligando = controlador.liga();
    const desligando = controlador.desliga();
    concluiPartida();
    await Promise.all([ligando, desligando]);

    assert.equal(pausouDepoisDaPartida, true);
  });

  it('espera também uma retomada do stream antes de pausar', async () => {
    let concluiRetomada!: () => void;
    let partidas = 0;
    let retomando = false;
    let pausouDepoisDaRetomada = false;
    const retomada = new Promise<void>((resolve) => {
      concluiRetomada = resolve;
    });
    const controlador = criaControladorDetector(detector({
      start: async () => {
        partidas += 1;
        if (partidas === 1) return;
        retomando = true;
        await retomada;
        retomando = false;
      },
      pause: async () => {
        if (partidas === 2) pausouDepoisDaRetomada = !retomando;
      },
    }), async () => detector());

    await controlador.liga();
    await controlador.desliga();
    const ligando = controlador.liga();
    const desligando = controlador.desliga();
    concluiRetomada();
    await Promise.all([ligando, desligando]);

    assert.equal(pausouDepoisDaRetomada, true);
  });

  it('reabre: destrói o detector calado e liga um novo, que passa a ser o controlado', async () => {
    const eventos: string[] = [];
    const primeiro = detector({
      start: async () => { eventos.push('liga 1'); },
      destroy: async () => { eventos.push('destrói 1'); },
    });
    const segundo = detector({
      start: async () => { eventos.push('liga 2'); },
      pause: async () => { eventos.push('pausa 2'); },
    });
    const controlador = criaControladorDetector(primeiro, async () => {
      eventos.push('cria 2');
      return segundo;
    });

    await controlador.liga();
    await controlador.reabre();
    await controlador.desliga();

    assert.deepEqual(eventos, ['liga 1', 'destrói 1', 'cria 2', 'liga 2', 'pausa 2']);
  });

  it('desligar no meio da reabertura deixa o novo pronto e calado', async () => {
    let criaNovo!: () => void;
    const eventos: string[] = [];
    const novo = detector({
      start: async () => { eventos.push('liga novo'); },
      pause: async () => { eventos.push('pausa novo'); },
    });
    const controlador = criaControladorDetector(detector(), () => new Promise((resolve) => {
      criaNovo = () => resolve(novo);
    }));

    await controlador.liga();
    const reabrindo = controlador.reabre();
    const desligando = controlador.desliga();
    await new Promise((resolve) => setImmediate(resolve));
    criaNovo();
    await Promise.all([reabrindo, desligando]);
    assert.deepEqual(eventos, ['pausa novo'], 'sem microfone aberto depois de desligar');

    // A próxima ligação usa o detector novo, não o destruído.
    await controlador.liga();
    assert.deepEqual(eventos, ['pausa novo', 'liga novo']);
  });

  it('ligar logo depois de desligar, com a reabertura em voo, espera por ela', async () => {
    let criaNovo!: () => void;
    const eventos: string[] = [];
    const velho = detector({
      start: async () => { eventos.push('liga velho'); },
      destroy: async () => { eventos.push('destrói velho'); },
    });
    const novo = detector({ start: async () => { eventos.push('liga novo'); } });
    const controlador = criaControladorDetector(velho, () => new Promise((resolve) => {
      criaNovo = () => resolve(novo);
    }));

    await controlador.liga();
    const reabrindo = controlador.reabre();
    const desligando = controlador.desliga();
    const ligando = controlador.liga();
    await new Promise((resolve) => setImmediate(resolve));
    criaNovo();
    await Promise.all([reabrindo, desligando, ligando]);

    assert.deepEqual(eventos, ['liga velho', 'destrói velho', 'liga novo']);
  });
});
