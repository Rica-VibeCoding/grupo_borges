import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HOLD_CONCLUSAO_MS,
  createControleCompact,
  type ArmazenamentoCompact,
} from './compact.ts';
import {
  ESCAPE_COMPACT_MS,
  ETA_COMPACT_PADRAO_MS,
} from '@grupo_borges/cockpit-core/compact-eta';

// Relógio, timers e storage falsos — o mesmo padrão do usa-envio/stream-coalescer:
// a máquina nunca toca Date.now nem setTimeout de verdade no teste.
function relogioFalso(inicial = 1_000_000) {
  let atual = inicial;
  return {
    agora: () => atual,
    avancar(ms: number) {
      atual += ms;
    },
  };
}

type TimerFalso = { callback: () => void; atrasoMs: number; cancelado: boolean };

function agendadorFalso() {
  const timers: TimerFalso[] = [];
  let proximoId = 0;
  return {
    timers,
    agendar(callback: () => void, atrasoMs: number) {
      const timer = { callback, atrasoMs, cancelado: false };
      timers.push(timer);
      return ++proximoId as unknown as ReturnType<typeof setTimeout>;
    },
    cancelar(id: ReturnType<typeof setTimeout>) {
      const idx = (id as unknown as number) - 1;
      if (timers[idx]) timers[idx].cancelado = true;
    },
    /** Dispara o timer mais recente não cancelado, se existir. */
    dispararUltimo() {
      const timer = [...timers].reverse().find((t) => !t.cancelado);
      assert.ok(timer, 'nenhum timer armado para disparar');
      timer.cancelado = true;
      timer.callback();
    },
  };
}

function storageFalso(): ArmazenamentoCompact & { mapa: Map<string, string> } {
  const mapa = new Map<string, string>();
  return {
    mapa,
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
  };
}

test('iniciar — entra em compactando com o ETA padrão e persiste o início', () => {
  const relogio = relogioFalso();
  const agendador = agendadorFalso();
  const storage = storageFalso();
  const c = createControleCompact('hiro', {
    agora: relogio.agora,
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    storage,
  });

  c.iniciar();
  const estado = c.getEstado();
  assert.equal(estado.fase, 'compactando');
  assert.equal(estado.desdeMs, 1_000_000);
  assert.equal(estado.etaMs, ETA_COMPACT_PADRAO_MS);
  assert.match(storage.mapa.get('cockpit:compact:v1:hiro') ?? '', /"inicio":1000000/);
  c.dispose();
});

test('concluir — mede do envio ao timestamp do resumo, segura 400ms e volta ao ocioso', () => {
  const relogio = relogioFalso();
  const agendador = agendadorFalso();
  const storage = storageFalso();
  const c = createControleCompact('hiro', {
    agora: relogio.agora,
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    storage,
  });

  c.iniciar();
  // O resumo nasceu 2min12s depois do envio (timestamp da MENSAGEM, não da detecção).
  c.concluir('uuid-resumo', 1_000_000 + 132_000);

  let estado = c.getEstado();
  assert.equal(estado.fase, 'concluindo');
  assert.equal(estado.duracaoMs, 132_000);
  assert.deepEqual(estado.ultimoConcluido, { uuid: 'uuid-resumo', duracaoMs: 132_000 });

  // A duração real entrou no histórico e o início foi limpo.
  const gravado = JSON.parse(storage.mapa.get('cockpit:compact:v1:hiro') ?? '{}') as {
    duracoes: number[];
    inicio: number | null;
  };
  assert.deepEqual(gravado.duracoes, [132_000]);
  assert.equal(gravado.inicio, null);

  // Hold de 400ms: o timer mais recente é o do hold (o escape foi cancelado).
  const hold = agendador.timers.at(-1);
  assert.equal(hold?.atrasoMs, HOLD_CONCLUSAO_MS);
  agendador.dispararUltimo();

  estado = c.getEstado();
  assert.equal(estado.fase, 'ocioso');
  assert.equal(estado.desdeMs, null);
  // ultimoConcluido SOBREVIVE à volta pro ocioso — o cartão lê a duração dele.
  assert.deepEqual(estado.ultimoConcluido, { uuid: 'uuid-resumo', duracaoMs: 132_000 });
  c.dispose();
});

test('ETA da rodada seguinte sai da mediana das últimas 5 durações reais', () => {
  const relogio = relogioFalso();
  const agendador = agendadorFalso();
  const storage = storageFalso();
  const c = createControleCompact('hiro', {
    agora: relogio.agora,
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    storage,
  });

  const duracoes = [93_000, 108_000, 136_000, 150_000, 163_000];
  for (const d of duracoes) {
    c.iniciar();
    c.concluir(`uuid-${d}`, relogio.agora() + d);
    agendador.dispararUltimo(); // hold → ocioso
    assert.equal(c.getEstado().fase, 'ocioso');
  }

  c.iniciar();
  assert.equal(c.getEstado().etaMs, 136_000); // mediana das 5
  c.dispose();
});

test('escape — 6min sem resumo vira sem-retorno, e um resumo tardio ainda conclui', () => {
  const relogio = relogioFalso();
  const agendador = agendadorFalso();
  const c = createControleCompact('hiro', {
    agora: relogio.agora,
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    storage: null,
  });

  c.iniciar();
  const escape = agendador.timers.at(-1);
  assert.equal(escape?.atrasoMs, ESCAPE_COMPACT_MS);
  agendador.dispararUltimo();

  assert.equal(c.getEstado().fase, 'sem-retorno');

  // O resumo chegou DEPOIS do escape (sinal atrasado, não perdido): acolhe.
  c.concluir('uuid-tardio', 1_000_000 + 400_000);
  const estado = c.getEstado();
  assert.equal(estado.fase, 'concluindo');
  assert.equal(estado.duracaoMs, 400_000);
  c.dispose();
});

test('cancelar — volta ao ocioso, limpa o início e não registra duração', () => {
  const relogio = relogioFalso();
  const agendador = agendadorFalso();
  const storage = storageFalso();
  const c = createControleCompact('hiro', {
    agora: relogio.agora,
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    storage,
  });

  c.iniciar();
  c.cancelar();
  assert.equal(c.getEstado().fase, 'ocioso');
  const gravado = JSON.parse(storage.mapa.get('cockpit:compact:v1:hiro') ?? '{}') as {
    duracoes?: number[];
    inicio: number | null;
  };
  assert.equal(gravado.inicio, null);
  assert.deepEqual(gravado.duracoes ?? [], []);
  c.dispose();
});

test('concluir fora da espera é ignorado — resumo antigo do replay não dispara nada', () => {
  const c = createControleCompact('hiro', { storage: null });
  c.concluir('uuid-antigo');
  assert.equal(c.getEstado().fase, 'ocioso');
  assert.equal(c.getEstado().ultimoConcluido, null);
  c.dispose();
});

test('retomada — início jovem no storage reabre em compactando com escape pelo restante', () => {
  const storage = storageFalso();
  storage.setItem(
    'cockpit:compact:v1:hiro',
    JSON.stringify({ duracoes: [], inicio: 900_000 }),
  );
  const relogio = relogioFalso(1_000_000); // 100s depois do início
  const agendador = agendadorFalso();

  const c = createControleCompact('hiro', {
    agora: relogio.agora,
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    storage,
  });

  const estado = c.getEstado();
  assert.equal(estado.fase, 'compactando');
  assert.equal(estado.desdeMs, 900_000);
  // O escape não rearma 6min cheios — só o que falta.
  assert.equal(agendador.timers.at(-1)?.atrasoMs, ESCAPE_COMPACT_MS - 100_000);
  c.dispose();
});

test('retomada — início velho demais é limpo e a máquina nasce ociosa', () => {
  const storage = storageFalso();
  storage.setItem(
    'cockpit:compact:v1:hiro',
    JSON.stringify({ duracoes: [], inicio: 1_000 }),
  );
  const c = createControleCompact('hiro', {
    agora: () => 1_000 + ESCAPE_COMPACT_MS + 1,
    storage,
  });
  assert.equal(c.getEstado().fase, 'ocioso');
  const gravado = JSON.parse(storage.mapa.get('cockpit:compact:v1:hiro') ?? '{}') as {
    inicio: number | null;
  };
  assert.equal(gravado.inicio, null);
  c.dispose();
});

test('storage quebrado (JSON inválido, durações sujas) não derruba a máquina', () => {
  const storage = storageFalso();
  storage.setItem('cockpit:compact:v1:hiro', '{não é json');
  const c = createControleCompact('hiro', { storage });
  assert.equal(c.getEstado().fase, 'ocioso');
  assert.equal(c.getEstado().etaMs, ETA_COMPACT_PADRAO_MS);
  c.dispose();
});

test('dispose — timers param de agir e transições não notificam mais', () => {
  const agendador = agendadorFalso();
  const c = createControleCompact('hiro', {
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    storage: null,
  });
  let notificacoes = 0;
  c.subscribe(() => {
    notificacoes += 1;
  });

  c.iniciar();
  assert.equal(notificacoes, 1);
  c.dispose();

  c.cancelar(); // no-op pós-dispose
  assert.equal(notificacoes, 1);
  assert.equal(c.getEstado().fase, 'compactando'); // congelado no descarte
});
