import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  ESPERA_MINIMA_DO_BOOT_MS,
  TEXTO_CONFIRMA_TURNO,
  TEXTO_FALHOU,
  TEXTO_NO_CHAO,
  aplicarMotor,
  assinarOperacao,
  fecharSePronto,
  convergiu,
  esquecerConfirmacao,
  esquecerTudo,
  faltaEscolher,
  leiaOperacao,
  registrarEscolha,
  revisarFaltas,
  sinalizarPainel,
  textoFalta,
  textoDesligando,
  textoSubindo,
  type PainelDoMotor,
} from './operacao-de-motor.ts';

afterEach(() => esquecerTudo());

/** A mesma rede, respondendo um painel conhecido na hora da decisão. */
function redeComPainel(
  r: { aplicar: (force: boolean) => Promise<unknown>; reler: () => unknown },
  painel: PainelDoMotor,
) {
  return { ...r, lePainel: async () => painel };
}

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

/** O painel como o back o devolve: `value: null` é campo que a tela mostra em
 *  branco, e `allowed` é o que aquele motor oferece. */
function pacote(modelo: string | null, esforco: string | null): PainelDoMotor {
  return {
    model: { value: modelo, allowed: ['kimi-k3', 'kimi-k3-turbo'], labels: {} },
    effort: { value: esforco, allowed: ['low', 'high'] },
  } as unknown as PainelDoMotor;
}

function rede(aplicar: (force: boolean) => Promise<unknown>, pagina?: () => PainelDoMotor) {
  const relidos: number[] = [];
  return {
    rede: {
      aplicar,
      reler: () => relidos.push(Date.now()),
      // O painel que a decisão vai LER na hora. Sem `pagina`, o pacote está
      // fechado — é o caso dos testes que não falam de campo em branco.
      lePainel: async () => (pagina ?? (() => pacote('kimi-k3', 'high')))(),
    },
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

describe('o pacote manda — religa quando não falta mais campo', () => {
  it('escolher com campo em branco guarda e NÃO religa nada', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });

    // Trocar o motor esvazia o modelo no back — é este painel que chega.
    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote(null, 'high')), nome: 'Canário' });

    assert.deepEqual(forces, [], 'religar aqui é religar no meio da escolha');
    assert.equal(leiaOperacao('canarinho').fase, 'agrupando');
    assert.equal(leiaOperacao('canarinho').aviso, textoFalta(['o modelo']));
  });

  it('modelo e esforço: um religar só, no toque que fecha o pacote', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });

    // O caminho do Rica: trocou o motor (os dois em branco), escolheu o modelo,
    // escolheu o esforço. O religar sai no último, sem gesto de tela nenhum.
    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote(null, null)), nome: 'Canário' });
    assert.deepEqual(forces, []);
    assert.equal(leiaOperacao('canarinho').aviso, textoFalta(['o modelo', 'o esforço']));

    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote('kimi-k3', null)), nome: 'Canário' });
    assert.deepEqual(forces, [], 'falta o esforço — ainda não é a hora');
    assert.equal(leiaOperacao('canarinho').aviso, textoFalta(['o esforço']));

    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote('kimi-k3', 'low')), nome: 'Canário' });

    assert.deepEqual(forces, [false], 'um religar para as três escolhas');
    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });

  it('escolha única com o resto preenchido religa na hora', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });

    // Mexer só no esforço não abre espera: o pacote já está fechado, e a régua
    // dele é "imediatamente depois que os dois estiverem escolhidos".
    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote('kimi-k3', 'low')), nome: 'Canário' });

    assert.deepEqual(forces, [false]);
    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');
  });

  it('a troca de motor decide RELENDO o painel, não com o que a tela tinha', async () => {
    const forces: boolean[] = [];
    let resposta = pacote(null, 'high');
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    }, () => resposta);

    // A gaveta do motor não tem o valor novo em mão — ela grava e a decisão lê o
    // painel na hora. Com o modelo em branco, a escolha só fica guardada.
    await registrarEscolha('canarinho', { rede: r, nome: 'Canário' });
    assert.deepEqual(forces, []);
    assert.equal(leiaOperacao('canarinho').aviso, textoFalta(['o modelo']));

    // Ele escolhe o modelo: o toque seguinte relê e encontra o pacote fechado.
    resposta = pacote('kimi-k3', 'high');
    await fecharSePronto('canarinho');
    assert.deepEqual(forces, [false]);
  });

  it('escolha que vale A QUENTE ainda fecha o pacote do motor guardado', async () => {
    const forces: boolean[] = [];
    let resposta = pacote(null, null);
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    }, () => resposta);

    // [10/09] Trocar para Claude nativo deixa modelo e esforço em branco, mas lá
    // os dois trocam na sessão VIVA — e esses caminhos não guardavam pendência
    // nenhuma. O pacote do motor ficava pendurado para sempre e o motor novo nunca
    // entrava. A prova de navegador parou exatamente aqui.
    await registrarEscolha('canarinho', { rede: r, nome: 'Canário' });
    assert.deepEqual(forces, []);

    resposta = pacote('opus', 'high');
    await fecharSePronto('canarinho');
    assert.deepEqual(forces, [false], 'o motor escolhido precisa do boot mesmo assim');
  });

  it('leitura que falha na hora da decisão NÃO religa no escuro', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });
    const semRede = { ...r, lePainel: () => Promise.reject(new Error('sem rede')) };

    await registrarEscolha('canarinho', { rede: semRede, nome: 'Canário' });

    assert.deepEqual(forces, [], 'sem saber o que falta, não se desliga ninguém');
    assert.equal(leiaOperacao('canarinho').fase, 'agrupando', 'a escolha fica guardada');
  });

  it('RELEITURA não religa — ela só conta o que falta', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });

    // [10/09] O painel oscila: depois de um boot, enquanto a statusline nova não
    // existe, o esforço volta do `settings.json` global e o campo que estava em
    // branco aparece preenchido. Na versão anterior essa leitura fechava o pacote
    // sozinha e religava o agente no meio da escolha — três leituras do mesmo
    // painel, respostas diferentes, medido na prova de navegador.
    let resposta = pacote(null, null);
    const comLeitura = { ...r, lePainel: async () => resposta };
    await registrarEscolha('canarinho', { rede: comLeitura, nome: 'Canário' });
    assert.equal(leiaOperacao('canarinho').aviso, textoFalta(['o modelo', 'o esforço']));

    // Uma leitura de fundo trazendo tudo preenchido: a linha acompanha, o agente
    // não cai.
    revisarFaltas('canarinho', pacote('kimi-k3', 'high'));
    assert.deepEqual(forces, [], 'quem religa é o toque dele, não uma leitura');
    assert.equal(leiaOperacao('canarinho').fase, 'agrupando');

    resposta = pacote('kimi-k3', 'high');
    await fecharSePronto('canarinho');
    assert.deepEqual(forces, [false]);
  });

  it('sem ninguém ter escolhido nada, fechar pacote não religa agente parado', async () => {
    await fecharSePronto('canarinho');
    assert.equal(leiaOperacao('canarinho').fase, 'ocioso');
  });

  it('controle que o motor não oferece não conta como campo em branco', () => {
    // OpenCode tem um modelo só: `allowed` vazio. Esperar escolha ali seria
    // esperar para sempre num controle que a tela não mostra.
    assert.deepEqual(faltaEscolher({
      model: { value: null, allowed: [] }, effort: { value: 'high', allowed: ['low', 'high'] },
    } as unknown as PainelDoMotor), []);
    assert.deepEqual(faltaEscolher(pacote(null, 'high')), ['o modelo']);
  });

  it('o aviso diz o que falta, curto e sem jargão', () => {
    assert.equal(textoFalta(['o modelo']), 'Falta escolher o modelo.');
    assert.equal(textoFalta(['o modelo', 'o esforço']), 'Falta escolher o modelo e o esforço.');
    assert.ok(textoFalta(['o modelo', 'o esforço']).length < 40, 'o aviso de 62 caracteres ocupou duas linhas na tela dele');
  });

  it('escolha nova NÃO apaga a pergunta do turno em voo', async () => {
    const { rede: r } = rede(async () => {
      throw erro(409, 'agent_busy_confirm_required');
    });
    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote('kimi-k3', 'high')) });
    assert.equal(leiaOperacao('canarinho').fase, 'confirmando');

    // Guardar outra escolha aqui trocaria a pergunta por uma espera muda, e o
    // segundo toque que mata o turno em voo sairia sem ninguém confirmar nada.
    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote('kimi-k3', 'low')) });

    assert.equal(leiaOperacao('canarinho').fase, 'confirmando');
    assert.equal(leiaOperacao('canarinho').aviso, TEXTO_CONFIRMA_TURNO);
  });

  it('agente já religando não ganha outro religar por cima', async () => {
    const forces: boolean[] = [];
    const { rede: r } = rede(async (force) => {
      forces.push(force);
      return { desligado: true, religado: true };
    });
    await aplicarMotor('canarinho', r);
    assert.equal(leiaOperacao('canarinho').fase, 'aplicando');

    await registrarEscolha('canarinho', { rede: redeComPainel(r, pacote('kimi-k3', 'low')) });

    assert.deepEqual(forces, [false], 'o segundo desligaria o agente no meio do próprio boot');
  });
});
