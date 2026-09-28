import assert from 'node:assert/strict';
import { it } from 'node:test';

import { leEventoDoCanal, PACIENCIA_DO_CANAL_MS, pacienciaDaVez, textoDoCanal, transcreveFala } from './transcricao-da-fala.ts';

const escoa = () => new Promise((resolve) => setImmediate(resolve));

type Adiado<T> = { promessa: Promise<T>; resolve: (v: T) => void; rejeita: (e: unknown) => void };
function adiado<T>(): Adiado<T> {
  let resolve!: (v: T) => void;
  let rejeita!: (e: unknown) => void;
  const promessa = new Promise<T>((ok, erro) => {
    resolve = ok;
    rejeita = erro;
  });
  return { promessa, resolve, rejeita };
}

/** Canal e WAV nas mãos do teste; o relógio também (`passa(ms)` dispara o que venceu até ali). */
function simula({
  semCanal = false,
  paciencia = 1000,
  vivo = (): boolean => true,
}: { semCanal?: boolean; paciencia?: number; vivo?: () => boolean } = {}) {
  const canal = adiado<string | null>();
  const wav = adiado<string>();
  const log = { arquivos: 0, textos: [] as string[], falhas: 0, relogios: [] as number[], terminou: false };
  const relogios: Array<{ acao: () => void; ms: number; foi: boolean }> = [];
  const vencedor = transcreveFala({
    aoVivo: semCanal ? null : canal.promessa,
    paciencia,
    agenda: (acao, ms) => {
      log.relogios.push(ms);
      relogios.push({ acao, ms, foi: false });
    },
    arquivo: () => {
      log.arquivos += 1;
      return wav.promessa;
    },
    vivo,
    transcreveu: (texto) => log.textos.push(texto),
    falhou: () => { log.falhas += 1; },
  });
  const feito = vencedor.then(() => { log.terminou = true; });
  const passa = async (ate: number) => {
    for (const r of [...relogios].sort((a, b) => a.ms - b.ms)) {
      if (r.foi || r.ms > ate) continue;
      r.foi = true;
      r.acao();
    }
    await escoa();
  };
  return { canal, wav, log, feito, vencedor, passa, esgota: () => passa(Infinity) };
}

it('texto firme dentro da paciência: vai esse texto e o WAV não sobe', async () => {
  const s = simula();
  s.canal.resolve(' Oi, Canário. ');
  assert.equal(await s.vencedor, 'canal');
  await s.esgota();
  assert.deepEqual(s.log.textos, ['Oi, Canário.']);
  assert.equal(s.log.arquivos, 0, 'nem depois da paciência');
  assert.deepEqual(s.log.relogios, [1000, 1000], 'WAV e janela do canal, os dois em 1 s');
});

it('canal fora de jogo (bilhete negado, canal caiu): o WAV sobe na hora, sem esperar a paciência', async () => {
  const s = simula({ semCanal: true });
  assert.equal(s.log.arquivos, 1);
  s.wav.resolve('pelo arquivo');
  assert.equal(await s.vencedor, 'wav');
  assert.deepEqual(s.log.textos, ['pelo arquivo']);
});

it('canal que desiste sem texto (vazio, falhou, lançou) sobe o WAV na hora', async () => {
  for (const desiste of [(c: Adiado<string | null>) => c.resolve(null), (c: Adiado<string | null>) => c.resolve('  '), (c: Adiado<string | null>) => c.rejeita(new Error('ws'))]) {
    const s = simula();
    desiste(s.canal);
    await escoa();
    assert.equal(s.log.arquivos, 1, 'sem esperar a paciência');
    s.wav.resolve('pelo arquivo');
    await s.feito;
    assert.deepEqual(s.log.textos, ['pelo arquivo']);
  }
});

it('texto firme atrasado: passada a paciência o WAV sobe e decide, mesmo que o canal chegue antes dele', async () => {
  // No dia em que o canal atrasou, o texto dele também veio cortado ("Agora responda", 28/09).
  const s = simula();
  await escoa();
  assert.equal(s.log.arquivos, 0, 'dentro da paciência, só o canal');
  await s.esgota();
  assert.equal(s.log.arquivos, 1, 'passou a paciência: o WAV sobe');
  s.canal.resolve('Agora responda');
  await escoa();
  assert.equal(s.log.terminou, false, 'o canal atrasado não decide');
  s.wav.resolve('Agora responda só com a palavra dois.');
  assert.equal(await s.vencedor, 'wav');
  assert.deepEqual(s.log.textos, ['Agora responda só com a palavra dois.']);
});

it('texto firme atrasado: o WAV que chega antes decide, e o canal que vier depois é ignorado', async () => {
  const s = simula();
  await s.esgota();
  s.wav.resolve('pelo arquivo');
  await s.feito;
  s.canal.resolve('pelo canal');
  await escoa();
  assert.deepEqual(s.log.textos, ['pelo arquivo']);
});

it('WAV vazio: o canal atrasado vale como último recurso', async () => {
  const s = simula();
  await s.esgota();
  s.wav.resolve('');
  await escoa();
  assert.equal(s.log.terminou, false, 'ainda espera o canal');
  s.canal.resolve('pelo canal');
  assert.equal(await s.vencedor, 'canalAtrasado');
  assert.deepEqual(s.log.textos, ['pelo canal']);
});

it('os dois sem texto: o vazio vai para a máquina, que volta a ouvir como hoje', async () => {
  const s = simula();
  await s.esgota();
  s.wav.resolve('');
  s.canal.resolve(null);
  assert.equal(await s.vencedor, null);
  assert.deepEqual(s.log.textos, ['']);
  assert.equal(s.log.falhas, 0);
});

it('WAV que falha ainda espera o canal; os dois falhando é a falha de transcrição de sempre', async () => {
  const salvo = simula();
  await salvo.esgota();
  salvo.wav.rejeita(new Error('502'));
  await escoa();
  salvo.canal.resolve('pelo canal');
  assert.equal(await salvo.vencedor, 'canalAtrasado');
  assert.deepEqual([salvo.log.textos, salvo.log.falhas], [['pelo canal'], 0]);

  const perdido = simula({ semCanal: true });
  perdido.wav.rejeita(new Error('502'));
  await perdido.feito;
  assert.deepEqual([perdido.log.textos, perdido.log.falhas], [[], 1]);
});

it('dia ruim (paciência 0): o WAV sobe junto, e o canal dentro da janela de 1 s ainda ganha', async () => {
  const s = simula({ paciencia: 0 });
  await s.passa(0);
  assert.equal(s.log.arquivos, 1, 'WAV junto com a confirmação');
  s.canal.resolve('pelo canal');
  assert.equal(await s.vencedor, 'canal', 'o canal voltou: a próxima fala tem paciência de novo');
  s.wav.resolve('pelo arquivo');
  await escoa();
  assert.deepEqual(s.log.textos, ['pelo canal']);
});

it('dia ruim: o canal que passa da janela de 1 s não ganha do WAV', async () => {
  const s = simula({ paciencia: 0 });
  await s.passa(1000);
  s.canal.resolve('pelo canal');
  await escoa();
  assert.equal(s.log.terminou, false);
  s.wav.resolve('pelo arquivo');
  assert.equal(await s.vencedor, 'wav');
  assert.deepEqual(s.log.textos, ['pelo arquivo']);
});

it('quem parou no meio não recebe texto nem falha, e o WAV não sobe depois disso', async () => {
  let vivo = true;
  const s = simula({ vivo: () => vivo });
  vivo = false;
  await s.esgota();
  s.canal.resolve('pelo canal');
  assert.equal(await s.vencedor, null);
  assert.deepEqual([s.log.arquivos, s.log.textos, s.log.falhas], [0, [], 0]);
});

it('quem ganhou: canal, WAV, ou ninguém (vazio, falha)', async () => {
  const vazio = simula({ semCanal: true });
  vazio.wav.resolve('');
  assert.equal(await vazio.vencedor, null);

  const falha = simula({ semCanal: true });
  falha.wav.rejeita(new Error('502'));
  assert.equal(await falha.vencedor, null);
});

it('paciência da vez: depois de uma fala que o canal não deu a tempo, os dois correm juntos desde o começo', () => {
  assert.equal(pacienciaDaVez('canal'), PACIENCIA_DO_CANAL_MS);
  assert.equal(pacienciaDaVez('wav'), 0);
  assert.equal(pacienciaDaVez('canalAtrasado'), 0);
  assert.equal(pacienciaDaVez(null), PACIENCIA_DO_CANAL_MS, 'primeira fala: confia no canal');
});

it('a paciência padrão fica acima do texto firme medido em dia bom (471–777 ms)', () => {
  assert.equal(PACIENCIA_DO_CANAL_MS, 1000);
});

it('textoDoCanal: só texto com letra vale; o resto é "não veio"', () => {
  assert.equal(textoDoCanal(null), null);
  assert.equal(textoDoCanal(''), null);
  assert.equal(textoDoCanal(' \n '), null);
  assert.equal(textoDoCanal(' oi '), 'oi');
});

it('leEventoDoCanal: confirmação, texto firme e falha chegam com o item da fala', () => {
  const le = (evento: object) => leEventoDoCanal(JSON.stringify(evento));
  assert.deepEqual(le({ type: 'input_audio_buffer.committed', item_id: 'item_1', previous_item_id: null }), {
    tipo: 'confirmou',
    item: 'item_1',
  });
  assert.deepEqual(
    le({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: 'Oi.' }),
    { tipo: 'firme', item: 'item_1', texto: 'Oi.' },
  );
  assert.deepEqual(le({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'item_1', error: {} }), {
    tipo: 'falhou',
    item: 'item_1',
  });
  assert.deepEqual(le({ type: 'error', error: { message: 'buffer too small' } }), { tipo: 'falhou', item: null });
});

it('leEventoDoCanal: o parcial chega com o item; sem item ou sem texto, não serve', () => {
  const le = (evento: object) => leEventoDoCanal(JSON.stringify(evento));
  const delta = 'conversation.item.input_audio_transcription.delta';
  assert.deepEqual(le({ type: delta, item_id: 'i', delta: ' Can' }), { tipo: 'parcial', item: 'i', texto: ' Can' });
  assert.deepEqual(le({ type: delta, delta: 'O' }), { tipo: 'ignorar' });
  assert.deepEqual(le({ type: delta, item_id: 'i' }), { tipo: 'ignorar' });
});

it('leEventoDoCanal: ruído do protocolo e lixo são ignorados sem lançar', () => {
  const le = (bruto: string) => leEventoDoCanal(bruto);
  assert.deepEqual(le(JSON.stringify({ type: 'session.created' })), { tipo: 'ignorar' });
  assert.deepEqual(le(JSON.stringify({ type: 'input_audio_buffer.cleared' })), { tipo: 'ignorar' });
  assert.deepEqual(le('não é json'), { tipo: 'ignorar' });
  assert.deepEqual(le('null'), { tipo: 'ignorar' });
  assert.deepEqual(le(JSON.stringify({ type: 'input_audio_buffer.committed' })), { tipo: 'ignorar' }, 'confirmação sem item não serve');
});
