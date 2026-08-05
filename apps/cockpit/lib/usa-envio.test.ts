import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aparenciaDe } from '../components/shell/aparencia-envio.ts';
import { PRAZO_ECO_MS } from './envio.ts';
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
test('rejeição HTTP do POST é falha real, e ali a tela afirma que não saiu', async () => {
  const erro = Object.assign(new Error('agent_pane_unavailable'), { status: 409 });
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

/* ========================================================================== */
/* VOZ — o áudio termina na mesma máquina, e o eco NÃO volta igual ao que      */
/* mandamos: `agents.py` entrega `f"🎙 {transcribed}"` por send-keys.          */
/* ========================================================================== */

/** Encena o caminho da voz até a sonda de fronteira responder. */
async function vozAte(
  fonte: ReturnType<typeof fonteFake>,
  controle: { enviarVoz(audio: Blob): Promise<string | null> },
  ultimoIdDoServidor: number | null,
) {
  const promessa = controle.enviarVoz(new Blob(['audio']));
  await Promise.resolve();
  const sonda = fonte.instancias.find((instancia) => instancia.ehSonda());
  assert.ok(sonda, 'a fronteira tem que ser lida do servidor ANTES do POST');
  if (ultimoIdDoServidor !== null) sonda.emitirMensagem(ultimoIdDoServidor, 'user', 'conversa velha');
  sonda.emitirFimDoReplay();
  return { transcrito: await promessa, sonda };
}

function controleDeVoz(
  fonte: ReturnType<typeof fonteFake>,
  relogio: ReturnType<typeof relogioFake>,
  postarVoz: () => Promise<{ transcribed: string; event_boundary_id?: number }>,
) {
  return createControleEnvio('daniel', {
    postar: async () => resposta(0),
    postarVoz,
    FonteEventos: fonte.FonteEventos,
    agora: relogio.agora,
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });
}

test('o eco da voz volta com o prefixo do back e ainda assim CONFIRMA', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = controleDeVoz(fonte, relogio, async () => ({
    transcribed: 'sobe o cockpit na porta 3008',
  }));

  const { transcrito } = await vozAte(fonte, controle, 40);
  assert.equal(transcrito, 'sobe o cockpit na porta 3008');
  assert.equal(controle.getEstado().fase, 'aceito');

  // Exatamente o que o tmux entrega — sem descascar, isto nunca casaria com o
  // texto que a UI conhece e TODO áudio terminaria não confirmado.
  const observacao = fonte.instancias.find((instancia) => !instancia.ehSonda());
  assert.ok(observacao);
  observacao.emitirMensagem(41, 'user', '🎙 sobe o cockpit na porta 3008');

  const estado = controle.getEstado();
  assert.equal(estado.fase, 'confirmado');
  assert.equal(estado.texto, 'sobe o cockpit na porta 3008', 'a tela mostra a fala, não o prefixo');
});

test('voz com tmux_delivered false é falha real, não falta de eco', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = controleDeVoz(fonte, relogio, async () => ({
    transcribed: 'faz isso',
    tmux_delivered: false,
  }));

  await vozAte(fonte, controle, 40);

  assert.equal(controle.getEstado().fase, 'falhou');
});

test('executor Codex entrega SEM prefixo — e confirma do mesmo jeito', async () => {
  // `agents.py` só prefixa no caminho tmux; no ramo codex o texto vai cru.
  // Descascar tem que ser tolerante, não obrigatório.
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = controleDeVoz(fonte, relogio, async () => ({ transcribed: 'roda os testes' }));

  await vozAte(fonte, controle, 10);
  fonte.instancias.find((i) => !i.ehSonda())!.emitirMensagem(11, 'user', 'roda os testes');
  assert.equal(controle.getEstado().fase, 'confirmado');
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

test('eco ANTERIOR à fronteira sondada não confirma o áudio', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = controleDeVoz(fonte, relogio, async () => ({ transcribed: 'mesma frase' }));

  await vozAte(fonte, controle, 90);
  const observacao = fonte.instancias.find((i) => !i.ehSonda())!;
  // Uma fala idêntica de dez minutos atrás, reentregue no replay.
  observacao.emitirMensagem(88, 'user', '🎙 mesma frase');
  assert.equal(controle.getEstado().fase, 'aceito', 'eco velho não pode confirmar envio novo');

  observacao.emitirMensagem(91, 'user', '🎙 mesma frase');
  assert.equal(controle.getEstado().fase, 'confirmado');
});

test('quando o back devolver a barreira no /voice, ela vence a sonda', async () => {
  // O `/voice` hoje não devolve `event_boundary_id` — o `/input` devolve. O
  // cliente já lê o campo para que a troca no back baste, sem tocar aqui.
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = controleDeVoz(fonte, relogio, async () => ({
    transcribed: 'fala',
    event_boundary_id: 700,
  }));

  await vozAte(fonte, controle, 40);
  const observacao = fonte.instancias.find((i) => !i.ehSonda())!;
  observacao.emitirMensagem(500, 'user', '🎙 fala');
  assert.equal(controle.getEstado().fase, 'aceito', 'abaixo da barreira do servidor');
  observacao.emitirMensagem(701, 'user', '🎙 fala');
  assert.equal(controle.getEstado().fase, 'confirmado');
});

test('STT que falha sobe o erro e NÃO suja a máquina de envio', async () => {
  // `falhou` com texto vazio ofereceria "reenviar"/"copiar" sobre nada.
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = controleDeVoz(fonte, relogio, async () => {
    throw new Error('postAgentVoice 502: {"detail":"stt_empty"}');
  });

  await assert.rejects(vozAte(fonte, controle, 40), /stt_empty/);
  assert.equal(controle.getEstado().fase, 'ocioso');
});

test('sonda que não responde não trava o áudio do Rica', async () => {
  const fonte = fonteFake();
  const relogio = relogioFake();
  const controle = controleDeVoz(fonte, relogio, async () => ({ transcribed: 'sem barreira' }));

  const promessa = controle.enviarVoz(new Blob(['audio']));
  await Promise.resolve();
  relogio.avancar(4_000); // o teto da sonda
  assert.equal(await promessa, 'sem barreira');
  // Entregue e sem confirmação observável — a verdade, não um "enviado" verde.
  assert.equal(controle.getEstado().fase, 'nao-confirmado');
});
