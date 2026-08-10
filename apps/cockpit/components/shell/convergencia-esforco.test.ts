import assert from 'node:assert/strict';
import { test } from 'node:test';

import { esperaConvergenciaDoEsforco } from './convergencia-esforco.ts';

type PainelFake = { effort: { value: string | null } };

type TimerFalso = { callback: () => void; cancelado: boolean };

// Mesmo padrão de `compact.test.ts`: agendador falso, sem tocar `setTimeout`
// de verdade — a máquina nunca espera o relógio real correr.
function agendadorFalso() {
  const timers: TimerFalso[] = [];
  let proximoId = 0;
  return {
    timers,
    agendar(callback: () => void) {
      const timer = { callback, cancelado: false };
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
    pendentes() {
      return timers.filter((t) => !t.cancelado).length;
    },
  };
}

async function drenar() {
  // Deixa as microtasks das promises de `lerPainel` resolverem antes do
  // teste checar o resultado.
  await Promise.resolve();
  await Promise.resolve();
}

test('achado [3]: troca `pendente` (agente em turno) converge sozinha quando o back confirmar', async () => {
  // Reproduz o achado da auditoria (09/08): `SeletorMotor` buscava o painel
  // uma vez por `agentSlug` e o ramo `pendente` só mostrava aviso — nada
  // refazia a leitura, e o rótulo travava no valor antigo até o componente
  // desmontar. Aqui a máquina poll até o `/painel` devolver o valor pedido.
  const agendador = agendadorFalso();
  let leituras = 0;
  const lerPainel = async (): Promise<PainelFake> => {
    leituras += 1;
    // A sessão só confirma na SEGUNDA consulta — o meio do turno anterior.
    return { effort: { value: leituras < 2 ? 'medium' : 'high' } };
  };
  let convergido: PainelFake | null = null;

  esperaConvergenciaDoEsforco('high', lerPainel, (p) => (convergido = p), {
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
  });

  agendador.dispararUltimo();
  await drenar();
  assert.equal(leituras, 1, 'primeira consulta já disparou');
  assert.equal(convergido, null, 'ainda não bateu com o valor pedido');
  assert.equal(agendador.pendentes(), 1, 'reagenda a próxima tentativa');

  agendador.dispararUltimo();
  await drenar();
  assert.equal(leituras, 2);
  assert.deepEqual(convergido, { effort: { value: 'high' } });
  assert.equal(agendador.pendentes(), 0, 'convergiu — não reagenda mais nada');
});

test('nunca converge: desiste depois do teto de tentativas, sem poll infinito', async () => {
  const agendador = agendadorFalso();
  let leituras = 0;
  const lerPainel = async (): Promise<PainelFake> => {
    leituras += 1;
    return { effort: { value: 'medium' } }; // nunca bate com o pedido
  };
  let convergiu = false;

  esperaConvergenciaDoEsforco('high', lerPainel, () => (convergiu = true), {
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
    tentativasMax: 3,
  });

  for (let i = 0; i < 3; i++) {
    agendador.dispararUltimo();
    await drenar();
  }

  assert.equal(leituras, 3);
  assert.equal(convergiu, false);
  assert.equal(agendador.pendentes(), 0, 'desistiu — não sobra timer armado');
});

test('parar() cancela o timer em voo e ignora resposta tardia da leitura', async () => {
  const agendador = agendadorFalso();
  let resolver!: (painel: PainelFake) => void;
  const lerPainel = () =>
    new Promise<PainelFake>((resolve) => {
      resolver = resolve;
    });
  let convergiu = false;

  const controle = esperaConvergenciaDoEsforco('high', lerPainel, () => (convergiu = true), {
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
  });

  agendador.dispararUltimo(); // dispara a leitura, que fica pendurada em `resolver`
  controle.parar();
  resolver({ effort: { value: 'high' } }); // a resposta chega DEPOIS do parar()
  await drenar();

  assert.equal(convergiu, false, 'parar() vale mesmo com leitura já em voo');
  assert.equal(agendador.pendentes(), 0);
});

test('leitura que rejeita (erro de rede) conta como tentativa e tenta de novo', async () => {
  const agendador = agendadorFalso();
  let leituras = 0;
  const lerPainel = async (): Promise<PainelFake> => {
    leituras += 1;
    if (leituras === 1) throw new Error('rede caiu');
    return { effort: { value: 'high' } };
  };
  let convergido: PainelFake | null = null;

  esperaConvergenciaDoEsforco('high', lerPainel, (p) => (convergido = p), {
    agendar: agendador.agendar,
    cancelar: agendador.cancelar,
  });

  agendador.dispararUltimo();
  await drenar();
  assert.equal(leituras, 1);
  assert.equal(convergido, null, 'erro não conta como convergência');
  assert.equal(agendador.pendentes(), 1, 'tenta de novo em vez de desistir na primeira falha');

  agendador.dispararUltimo();
  await drenar();
  assert.deepEqual(convergido, { effort: { value: 'high' } });
});
