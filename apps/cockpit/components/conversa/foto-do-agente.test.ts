import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LADO_SEM_ALTA, fotoDoAgente } from './foto-do-agente.ts';

describe('foto do agente na tela de voz', () => {
  it('foto pequena (a pílula da B) é a mesma da cápsula do chat', () => {
    assert.deepEqual(fotoDoAgente('daniel', 52), { src: '/avatars/daniel.webp', lado: 52 });
    assert.deepEqual(fotoDoAgente('canarinho', 52), { src: '/avatars/canarinho.webp', lado: 52 });
  });

  it('foto grande (o núcleo da C) usa a de 512 px de quem tem', () => {
    for (const slug of ['barsi', 'daniel', 'dimy', 'felipe', 'hiro', 'lucas', 'maestro', 'marcio', 'pavan', 'tara', 'vinicius']) {
      assert.deepEqual(fotoDoAgente(slug, 220), { src: `/avatars/512/${slug}.webp`, lado: 220 });
    }
  });

  it('sem original em alta, a grande usa a de 128 e encolhe para não borrar', () => {
    for (const slug of ['canarinho', 'caseiro', 'fluytcom']) {
      const foto = fotoDoAgente(slug, 220);
      assert.equal(foto.src, `/avatars/${slug}.webp`);
      assert.equal(foto.lado, LADO_SEM_ALTA);
      assert.ok(LADO_SEM_ALTA < 220);
    }
  });

  it('slug desconhecido segue o mesmo caminho da cápsula (o fallback é a inicial)', () => {
    assert.deepEqual(fotoDoAgente('novato', 220), { src: '/avatars/novato.webp', lado: LADO_SEM_ALTA });
  });
});
