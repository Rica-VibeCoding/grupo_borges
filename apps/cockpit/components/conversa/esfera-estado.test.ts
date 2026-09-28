import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FORMAS,
  REGULADOR_INICIAL,
  alvosDaEsfera,
  aproximaRitmo,
  aproximaLugar,
  coresDaEsfera,
  lugarAssentou,
  lugarNoPalco,
  regulaQuadro,
  ritmoDaEsfera,
} from './esfera-estado.ts';
import type { Cena } from './moldura-estado.ts';

const CENAS: Cena[] = ['parado', 'preparando', 'ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo', 'erro'];

describe('Esfera: o que cada momento desenha', () => {
  it('cada cena tem uma forma dominante, e parado fica em repouso', () => {
    const dominante = (cena: Cena) => {
      const pesos = alvosDaEsfera(cena);
      return FORMAS.filter((f) => pesos[f] === 1).join('+') || 'repouso';
    };
    assert.deepEqual(CENAS.map(dominante), [
      'repouso', 'enche', 'voce', 'calma', 'calma', 'ze', 'cristal', 'colapso',
    ]);
  });

  it('a cor segue de quem é a vez; na interrupção, o corpo é ele apagado e a borda é você', () => {
    assert.deepEqual(coresDaEsfera('ouvindo'), { corpo: 'voce', brilho: 1, borda: 'voce' });
    assert.equal(coresDaEsfera('falando').borda, 'ze');
    assert.equal(coresDaEsfera('esperandoZe').borda, 'pensa');
    assert.deepEqual(coresDaEsfera('interrompendo'), { corpo: 'ze', brilho: 0.55, borda: 'voce' });
    assert.equal(coresDaEsfera('erro').borda, 'erro');
    assert.equal(coresDaEsfera('preparando').borda, 'prepara');
  });

  it('interromper, errar e parar congelam o tempo da matéria', () => {
    for (const cena of ['interrompendo', 'erro', 'parado'] as const) assert.equal(ritmoDaEsfera(cena), 0);
    assert.ok(ritmoDaEsfera('transcrevendo') > ritmoDaEsfera('esperandoZe'));
  });
});

describe('Esfera: lugar no palco', () => {
  it('fica no centro do palco, com raio de 36% da altura', () => {
    const lugar = lugarNoPalco({ left: 0, top: 60, width: 393, height: 300 }, 393);
    assert.equal(lugar.x, 196.5);
    assert.equal(lugar.y, 210);
    assert.equal(lugar.raio, 108);
    assert.deepEqual([lugar.topo, lugar.base], [60, 360]);
  });

  it('não passa de 31% da largura da tela nem de 150 px, e nunca some', () => {
    assert.equal(lugarNoPalco({ left: 0, top: 0, width: 320, height: 360 }, 320).raio, 320 * 0.31);
    assert.equal(lugarNoPalco({ left: 0, top: 0, width: 900, height: 600 }, 1200).raio, 150);
    assert.equal(lugarNoPalco({ left: 0, top: 0, width: 393, height: 10 }, 393).raio, 24);
  });

  it('quando o palco encolhe, desliza até o lugar novo e assenta', () => {
    const antes = lugarNoPalco({ left: 0, top: 60, width: 393, height: 320 }, 393);
    const depois = lugarNoPalco({ left: 0, top: 60, width: 393, height: 200 }, 393);
    let lugar = aproximaLugar(antes, depois, 0.2);
    assert.ok(lugar.raio < antes.raio && lugar.raio > depois.raio);
    for (let i = 0; i < 80; i++) lugar = aproximaLugar(lugar, depois, 0.2);
    assert.ok(lugarAssentou(lugar, depois));
  });
});

describe('Esfera: teto de quadros', () => {
  it('a 60 quadros por segundo, desenha todos', () => {
    let r = REGULADOR_INICIAL;
    let desenhados = 0;
    for (let i = 1; i <= 120; i++) {
      r = regulaQuadro(r, i * 16.7, 16.7);
      if (r.desenha) desenhados++;
    }
    assert.equal(desenhados, 120);
    assert.equal(r.pesado, false);
  });

  it('um tranco curto não derruba o ritmo', () => {
    let r = REGULADOR_INICIAL;
    for (let i = 0; i < 3; i++) r = regulaQuadro(r, i * 50, 50);
    assert.equal(r.pesado, false);
  });

  it('quando pesa, cai para 30 e fica', () => {
    let r = REGULADOR_INICIAL;
    let agora = 0;
    for (let i = 0; i < 40; i++) r = regulaQuadro(r, (agora += 33), 33);
    assert.equal(r.pesado, true);
    // O aparelho voltou a 60, mas a Esfera desenha um quadro sim, outro não.
    let desenhados = 0;
    for (let i = 0; i < 60; i++) {
      r = regulaQuadro(r, (agora += 16.7), 16.7);
      if (r.desenha) desenhados++;
    }
    assert.equal(r.pesado, true);
    assert.ok(desenhados >= 29 && desenhados <= 31, String(desenhados));
  });
});

describe('o ritmo da esfera na troca de estado', () => {
  it('muda sem salto: um quadro anda pouco, 0,4 s chega quase todo, nunca passa do alvo', () => {
    const umQuadro = aproximaRitmo(1.8, 0.9, 1 / 60);
    assert.ok(umQuadro < 1.8 && umQuadro > 1.7, String(umQuadro));
    let r = 1.8;
    for (let i = 0; i < 24; i += 1) r = aproximaRitmo(r, 0.9, 1 / 60);
    assert.ok(r > 0.9 && r < 0.99, String(r));
  });

  it('movimento reduzido (dt infinito) salta direto', () => {
    assert.equal(aproximaRitmo(1.8, 0.9, Number.POSITIVE_INFINITY), 0.9);
  });
});
