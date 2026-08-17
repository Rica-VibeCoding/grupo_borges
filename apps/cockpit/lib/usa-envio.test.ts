import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aparenciaDe } from '../components/shell/aparencia-envio.ts';
import { PRAZO_ECO_MS } from './envio.ts';
import { ATRASOS_DA_RETENTATIVA_MS } from './recusa-transitoria.ts';
import {
  createControleEnvio,
  type ConstrutorFonteEventosEnvio,
  type FonteEventosEnvio,
} from './usa-envio.ts';

type CallbackTimer = () => void;

function relogioFake(inicio = 1_000) {
  let agora = inicio;
  let proximoId = 0;
  const timers = new Map<number, { callback: CallbackTimer; quando: number }>();
  return {
    agora: () => agora,
    agendar(callback: CallbackTimer, atraso: number) {
      const id = ++proximoId;
      timers.set(id, { callback, quando: agora + atraso });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancelar(timer: ReturnType<typeof setTimeout>) {
      timers.delete(timer as unknown as number);
    },
    avancar(ms: number) {
      agora += ms;
      const vencidos = [...timers.entries()]
        .filter(([, timer]) => timer.quando <= agora)
        .sort((a, b) => a[1].quando - b[1].quando);
      for (const [id, timer] of vencidos) {
        timers.delete(id);
        timer.callback();
      }
    },
    quantidade: () => timers.size,
  };
}

function fonteFake() {
  const instancias: FakeFonte[] = [];

  class FakeFonte implements FonteEventosEnvio {
    readonly ouvintes = new Map<string, ((evento: { data: string }) => void)[]>();
    readonly url: string;
    onerror: (() => void) | null = null;
    fechada = false;

    constructor(url: string) {
      this.url = url;
      instancias.push(this);
    }

    addEventListener(
      tipo: string,
      ouvinte: (evento: { data: string }) => void,
    ): void {
      const atuais = this.ouvintes.get(tipo) ?? [];
      atuais.push(ouvinte);
      this.ouvintes.set(tipo, atuais);
    }

    close(): void {
      this.fechada = true;
    }

    emitirMensagem(id: number, papel: 'user' | 'assistant', texto: string): void {
      const data = JSON.stringify({
        id,
        message: { role: papel, content: texto },
      });
      for (const ouvinte of this.ouvintes.get('message') ?? []) {
        ouvinte({ data });
      }
    }

    /** Fecha o replay — é o que a sonda de fronteira espera para responder. */
    emitirFimDoReplay(): void {
      for (const ouvinte of this.ouvintes.get('replay-end') ?? []) {
        ouvinte({ data: '' });
      }
    }

    /** A sonda de fronteira é a única que pede a ponta recente do histórico. */
    ehSonda(): boolean {
      return this.url.includes('recentes=1');
    }
  }

  return {
    FonteEventos: FakeFonte as unknown as ConstrutorFonteEventosEnvio,
    instancias,
  };
}

function resposta(fronteira: number) {
  return {
    tmux_delivered: true,
    sent_at: 123,
    event_boundary_id: fronteira,
  };
}

test('POST instala a fronteira, fica aceito e o eco user confirma', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = createControleEnvio('tara', {
    postar: async () => resposta(40),
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  const promessa = controle.enviar('faz isso');
  assert.equal(controle.getEstado().fase, 'enviando');
  await promessa;
  assert.equal(controle.getEstado().fase, 'aceito');
  assert.match(fonte.instancias[0]!.url, /since_id=40/);

  fonte.instancias[0]!.emitirMensagem(41, 'user', 'faz isso');
  assert.equal(controle.getEstado().fase, 'confirmado');
  assert.equal(fonte.instancias[0]!.fechada, true);
  assert.equal(relogio.quantidade(), 0);
});

test('erro de rede sem resposta fica não confirmado e não abre o stream', async () => {
  const fonte = fonteFake();
  const erro = new Error('rede caiu');
  const controle = createControleEnvio('tara', {
    postar: async () => {
      throw erro;
    },
    FonteEventos: fonte.FonteEventos,
  });

  await controle.enviar('faz isso');

  const estado = controle.getEstado();
  assert.equal(estado.fase, 'nao-confirmado');
  if (estado.fase === 'nao-confirmado') {
    assert.strictEqual(estado.erro, erro);
  }
  assert.equal(fonte.instancias.length, 0);
});

// `falhou` não foi aposentado quando o `tmux_delivered` saiu de lá: erro HTTP
// real continua sendo dele, e é a única fase em que a tela AFIRMA que a
// mensagem não saiu — porque ali ela sabe.
//
// O detalhe MUDOU em 15/08: um 409 que o back afirma não ter entregue passa
// primeiro pela retentativa (ver os três testes abaixo). Este caso usa um erro
// HTTP sem detalhe conhecido, que continua indo direto para o vermelho.
test('rejeição HTTP do POST é falha real, e ali a tela afirma que não saiu', async () => {
  const erro = Object.assign(new Error('coisa nova'), { status: 500 });
  const controle = createControleEnvio('tara', {
    postar: async () => {
      throw erro;
    },
  });

  await controle.enviar('faz isso');

  const fase = controle.getEstado().fase;
  assert.equal(fase, 'falhou');
  assert.match(aparenciaDe(fase, 'Tara').frase ?? '', /não saiu/i);
});

test('409 incerto preserva a pendência e não afirma que a mensagem falhou', async () => {
  const relogio = relogioFake();
  const erro = Object.assign(new Error('agent_pane_unavailable'), {
    status: 409,
    detail: 'agent_pane_unavailable',
    deliveryOutcome: 'uncertain',
    safeToResend: false,
  });
  let pendenciasDesfeitas = 0;
  const controle = createControleEnvio('tara', {
    postar: async () => {
      throw erro;
    },
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('faz isso', () => {
    pendenciasDesfeitas += 1;
  });

  assert.equal(controle.getEstado().fase, 'nao-confirmado');
  assert.equal(pendenciasDesfeitas, 0);
});

// O DEFEITO QUE O RICA VIVEU: mandou, deu parar, mandou de novo, e o 409 do
// pane pintou a tela de vermelho pedindo intervenção — quando a entrega
// seguinte, sem conserto nenhum, voltou 200. O composer agora insiste sozinho.
test('409 do pane não pinta a tela: a máquina espera e tenta de novo', async () => {
  const relogio = relogioFake();
  const fonte = fonteFake();
  let chamadas = 0;
  const controle = createControleEnvio('canarinho', {
    postar: async () => {
      chamadas += 1;
      if (chamadas === 1) {
        throw Object.assign(new Error('agent_pane_unavailable'), {
          status: 409,
          detail: 'agent_pane_unavailable',
        });
      }
      return resposta(70);
    },
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('conta de 1 a 10');
  // Continua em `enviando`, e é o ponto: a porta segue recusando `envio-em-voo`,
  // então o que ele escrever nesses segundos vai para a fila, não para o
  // vermelho.
  assert.equal(controle.getEstado().fase, 'enviando');

  relogio.avancar(ATRASOS_DA_RETENTATIVA_MS[0]);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(chamadas, 2);
  assert.equal(controle.getEstado().fase, 'aceito');
});

test('esgotadas as tentativas, o vermelho volta — a recuperação não esconde o defeito', async () => {
  const relogio = relogioFake();
  let chamadas = 0;
  const controle = createControleEnvio('canarinho', {
    postar: async () => {
      chamadas += 1;
      throw Object.assign(new Error('agent_pane_unavailable'), {
        status: 409,
        detail: 'agent_pane_unavailable',
      });
    },
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('faz isso');
  for (const atraso of ATRASOS_DA_RETENTATIVA_MS) {
    relogio.avancar(atraso);
    await Promise.resolve();
    await Promise.resolve();
  }

  assert.equal(chamadas, ATRASOS_DA_RETENTATIVA_MS.length + 1);
  assert.equal(controle.getEstado().fase, 'falhou');
});

// Timer solto depois do dispose reabriria um POST para um agente que a tela já
// deixou — e a bolha otimista dele foi desfeita há muito.
test('dispose durante a espera cancela a retentativa', async () => {
  const relogio = relogioFake();
  let chamadas = 0;
  const controle = createControleEnvio('canarinho', {
    postar: async () => {
      chamadas += 1;
      throw Object.assign(new Error('agent_pane_unavailable'), {
        status: 409,
        detail: 'agent_pane_unavailable',
      });
    },
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('faz isso');
  controle.dispose();
  relogio.avancar(ATRASOS_DA_RETENTATIVA_MS[0]);
  await Promise.resolve();

  assert.equal(chamadas, 1);
  assert.equal(relogio.quantidade(), 0);
});

// `tmux_delivered: false` é ausência de prova, não erro: o `send_message` só
// devolve `true` com prova observável no pane, e pane em turno ativo não mostra
// essa prova embora o texto entre na fila. Mandar isso pra `falhou` era pior
// aqui do que no anexo — `falhou` oferece "tentar de novo" como caminho óbvio, e
// reenviar um texto que ENTROU faz o agente rodar o mesmo comando duas vezes.
//
// O teste trava a corrente inteira: da resposta do backend até a frase na tela.
test('tmux_delivered false vai para não confirmado, e a tela não afirma que não chegou', async () => {
  const controle = createControleEnvio('tara', {
    postar: async () => ({ ...resposta(10), tmux_delivered: false }),
  });

  await controle.enviar('faz isso');

  const fase = controle.getEstado().fase;
  assert.equal(fase, 'nao-confirmado');

  const naTela = aparenciaDe(fase, 'Tara');
  assert.match(naTela.frase ?? '', /não consegui confirmar/i);
  assert.match(naTela.frase ?? '', /duplica/i);
  assert.doesNotMatch(naTela.frase ?? '', /não saiu|não recebeu|não chegou|nada foi entregue/i);
});

test('timer externo ao redutor transforma aceito em não confirmado no prazo', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = createControleEnvio('tara', {
    postar: async () => resposta(10),
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('sem eco');
  relogio.avancar(PRAZO_ECO_MS - 1);
  assert.equal(controle.getEstado().fase, 'aceito');
  relogio.avancar(1);
  assert.equal(controle.getEstado().fase, 'nao-confirmado');
});

test('mandar de novo só atua em não confirmado e preserva a proteção de texto idêntico', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  let chamadas = 0;
  const controle = createControleEnvio('tara', {
    postar: async () => resposta(chamadas++ === 0 ? 10 : 11),
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.reenviar();
  assert.equal(chamadas, 0);
  await controle.enviar('ok');
  relogio.avancar(PRAZO_ECO_MS);
  await controle.reenviar();
  assert.equal(chamadas, 2);

  fonte.instancias[1]!.emitirMensagem(12, 'user', 'ok');
  assert.equal(controle.getEstado().fase, 'aceito');
  fonte.instancias[1]!.emitirMensagem(13, 'user', 'ok');
  assert.equal(controle.getEstado().fase, 'confirmado');
});

test('falha HTTP do reenvio desfaz a pendência otimista', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  let chamadas = 0;
  let pendenciasDesfeitas = 0;
  const controle = createControleEnvio('tara', {
    postar: async () => {
      chamadas += 1;
      if (chamadas === 1) return resposta(10);
      throw Object.assign(new Error('erro do servidor'), { status: 500 });
    },
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('ok');
  relogio.avancar(PRAZO_ECO_MS);
  await controle.reenviar(() => {
    pendenciasDesfeitas += 1;
  });

  assert.equal(controle.getEstado().fase, 'falhou');
  assert.equal(pendenciasDesfeitas, 1);
});

test('dispose fecha fonte, mata timers e ignora POST que termina depois', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  let resolver!: (valor: ReturnType<typeof resposta>) => void;
  const pendente = new Promise<ReturnType<typeof resposta>>((resolve) => {
    resolver = resolve;
  });
  const controle = createControleEnvio('tara', {
    postar: async () => pendente,
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });
  let publicacoes = 0;
  controle.subscribe(() => {
    publicacoes += 1;
  });

  const envio = controle.enviar('demorado');
  assert.equal(publicacoes, 1);
  controle.dispose();
  resolver(resposta(20));
  await envio;

  assert.equal(publicacoes, 1);
  assert.equal(fonte.instancias.length, 0);
  assert.equal(relogio.quantidade(), 0);
});

test('reconexão preserva cursor e replaya a partir do último item observado', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = createControleEnvio('tara', {
    postar: async () => resposta(20),
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
    atrasoReconexaoMs: 50,
  });

  await controle.enviar('alvo');
  fonte.instancias[0]!.emitirMensagem(21, 'assistant', 'trabalhando');
  fonte.instancias[0]!.onerror?.();
  assert.equal(fonte.instancias[0]!.fechada, true);

  relogio.avancar(50);
  assert.equal(fonte.instancias.length, 2);
  assert.match(fonte.instancias[1]!.url, /since_id=21/);
  fonte.instancias[1]!.emitirMensagem(22, 'user', 'alvo');
  assert.equal(controle.getEstado().fase, 'confirmado');
});

test('dispose durante reconexão cancela espera e impede nova fonte', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = createControleEnvio('tara', {
    postar: async () => resposta(30),
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
    atrasoReconexaoMs: 50,
  });

  await controle.enviar('alvo');
  fonte.instancias[0]!.onerror?.();
  assert.equal(relogio.quantidade(), 2);
  controle.dispose();
  assert.equal(relogio.quantidade(), 0);

  relogio.avancar(50);
  assert.equal(fonte.instancias.length, 1);
});

test('texto DIGITADO que começa com o emoji não é descascado', async () => {
  // O falso positivo de descascar sempre: o eco viria igual ao digitado, e
  // tirar o prefixo de um lado só quebraria a comparação.
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = createControleEnvio('daniel', {
    postar: async () => resposta(5),
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('🎙 é o nome do canal');
  fonte.instancias[0]!.emitirMensagem(6, 'user', '🎙 é o nome do canal');
  assert.equal(controle.getEstado().fase, 'confirmado');
});

test('rascunho transcrito preserva origem de voz depois da revisão', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  let origemPostada: string | undefined;
  const controle = createControleEnvio('daniel', {
    postar: async (_slug, _texto, origem) => {
      origemPostada = origem;
      return resposta(20);
    },
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });

  await controle.enviar('texto revisado', undefined, 'stt');
  assert.equal(origemPostada, 'stt');
  controle.confirmarPorEco('🎙 texto revisado');
  const estado = controle.getEstado();
  assert.equal(estado.fase, 'confirmado');
  assert.equal('texto' in estado ? estado.texto : null, 'texto revisado');
});
