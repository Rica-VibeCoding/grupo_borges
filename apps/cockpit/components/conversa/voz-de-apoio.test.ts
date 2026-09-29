import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EscutaSequencia } from '../feed/reprodutor-unico.ts';

import { criaVozDeApoio, FRASES_DE_DEMORA, FRASES_DE_PONTE, sorteia } from './voz-de-apoio.ts';

const vez = () => new Promise<void>((r) => setImmediate(r));

type SequenciaFalsa = { escuta: EscutaSequencia; urls: string[]; fechada: boolean; parada: boolean };

// As portas da tela, falsas. A fila do turno (a da resposta) não é porta: a voz de apoio não a enxerga,
// e é o fim dela que vira `vozTerminou` — o que a ponte não pode disparar.
function tela({ rota = 'ok', ocupado = false }: { rota?: 'ok' | 'caiu' | 'lenta'; ocupado?: boolean } = {}) {
  const sinteses: string[] = [];
  const reservas: string[] = [];
  const sequencias: SequenciaFalsa[] = [];
  const pendentes: Array<() => void> = [];
  let prazo: () => void = () => {};
  let turnosCancelados = 0;
  const apoio = criaVozDeApoio({
    sintetiza: (texto) => {
      sinteses.push(texto);
      if (rota === 'caiu') return Promise.reject(new Error('HTTP 502'));
      if (rota === 'lenta') return new Promise((r) => pendentes.push(() => r([`blob:${texto}`])));
      return Promise.resolve([`blob:${texto}`]);
    },
    iniciaSequencia: (escuta) => {
      const s: SequenciaFalsa = { escuta, urls: [], fechada: false, parada: false };
      sequencias.push(s);
      return {
        enfileira: (url) => void s.urls.push(url),
        fecha: () => void (s.fechada = true),
        pausa: () => {},
        retoma: () => {},
        para: () => void (s.parada = true),
      };
    },
    ocupado: () => ocupado,
    reserva: (texto) => void reservas.push(texto),
    calaReserva: () => {},
    cancelaTurno: () => void (turnosCancelados += 1),
    cache: new Map(),
    espera: () => new Promise<void>((r) => (prazo = r)),
  });
  return {
    apoio,
    sinteses,
    reservas,
    sequencias,
    soltaRota: () => pendentes.splice(0).forEach((r) => r()),
    venceOPrazo: () => prazo(),
    turnosCancelados: () => turnosCancelados,
  };
}

describe('frases de apoio na voz do agente', () => {
  it('o sorteio nunca repete a frase anterior, e alcança todas as outras', () => {
    for (let anterior = 0; anterior < 5; anterior += 1) {
      const vistas = new Set<number>();
      for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
        const i = sorteia(5, anterior, () => r);
        assert.notEqual(i, anterior);
        assert.ok(i >= 0 && i < 5);
        vistas.add(i);
      }
      assert.equal(vistas.size, 4);
    }
  });

  it('cinco frases de ponte e cinco de demora, sem reticências nem interrogação', () => {
    assert.equal(new Set(FRASES_DE_PONTE).size, 5);
    assert.equal(new Set(FRASES_DE_DEMORA).size, 5);
    for (const frase of [...FRASES_DE_PONTE, ...FRASES_DE_DEMORA]) assert.doesNotMatch(frase, /\.\.\.|…|\?|!|;/);
  });

  it('falarPonte fala pela rota do agente, fora da fila do turno: nem speechSynthesis, nem vozTerminou', async () => {
    const t = tela();
    t.apoio.ponte();
    await vez();
    assert.deepEqual(t.reservas, []);
    assert.ok((FRASES_DE_PONTE as readonly string[]).includes(t.sinteses[0]));
    assert.equal(t.sequencias.length, 1);
    assert.deepEqual(t.sequencias[0].urls, [`blob:${t.sinteses[0]}`]);
    assert.equal(t.sequencias[0].fechada, true);
    // O fim da ponte é só dela: não cancela nem fecha o turno.
    t.sequencias[0].escuta.aoTerminar();
    assert.equal(t.turnosCancelados(), 0);
  });

  it('duas pontes seguidas não repetem a frase', async () => {
    const t = tela();
    t.apoio.ponte();
    await vez();
    t.apoio.ponte();
    await vez();
    const [a, b] = t.sequencias.map((s) => s.urls[0]);
    assert.notEqual(a, b);
  });

  it('ao abrir a tela, pré-sintetiza a próxima ponte e a próxima demora primeiro; na hora, não pede de novo', async () => {
    const t = tela();
    t.apoio.prepara();
    for (let i = 0; i < 12; i += 1) await vez();
    assert.equal(t.sinteses.length, 10);
    assert.ok((FRASES_DE_PONTE as readonly string[]).includes(t.sinteses[0]));
    assert.ok((FRASES_DE_DEMORA as readonly string[]).includes(t.sinteses[1]));
    t.apoio.ponte();
    await vez();
    t.apoio.demora();
    await vez();
    assert.equal(t.sinteses.length, 10);
    assert.equal(t.sequencias.length, 2);
    assert.equal(t.sequencias[0].parada, true); // a demora corta a ponte que sobrou
  });

  it('a resposta chega com a ponte ainda na síntese: a ponte não toca', async () => {
    const t = tela({ rota: 'lenta' });
    t.apoio.ponte();
    t.apoio.cala();
    t.soltaRota();
    await vez();
    assert.equal(t.sequencias.length, 0);
  });

  it('a resposta chega com a ponte tocando: a ponte corta', async () => {
    const t = tela();
    t.apoio.ponte();
    await vez();
    t.apoio.cala();
    assert.equal(t.sequencias[0].parada, true);
  });

  it('com a resposta já tocando no alto-falante, a ponte não corta a resposta', async () => {
    const t = tela({ ocupado: true });
    t.apoio.demora();
    await vez();
    assert.equal(t.sequencias.length, 0);
    assert.deepEqual(t.reservas, []);
  });

  it('a rota caiu: a ponte e o erro saem pela voz do navegador, de reserva', async () => {
    const t = tela({ rota: 'caiu' });
    t.apoio.ponte();
    await vez();
    t.apoio.erro('Não consegui transcrever');
    await vez();
    assert.equal(t.reservas.length, 2);
    assert.equal(t.reservas[1], 'Não consegui transcrever');
    assert.equal(t.sequencias.length, 0);
  });

  it('o erro com a rota lenta não fica mudo: passou do prazo, fala a reserva e o áudio atrasado não toca', async () => {
    const t = tela({ rota: 'lenta' });
    t.apoio.erro('O microfone desligou');
    t.venceOPrazo();
    await vez();
    assert.deepEqual(t.reservas, ['O microfone desligou']);
    t.soltaRota();
    await vez();
    assert.equal(t.sequencias.length, 0);
  });

  it('o erro sai na voz do agente e corta a resposta em curso, pela fila dela', async () => {
    const t = tela();
    t.apoio.erro('O microfone desligou');
    await vez();
    assert.equal(t.turnosCancelados(), 1);
    assert.deepEqual(t.sequencias[0]?.urls, ['blob:O microfone desligou']);
    assert.deepEqual(t.reservas, []);
  });
});
