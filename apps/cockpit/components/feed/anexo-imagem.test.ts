import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { juntaMetadesDoAnexo, leAnexoImagem, urlDoAnexoImagem } from './anexo-imagem.ts';

const CAMINHO = '/home/clawd/repos/grupo_borges/apps/api/uploads/agents/canarinho/1786819169359-c0919295ee39.jpg';

describe('imagem enviada pelo cockpit — envelope para apresentação', () => {
  it('extrai o nome gravado e preserva a legenda inteira', () => {
    assert.deepEqual(
      leAnexoImagem(
        'Imagem enviada via cockpit:\n' +
          '/home/clawd/repos/grupo_borges/apps/api/uploads/agents/tara/1785888000000-a1b2c3d4e5f6.jpg\n' +
          'Caption: compare esta foto\ncom a planta do térreo',
      ),
      {
        filename: '1785888000000-a1b2c3d4e5f6.jpg',
        legenda: 'compare esta foto\ncom a planta do térreo',
      },
    );
  });

  it('aceita imagem sem legenda, inclusive CRLF', () => {
    assert.deepEqual(
      leAnexoImagem(
        'Imagem enviada via cockpit:\r\n' +
          '/srv/apps/api/uploads/agents/tara/1785888000000-a1b2c3d4e5f6.webp',
      ),
      { filename: '1785888000000-a1b2c3d4e5f6.webp', legenda: null },
    );
  });

  // 08/08: o CC passou a anexar a imagem sozinho e o envelope chega picado em
  // duas mensagens. Sem estes casos o feed devolve o envelope cru como balão e
  // a foto não aparece em lugar nenhum.
  it('lê a legenda depois de o CC comer a linha que cita a imagem', () => {
    assert.deepEqual(
      leAnexoImagem('[Image #2]Imagem enviada via cockpit:\nCaption: teste, apenas ok'),
      { filename: null, legenda: 'teste, apenas ok' },
    );
  });

  it('lê a legenda quando nem o cabeçalho sobrou', () => {
    assert.deepEqual(leAnexoImagem('[Image #4]Caption: prova final do cartao'), {
      filename: null,
      legenda: 'prova final do cartao',
    });
  });

  it('acha a foto na linha de origem que o CC grava depois da mensagem', () => {
    assert.deepEqual(
      leAnexoImagem(
        '[Image: source: /home/clawd/repos/grupo_borges/apps/api/uploads/agents/daniel/1786236851587-9f17120b8449.png]',
      ),
      { filename: '1786236851587-9f17120b8449.png', legenda: null },
    );
  });

  it('não tem o que desenhar quando a origem está fora de uploads', () => {
    assert.deepEqual(leAnexoImagem('[Image: source: /tmp/print-do-rica.png]'), {
      filename: null,
      legenda: null,
    });
  });

  // Auditoria de 09/08: a âncora do caminho não exigia a linha inteira, então
  // uma fala que TERMINAVA num caminho de upload virava cartão de foto e o
  // texto do Rica sumia da tela.
  it('fala que termina num caminho de upload continua sendo fala', () => {
    assert.equal(
      leAnexoImagem(
        'olha este arquivo /home/clawd/repos/grupo_borges/apps/api/uploads/agents/daniel/1786236851587-9f17120b8449.png',
      ),
      null,
    );
    assert.equal(
      leAnexoImagem('achei em uploads/agents/daniel/1786236851587-9f17120b8449.png'),
      null,
    );
  });

  // Ramo descoberto pela mesma auditoria: com o prefixo do CC, o que sobra é
  // legenda mesmo sem `Caption:` — é assim que o `[Image #N]` some da tela.
  it('texto depois do prefixo do CC vira legenda mesmo sem Caption:', () => {
    assert.deepEqual(leAnexoImagem('[Image #1]e isto aqui, o que é?'), {
      filename: null,
      legenda: 'e isto aqui, o que é?',
    });
  });

  it('o caminho sozinho na linha continua valendo, com e sem barra inicial', () => {
    assert.deepEqual(
      leAnexoImagem(
        'Imagem enviada via cockpit:\nuploads/agents/tara/1785888000000-a1b2c3d4e5f6.jpg',
      ),
      { filename: '1785888000000-a1b2c3d4e5f6.jpg', legenda: null },
    );
  });

  it('não engole texto comum nem envelope de outro tipo', () => {
    assert.equal(leAnexoImagem('texto comum do Rica'), null);
    assert.equal(leAnexoImagem('olha o [Image: source: /tmp/a.png] aí'), null);
    assert.equal(
      leAnexoImagem('Imagem enviada via cockpit: isto é só uma citação'),
      null,
    );
    assert.equal(
      leAnexoImagem(
        'Imagem enviada via cockpit:\n' +
          '/srv/apps/api/uploads/agents/tara/1785888000000-a1b2c3d4e5f6.pdf',
      ),
      null,
    );
  });

  it('monta somente a porta fechada da API e escapa os dois segmentos', () => {
    assert.equal(
      urlDoAnexoImagem('tara teste/um', 'foto final.jpg'),
      '/api/agents/tara%20teste%2Fum/file/foto%20final.jpg',
    );
  });

  // Imagem da Tara (Codex): chega como data-URL já pronta — não passou pelo
  // disco de uploads, então não há caminho relativo pra reconhecer.
  it('reconhece a URL embutida (data-URL) como a imagem inteira', () => {
    assert.deepEqual(leAnexoImagem('data:image/png;base64,iVBORw0KGgo='), {
      filename: 'data:image/png;base64,iVBORw0KGgo=',
      legenda: null,
    });
  });

  it('URL embutida com legenda separa as duas', () => {
    assert.deepEqual(
      leAnexoImagem('data:image/png;base64,iVBORw0KGgo=\nCaption: print do erro'),
      { filename: 'data:image/png;base64,iVBORw0KGgo=', legenda: 'print do erro' },
    );
  });

  it('urlDoAnexoImagem devolve a URL embutida direto, sem montar rota de arquivo', () => {
    assert.equal(
      urlDoAnexoImagem('tara', 'data:image/png;base64,iVBORw0KGgo='),
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });
});

describe('as duas metades do envelope picado pelo CC', () => {
  it('remontadas viram UM envelope, com foto e legenda no mesmo cartão', () => {
    const inteiro = juntaMetadesDoAnexo(
      '[Image #1]Caption: Teste, apenas "oi"',
      `[Image: source: ${CAMINHO}]`,
    );

    assert.notEqual(inteiro, null);
    assert.deepEqual(leAnexoImagem(inteiro as string), {
      filename: '1786819169359-c0919295ee39.jpg',
      legenda: 'Teste, apenas "oi"',
    });
  });

  it('metade de legenda sem `Caption:` também remonta — o CC come o rótulo às vezes', () => {
    const inteiro = juntaMetadesDoAnexo('[Image #2]olha o rodapé', `[Image: source: ${CAMINHO}]`);

    assert.equal(leAnexoImagem(inteiro as string)?.legenda, 'olha o rodapé');
  });

  it('não junta duas falas comuns — o par tem de ser legenda-sozinha e caminho-sozinho', () => {
    assert.equal(juntaMetadesDoAnexo('primeira frase', 'segunda frase'), null);
    assert.equal(juntaMetadesDoAnexo('[Image #1]Caption: legenda', 'segunda frase'), null);
    assert.equal(juntaMetadesDoAnexo('frase comum', `[Image: source: ${CAMINHO}]`), null);
  });

  it('caminho fora de uploads/ não vira cartão — não existe rota que o sirva', () => {
    assert.equal(
      juntaMetadesDoAnexo('[Image #1]Caption: legenda', '[Image: source: /tmp/qualquer.png]'),
      null,
    );
  });

  it('a fala do Rica que só MENCIONA um caminho continua sendo fala dele', () => {
    assert.equal(juntaMetadesDoAnexo('[Image #1]Caption: x', `olha este arquivo ${CAMINHO}`), null);
  });
});

describe('foto que chegou por canal', () => {
  it('vai pela rota de anexo de canal, não pela de upload', () => {
    assert.equal(
      urlDoAnexoImagem('daniel', '/home/clawd/.claude/channels/telegram/inbox/foto.jpg'),
      '/api/agents/daniel/channel-attachment?path=%2Fhome%2Fclawd%2F.claude%2Fchannels%2Ftelegram%2Finbox%2Ffoto.jpg',
    );
  });

  it('upload comum continua na rota de arquivo do agente', () => {
    assert.equal(
      urlDoAnexoImagem('daniel', '1786819169359-c0919295ee39.jpg'),
      '/api/agents/daniel/file/1786819169359-c0919295ee39.jpg',
    );
  });
});
