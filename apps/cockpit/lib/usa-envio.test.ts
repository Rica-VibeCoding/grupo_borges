import assert from 'node:assert/strict';
import { test } from 'node:test';

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

test('erro do POST alimenta falhou e não abre o stream', async () => {
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
  assert.equal(estado.fase, 'falhou');
  if (estado.fase === 'falhou') {
    assert.strictEqual(estado.erro, erro);
    assert.equal(estado.entregaIncerta, true);
  }
  assert.equal(fonte.instancias.length, 0);
});

test('timer externo ao redutor transforma aceito em pendurado no prazo', async () => {
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
  assert.equal(controle.getEstado().fase, 'pendurado');
});

test('reenviar só atua em pendurado e preserva a proteção de texto idêntico', async () => {
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
