import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACCEPT_POR_ESPECIE,
  ErroAnexo,
  ITENS_DA_GAVETA,
  REGRAS,
  classificaAnexo,
  detalheDoErro,
  enviaAnexo,
  formataTamanho,
  validaAnexo,
} from './anexo.ts';

function arquivo(name: string, type: string, size: number) {
  return { name, type, size };
}

function respostaFake(
  status: number,
  corpo: unknown,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

// ---- classificação -------------------------------------------------------

test('classifica pelas três espécies do contrato', () => {
  assert.equal(classificaAnexo(arquivo('a.jpg', 'image/jpeg', 10))?.especie, 'image');
  assert.equal(classificaAnexo(arquivo('a.mov', 'video/quicktime', 10))?.especie, 'video');
  assert.equal(classificaAnexo(arquivo('a.pdf', 'application/pdf', 10))?.especie, 'document');
});

test('mime com charset ainda classifica', () => {
  assert.equal(classificaAnexo(arquivo('n.csv', 'text/csv; charset=utf-8', 10))?.especie, 'document');
});

test('extensão salva o arquivo quando o sistema não dá mime', () => {
  // O caso real: `.md` no Windows chega com `type` vazio.
  assert.equal(classificaAnexo(arquivo('briefing.md', '', 10))?.especie, 'document');
  assert.equal(classificaAnexo(arquivo('dados.json', '', 10))?.especie, 'document');
});

test('mime desconhecido com extensão conhecida ainda passa', () => {
  assert.equal(
    classificaAnexo(arquivo('planilha.xlsx', 'application/octet-stream', 10))?.especie,
    'document',
  );
});

test('tipo fora do contrato não classifica', () => {
  assert.equal(classificaAnexo(arquivo('foto.heic', 'image/heic', 10)), null);
  assert.equal(classificaAnexo(arquivo('pacote.zip', 'application/zip', 10)), null);
  assert.equal(classificaAnexo(arquivo('semextensao', '', 10)), null);
});

// ---- validação -----------------------------------------------------------

test('aceita dentro do teto de cada espécie', () => {
  assert.deepEqual(validaAnexo(arquivo('a.png', 'image/png', 10 * 1024 * 1024)), {
    ok: true,
    especie: 'image',
  });
  assert.deepEqual(validaAnexo(arquivo('a.mp4', 'video/mp4', 50 * 1024 * 1024)), {
    ok: true,
    especie: 'video',
  });
  assert.deepEqual(validaAnexo(arquivo('a.pdf', 'application/pdf', 25 * 1024 * 1024)), {
    ok: true,
    especie: 'document',
  });
});

test('recusa por TAMANHO dizendo o número e o teto', () => {
  const veredito = validaAnexo(arquivo('a.png', 'image/png', 12 * 1024 * 1024));
  assert.equal(veredito.ok, false);
  assert.match(veredito.ok === false ? veredito.motivo : '', /12,0 MB/);
  assert.match(veredito.ok === false ? veredito.motivo : '', /10 MB/);
});

test('recusa por TIPO dizendo o que veio e o que vale', () => {
  const veredito = validaAnexo(arquivo('foto.heic', 'image/heic', 100));
  assert.equal(veredito.ok, false);
  assert.match(veredito.ok === false ? veredito.motivo : '', /\.heic/);
  assert.match(veredito.ok === false ? veredito.motivo : '', /jpg, png, webp/);
});

test('tipo e tamanho dão mensagens distinguíveis', () => {
  const porTipo = validaAnexo(arquivo('a.zip', 'application/zip', 100));
  const porTamanho = validaAnexo(arquivo('a.png', 'image/png', 99 * 1024 * 1024));
  assert.equal(porTipo.ok, false);
  assert.equal(porTamanho.ok, false);
  assert.notEqual(
    porTipo.ok === false ? porTipo.motivo : '',
    porTamanho.ok === false ? porTamanho.motivo : '',
  );
});

test('arquivo vazio não sobe', () => {
  assert.equal(validaAnexo(arquivo('a.png', 'image/png', 0)).ok, false);
});

test('a gaveta tem exatamente os três itens da ordem, nesta ordem', () => {
  assert.deepEqual(
    ITENS_DA_GAVETA.map((item) => item.especie),
    ['image', 'video', 'document'],
  );
  assert.deepEqual(
    ITENS_DA_GAVETA.map((item) => item.rotulo),
    ['Foto', 'Vídeo', 'Documento'],
  );
});

test('cada item restringe o picker ao seu tipo', () => {
  // `image/*` é o que faz o iOS oferecer a câmera — não trocar por `image/jpeg`.
  assert.equal(ACCEPT_POR_ESPECIE.image, 'image/*');
  assert.equal(ACCEPT_POR_ESPECIE.video, 'video/*');
  assert.doesNotMatch(ACCEPT_POR_ESPECIE.document, /image|video/);
  assert.match(ACCEPT_POR_ESPECIE.document, /application\/pdf/);
  // Por extensão também: `.md` e `.csv` chegam sem mime no Windows e sumiriam
  // do picker se o accept fosse só de mime.
  assert.match(ACCEPT_POR_ESPECIE.document, /\.md/);
});

test('todo item da gaveta anuncia o teto da sua espécie', () => {
  assert.match(ITENS_DA_GAVETA[0]!.descricao, /10 MB/);
  assert.match(ITENS_DA_GAVETA[1]!.descricao, /50 MB/);
  assert.match(ITENS_DA_GAVETA[2]!.descricao, /25 MB/);
});

// O bug de 04/08 não foi um número errado — foi DOIS números discordando. O
// backend prometia 100MB, o proxy do Next cortava em 10MB, e a tela anunciava o
// número do backend. Este teste amarra a ponta que este pacote controla no
// número que o proxy realmente aceita: se alguém subir o teto do vídeo sem
// subir o do proxy, a promessa volta a ser maior que o transporte.
test('o teto do vídeo cabe no que o proxy do Next aceita', async () => {
  const { default: config } = await import('../next.config.ts');
  const limite = config.experimental?.proxyClientMaxBodySize;
  assert.equal(typeof limite, 'string', 'o proxy precisa de limite explícito — o default é 10MB');
  const limiteBytes = Number(String(limite).replace(/mb$/i, '')) * 1024 * 1024;
  const tetoVideo = REGRAS.find((regra) => regra.especie === 'video')!.tetoBytes;
  assert.ok(
    tetoVideo < limiteBytes,
    `vídeo de ${tetoVideo} não cabe no proxy de ${limiteBytes}`,
  );
  // A folga existe pro overhead do multipart (bordas + legenda), não é enfeite.
  assert.ok(limiteBytes - tetoVideo >= 5 * 1024 * 1024, 'folga pro multipart curta demais');
});

test('formataTamanho fala português', () => {
  assert.equal(formataTamanho(512), '512 B');
  assert.equal(formataTamanho(2048), '2 KB');
  assert.equal(formataTamanho(3.5 * 1024 * 1024), '3,5 MB');
});

// ---- detalhe do erro -----------------------------------------------------

test('detalhe string do FastAPI vira a frase', () => {
  assert.equal(detalheDoErro({ detail: 'mime não suportado' }, 'x'), 'mime não suportado');
});

test('detalhe em lista do Pydantic vira frase', () => {
  assert.equal(
    detalheDoErro({ detail: [{ msg: 'campo obrigatório' }, { msg: 'valor inválido' }] }, 'x'),
    'campo obrigatório; valor inválido',
  );
});

test('corpo sem detalhe cai na alternativa', () => {
  assert.equal(detalheDoErro(null, 'alternativa'), 'alternativa');
  assert.equal(detalheDoErro({}, 'alternativa'), 'alternativa');
  assert.equal(detalheDoErro({ detail: '  ' }, 'alternativa'), 'alternativa');
});

// ---- envio ---------------------------------------------------------------

function arquivoReal(nome: string, tipo: string, bytes = 8): File {
  return new File([new Uint8Array(bytes)], nome, { type: tipo });
}

test('monta o multipart do contrato e chama a rota /file', async () => {
  let url = '';
  let corpo: FormData | null = null;
  const resposta = await enviaAnexo('minha-agente', arquivoReal('a.png', 'image/png'), '  olha isto  ', {
    fetch: (async (entrada: string, init: RequestInit) => {
      url = entrada;
      corpo = init.body as FormData;
      return respostaFake(200, {
        path: '/uploads/agents/minha-agente/a.png',
        kind: 'image',
        filename: 'a.png',
        size: 8,
        tmux_delivered: true,
        duration_ms: 12,
      });
    }) as unknown as typeof globalThis.fetch,
  });

  assert.equal(url, '/api/agents/minha-agente/file');
  assert.ok(corpo);
  assert.equal((corpo as FormData).get('caption'), 'olha isto');
  assert.ok((corpo as FormData).get('file') instanceof File);
  assert.equal(resposta.kind, 'image');
});

test('sem texto digitado não manda caption', async () => {
  let corpo: FormData | null = null;
  await enviaAnexo('a', arquivoReal('a.png', 'image/png'), '   ', {
    fetch: (async (_url: string, init: RequestInit) => {
      corpo = init.body as FormData;
      return respostaFake(200, { kind: 'image', tmux_delivered: true });
    }) as unknown as typeof globalThis.fetch,
  });
  assert.equal((corpo as unknown as FormData).has('caption'), false);
});

test('slug com caractere especial é escapado na URL', async () => {
  let url = '';
  await enviaAnexo('a b/c', arquivoReal('a.png', 'image/png'), '', {
    fetch: (async (entrada: string) => {
      url = entrada;
      return respostaFake(200, { kind: 'image', tmux_delivered: true });
    }) as unknown as typeof globalThis.fetch,
  });
  assert.equal(url, '/api/agents/a%20b%2Fc/file');
});

test('não sobe byte nenhum quando o cliente já sabe que não passa', async () => {
  let chamou = false;
  await assert.rejects(
    enviaAnexo('a', arquivoReal('grande.png', 'image/png', 11 * 1024 * 1024), '', {
      fetch: (async () => {
        chamou = true;
        return respostaFake(200, {});
      }) as unknown as typeof globalThis.fetch,
    }),
    (erro: unknown) => erro instanceof ErroAnexo && /10 MB/.test((erro as Error).message),
  );
  assert.equal(chamou, false);
});

test('422 do backend chega à tela com o texto do detail', async () => {
  await assert.rejects(
    enviaAnexo('a', arquivoReal('a.png', 'image/png'), '', {
      fetch: (async () =>
        respostaFake(422, { detail: 'conteúdo não bate com o mime' })) as unknown as typeof globalThis.fetch,
    }),
    (erro: unknown) =>
      erro instanceof ErroAnexo &&
      erro.status === 422 &&
      erro.message === 'conteúdo não bate com o mime',
  );
});

test('404 e 409 têm recado próprio quando o backend não manda detail', async () => {
  for (const [status, marca] of [[404, /não existe/], [409, /sessão/]] as const) {
    await assert.rejects(
      enviaAnexo('a', arquivoReal('a.png', 'image/png'), '', {
        fetch: (async () => respostaFake(status, null)) as unknown as typeof globalThis.fetch,
      }),
      (erro: unknown) => erro instanceof ErroAnexo && marca.test((erro as Error).message),
    );
  }
});

// `false` do backend é "não consegui provar", não "não entregou" — pane em turno
// ativo nunca mostra a prova que o `send_message` espera, e o texto entra na fila
// do CC do mesmo jeito. Então a frase não pode cantar sucesso NEM afirmar que o
// agente ficou sem o arquivo: ela fica na incerteza e desaconselha o reenvio,
// que é o único jeito de o Rica duplicar a entrega.
test('200 com tmux_delivered falso não é sucesso, mas também não afirma que não chegou', async () => {
  await assert.rejects(
    enviaAnexo('a', arquivoReal('a.png', 'image/png'), '', {
      fetch: (async () =>
        respostaFake(200, { kind: 'image', tmux_delivered: false })) as unknown as typeof globalThis.fetch,
    }),
    (erro: unknown) => {
      if (!(erro instanceof ErroAnexo)) return false;
      const frase = (erro as Error).message;
      return (
        /não deu para confirmar/.test(frase) &&
        /[Nn]ão reenvie/.test(frase) &&
        !/não recebeu|não chegou/.test(frase)
      );
    },
  );
});

test('rede caindo no meio não afirma que o arquivo não chegou', async () => {
  await assert.rejects(
    enviaAnexo('a', arquivoReal('a.png', 'image/png'), '', {
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof globalThis.fetch,
    }),
    (erro: unknown) => erro instanceof ErroAnexo && /confira no agente/.test((erro as Error).message),
  );
});
