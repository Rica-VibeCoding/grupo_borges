import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  assinaPendentes,
  lePendentes,
  limpaEcoPendente,
  reconciliaPendentes,
  registraEcoPendente,
  temPendencia,
  assinaEntrega,
} from './eco-pendente.ts';

beforeEach(() => limpaEcoPendente());

describe('eco pendente — a bolha que nasce no gesto, 12s antes do rollout', () => {
  it('registra e devolve na ordem em que foi mandado', () => {
    registraEcoPendente('tara', 'primeira');
    registraEcoPendente('tara', 'segunda');

    assert.deepEqual(
      lePendentes('tara').map((p) => p.texto),
      ['primeira', 'segunda'],
    );
  });

  it('texto em branco não vira bolha', () => {
    registraEcoPendente('tara', '   ');
    assert.equal(lePendentes('tara').length, 0);
  });

  it('agentes não se misturam', () => {
    registraEcoPendente('tara', 'da tara');
    assert.equal(lePendentes('daniel').length, 0);
  });

  it('sem pendência devolve SEMPRE o mesmo array', () => {
    // `useSyncExternalStore` entra em laço infinito com snapshot novo a cada
    // leitura; `deepEqual` passaria exatamente no caso que quebra.
    assert.equal(lePendentes('tara'), lePendentes('tara'));
  });
});

describe('reconciliação — a pendência sai quando o rollout entrega', () => {
  it('mensagem que chegou pelo rollout some da lista otimista', () => {
    registraEcoPendente('tara', 'oi');
    reconciliaPendentes('tara', ['conversa velha', 'oi']);

    assert.equal(lePendentes('tara').length, 0);
  });

  it('duas iguais em sequência: o rollout com uma só derruba UMA', () => {
    registraEcoPendente('tara', 'ok');
    registraEcoPendente('tara', 'ok');
    reconciliaPendentes('tara', ['ok']);

    assert.equal(lePendentes('tara').length, 1);
  });

  it('rollout sem a mensagem preserva a bolha — é o caso dos 12s', () => {
    registraEcoPendente('tara', 'ainda subindo');
    reconciliaPendentes('tara', ['conversa velha']);

    assert.equal(lePendentes('tara').length, 1);
  });

  it('poll que não muda nada NÃO notifica — senão o feed remonta a cada 3s', () => {
    registraEcoPendente('tara', 'esperando');
    let avisos = 0;
    assinaPendentes('tara', () => (avisos += 1));

    const antes = lePendentes('tara');
    reconciliaPendentes('tara', ['outra coisa']);
    reconciliaPendentes('tara', ['outra coisa']);

    assert.equal(avisos, 0);
    assert.equal(lePendentes('tara'), antes, 'mesmo array, não só igual');
  });

  it('reconciliar sem pendência nenhuma não explode nem notifica', () => {
    let avisos = 0;
    assinaPendentes('tara', () => (avisos += 1));
    reconciliaPendentes('tara', ['qualquer coisa']);
    assert.equal(avisos, 0);
  });

  it('a entrega avisa quem está ouvindo', () => {
    let avisos = 0;
    const desassina = assinaPendentes('tara', () => (avisos += 1));

    registraEcoPendente('tara', 'oi');
    assert.equal(avisos, 1);

    reconciliaPendentes('tara', ['oi']);
    assert.equal(avisos, 2);

    desassina();
    registraEcoPendente('tara', 'depois de sair');
    assert.equal(avisos, 2);
  });
});

describe('temPendencia — o prazo do composer pergunta por aqui', () => {
  it('falso sem envio, verdadeiro com envio em curso, falso depois da entrega', () => {
    assert.equal(temPendencia('tara'), false);

    registraEcoPendente('tara', 'subindo');
    assert.equal(temPendencia('tara'), true);

    reconciliaPendentes('tara', ['subindo']);
    assert.equal(temPendencia('tara'), false);
  });

  it('agente sem pendência não segura o alarme do vizinho', () => {
    registraEcoPendente('tara', 'só dela');
    assert.equal(temPendencia('daniel'), false);
  });
});

describe('recibo de entrega — o que desfaz o âmbar', () => {
  it('a entrega avisa com o TEXTO, que é o que a máquina casa', () => {
    const recebidos: string[] = [];
    assinaEntrega('tara', (t) => recebidos.push(t));

    registraEcoPendente('tara', 'oi');
    reconciliaPendentes('tara', ['oi']);

    assert.deepEqual(recebidos, ['oi']);
  });

  it('pendência que só EXPIROU não vira recibo — nada provou a entrega', () => {
    const recebidos: string[] = [];
    assinaEntrega('tara', (t) => recebidos.push(t));

    registraEcoPendente('tara', 'perdida');
    // Envelhece à força: o prazo é de 3 min.
    const p = lePendentes('tara')[0] as { emMs: number };
    p.emMs = Date.now() - 200_000;
    reconciliaPendentes('tara', ['outra coisa']);

    assert.equal(lePendentes('tara').length, 0, 'saiu da lista');
    assert.deepEqual(recebidos, [], 'mas NÃO foi anunciada como entregue');
  });
});
