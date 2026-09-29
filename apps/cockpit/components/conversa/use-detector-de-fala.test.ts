import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';

import { criaControladorDetector, opcoesDoDetector, seguraNoDetector } from './controlador-detector.ts';
import { criaMicrofone, ganchosDoMicrofone, soltaOMicrofone } from './microfone-da-conversa.ts';
import { TEMPOS } from '../../lib/conversa/tipos.ts';
import { eventosDoDetector } from './eventos-do-detector.ts';

const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

const assenta = () => new Promise<void>((resolve) => setImmediate(resolve));
function capturaFalsa() {
  const faixa = { readyState: 'live', enabled: true, stop() { this.readyState = 'ended'; }, addEventListener() {} };
  return { getTracks: () => [faixa], getAudioTracks: () => [faixa] };
}

async function monta(pede = async () => capturaFalsa(), bloqueado = false, concluiLigacao = async () => {}) {
  const efeitos: (() => () => void)[] = [];
  const eventos: unknown[] = [];
  const falas: string[] = [];
  const ajustes: ReturnType<typeof opcoesDoDetector>[] = [];
  const bloqueadoRef = { current: bloqueado };
  const contagem = { pedidos: 0, liga: 0, pausa: 0, vigia: 0, para: 0, retoma: 0 };
  let opcoes: any;
  let vigia: any;
  const escopos = {
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => () => void) => efeitos.push(fn),
    useRef: (current: unknown) => ({ current }),
    useState: (valor: unknown) => [valor, () => {}],
    TEMPOS, criaControladorDetector, opcoesDoDetector, seguraNoDetector, eventosDoDetector, exports: {},
    criaMicrofone, ganchosDoMicrofone, soltaOMicrofone,
    criaVigiaDaEscuta: (op: unknown) => {
      vigia = op;
      return { comeca: () => { contagem.vigia += 1; }, para: () => { contagem.para += 1; }, confere() {} };
    },
    navigator: { mediaDevices: { getUserMedia: () => { contagem.pedidos += 1; return pede(); } } },
    window: { setInterval, clearInterval },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    AudioContext: class {
      state = 'running';
      addEventListener() {}
      async resume() { contagem.retoma += 1; }
      async close() {}
    },
    vadInstalado: {
      utils: { encodeWAV: () => new ArrayBuffer(0) },
      MicVAD: { new: async (op: any) => {
        opcoes = op;
        let captura: ReturnType<typeof capturaFalsa> | null = null;
        return {
          options: op, setOptions(opcoes: ReturnType<typeof opcoesDoDetector>) { ajustes.push(opcoes); },
          async start() {
            contagem.liga += 1;
            captura = captura ? await op.resumeStream(captura) : await op.getStream();
            await concluiLigacao();
          },
          async pause() {
            contagem.pausa += 1;
            op.onVADMisfire();
            if (captura) await op.pauseStream(captura);
          },
          async destroy() {},
        };
      } },
    },
  };
  const fonte = readFileSync(new URL('./use-detector-de-fala.ts', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace("const vad = await import('@ricky0123/vad-web')", 'const vad = await Promise.resolve(vadInstalado)')
    .replace('export function useDetectorDeFala', 'function useDetectorDeFala');
  const codigo = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fabrica = new Function(...Object.keys(escopos), `${codigo}; return useDetectorDeFala;`);
  const hook = fabrica(...Object.values(escopos));
  const detector = hook({
    bloqueadoRef,
    eventoRef: { current: (evento: unknown) => eventos.push(evento) },
    sessaoAtivaRef: { current: true },
    conversaRef: { current: { estado: 'ouvindo' } },
    falaRef: { current: {
      inicio: () => falas.push('inicio'), fim: () => falas.push('fim'),
      descarte: () => falas.push('descarte'), quadro: () => falas.push('quadro'),
    } },
  });
  const encerra = efeitos[0]();
  await assenta();
  return { detector, bloqueadoRef, contagem, eventos, falas, ajustes, opcoes: () => opcoes, vigia: () => vigia, encerra };
}

it('mudo não liga, reabre ou retoma contexto pela vigia', async () => {
  const c = await monta(undefined, true);
  try {
    await c.detector.liga();
    await c.vigia().reabre();
    c.vigia().retoma();
    c.vigia().desiste();
    assert.equal(c.contagem.pedidos, 0);
    assert.equal(c.contagem.liga, 0);
    assert.equal(c.contagem.vigia, 0);
    assert.equal(c.contagem.retoma, 0);
    assert.deepEqual(c.eventos, []);
  } finally { c.encerra(); }
});

it('mudo bloqueia todos os retornos de fala e quadro, inclusive os atrasados', async () => {
  const c = await monta();
  try {
    await c.detector.liga();
    c.bloqueadoRef.current = true;
    const op = c.opcoes();
    op.onSpeechStart();
    op.onSpeechRealStart();
    op.onSpeechEnd(new Float32Array([1]));
    op.onVADMisfire();
    op.onFrameProcessed({}, new Float32Array([1]));
    assert.deepEqual(c.eventos, []);
    assert.deepEqual(c.falas, []);
    assert.equal(c.detector.nivelRef.current, 0);
  } finally { c.encerra(); }
});

it('emudece descarta entrada, para vigia e captura sem emitir evento da máquina', async () => {
  const captura = capturaFalsa();
  const c = await monta(async () => captura);
  try {
    await c.detector.liga();
    c.bloqueadoRef.current = true;
    c.detector.emudece();
    await assenta();
    assert.equal(captura.getTracks()[0].readyState, 'ended');
    assert.ok(c.contagem.para > 0);
    assert.ok(c.contagem.pausa > 0);
    assert.deepEqual(c.falas, ['descarte']);
    assert.deepEqual(c.eventos, []);
    assert.equal(c.detector.nivelRef.current, 0);
    c.bloqueadoRef.current = false;
    await assenta();
    assert.equal(c.contagem.liga, 1);
  } finally { c.encerra(); }
});

it('sem mudo mantém retornos e reutiliza captura; depois do mudo só liga por comando', async () => {
  const c = await monta();
  try {
    await c.detector.liga();
    const op = c.opcoes();
    op.onSpeechStart();
    op.onSpeechRealStart();
    op.onFrameProcessed({}, new Float32Array([0.1]));
    op.onSpeechEnd(new Float32Array([0.1]));
    assert.deepEqual(c.falas, ['inicio', 'quadro', 'fim']);
    assert.equal(c.eventos.length, 3);
    c.detector.desliga();
    await assenta();
    await c.detector.liga();
    assert.equal(c.contagem.pedidos, 1);
    c.bloqueadoRef.current = true;
    c.detector.emudece();
    await assenta();
    c.bloqueadoRef.current = false;
    op.onSpeechStart();
    assert.equal(c.eventos.length, 3);
    assert.equal(c.contagem.pedidos, 1);
    await c.detector.liga();
    assert.equal(c.contagem.pedidos, 2);
    c.opcoes().onSpeechStart();
    assert.equal(c.eventos.length, 4);
  } finally { c.encerra(); }
});

it('mudo permite soltar uma vez previamente segurada para limpar o estado visual', async () => {
  const c = await monta();
  try {
    assert.equal(c.detector.segura(true), true);
    c.bloqueadoRef.current = true;
    assert.equal(c.detector.segura(false), true);
    assert.equal(c.ajustes.at(-1)!.redemptionMs, TEMPOS.silencioFimDeFala);
    assert.equal(c.detector.segura(false), false);
    assert.equal(c.detector.segura(true), false);
  } finally { c.encerra(); }
});

it('mudo não segura a vez e emudecer retira o silêncio prolongado da próxima escuta', async () => {
  const c = await monta();
  try {
    c.bloqueadoRef.current = true;
    assert.equal(c.detector.segura(true), false);
    c.bloqueadoRef.current = false;
    await c.detector.liga();
    assert.equal(c.detector.segura(true), true);
    assert.ok(c.ajustes.at(-1)!.redemptionMs > TEMPOS.silencioFimDeFala);
    c.bloqueadoRef.current = true;
    c.detector.emudece();
    assert.equal(c.ajustes.at(-1)!.redemptionMs, TEMPOS.silencioFimDeFala);
    await assenta();
    c.bloqueadoRef.current = false;
    await c.detector.liga();
    assert.equal(c.ajustes.at(-1)!.redemptionMs, TEMPOS.silencioFimDeFala);
    assert.equal(c.detector.segura(true), true);
  } finally { c.encerra(); }
});

it('ligação pendente depois da captura não reinicia vigia ao terminar emudecida', async () => {
  let conclui!: () => void;
  const captura = capturaFalsa();
  const c = await monta(async () => captura, false, () => new Promise<void>((resolve) => { conclui = resolve; }));
  try {
    const ligacao = c.detector.liga();
    await assenta();
    c.bloqueadoRef.current = true;
    c.detector.emudece();
    assert.equal(captura.getTracks()[0].readyState, 'ended');
    conclui();
    await ligacao;
    await assenta();
    assert.equal(c.contagem.vigia, 0);
    assert.ok(c.contagem.pausa > 0);
    assert.deepEqual(c.eventos, []);
  } finally { c.encerra(); }
});

it('permissão pendente ao emudecer para a faixa tardia sem religar nem falhar a máquina', async () => {
  let entrega!: (captura: ReturnType<typeof capturaFalsa>) => void;
  const c = await monta(() => new Promise((resolve) => { entrega = resolve; }));
  try {
    const ligacao = c.detector.liga();
    c.bloqueadoRef.current = true;
    c.detector.emudece();
    c.bloqueadoRef.current = false;
    const captura = capturaFalsa();
    entrega(captura);
    await ligacao;
    await assenta();
    assert.equal(captura.getTracks()[0].readyState, 'ended');
    assert.equal(c.contagem.vigia, 0);
    assert.equal(c.contagem.liga, 1);
    assert.deepEqual(c.eventos, []);
  } finally { c.encerra(); }
});
