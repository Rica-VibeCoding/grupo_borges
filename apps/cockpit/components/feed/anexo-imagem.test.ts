import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ehMarcadorDeOrigem, leAnexoImagem, urlDoAnexoImagem } from './anexo-imagem.ts';

describe('imagem enviada pelo cockpit — envelope para apresentação', () => {
  it('extrai o nome gravado e preserva a legenda inteira', () => {
    assert.deepEqual(
      leAnexoImagem(
        'Imagem enviada via cockpit: 1785888000000-a1b2c3d4e5f6.jpg\n' +
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

  // 08/08: o CC passou a anexar a imagem sozinho — apaga a linha do caminho e
  // prefixa `[Image #N]`. Sem estes dois casos o feed devolve o envelope cru
  // como balão e a foto não aparece em lugar nenhum.
  it('lê o envelope depois de o CC engolir a linha do caminho', () => {
    assert.deepEqual(
      leAnexoImagem(
        '[Image #2]Imagem enviada via cockpit: 1786236851587-9f17120b8449.png\n' +
          'Caption: teste, apenas ok',
      ),
      { filename: '1786236851587-9f17120b8449.png', legenda: 'teste, apenas ok' },
    );
  });

  it('reconhece a linha de origem que o CC grava depois da mensagem', () => {
    assert.equal(
      ehMarcadorDeOrigem(
        '[Image: source: /home/clawd/repos/grupo_borges/apps/api/uploads/agents/daniel/1786236851587-9f17120b8449.png]',
      ),
      true,
    );
    assert.equal(ehMarcadorDeOrigem('olha o [Image: source: /tmp/a.png] aí'), false);
  });

  it('não engole texto comum nem envelope de outro tipo', () => {
    assert.equal(leAnexoImagem('texto comum do Rica'), null);
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
