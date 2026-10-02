import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  QUADRO_MS,
  criaSeguidor,
  modoDeSeguir,
  passoDaMola,
  type ElementoRolavel,
  type Relogio,
} from './seguir-o-fim.ts';

/** Roda a mola até parar, devolvendo as posições de cada quadro. */
function corre(pos: number, alvo: number, dtMs = QUADRO_MS, limite = 600) {
  let estado = { pos, vel: 0 };
  const posicoes: number[] = [];
  for (let i = 0; i < limite; i++) {
    const passo = passoDaMola(estado, alvo, dtMs);
    posicoes.push(passo.pos);
    estado = passo;
    if (passo.parou) return { posicoes, parou: true };
  }
  return { posicoes, parou: false };
}

describe('seguir o fim — a mola', () => {
  it('chega ao alvo e para, sem passar dele', () => {
    const { posicoes, parou } = corre(0, 120);
    assert.equal(parou, true);
    assert.equal(posicoes.at(-1), 120);
    assert.ok(posicoes.every((p) => p <= 120));
  });

  it('sobe sempre para a frente — nunca volta no meio da subida', () => {
    const { posicoes } = corre(0, 300);
    for (let i = 1; i < posicoes.length; i++) assert.ok(posicoes[i]! >= posicoes[i - 1]!);
  });

  it('assenta em torno de 300 ms, o --ck-dur-calm', () => {
    const { posicoes } = corre(0, 200);
    const ms = posicoes.length * QUADRO_MS;
    assert.ok(ms > 200 && ms < 700, `assentou em ${ms} ms`);
    // A maior parte do caminho vai nos primeiros 150 ms: é o que o olho lê.
    const em150 = posicoes[Math.round(150 / QUADRO_MS) - 1]!;
    assert.ok(em150 > 0.75 * 200, `em 150 ms estava em ${em150}`);
  });

  it('quadro longo (aba em segundo plano) não passa do alvo nem oscila', () => {
    const passo = passoDaMola({ pos: 0, vel: 0 }, 400, 5000);
    assert.equal(passo.pos, 400);
    assert.equal(passo.parou, true);
  });

  it('dt negativo não anda para trás', () => {
    const passo = passoDaMola({ pos: 10, vel: 0 }, 100, -16);
    assert.equal(passo.pos, 10);
  });

  it('alvo que cresce no meio guarda a velocidade — a subida estica, não recomeça', () => {
    let estado = { pos: 0, vel: 0 };
    for (let i = 0; i < 5; i++) estado = passoDaMola(estado, 100, QUADRO_MS);
    const velAntes = estado.vel;
    const depois = passoDaMola(estado, 160, QUADRO_MS);
    // Contínua: a velocidade não cai a zero nem dá um pulo descontrolado.
    assert.ok(depois.vel > 0.5 * velAntes, `${depois.vel} contra ${velAntes}`);
    assert.ok(depois.pos > estado.pos);
  });

  it('alvo que encolhe abaixo da posição encosta no fim e zera', () => {
    const passo = passoDaMola({ pos: 300, vel: 500 }, 250, QUADRO_MS);
    assert.equal(passo.pos, 250);
  });
});

describe('seguir o fim — mola ou salto', () => {
  const base = { clientHeight: 800, reduzido: false, assentando: false };

  it('sem distância não faz nada', () => {
    assert.equal(modoDeSeguir({ ...base, distancia: 0 }), 'nada');
  });

  it('item novo ou texto crescendo: mola', () => {
    assert.equal(modoDeSeguir({ ...base, distancia: 48 }), 'mola');
  });

  it('movimento reduzido pedido pelo sistema: salto', () => {
    assert.equal(modoDeSeguir({ ...base, distancia: 48, reduzido: true }), 'salto');
  });

  it('carga ainda assentando: salto', () => {
    assert.equal(modoDeSeguir({ ...base, distancia: 48, assentando: true }), 'salto');
  });

  it('mais de uma tela de distância: salto', () => {
    assert.equal(modoDeSeguir({ ...base, distancia: 801 }), 'salto');
  });
});

/** Relógio de mentira: os quadros só andam quando o teste manda. */
function relogioManual() {
  let fila = new Map<number, (agora: number) => void>();
  let id = 0;
  let agora = 0;
  const relogio: Relogio = {
    agenda(quadro) {
      fila.set(++id, quadro);
      return id;
    },
    cancela(qual) {
      fila.delete(qual);
    },
  };
  const quadro = () => {
    agora += QUADRO_MS;
    const atual = fila;
    fila = new Map();
    for (const f of atual.values()) f(agora);
  };
  return { relogio, quadro, pendentes: () => fila.size };
}

describe('seguir o fim — o seguidor', () => {
  it('sem distância a vencer não agenda quadro nenhum depois de chegar', () => {
    const el: ElementoRolavel = { scrollTop: 0, scrollHeight: 900, clientHeight: 800 };
    const { relogio, quadro, pendentes } = relogioManual();
    const s = criaSeguidor(() => el, relogio);
    s.segue();
    for (let i = 0; i < 120 && pendentes() > 0; i++) quadro();
    assert.equal(el.scrollTop, 100);
    assert.equal(pendentes(), 0);
    assert.equal(s.ativo(), false);
  });

  it('o alvo é lido vivo: conteúdo que cresce no meio estica a mesma subida', () => {
    const el: ElementoRolavel = { scrollTop: 0, scrollHeight: 900, clientHeight: 800 };
    const { relogio, quadro, pendentes } = relogioManual();
    const s = criaSeguidor(() => el, relogio);
    s.segue();
    quadro();
    quadro();
    el.scrollHeight = 1000;
    s.segue(); // flush novo durante a subida: não reinicia
    assert.equal(pendentes(), 1);
    for (let i = 0; i < 120 && pendentes() > 0; i++) quadro();
    assert.equal(el.scrollTop, 200);
  });

  it('andando, toda rolagem é eco da mola — não descola', () => {
    const el: ElementoRolavel = { scrollTop: 0, scrollHeight: 900, clientHeight: 800 };
    const { relogio, quadro } = relogioManual();
    const s = criaSeguidor(() => el, relogio);
    s.segue();
    quadro();
    assert.equal(s.eco(el.scrollTop), true);
  });

  it('parada pela mão do Rica, só o eco da última escrita é dela, e uma vez', () => {
    const el: ElementoRolavel = { scrollTop: 0, scrollHeight: 900, clientHeight: 800 };
    const { relogio, quadro } = relogioManual();
    const s = criaSeguidor(() => el, relogio);
    s.segue();
    quadro();
    quadro();
    s.para();
    const meio = el.scrollTop;
    assert.ok(meio > 0 && meio < 100);
    assert.equal(s.eco(meio), true);
    assert.equal(s.eco(meio), false);
  });

  it('rolagem do Rica, parada, não é eco', () => {
    const el: ElementoRolavel = { scrollTop: 0, scrollHeight: 900, clientHeight: 800 };
    const { relogio, quadro, pendentes } = relogioManual();
    const s = criaSeguidor(() => el, relogio);
    s.segue();
    for (let i = 0; i < 120 && pendentes() > 0; i++) quadro();
    assert.equal(s.eco(40), false);
  });

  it('compensação de fora no meio (virtualizador) vira o novo ponto de partida', () => {
    const el: ElementoRolavel = { scrollTop: 0, scrollHeight: 900, clientHeight: 800 };
    const { relogio, quadro, pendentes } = relogioManual();
    const s = criaSeguidor(() => el, relogio);
    s.segue();
    quadro();
    const antes = el.scrollTop;
    // Item acima remedido: o virtualizador soma 50 no scrollTop e o fim desce 50.
    el.scrollTop = antes + 50;
    el.scrollHeight = 950;
    quadro();
    assert.ok(el.scrollTop >= antes + 50, `${el.scrollTop} recuou para trás de ${antes + 50}`);
    for (let i = 0; i < 120 && pendentes() > 0; i++) quadro();
    assert.equal(el.scrollTop, 150);
  });
});
