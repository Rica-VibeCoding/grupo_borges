import assert from 'node:assert/strict';
import { it } from 'node:test';

import { ESPERAS_DO_WAV_MS, transcreveFala } from './transcricao-da-fala.ts';

/*
 * O WAV que cai na rede (28/09, iPhone): o `fetch` rejeita sem status HTTP — "Load failed" no
 * WebKit — e o pedido nunca chega à API. Uma queda dessas não pode custar a fala: o WAV sobe de
 * novo, e só a resposta do servidor (status HTTP) é definitiva.
 */

const escoa = () => new Promise((resolve) => setImmediate(resolve));
const deRede = () => new TypeError('Load failed');
const doServidor = () => new Error('postAgentTranscription 502: {"detail":"stt_failed"}');

/** Cada subida do WAV devolve o próximo resultado da fila; o relógio é do teste. */
function simula(resultados: Array<string | Error>, { semCanal = true, vivo = (): boolean => true } = {}) {
  const log = { subidas: 0, textos: [] as string[], falhas: 0, esperas: [] as number[] };
  const relogios: Array<{ acao: () => void; ms: number }> = [];
  const vencedor = transcreveFala({
    aoVivo: semCanal ? null : Promise.resolve(null),
    paciencia: 1000,
    agenda: (acao, ms) => {
      log.esperas.push(ms);
      relogios.push({ acao, ms });
    },
    arquivo: () => {
      const resultado = resultados[log.subidas++];
      return resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve(resultado);
    },
    vivo,
    transcreveu: (texto) => log.textos.push(texto),
    falhou: () => {
      log.falhas += 1;
    },
  });
  /** Dispara o relógio mais curto que ainda não venceu. */
  const venceUm = async () => {
    await escoa();
    const menor = relogios.reduce((m, r, i) => (m === -1 || r.ms < relogios[m].ms ? i : m), -1);
    if (menor !== -1) relogios.splice(menor, 1)[0].acao();
    await escoa();
  };
  return { log, vencedor, venceUm };
}

it('WAV que cai na rede uma vez: sobe de novo e a fala chega', async () => {
  const s = simula([deRede(), 'Oi, Canário.']);
  await s.venceUm();
  assert.equal(await s.vencedor, 'wav');
  assert.equal(s.log.subidas, 2);
  assert.deepEqual(s.log.textos, ['Oi, Canário.']);
  assert.equal(s.log.falhas, 0);
  assert.equal(s.log.esperas[0], ESPERAS_DO_WAV_MS[0]);
});

it('a rede cai em todas as tentativas: aí sim falhou, depois das esperas', async () => {
  const s = simula([deRede(), deRede(), deRede(), 'nunca']);
  for (let i = 0; i < ESPERAS_DO_WAV_MS.length; i++) await s.venceUm();
  assert.equal(await s.vencedor, null);
  assert.equal(s.log.subidas, ESPERAS_DO_WAV_MS.length + 1);
  assert.equal(s.log.falhas, 1);
  assert.deepEqual(s.log.esperas, [...ESPERAS_DO_WAV_MS]);
});

it('o servidor respondeu com erro: não repete (é resposta, não queda)', async () => {
  const s = simula([doServidor(), 'nunca']);
  assert.equal(await s.vencedor, null);
  assert.equal(s.log.subidas, 1);
  assert.equal(s.log.falhas, 1);
  assert.deepEqual(s.log.esperas, []);
});

it('parou durante a espera da nova subida: não sobe de novo nem avisa', async () => {
  let vivo = true;
  const s = simula([deRede(), 'tarde demais'], { vivo: () => vivo });
  await escoa();
  vivo = false;
  await s.venceUm();
  assert.equal(await s.vencedor, null);
  assert.equal(s.log.subidas, 1);
  assert.deepEqual(s.log.textos, []);
  assert.equal(s.log.falhas, 0);
});

it('com o canal em jogo, a queda de rede do WAV também repete antes do último recurso', async () => {
  const s = simula([deRede(), 'Pelo WAV, na segunda.'], { semCanal: false });
  await escoa();
  // O canal acabou sem texto: o WAV sobe na hora, cai, e sobe de novo depois da espera.
  await s.venceUm();
  await s.venceUm();
  assert.equal(await s.vencedor, 'wav');
  assert.deepEqual(s.log.textos, ['Pelo WAV, na segunda.']);
  assert.equal(s.log.falhas, 0);
});
