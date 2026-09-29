import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EscutaSequencia } from '../feed/reprodutor-unico.ts';
import { criaVozDeApoio } from './voz-de-apoio.ts';

const vez = () => new Promise<void>((r) => setImmediate(r));
function tela({ rota = 'ok', ocupado = false, bloqueado = false, cede = true }: {
  rota?: 'ok' | 'caiu' | 'lenta'; ocupado?: boolean; bloqueado?: boolean; cede?: boolean;
} = {}) {
  const sinteses: string[] = [];
  const reservas: string[] = [];
  const liberados: string[] = [];
  const pendentes: Array<() => void> = [];
  const sequencias: { escuta: EscutaSequencia; urls: string[]; parada: boolean }[] = [];
  let prazo = () => {};
  let fimReserva = () => {};
  let fins = 0;
  let cancelados = 0;
  let cabecalhoAtual: string | null = 'Conferir a fila';
  const apoio = criaVozDeApoio({
    sintetiza: (texto) => {
      sinteses.push(texto);
      if (rota === 'caiu') return Promise.reject(new Error('HTTP 502'));
      if (rota === 'lenta') return new Promise((r) => pendentes.push(() => r([`blob:${texto}`])));
      return Promise.resolve([`blob:${texto}`]);
    },
    iniciaSequencia: (escuta) => {
      const s = { escuta, urls: [] as string[], parada: false };
      sequencias.push(s);
      return { enfileira: (url) => void s.urls.push(url), fecha() {}, pausa() {}, retoma() {}, para: () => { s.parada = true; } };
    },
    ocupado: () => ocupado,
    bloqueado: () => bloqueado,
    cabecalhoAtual: () => cabecalhoAtual,
    preparaApoio: () => cede,
    reserva: (texto, fim) => { reservas.push(texto); fimReserva = fim ?? (() => {}); },
    calaReserva() {},
    cancelaTurno: () => { cancelados++; },
    liberaAudio: (url) => { liberados.push(url); },
    aoTerminar: () => { fins++; },
    espera: () => new Promise<void>((r) => { prazo = r; }),
  });
  return {
    apoio, sinteses, reservas, sequencias, liberados,
    bloqueia: () => { bloqueado = true; },
    mudaCabecalho: (texto: string | null) => { cabecalhoAtual = texto; },
    soltaRota: () => pendentes.splice(0).forEach((r) => r()),
    vencePrazo: () => prazo(), terminaReserva: () => fimReserva(),
    fins: () => fins, cancelados: () => cancelados,
  };
}

test('cabeçalho pode repetir e sempre sintetiza sem pré-síntese/cache', async () => {
  const t = tela();
  assert.deepEqual(t.sinteses, []);
  for (let i = 0; i < 2; i++) {
    t.apoio.cabecalho('Conferir a fila');
    await vez();
    assert.deepEqual(t.sequencias[i].urls, ['blob:Conferir a fila']);
    t.sequencias[i].escuta.aoTerminar();
  }
  assert.deepEqual(t.sinteses, ['Conferir a fila', 'Conferir a fila']);
  assert.deepEqual(t.liberados, ['blob:Conferir a fila', 'blob:Conferir a fila']);
  assert.equal(t.fins(), 2);
  assert.equal(t.cancelados(), 0);
});

test('captura bloqueia síntese e reserva; fila sem cessão impede tomar resposta', async () => {
  for (const opcoes of [{ bloqueado: true }, { ocupado: true }, { cede: false }]) {
    const t = tela(opcoes);
    t.apoio.cabecalho('Conferir a fila');
    await vez();
    assert.equal(t.sequencias.length, 0);
    assert.deepEqual(t.reservas, []);
  }
});

test('captura iniciada durante síntese é revalidada e URLs são liberadas', async () => {
  const t = tela({ rota: 'lenta' });
  t.apoio.cabecalho('Conferir a fila');
  t.bloqueia();
  t.soltaRota();
  await vez();
  assert.equal(t.sequencias.length, 0);
  assert.deepEqual(t.liberados, ['blob:Conferir a fila']);
});

test('fim do turno ou resposta nova cancela síntese pendente e áudio já tocando', async () => {
  for (const rota of ['ok', 'lenta'] as const) {
    const t = tela({ rota });
    t.apoio.cabecalho('Conferir a fila');
    await vez();
    t.apoio.cala();
    t.soltaRota();
    await vez();
    assert.ok(t.sequencias.every((s) => s.parada));
    assert.deepEqual(t.liberados, ['blob:Conferir a fila']);
  }
});

test('rota caída usa reserva e informa fim audível, sem terminar turno', async () => {
  const t = tela({ rota: 'caiu' });
  t.apoio.cabecalho('Conferir a fila');
  await vez();
  assert.deepEqual(t.reservas, ['Conferir a fila']);
  t.terminaReserva();
  assert.equal(t.fins(), 1);
  assert.equal(t.cancelados(), 0);
});

test('erro mantém reserva por prazo e libera áudio atrasado sem reproduzir', async () => {
  const t = tela({ rota: 'lenta' });
  t.apoio.erro('O microfone desligou');
  t.vencePrazo();
  await vez();
  assert.deepEqual(t.reservas, ['O microfone desligou']);
  t.soltaRota();
  await vez();
  assert.equal(t.sequencias.length, 0);
  assert.deepEqual(t.liberados, ['blob:O microfone desligou']);
  assert.equal(t.cancelados(), 1);
});

test('troca de ferramenta durante síntese impede tocar o cabeçalho anterior', async () => {
  for (const texto of [null, 'Conferir a resposta']) {
    const t = tela({ rota: 'lenta' });
    t.apoio.cabecalho('Conferir a fila');
    t.mudaCabecalho(texto);
    t.soltaRota();
    await vez();
    assert.equal(t.sequencias.length, 0);
    assert.deepEqual(t.reservas, []);
    assert.deepEqual(t.liberados, ['blob:Conferir a fila']);
  }
});

test('corte de apoio audível reinicia silêncio; síntese pendente não conta como fala', async () => {
  for (const rota of ['ok', 'caiu', 'lenta'] as const) {
    const t = tela({ rota });
    t.apoio.cabecalho('Conferir a fila');
    await vez();
    t.apoio.cala();
    assert.equal(t.fins(), rota === 'lenta' ? 0 : 1);
    t.apoio.cala();
    t.terminaReserva();
    assert.equal(t.fins(), rota === 'lenta' ? 0 : 1);
  }
});

test('erro sai na voz do agente e cancela resposta pela própria fila', async () => {
  const t = tela();
  t.apoio.erro('O microfone desligou');
  await vez();
  assert.equal(t.cancelados(), 1);
  assert.deepEqual(t.sequencias[0].urls, ['blob:O microfone desligou']);
  assert.deepEqual(t.reservas, []);
});
