import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EscutaSequencia } from '../feed/reprodutor-unico.ts';
import { criaVozDeApoio } from './voz-de-apoio.ts';

const vez = () => new Promise<void>((r) => setImmediate(r));
type Rota = 'ok' | 'caiu' | 'lenta';
function tela({ rota = 'ok', depois = rota, ocupado = false, bloqueado = false, cede = true }: {
  rota?: Rota; depois?: Rota; ocupado?: boolean; bloqueado?: boolean; cede?: boolean;
} = {}) {
  const sinteses: string[] = [];
  const liberados: string[] = [];
  const pendentes: Array<() => void> = [];
  const sequencias: { escuta: EscutaSequencia; urls: string[]; parada: boolean }[] = [];
  let prazo = () => {};
  let fins = 0;
  let cancelados = 0;
  let cabecalhoAtual: string | null = 'Conferir a fila';
  const apoio = criaVozDeApoio({
    sintetiza: (texto) => {
      sinteses.push(texto);
      const agora = sinteses.length === 1 ? rota : depois;
      if (agora === 'caiu') return Promise.reject(new Error('HTTP 502'));
      if (agora === 'lenta') return new Promise((r) => pendentes.push(() => r([`blob:${texto}`])));
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
    cancelaTurno: () => { cancelados++; },
    liberaAudio: (url) => { liberados.push(url); },
    aoTerminar: () => { fins++; },
    espera: () => new Promise<void>((r) => { prazo = r; }),
  });
  return {
    apoio, sinteses, sequencias, liberados,
    bloqueia: () => { bloqueado = true; },
    mudaCabecalho: (texto: string | null) => { cabecalhoAtual = texto; },
    soltaRota: () => pendentes.splice(0).forEach((r) => r()),
    vencePrazo: () => prazo(),
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

test('captura bloqueia síntese; fila sem cessão impede tomar resposta', async () => {
  for (const opcoes of [{ bloqueado: true }, { ocupado: true }, { cede: false }]) {
    const t = tela(opcoes);
    t.apoio.cabecalho('Conferir a fila');
    await vez();
    assert.equal(t.sequencias.length, 0);
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

test('rota caída tenta de novo uma vez na mesma voz e toca na segunda', async () => {
  const t = tela({ rota: 'caiu', depois: 'ok' });
  t.apoio.cabecalho('Conferir a fila');
  await vez();
  assert.deepEqual(t.sinteses, ['Conferir a fila', 'Conferir a fila']);
  assert.deepEqual(t.sequencias.map((s) => s.urls), [['blob:Conferir a fila']]);
  t.sequencias[0].escuta.aoTerminar();
  assert.equal(t.fins(), 1);
  assert.equal(t.cancelados(), 0);
});

test('falha dupla fica calada: duas sínteses e nenhuma outra voz', async () => {
  for (const erro of [false, true]) {
    const t = tela({ rota: 'caiu' });
    if (erro) t.apoio.erro('O microfone desligou');
    else t.apoio.cabecalho('Conferir a fila');
    await vez();
    await vez();
    assert.equal(t.sinteses.length, 2);
    assert.equal(t.sequencias.length, 0);
    assert.equal(t.fins(), 0);
  }
});

test('áudio que não toca conta como falha e ganha uma retentativa', async () => {
  const t = tela();
  t.apoio.cabecalho('Conferir a fila');
  await vez();
  t.sequencias[0].escuta.aoFalhar();
  await vez();
  assert.equal(t.sinteses.length, 2);
  t.sequencias[1].escuta.aoFalhar();
  await vez();
  assert.equal(t.sinteses.length, 2);
});

test('erro que passa do prazo tenta de novo e libera o áudio atrasado sem reproduzir', async () => {
  const t = tela({ rota: 'lenta', depois: 'ok' });
  t.apoio.erro('O microfone desligou');
  t.vencePrazo();
  await vez();
  await vez();
  assert.equal(t.sinteses.length, 2);
  assert.deepEqual(t.sequencias.map((s) => s.urls), [['blob:O microfone desligou']]);
  t.soltaRota();
  await vez();
  assert.equal(t.sequencias.length, 1);
  assert.deepEqual(t.liberados, ['blob:O microfone desligou']);
  assert.equal(t.cancelados(), 1);
});

test('cala (toque, fim de turno) e desiste (mudo) cancelam a retentativa pendente', async () => {
  for (const corte of ['cala', 'desiste'] as const) {
    const t = tela({ rota: 'caiu', depois: 'lenta' });
    t.apoio.cabecalho('Conferir a fila');
    await vez();
    assert.equal(t.sinteses.length, 2);
    t.apoio[corte]();
    t.soltaRota();
    await vez();
    assert.equal(t.sequencias.length, 0);
    assert.deepEqual(t.liberados, ['blob:Conferir a fila']);
  }
});

test('desiste não corta o apoio que já está soando', async () => {
  const t = tela();
  t.apoio.cabecalho('Conferir a fila');
  await vez();
  t.apoio.desiste();
  assert.equal(t.sequencias[0].parada, false);
  t.sequencias[0].escuta.aoTerminar();
  assert.equal(t.fins(), 1);
});

test('gravação do Rica durante a falha impede a retentativa', async () => {
  const t = tela({ rota: 'lenta', depois: 'ok' });
  t.apoio.erro('O microfone desligou');
  t.bloqueia();
  t.vencePrazo();
  await vez();
  await vez();
  assert.equal(t.sinteses.length, 1);
  assert.equal(t.sequencias.length, 0);
});

test('troca de ferramenta durante síntese impede tocar o cabeçalho anterior', async () => {
  for (const texto of [null, 'Conferir a resposta']) {
    const t = tela({ rota: 'lenta' });
    t.apoio.cabecalho('Conferir a fila');
    t.mudaCabecalho(texto);
    t.soltaRota();
    await vez();
    assert.equal(t.sequencias.length, 0);
    assert.deepEqual(t.liberados, ['blob:Conferir a fila']);
  }
});

test('corte de apoio audível reinicia silêncio; síntese pendente não conta como fala', async () => {
  for (const rota of ['ok', 'caiu', 'lenta'] as const) {
    const t = tela({ rota });
    t.apoio.cabecalho('Conferir a fila');
    await vez();
    t.apoio.cala();
    assert.equal(t.fins(), rota === 'ok' ? 1 : 0);
    t.apoio.cala();
    assert.equal(t.fins(), rota === 'ok' ? 1 : 0);
  }
});

test('erro sai na voz do agente e cancela resposta pela própria fila', async () => {
  const t = tela();
  t.apoio.erro('O microfone desligou');
  await vez();
  assert.equal(t.cancelados(), 1);
  assert.deepEqual(t.sequencias[0].urls, ['blob:O microfone desligou']);
});

test('enfeite: a voz diz a frase enfeitada, mas confere o cabeçalho cru', async () => {
  const sinteses: string[] = [];
  const tocadas: string[] = [];
  const apoio = criaVozDeApoio({
    sintetiza: (texto) => { sinteses.push(texto); return Promise.resolve([`blob:${texto}`]); },
    iniciaSequencia: () => ({ enfileira: (url) => void tocadas.push(url), fecha() {}, pausa() {}, retoma() {}, para() {} }),
    ocupado: () => false,
    cabecalhoAtual: () => 'Tô lendo o código',
    enfeita: (texto) => `Rica… ${texto}`,
    cancelaTurno() {},
    liberaAudio() {},
  });
  apoio.cabecalho('Tô lendo o código');
  await vez();
  await vez();
  assert.deepEqual(sinteses, ['Rica… Tô lendo o código']);
  assert.deepEqual(tocadas, ['blob:Rica… Tô lendo o código']);
});

test('aoComecar vem antes do primeiro áudio; aoTerminar, quando cala', async () => {
  const ordem: string[] = [];
  let escuta: EscutaSequencia | null = null;
  const apoio = criaVozDeApoio({
    sintetiza: () => Promise.resolve(['blob:a']),
    iniciaSequencia: (e) => { escuta = e; return { enfileira: () => void ordem.push('toca'), fecha() {}, pausa() {}, retoma() {}, para() {} }; },
    ocupado: () => false,
    aoComecar: () => ordem.push('comeca'),
    aoTerminar: () => ordem.push('terminou'),
    cancelaTurno() {},
    liberaAudio() {},
  });
  apoio.cabecalho('Tô rodando os testes');
  await vez();
  await vez();
  (escuta as EscutaSequencia | null)?.aoTerminar();
  assert.deepEqual(ordem, ['comeca', 'toca', 'terminou']);
});

test('falha no meio da frase também avisa o fim (o microfone volta)', async () => {
  const ordem: string[] = [];
  let escuta: EscutaSequencia | null = null;
  const apoio = criaVozDeApoio({
    sintetiza: () => Promise.resolve(['blob:a']),
    iniciaSequencia: (e) => { escuta = e; return { enfileira() {}, fecha() {}, pausa() {}, retoma() {}, para() {} }; },
    ocupado: () => false,
    bloqueado: () => ordem.length > 1,
    aoComecar: () => ordem.push('comeca'),
    aoTerminar: () => ordem.push('terminou'),
    cancelaTurno() {},
    liberaAudio() {},
  });
  apoio.cabecalho('Tô rodando os testes');
  await vez();
  await vez();
  (escuta as EscutaSequencia | null)?.aoFalhar();
  assert.deepEqual(ordem, ['comeca', 'terminou']);
});
