import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PainelMotor } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  TEXTO_VALE_NO_BOOT,
  destinoDaTroca,
  opcoesDeFamilia,
  rotulaFamilia,
} from './troca-de-motor.ts';

function motor(patch: Partial<PainelMotor> = {}): PainelMotor {
  return { familia: 'opencode', override: null, source: 'agents.model_family', ...patch };
}

describe('matriz cheia e neutra — nenhuma preferência de motor no código', () => {
  it('a lista tem as quatro famílias em ordem alfabética, sem item extra', () => {
    const opcoes = opcoesDeFamilia(motor());
    assert.deepEqual(
      opcoes.map((o) => o.chave),
      ['anthropic', 'codex-proxy', 'kimi', 'opencode'],
    );
  });

  it('sem override, o selecionado é a família do yaml e não há "voltar ao padrão"', () => {
    const opcoes = opcoesDeFamilia(motor({ familia: 'kimi', override: null }));
    const selecionado = opcoes.filter((o) => o.selecionado).map((o) => o.chave);
    assert.deepEqual(selecionado, ['kimi']);
    assert.equal(opcoes.some((o) => o.chave === 'herda'), false);
  });

  it('com override, o selecionado é o escolhido e o item "voltar ao padrão" aparece', () => {
    const opcoes = opcoesDeFamilia(motor({ familia: 'codex-proxy', override: 'codex-proxy' }));
    assert.deepEqual(opcoes.filter((o) => o.selecionado).map((o) => o.chave), ['codex-proxy']);
    assert.equal(opcoes.some((o) => o.chave === 'herda'), true);
  });

  it('a palavra do padrão Anthropic (ausência no yaml) é o rótulo correto', () => {
    assert.equal(rotulaFamilia('kimi'), 'Kimi');
    assert.equal(rotulaFamilia('codex-proxy'), 'Codex');
    assert.equal(rotulaFamilia(null), 'Padrão (Anthropic)');
    // Família que o catálogo ainda não conhece: mostra o nome cru, não estoura.
    assert.equal(rotulaFamilia('gemini'), 'gemini');
  });
});

describe('destino da troca — o clique manda só o que muda alguma coisa', () => {
  it('escolher a família que já é o override atual não dispara nada', () => {
    // Com override, o back devolve `familia === override` — os dois andam juntos.
    const destino = destinoDaTroca(motor({ familia: 'kimi', override: 'kimi' }), 'kimi');
    assert.deepEqual(destino, { acao: 'nenhuma' });
  });

  it('escolher família diferente do override envia a troca', () => {
    const destino = destinoDaTroca(motor({ override: 'opencode' }), 'codex-proxy');
    assert.deepEqual(destino, { acao: 'trocar', familia: 'codex-proxy' });
  });

  it('sem override, escolher a própria família do yaml não dispara (nada a pinar)', () => {
    const destino = destinoDaTroca(motor({ override: null }), 'opencode');
    assert.deepEqual(destino, { acao: 'nenhuma' });
  });

  it('"voltar ao padrão" com override presente limpa (null é troca legítima)', () => {
    const destino = destinoDaTroca(motor({ override: 'codex-proxy' }), 'herda');
    assert.deepEqual(destino, { acao: 'trocar', familia: null });
  });

  it('"voltar ao padrão" sem override não dispara', () => {
    const destino = destinoDaTroca(motor({ override: null }), 'herda');
    assert.deepEqual(destino, { acao: 'nenhuma' });
  });
});

describe('a ressalva do boot fica visível no próprio controle', () => {
  it('a frase existe e é a que o Daniel pediu por extenso', () => {
    assert.equal(TEXTO_VALE_NO_BOOT, 'Vale no próximo boot — Desligar e Ligar aplicam.');
  });
});
