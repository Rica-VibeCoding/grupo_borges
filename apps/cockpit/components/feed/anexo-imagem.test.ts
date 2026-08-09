import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { leAnexoImagem, urlDoAnexoImagem } from './anexo-imagem.ts';

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
});
