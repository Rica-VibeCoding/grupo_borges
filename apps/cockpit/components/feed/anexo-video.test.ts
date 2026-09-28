import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { leAnexoVideo } from './anexo-video.ts';

const CAMINHO = '/home/clawd/repos/grupo_borges/uploads/agents/tara/1727-abc123.mp4';
const SERVICO =
  'Nome original: praia.mp4\nNão há visão de vídeo nativa: pra ver o conteúdo, extraia frames com ffmpeg (já instalado na VPS).';

describe('leAnexoVideo', () => {
  it('lê o envelope inteiro do _agent_file_message, com legenda', () => {
    const texto = `Vídeo enviado via cockpit:\n${CAMINHO}\n${SERVICO}\nCaption: olha a praia`;
    assert.deepEqual(leAnexoVideo(texto), { filename: '1727-abc123.mp4', legenda: 'olha a praia' });
  });

  it('sem Caption, legenda nula; linhas de serviço nunca viram legenda', () => {
    const texto = `Vídeo enviado via cockpit:\n${CAMINHO}\n${SERVICO}`;
    assert.deepEqual(leAnexoVideo(texto), { filename: '1727-abc123.mp4', legenda: null });
  });

  it('legenda de várias linhas fica inteira', () => {
    const texto = `Vídeo enviado via cockpit:\n${CAMINHO}\n${SERVICO}\nCaption: linha 1\nlinha 2`;
    assert.equal(leAnexoVideo(texto)?.legenda, 'linha 1\nlinha 2');
  });

  it('aceita mov, webm e m4v', () => {
    for (const ext of ['mov', 'webm', 'm4v', 'MP4']) {
      const texto = `Vídeo enviado via cockpit:\n/x/uploads/agents/tara/a.${ext}`;
      assert.equal(leAnexoVideo(texto)?.filename, `a.${ext}`);
    }
  });

  it('recusa o que não é o envelope inteiro', () => {
    assert.equal(leAnexoVideo('Vídeo enviado via cockpit: olha'), null);
    assert.equal(leAnexoVideo(`olha este arquivo ${CAMINHO}`), null);
    assert.equal(leAnexoVideo(`Vídeo enviado via cockpit:\n/tmp/fora/a.mp4`), null);
    assert.equal(leAnexoVideo(`Vídeo enviado via cockpit:\n/x/uploads/agents/tara/a.png`), null);
    assert.equal(leAnexoVideo(`Imagem enviada via cockpit:\n/x/uploads/agents/tara/a.mp4`), null);
  });
});
