import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  assinaNovaConversa,
  leGeracaoNovaConversa,
  limpaNovaConversa,
  publicaNovaConversa,
} from './nova-conversa.ts';

beforeEach(() => limpaNovaConversa());

describe('nova conversa — o /clear da Tara (10/08)', () => {
  it('publica incrementa a geração e avisa quem assina', () => {
    const slug = 'tara';
    let chamadas = 0;
    const desassina = assinaNovaConversa(slug, () => {
      chamadas += 1;
    });

    assert.equal(leGeracaoNovaConversa(slug), 0);
    publicaNovaConversa(slug);

    assert.equal(chamadas, 1);
    assert.equal(leGeracaoNovaConversa(slug), 1);

    desassina();
    publicaNovaConversa(slug);
    assert.equal(chamadas, 1);
  });

  it('isola por slug — um agente não zera o outro', () => {
    const tara = 'tara';
    const outro = 'outro';
    let chamadasOutro = 0;
    assinaNovaConversa(outro, () => {
      chamadasOutro += 1;
    });

    publicaNovaConversa(tara);

    assert.equal(chamadasOutro, 0);
    assert.equal(leGeracaoNovaConversa(tara), 1);
    assert.equal(leGeracaoNovaConversa(outro), 0);
  });
});
