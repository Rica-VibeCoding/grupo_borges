import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { criaAdaptadorCodex } from './adapta-mensagens.ts';
import {
  assinaPendentes,
  descartaEcoPendente,
  lePendentes,
  limpaEcoPendente,
  reconciliaPendentes,
  registraEcoPendente,
  temPendencia,
  assinaEntrega,
  PRAZO_CC_MS,
  PRAZO_CODEX_MS,
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

  it('anexo mostra o envelope da imagem e reconcilia pela legenda', () => {
    const envelope =
      'Imagem enviada via cockpit:\n' +
      '/uploads/agents/tara/1786839427177-af0d6873f9d9.png\n' +
      'Caption: teste';

    registraEcoPendente('tara', 'teste', PRAZO_CODEX_MS, envelope);

    assert.equal(lePendentes('tara')[0]?.conteudo, envelope);
    reconciliaPendentes('tara', ['teste']);
    assert.equal(lePendentes('tara').length, 0);
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

describe('polling ocioso — por que reconciliar tem que vir do array CRU', () => {
  it('reconciliar só quando o adaptado muda de referência nunca expira em agente ocioso', () => {
    // Reproduz o bug do achado [1] da auditoria (09/08): `doRollout` é
    // estabilizado por identidade pelo adaptador (ver adapta-mensagens.ts —
    // "devolve o MESMO array quando o poll não trouxe novidade"). Um
    // `useEffect(() => reconciliaPendentes(...), [doRollout])` só dispara
    // quando essa referência muda — e se o agente fica ocioso e o texto nunca
    // aparece no rollout, ela nunca muda de novo.
    const adapta = criaAdaptadorCodex();
    registraEcoPendente('tara', 'nunca chega');

    let anterior: unknown;
    for (let i = 0; i < 60; i++) {
      const doRollout = adapta([]); // rollout sempre vazio — agente ocioso
      if (doRollout !== anterior) {
        anterior = doRollout;
        reconciliaPendentes(
          'tara',
          doRollout.map((m) => String(m.message?.content ?? '')),
        );
      }
    }

    // O prazo de 3 min já estourou faz tempo...
    const p = lePendentes('tara')[0] as { emMs: number };
    p.emMs = Date.now() - 200_000;

    // ...mas sem uma nova chamada de `reconciliaPendentes` ninguém checa: a
    // pendência fica presa, e é ela quem trava `porta-de-envio.ts:112`.
    assert.equal(temPendencia('tara'), true);
  });

  it('reconciliar com o texto do fetch cru, a cada poll, expira mesmo ocioso', () => {
    // O fix: `usa-conversa-codex.ts` passou a chamar `reconciliaPendentes` de
    // dentro do próprio poll de 3s (com o `CodexMessage[]` cru da resposta),
    // não mais amarrado à identidade do `doRollout` adaptado.
    registraEcoPendente('tara', 'nunca chega');

    const p = lePendentes('tara')[0] as { emMs: number };
    p.emMs = Date.now() - 200_000;

    reconciliaPendentes('tara', []); // o poll ocioso chama assim mesmo

    assert.equal(temPendencia('tara'), false);
  });
});

describe('descarte por falha — a bolha que o POST provou que não saiu', () => {
  it('sem descarte, uma pendência de tentativa que falhou fica órfã até o prazo de 3 min', () => {
    // Reproduz o achado [2] da auditoria (09/08): `registraEcoPendente` roda
    // em `composer.tsx:402`, ANTES do `await envio.enviar`. Quando o POST
    // rejeita com erro HTTP real (409 "Tara ocupada", rede, 4xx/5xx), a
    // máquina de envio vai pra `falhou` — mas nada nesta lista sabia disso.
    registraEcoPendente('tara', 'texto que nunca saiu');

    // O POST rejeitou (simulado — nada aqui reconcilia nem descarta), e a
    // tela já mostra a faixa "não saiu". A bolha, sem intervenção, continua
    // pintando "enviado" no feed.
    assert.equal(temPendencia('tara'), true, 'a bolha ainda está lá, contradizendo a faixa de erro');
  });

  it('descartaEcoPendente remove só a pendência da tentativa que falhou, por id', () => {
    const id1 = registraEcoPendente('tara', 'primeira tentativa');
    const id2 = registraEcoPendente('tara', 'primeira tentativa'); // mesmo texto, reenvio
    assert.ok(id1 && id2 && id1 !== id2, 'duas tentativas geram ids distintos mesmo com texto igual');

    descartaEcoPendente('tara', id1!);

    assert.deepEqual(
      lePendentes('tara').map((p) => p.id),
      [id2],
      'só a tentativa que falhou some — a outra continua esperando o rollout',
    );
  });

  it('descartar id que não existe (já reconciliado, já expirado) não explode nem mexe no resto', () => {
    registraEcoPendente('tara', 'fica');
    descartaEcoPendente('tara', 'eco-inexistente');
    assert.equal(lePendentes('tara').length, 1);
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

  it('o teto é por MOTOR: no Claude Code a bolha morre aos 45s, no Codex aos 3 min', () => {
    // A pendência segura o prazo do alarme de entrega, então o teto dela é o
    // tempo que o Rica fica com a mensagem na tela sem ninguém dizer se ela
    // entrou. Se este caso ficar vermelho porque alguém uniformizou os dois,
    // leia o porquê em `PRAZO_CC_MS`: no CC herdar os 3 min troca um aviso
    // falso aos 12 s por silêncio de três minutos.
    registraEcoPendente('canarinho', 'no claude code', PRAZO_CC_MS);
    registraEcoPendente('tara', 'no codex', PRAZO_CODEX_MS);
    const envelhece = (slug: string, ms: number) => {
      const p = lePendentes(slug)[0] as { emMs: number };
      p.emMs = Date.now() - ms;
    };

    envelhece('canarinho', 60_000);
    envelhece('tara', 60_000);
    reconciliaPendentes('canarinho', ['outra coisa']);
    reconciliaPendentes('tara', ['outra coisa']);

    assert.equal(lePendentes('canarinho').length, 0, 'CC: 60s já passou dos 45s');
    assert.equal(lePendentes('tara').length, 1, 'Codex: 60s ainda cabe nos 3 min');
  });

  it('quem não diz o prazo herda o do Codex — é o chamador antigo', () => {
    registraEcoPendente('tara', 'sem prazo declarado');
    assert.equal((lePendentes('tara')[0] as { prazoMs: number }).prazoMs, PRAZO_CODEX_MS);
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
