import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  ESPERA_DE_AGRUPAMENTO_MS,
  ESPERA_MINIMA_DO_BOOT_MS,
  TEXTO_AGRUPANDO,
  TEXTO_CONFIRMA_TURNO,
  TEXTO_FALHOU,
  TEXTO_NO_CHAO,
  agendarAplicacao,
  aplicarMotor,
  assinarOperacao,
  convergiu,
  esquecerConfirmacao,
  esquecerTudo,
  leiaOperacao,
  sinalizarPainel,
  textoDesligando,
  textoSubindo,
} from './operacao-de-motor.ts';

afterEach(() => esquecerTudo());

function erro(status: number, detail: string) {
  return Object.assign(new Error(detail), { status, detail });
}

function painel(patch: Partial<AgentPainelResponse> = {}): AgentPainelResponse {
  return {
    slug: 'canarinho',
    generated_at: 0,
    vida: { sessao: true, processo: true },
    motor: { familia: 'kimi', override: 'kimi', source: 'agent_state.motor_familia', session_may_diverge: false },
    ...patch,
  } as AgentPainelResponse;
}

function rede(aplicar: (force: boolean) => Promise<unknown>) {
  const relidos: number[] = [];
  return {
    rede: { aplicar, reler: () => relidos.push(Date.now()) },
    relidos,
  };
}

describe('a guarda do turno em voo', () => {
  it('409 agent_busy ARMA a pergunta em vez de desligar', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      throw erro(409, 'agent_busy_confirm_required');
    });

    const disparou = await aplicarMotor('canarinho', r);

    assert.equal(disparou, false);
    assert.deepEqual(forces, [false]);
    assert.equal(leiaOperacao('canarinho').fase, 'confirmando');
    assert.equal(leiaOperacao('canarinho').aviso, TEXTO_CONFIRMA_TURNO);
  });

  it('o segundo toque manda force e a operação passa', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      if (!force) throw erro(409, 'agent_busy_confirm_required');
      return { desligado: true, religado: true };
    });

    await aplicarMotor('canarinho', r);
    const disparou = await aplicarMotor('canarinho', r);

    assert.equal(disparou, true);
    assert.deepEqual(forces, [false, true]);
    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });

  it('fechar a gaveta desarma a pergunta, mas não uma operação em voo', async () => {
    const { rede: r } = rede(async () => {
      throw erro(409, 'agent_busy_confirm_required');
    });
    await aplicarMotor('canarinho', r);
    esquecerConfirmacao('canarinho');
    assert.equal(leiaOperacao('canarinho').fase, 'ocioso');

    const { rede: r2 } = rede(async () => ({ desligado: true }));
    await aplicarMotor('canarinho', r2);
    esquecerConfirmacao('canarinho');
    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });
});

describe('o que a tela mostra em cada desfecho', () => {
  it('dispara com o aviso de trabalho e relê o painel sem esperar timer', async () => {
    const { rede: r, relidos } = rede(async () => ({ desligado: true, religado: true }));
    const vistos: string[] = [];
    assinarOperacao('canarinho', (estado) => vistos.push(estado.fase));

    await aplicarMotor('canarinho', r);

    assert.equal(leiaOperacao('canarinho').aviso, textoSubindo());
    assert.deepEqual(vistos, ['aplicando', 'aplicando']);
    assert.equal(relidos.length, 1);
  });

  it('o aviso diz QUEM está religando e em que etapa — não uma frase só', async () => {
    // [09/09] O Rica fotografou a frase antiga ocupando duas linhas: "Aplicando
    // — desligando e religando o agente. Leva uns 15 segundos." Ela é longa,
    // some com o nome do agente e diz as duas etapas de uma vez, então nunca
    // corresponde ao que está acontecendo naquele instante.
    const avisos: (string | null)[] = [];
    assinarOperacao('canarinho', (estado) => avisos.push(estado.aviso));
    const { rede: r } = rede(async () => {
      // Dentro do POST: é aqui que o desligamento está de fato acontecendo.
      assert.equal(leiaOperacao('canarinho').aviso, textoDesligando('Canário'));
      return { desligado: true, religado: true };
    });

    await aplicarMotor('canarinho', r, 'Canário');

    assert.deepEqual(avisos, [textoDesligando('Canário'), textoSubindo('Canário')]);
    assert.ok(textoSubindo('Canário').includes('Canário'), 'sem o nome, "quem" fica sem resposta');
    assert.ok(textoSubindo('Canário').length < 40, 'o que não cabe numa linha vira parágrafo');
  });

  it('sem nome o aviso não mente — fala do agente', async () => {
    const { rede: r } = rede(async () => ({ desligado: true, religado: true }));
    await aplicarMotor('canarinho', r);
    assert.match(leiaOperacao('canarinho').aviso ?? '', /agente/);
  });

  it('religar que falhou DEPOIS do desligamento diz que o agente está no chão', async () => {
    const { rede: r, relidos } = rede(async () => {
      throw erro(409, 'religar_falhou_agente_desligado: boot já em curso');
    });

    await aplicarMotor('canarinho', r);

    assert.equal(leiaOperacao('canarinho').fase, 'falhou');
    assert.equal(leiaOperacao('canarinho').aviso, TEXTO_NO_CHAO);
    // A releitura na falha não é enfeite: sem ela a gaveta seguiria mostrando
    // os botões do agente vivo.
    assert.equal(relidos.length, 1);
  });

  it('falha comum não vira "o agente está fora do ar"', async () => {
    const { rede: r } = rede(async () => {
      throw erro(500, 'boom');
    });
    await aplicarMotor('canarinho', r);
    assert.equal(leiaOperacao('canarinho').aviso, TEXTO_FALHOU);
  });
});

describe('a trava sai quando a escolha entra em vigor', () => {
  /** O tempo é do relógio real; o teste empurra o disparo para trás em vez de
   *  esperar 12 segundos parado. */
  function envelhecer(ms = ESPERA_MINIMA_DO_BOOT_MS) {
    const agora = Date.now;
    Date.now = () => agora() + ms;
    return () => { Date.now = agora; };
  }

  it('painel convergido conclui a operação — depois do piso do boot', async () => {
    const { rede: r } = rede(async () => ({ desligado: true, religado: true }));
    await aplicarMotor('canarinho', r);

    const restaurar = envelhecer();
    sinalizarPainel(painel());
    restaurar();

    assert.equal(leiaOperacao('canarinho').fase, 'concluido');
  });

  it('painel convergido ANTES do piso não solta a trava', async () => {
    // O caso que a prova ao vivo pegou: trocar só o modelo dentro da mesma
    // família deixa o painel convergido desde antes do religamento. Aos 3s ele
    // diria "pronto" sobre a sessão velha, ainda morrendo.
    const { rede: r } = rede(async () => ({ desligado: true, religado: true }));
    await aplicarMotor('canarinho', r);

    sinalizarPainel(painel());

    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });

  it('agente ainda no chão NÃO solta a trava', async () => {
    const { rede: r } = rede(async () => ({ desligado: true, religado: true }));
    await aplicarMotor('canarinho', r);

    const restaurar = envelhecer();
    sinalizarPainel(painel({ vida: { sessao: false, processo: false } }));
    restaurar();

    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });

  it('agente de pé mas ainda divergindo NÃO solta a trava', async () => {
    const { rede: r } = rede(async () => ({ desligado: true, religado: true }));
    await aplicarMotor('canarinho', r);

    const restaurar = envelhecer();
    sinalizarPainel(
      painel({
        motor: { familia: 'kimi', override: 'kimi', source: 'agent_state.motor_familia', session_may_diverge: true },
      }),
    );
    restaurar();

    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });

  it('API velha, sem o campo, não conta como convergida', () => {
    assert.equal(convergiu(painel({ motor: undefined })), false);
  });

  it('painel de OUTRO agente não solta a trava deste', async () => {
    const { rede: r } = rede(async () => ({ desligado: true, religado: true }));
    await aplicarMotor('canarinho', r);

    const restaurar = envelhecer();
    sinalizarPainel(painel({ slug: 'tara' }));
    restaurar();

    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });
});

describe('o agrupamento das escolhas num religar só', () => {
  /** Os oito segundos de espera são relógio de parede. Com o timer falso o
   *  teste anda no tempo em vez de dormir nele. */
  function comRelogioFalso() {
    mock.timers.enable({ apis: ['setTimeout'] });
    return () => mock.timers.reset();
  }

  /** A chamada agendada é `async`: o tick dispara, e a ida à rede só termina
   *  na microtask seguinte. */
  const assentar = () => new Promise((pronto) => setImmediate(pronto));

  it('modelo e esforço escolhidos em seguida religam UMA vez', async () => {
    const restaurar = comRelogioFalso();
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });

    // O que o Rica fez em 09/09: trocou o modelo e, enquanto o primeiro boot
    // ainda nem tinha razão de existir, trocou o esforço. Deu dois boots.
    agendarAplicacao('canarinho', r);
    mock.timers.tick(ESPERA_DE_AGRUPAMENTO_MS - 1);
    agendarAplicacao('canarinho', r);
    mock.timers.tick(ESPERA_DE_AGRUPAMENTO_MS - 1);
    await assentar();
    assert.deepEqual(forces, [], 'a segunda escolha reinicia o relógio');

    mock.timers.tick(1);
    await assentar();

    assert.deepEqual(forces, [false], 'um religar só para as duas escolhas');
    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
    restaurar();
  });

  it('a espera aparece na tela — e não é a trava', async () => {
    const restaurar = comRelogioFalso();
    const { rede: r } = rede(async () => ({ desligado: true, religado: true }));

    agendarAplicacao('canarinho', r);

    // Fase própria: o véu só nasce em `aplicando`, e travar a tela enquanto ela
    // espera mais escolhas mataria justamente o que o agrupamento serve.
    assert.equal(leiaOperacao('canarinho').fase, 'agrupando');
    assert.equal(leiaOperacao('canarinho').aviso, TEXTO_AGRUPANDO);
    restaurar();
  });

  it('escolha nova NÃO apaga a pergunta do turno em voo', async () => {
    const restaurar = comRelogioFalso();
    const { rede: r } = rede(async () => {
      throw erro(409, 'agent_busy_confirm_required');
    });
    agendarAplicacao('canarinho', r);
    mock.timers.tick(ESPERA_DE_AGRUPAMENTO_MS);
    await assentar();
    assert.equal(leiaOperacao('canarinho').fase, 'confirmando');

    // Reagendar aqui trocaria a pergunta por um relógio mudo — e o segundo
    // toque que mata o turno em voo sairia sem ninguém ter confirmado nada. A
    // gravação da escolha nova já está no banco; quem espera é o religar.
    agendarAplicacao('canarinho', r);

    assert.equal(leiaOperacao('canarinho').fase, 'confirmando');
    assert.equal(leiaOperacao('canarinho').aviso, TEXTO_CONFIRMA_TURNO);
    restaurar();
  });

  it('agente já religando não ganha um religar agendado por cima', async () => {
    const restaurar = comRelogioFalso();
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });
    await aplicarMotor('canarinho', r);
    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');

    agendarAplicacao('canarinho', r);
    mock.timers.tick(ESPERA_DE_AGRUPAMENTO_MS);
    await assentar();

    assert.deepEqual(forces, [false], 'o segundo desligaria o agente no meio do próprio boot');
    restaurar();
  });
});
