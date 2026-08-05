import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ErroAnexo, type RespostaAnexo } from './anexo.ts';
import { PRAZO_SUCESSO_MS, createControleAnexo } from './usa-anexo.ts';

type CallbackTimer = () => void;

function relogioFake() {
  let agora = 0;
  let proximoId = 0;
  const timers = new Map<number, { callback: CallbackTimer; quando: number }>();
  return {
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
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.quando <= agora) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function arquivo(nome = 'a.png'): File {
  return new File([new Uint8Array(8)], nome, { type: 'image/png' });
}

function respostaOk(kind: RespostaAnexo['kind'] = 'image'): RespostaAnexo {
  return {
    path: `/uploads/agents/a/${kind}`,
    kind,
    filename: 'a.png',
    size: 8,
    tmux_delivered: true,
    duration_ms: 5,
  };
}

// ---- gaveta --------------------------------------------------------------

test('a gaveta nasce fechada e alterna', () => {
  const controle = createControleAnexo('a', { subir: async () => respostaOk() });
  assert.equal(controle.getEstado().gaveta, false);
  controle.alternarGaveta();
  assert.equal(controle.getEstado().gaveta, true);
  controle.alternarGaveta();
  assert.equal(controle.getEstado().gaveta, false);
});

test('fecharGaveta é idempotente e não avisa à toa', () => {
  const controle = createControleAnexo('a', { subir: async () => respostaOk() });
  let avisos = 0;
  controle.subscribe(() => (avisos += 1));
  controle.fecharGaveta();
  assert.equal(avisos, 0);
  controle.alternarGaveta();
  controle.fecharGaveta();
  assert.equal(controle.getEstado().gaveta, false);
  assert.equal(avisos, 2);
});

test('abrir a gaveta apaga o erro que já foi lido', async () => {
  const controle = createControleAnexo('a', {
    subir: async () => {
      throw new ErroAnexo('mime não suportado');
    },
  });
  await controle.enviar(arquivo(), '');
  assert.equal(controle.getEstado().fase, 'erro');
  controle.alternarGaveta();
  assert.equal(controle.getEstado().fase, 'ocioso');
  assert.equal(controle.getEstado().gaveta, true);
});

test('a gaveta não reabre no meio de um envio', async () => {
  let soltar!: (r: RespostaAnexo) => void;
  const controle = createControleAnexo('a', {
    subir: () => new Promise<RespostaAnexo>((resolve) => (soltar = resolve)),
  });
  const emVoo = controle.enviar(arquivo(), '');
  controle.alternarGaveta();
  assert.equal(controle.getEstado().gaveta, false);
  soltar(respostaOk());
  await emVoo;
});

// ---- retenção ------------------------------------------------------------

/** A espinha da retenção: escolher NÃO sobe. O upload passou a ser o toque de
 *  enviar, que é quando a legenda já existe. */
test('escolher retém o arquivo e não sobe nada', () => {
  let subidas = 0;
  const controle = createControleAnexo('a', {
    subir: async () => {
      subidas += 1;
      return respostaOk();
    },
  });
  const escolhido = arquivo('foto.png');
  controle.escolher(escolhido);

  const estado = controle.getEstado();
  assert.equal(estado.fase, 'escolhido');
  assert.equal(subidas, 0, 'escolher subiu o arquivo — a legenda nem foi escrita ainda');
  // O arquivo INTEIRO fica retido: a miniatura precisa dele para o preview e o
  // despacho para o upload, e o input já foi zerado.
  assert.equal(estado.fase === 'escolhido' && estado.arquivo, escolhido);
  assert.equal(estado.fase === 'escolhido' && estado.especie, 'image');
});

/** Sem isto o Rica anexa o vídeo de 60 MB, escreve a legenda e só então leva o
 *  não — a viagem inteira para descobrir o que dava para saber no primeiro
 *  instante. */
test('escolher valida na hora e recusa sem tocar na rede', () => {
  let subidas = 0;
  const controle = createControleAnexo('a', {
    subir: async () => {
      subidas += 1;
      return respostaOk();
    },
  });
  controle.escolher(new File([new Uint8Array(8)], 'instalador.exe', { type: '' }));

  const estado = controle.getEstado();
  assert.equal(estado.fase, 'erro');
  assert.equal(subidas, 0);
  assert.match(
    estado.fase === 'erro' ? estado.motivo : '',
    /\.exe/,
    'a recusa tem de dizer O QUE foi recusado, não um "falhou" genérico',
  );
});

test('escolher fecha a gaveta nos dois desfechos', () => {
  const controle = createControleAnexo('a', { subir: async () => respostaOk() });
  controle.alternarGaveta();
  controle.escolher(arquivo());
  assert.equal(controle.getEstado().gaveta, false);

  controle.alternarGaveta();
  controle.escolher(new File([new Uint8Array(8)], 'x.exe', { type: '' }));
  assert.equal(controle.getEstado().gaveta, false, 'a gaveta ficou aberta por cima do erro');
});

test('escolher não atropela um arquivo em voo', async () => {
  let soltar!: (r: RespostaAnexo) => void;
  const controle = createControleAnexo('a', {
    subir: () => new Promise<RespostaAnexo>((resolve) => (soltar = resolve)),
  });
  const emVoo = controle.enviar(arquivo(), '');
  controle.escolher(arquivo('outra.png'));
  assert.equal(controle.getEstado().fase, 'enviando');
  soltar(respostaOk());
  await emVoo;
});

/** Um arquivo por vez: escolher de novo troca o retido, não empilha. */
test('escolher de novo substitui o anexo retido', () => {
  const controle = createControleAnexo('a', { subir: async () => respostaOk() });
  controle.escolher(arquivo('primeira.png'));
  const segunda = arquivo('segunda.png');
  controle.escolher(segunda);
  const estado = controle.getEstado();
  assert.equal(estado.fase === 'escolhido' && estado.arquivo, segunda);
});

/** Retenção sem saída seria um beco: escolheu a foto errada, e daí? */
test('limpar solta o anexo retido', () => {
  const controle = createControleAnexo('a', { subir: async () => respostaOk() });
  controle.escolher(arquivo());
  controle.limpar();
  assert.equal(controle.getEstado().fase, 'ocioso');
});

test('descartado não retém mais nada', () => {
  const controle = createControleAnexo('a', { subir: async () => respostaOk() });
  controle.dispose();
  controle.escolher(arquivo());
  assert.equal(controle.getEstado().fase, 'ocioso');
});

// ---- envio ---------------------------------------------------------------

test('o envio percorre enviando → sucesso e fecha a gaveta', async () => {
  const relogio = relogioFake();
  const controle = createControleAnexo('a', {
    subir: async () => respostaOk('video'),
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });
  controle.alternarGaveta();
  const fases: string[] = [];
  controle.subscribe(() => fases.push(controle.getEstado().fase));

  const ok = await controle.enviar(arquivo('clipe.mp4'), 'olha isto');
  assert.equal(ok, true);
  assert.deepEqual(fases, ['enviando', 'sucesso']);
  assert.equal(controle.getEstado().gaveta, false);
});

test('o sucesso some sozinho — confirmação não mora na tela', async () => {
  const relogio = relogioFake();
  const controle = createControleAnexo('a', {
    subir: async () => respostaOk(),
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });
  await controle.enviar(arquivo(), '');
  assert.equal(controle.getEstado().fase, 'sucesso');
  relogio.avancar(PRAZO_SUCESSO_MS - 1);
  assert.equal(controle.getEstado().fase, 'sucesso');
  relogio.avancar(2);
  assert.equal(controle.getEstado().fase, 'ocioso');
});

test('duplo toque não manda o arquivo duas vezes', async () => {
  let chamadas = 0;
  let soltar!: (r: RespostaAnexo) => void;
  const controle = createControleAnexo('a', {
    subir: () => {
      chamadas += 1;
      return new Promise<RespostaAnexo>((resolve) => (soltar = resolve));
    },
  });
  const primeiro = controle.enviar(arquivo(), '');
  const segundo = await controle.enviar(arquivo(), '');
  assert.equal(segundo, false);
  assert.equal(chamadas, 1);
  soltar(respostaOk());
  await primeiro;
});

test('a frase do backend chega inteira ao estado de erro', async () => {
  const controle = createControleAnexo('a', {
    subir: async () => {
      throw new ErroAnexo('imagem maior que 10MB', 422);
    },
  });
  const ok = await controle.enviar(arquivo('grande.png'), 'legenda');
  assert.equal(ok, false);
  const estado = controle.getEstado();
  assert.equal(estado.fase, 'erro');
  assert.equal(estado.fase === 'erro' && estado.motivo, 'imagem maior que 10MB');
  assert.equal(estado.fase === 'erro' && estado.nome, 'grande.png');
});

test('erro sem ErroAnexo ainda diz alguma coisa — nunca um "falhou" mudo', async () => {
  const controle = createControleAnexo('a', {
    subir: async () => {
      throw new Error('boom interno');
    },
  });
  await controle.enviar(arquivo(), '');
  const estado = controle.getEstado();
  assert.equal(estado.fase === 'erro' && estado.motivo, 'boom interno');
});

test('erro sem mensagem nenhuma ganha frase padrão', async () => {
  const controle = createControleAnexo('a', {
    subir: async () => {
      throw new Error('');
    },
  });
  await controle.enviar(arquivo(), '');
  const estado = controle.getEstado();
  assert.equal(estado.fase === 'erro' && estado.motivo, 'Não foi possível enviar o arquivo.');
});

test('depois de erro dá para tentar de novo', async () => {
  let falhar = true;
  const relogio = relogioFake();
  const controle = createControleAnexo('a', {
    subir: async () => {
      if (falhar) throw new ErroAnexo('recusado');
      return respostaOk();
    },
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });
  await controle.enviar(arquivo(), '');
  falhar = false;
  assert.equal(await controle.enviar(arquivo(), ''), true);
  assert.equal(controle.getEstado().fase, 'sucesso');
});

test('a legenda digitada chega ao upload', async () => {
  let vista = '';
  const controle = createControleAnexo('minha-agente', {
    subir: async (_slug, _arquivo, caption) => {
      vista = caption;
      return respostaOk();
    },
  });
  await controle.enviar(arquivo(), 'compara com o print anterior');
  assert.equal(vista, 'compara com o print anterior');
});

test('o slug do controle é o que vai pro upload', async () => {
  let vista = '';
  const controle = createControleAnexo('minha-agente', {
    subir: async (slug) => {
      vista = slug;
      return respostaOk();
    },
  });
  await controle.enviar(arquivo(), '');
  assert.equal(vista, 'minha-agente');
});

test('descartado não publica mais nada nem dispara timer órfão', async () => {
  const relogio = relogioFake();
  const controle = createControleAnexo('a', {
    subir: async () => respostaOk(),
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
  });
  await controle.enviar(arquivo(), '');
  controle.dispose();
  relogio.avancar(PRAZO_SUCESSO_MS * 2);
  assert.equal(controle.getEstado().fase, 'sucesso');
  assert.equal(await controle.enviar(arquivo(), ''), false);
});
