import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  PRAZO_ANEXO_MS,
  assinaAnexosPendentes,
  confirmaAnexoPendente,
  descartaAnexoPendente,
  leAnexoPendente,
  leAnexosPendentes,
  limpaAnexosPendentes,
  reconciliaAnexosPendentes,
  registraAnexoPendente,
} from './anexo-pendente.ts';

let revogadas: string[] = [];

beforeEach(() => {
  revogadas = [];
  limpaAnexosPendentes((url) => revogadas.push(url));
});

const foto = { url: 'blob:x/1', especie: 'image' as const, legenda: '  olha isso ', nome: 'IMG_1.png' };
const RESPOSTA = {
  path: '/home/clawd/repos/grupo_borges/uploads/agents/tara/1727-abc123.png',
  filename: 'IMG_1.png',
};

describe('anexo pendente', () => {
  it('registra no gesto, com a legenda aparada e sem nome do servidor', () => {
    const id = registraAnexoPendente('tara', foto);
    assert.match(id, /^anexo-\d+$/);
    const p = leAnexoPendente('tara', id);
    assert.equal(p?.legenda, 'olha isso');
    assert.equal(p?.arquivoServidor, null);
    assert.equal(leAnexosPendentes('daniel').length, 0);
  });

  it('confirma com o nome GRAVADO (do path), não o original, e troca o objeto', () => {
    const id = registraAnexoPendente('tara', foto);
    const antes = leAnexoPendente('tara', id);
    let avisos = 0;
    assinaAnexosPendentes('tara', () => (avisos += 1));
    confirmaAnexoPendente('tara', id, RESPOSTA);
    const depois = leAnexoPendente('tara', id);
    assert.equal(depois?.arquivoServidor, '1727-abc123.png');
    assert.notEqual(depois, antes);
    assert.equal(avisos, 1);
  });

  it('não reconcilia antes da confirmação, nem com o prazo vencido', () => {
    const id = registraAnexoPendente('tara', foto);
    reconciliaAnexosPendentes('tara', [{ texto: 'qualquer', criadoEmMs: 0 }], Date.now() + PRAZO_ANEXO_MS * 10);
    assert.ok(leAnexoPendente('tara', id));
  });

  it('reconcilia quando o feed cita o arquivo, e revoga o objectURL', () => {
    const id = registraAnexoPendente('tara', foto);
    confirmaAnexoPendente('tara', id, RESPOSTA);
    reconciliaAnexosPendentes('tara', [{ texto: 'outra coisa', criadoEmMs: 0 }]);
    assert.ok(leAnexoPendente('tara', id));
    reconciliaAnexosPendentes('tara', [
      { texto: `[Image: source: ${RESPOSTA.path}]`, criadoEmMs: Date.now() },
    ]);
    assert.equal(leAnexoPendente('tara', id), null);
    assert.deepEqual(revogadas, ['blob:x/1']);
  });

  it('confirmada que passou do prazo sai sozinha', () => {
    const id = registraAnexoPendente('tara', foto);
    confirmaAnexoPendente('tara', id, RESPOSTA);
    reconciliaAnexosPendentes('tara', [], Date.now() + PRAZO_ANEXO_MS);
    assert.equal(leAnexoPendente('tara', id), null);
    assert.equal(revogadas.length, 1);
  });

  it('descarta só a do upload que falhou, e revoga a URL dela', () => {
    const a = registraAnexoPendente('tara', foto);
    const b = registraAnexoPendente('tara', { ...foto, url: 'blob:x/2', especie: 'video' });
    descartaAnexoPendente('tara', a);
    assert.deepEqual(leAnexosPendentes('tara').map((p) => p.id), [b]);
    assert.deepEqual(revogadas, ['blob:x/1']);
    descartaAnexoPendente('tara', 'anexo-inexistente');
    assert.equal(leAnexosPendentes('tara').length, 1);
  });

  it('lista vazia devolve SEMPRE a mesma instância (useSyncExternalStore)', () => {
    assert.equal(leAnexosPendentes('tara'), leAnexosPendentes('tara'));
    const id = registraAnexoPendente('tara', foto);
    const lista = leAnexosPendentes('tara');
    reconciliaAnexosPendentes('tara', []);
    assert.equal(leAnexosPendentes('tara'), lista);
    descartaAnexoPendente('tara', id);
    assert.equal(leAnexosPendentes('tara'), leAnexosPendentes('outro'));
  });
});
