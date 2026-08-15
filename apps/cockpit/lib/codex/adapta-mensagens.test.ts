// O que este teste protege não é o formato — é a IDENTIDADE DE OBJETO.
// Traduzir campo a campo é a parte fácil e o TypeScript já cobre; o que quebra
// em silêncio é o adaptador devolver objetos novos a cada poll, porque aí o
// `samePrefix` do incremental (`lib/spike/render-items-incremental.ts`) para de
// casar e a conversa inteira é reclassificada de 3 em 3 segundos, com o feed
// remontando por baixo. Nada disso aparece como erro: só como tela que pisca e
// CPU que sobe. Por isso metade dos casos abaixo compara com `assert.equal`
// (identidade), não `deepEqual`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRenderItems } from '@grupo_borges/cockpit-core/render-items';

import { criaAdaptadorCodex, type CodexMessage, type CodexMessagePart } from './adapta-mensagens.ts';
import { leAnexoImagem } from '../../components/feed/anexo-imagem.ts';
import { temConteudoVisivel } from '../spike/conteudo-visivel.ts';

function bruta(over: Partial<CodexMessage> & { id: string }): CodexMessage {
  return {
    role: 'assistant',
    text: 'texto',
    timestamp: '2026-08-09T20:00:00.000Z',
    item_type: 'message',
    visible: true,
    ...over,
  };
}

describe('adaptaMensagensCodex', () => {
  it('traduz user e assistant preservando a ordem', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({ id: 't:0', role: 'user', text: 'roda o teste' }),
      bruta({ id: 't:1', role: 'assistant', text: 'rodei, 6 verdes' }),
    ]);

    assert.equal(saida.length, 2);
    assert.equal(saida[0].kind, 'user');
    assert.equal(saida[0].message?.content, 'roda o teste');
    assert.equal(saida[1].kind, 'assistant');
    assert.equal(saida[1].message?.stop_reason, 'end_turn');
    // `id` numérico é índice do incremental e chave do virtualizador.
    assert.deepEqual(saida.map((m) => m.id), [0, 1]);
  });

  it('carrega a proveniência de voz ao evento canônico', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({
        id: 't:voz',
        role: 'user',
        text: 'abre o relatório',
        meta: { kind: 'stt', raw_text: '🎙 abre o relatório' },
      }),
    ]);

    assert.deepEqual(saida[0].meta, {
      kind: 'stt',
      raw_text: '🎙 abre o relatório',
    });
  });

  it('deixa o internal de fora e não gasta ordinal com ele', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({ id: 't:0', role: 'user', text: 'sobe' }),
      bruta({ id: 't:1', role: 'internal', text: 'bash -lc "pytest -q"' }),
      bruta({ id: 't:2', role: 'assistant', text: 'subiu' }),
    ]);

    assert.equal(saida.length, 2);
    assert.deepEqual(saida.map((m) => m.id), [0, 1]);
    assert.equal(saida[1].message?.content, 'subiu');
  });

  it('devolve o MESMO array quando o poll não trouxe novidade', () => {
    const adapta = criaAdaptadorCodex();
    const entrada = [bruta({ id: 't:0', role: 'user', text: 'oi' })];

    const primeira = adapta(entrada);
    const segunda = adapta([...entrada]); // array novo, conteúdo idêntico

    assert.equal(primeira, segunda);
  });

  it('preserva a identidade do PREFIXO quando chega mensagem nova', () => {
    const adapta = criaAdaptadorCodex();
    const antes = adapta([bruta({ id: 't:0', role: 'user', text: 'oi' })]);
    const depois = adapta([
      bruta({ id: 't:0', role: 'user', text: 'oi' }),
      bruta({ id: 't:1', role: 'assistant', text: 'olá' }),
    ]);

    assert.notEqual(antes, depois);
    // É este o casamento que o `samePrefix` procura.
    assert.equal(antes[0], depois[0]);
    assert.equal(depois.length, 2);
  });

  it('troca só o objeto que mudou quando a última resposta cresce', () => {
    const adapta = criaAdaptadorCodex();
    const antes = adapta([
      bruta({ id: 't:0', role: 'user', text: 'oi' }),
      bruta({ id: 't:1', role: 'assistant', text: 'estou pen' }),
    ]);
    const depois = adapta([
      bruta({ id: 't:0', role: 'user', text: 'oi' }),
      bruta({ id: 't:1', role: 'assistant', text: 'estou pensando' }),
    ]);

    assert.equal(antes[0], depois[0]);
    assert.notEqual(antes[1], depois[1]);
    assert.equal(depois[1].message?.content, 'estou pensando');
  });

  it('timestamp ilegível vira 0 em vez de NaN', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([bruta({ id: 't:0', timestamp: 'nao-e-data' })]);

    // NaN em `created_at` envenena qualquer ordenação ou comparação depois.
    assert.equal(saida[0].created_at, 0);
  });

  it('esquece as mensagens da thread anterior quando a conversa troca', () => {
    const adapta = criaAdaptadorCodex();
    adapta([
      bruta({ id: 'velha:0', role: 'user', text: 'conversa antiga' }),
      bruta({ id: 'velha:1', role: 'assistant', text: 'resposta antiga' }),
    ]);
    const nova = adapta([bruta({ id: 'nova:0', role: 'user', text: 'conversa nova' })]);

    assert.equal(nova.length, 1);
    assert.equal(nova[0].message?.content, 'conversa nova');
    assert.equal(nova[0].uuid, 'codex-nova:0');
  });

  it('lista vazia não quebra e continua estável entre chamadas', () => {
    const adapta = criaAdaptadorCodex();
    const primeira = adapta([]);
    const segunda = adapta([]);

    assert.deepEqual(primeira, []);
    assert.equal(primeira, segunda);
  });
});

describe('adaptaMensagensCodex — partes tipadas (bruta.parts)', () => {
  it('parte text vira o content de sempre, sem envelope nenhum', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({
        id: 't:0',
        role: 'user',
        parts: [{ type: 'text', text: 'roda o teste' }],
      }),
    ]);

    assert.equal(saida.length, 1);
    assert.equal(saida[0].message?.content, 'roda o teste');
    assert.equal(saida[0].user_type, 'external');
  });

  it('parte image vira o envelope que leAnexoImagem já lê pro CC', () => {
    const adapta = criaAdaptadorCodex();
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    const saida = adapta([
      bruta({
        id: 't:0',
        role: 'user',
        parts: [
          { type: 'image', image_url: url },
          { type: 'text', text: 'compara com o mockup' },
        ],
      }),
    ]);

    assert.equal(saida.length, 1);
    const content = saida[0].message?.content;
    assert.equal(typeof content, 'string');
    // Prova de integração: o que o adaptador produz é exatamente o que
    // `anexo-imagem.ts` (território do Hiro) já sabe desenhar — sem precisar
    // ensinar `corpo-do-item.tsx` a reconhecer Codex.
    assert.deepEqual(leAnexoImagem(content as string), {
      filename: url,
      legenda: 'compara com o mockup',
    });
  });

  it('parte image sozinha (sem legenda) ainda vira envelope reconhecível', () => {
    const adapta = criaAdaptadorCodex();
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    const saida = adapta([
      bruta({ id: 't:0', role: 'user', parts: [{ type: 'image', image_url: url }] }),
    ]);

    assert.deepEqual(leAnexoImagem(saida[0].message?.content as string), {
      filename: url,
      legenda: null,
    });
  });

  it('parte context abre uma SEGUNDA bolha, interna e antes da fala', () => {
    const adapta = criaAdaptadorCodex();
    const parts: CodexMessagePart[] = [
      {
        type: 'context',
        text: 'esta mensagem chegou pelo cockpit do grupo_borges',
        source: 'developer',
      },
      { type: 'text', text: 'ola tara' },
    ];
    const saida = adapta([bruta({ id: 't:0', role: 'user', parts })]);

    assert.equal(saida.length, 2);
    assert.equal(saida[0].user_type, 'internal');
    assert.equal(saida[0].message?.content, 'esta mensagem chegou pelo cockpit do grupo_borges');
    assert.equal(saida[1].user_type, 'external');
    assert.equal(saida[1].message?.content, 'ola tara');
    // Ids sequenciais: a bolha de contexto entra ANTES da fala no incremental.
    assert.deepEqual(saida.map((m) => m.id), [0, 1]);
  });

  it('context nunca aparece dentro do content da fala principal', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({
        id: 't:0',
        role: 'user',
        parts: [
          { type: 'context', text: 'régua do cockpit', source: 'developer' },
          { type: 'text', text: 'oi' },
        ],
      }),
    ]);

    const fala = saida.find((m) => m.user_type === 'external');
    assert.ok(fala);
    assert.doesNotMatch(String(fala.message?.content), /régua do cockpit/);
  });

  it('context em mensagem do assistant é ignorado — só a fala do Rica carrega preâmbulo', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([
      bruta({
        id: 't:0',
        role: 'assistant',
        parts: [
          { type: 'context', text: 'nao deveria existir aqui', source: 'developer' },
          { type: 'text', text: 'resposta da tara' },
        ],
      }),
    ]);

    assert.equal(saida.length, 1);
    assert.equal(saida[0].message?.content, 'resposta da tara');
  });

  it('sem parts, cai no fallback de text achatado — comportamento antigo intacto', () => {
    const adapta = criaAdaptadorCodex();
    const saida = adapta([bruta({ id: 't:0', role: 'user', text: 'sem parts ainda' })]);

    assert.equal(saida.length, 1);
    assert.equal(saida[0].message?.content, 'sem parts ainda');
  });

  it('identidade de objeto sobrevive entre polls quando as parts se repetem', () => {
    const adapta = criaAdaptadorCodex();
    const parts = (): CodexMessagePart[] => [
      { type: 'context', text: 'régua', source: 'developer' },
      { type: 'text', text: 'oi' },
    ];

    const primeira = adapta([bruta({ id: 't:0', role: 'user', parts: parts() })]);
    // Array novo, parts novo (objeto fresco do fetch seguinte) — mas o
    // CONTEÚDO é idêntico, e é isso que o `samePrefix` do incremental exige.
    const segunda = adapta([bruta({ id: 't:0', role: 'user', parts: parts() })]);

    assert.equal(primeira[0], segunda[0]);
    assert.equal(primeira[1], segunda[1]);
  });
});

// Prova de ponta a ponta: o que o adaptador produz, passado pelo MESMO
// classificador puro que o CC usa (`buildRenderItems`, core — nunca editado
// aqui), tem de separar as três partes na tela sem `corpo-do-item.tsx`
// aprender que existe Codex. Se esta suíte quebrar, a UI quebrou.
describe('adaptaMensagensCodex — o que chega em corpo-do-item.tsx depois do classificador', () => {
  it('context + text viram DOIS RenderItem: user-internal discreto e user de verdade', () => {
    const adapta = criaAdaptadorCodex();
    const mensagens = adapta([
      bruta({
        id: 't:0',
        role: 'user',
        parts: [
          {
            type: 'context',
            text: 'esta mensagem chegou pelo cockpit do grupo_borges',
            source: 'developer',
          },
          { type: 'text', text: 'ola tara' },
        ],
      }),
    ]);

    const itens = buildRenderItems(mensagens).filter(temConteudoVisivel);
    assert.equal(itens.length, 2);
    assert.equal(itens[0].kind, 'user-internal');
    assert.equal(itens[1].kind, 'user');
    // `user-internal` desenha em `<Fala tom="discreto">`, sem caixa — nunca a
    // bolha da fala. Ver `corpo-do-item.tsx`, casos 'user-internal' e 'user'.
    if (itens[0].kind === 'user-internal') {
      assert.match(itens[0].text, /chegou pelo cockpit/);
    }
    if (itens[1].kind === 'user') {
      assert.equal(itens[1].text, 'ola tara');
    }
  });

  it('image + caption vira UM RenderItem que temConteudoVisivel aceita e leAnexoImagem decompõe', () => {
    const adapta = criaAdaptadorCodex();
    const url = 'data:image/jpeg;base64,ZmFrZQ==';
    const mensagens = adapta([
      bruta({
        id: 't:0',
        role: 'user',
        parts: [
          { type: 'image', image_url: url },
          { type: 'text', text: 'olha essa tela' },
        ],
      }),
    ]);

    const itens = buildRenderItems(mensagens).filter(temConteudoVisivel);
    assert.equal(itens.length, 1);
    assert.equal(itens[0].kind, 'user');
    if (itens[0].kind === 'user') {
      // A mesma leitura que `corpo-do-item.tsx` faz antes de montar
      // `<AnexoImagemView>` — nenhum código de render precisa mudar.
      assert.deepEqual(leAnexoImagem(itens[0].text), { filename: url, legenda: 'olha essa tela' });
    }
  });

  it('texto puro continua um único user comum — nada de Codex vaza pro classificador', () => {
    const adapta = criaAdaptadorCodex();
    const mensagens = adapta([
      bruta({ id: 't:0', role: 'user', parts: [{ type: 'text', text: 'bom dia' }] }),
    ]);

    const itens = buildRenderItems(mensagens).filter(temConteudoVisivel);
    assert.equal(itens.length, 1);
    assert.equal(itens[0].kind, 'user');
    if (itens[0].kind === 'user') assert.equal(itens[0].text, 'bom dia');
  });
});

describe('adaptaMensagensCodex — chamada de ferramenta vira linha de execução', () => {
  // O rollout real do Codex emite `custom_tool_call`. Até 15/08 o reader o
  // jogava fora e o adaptador recusava `internal`, então o chat da Tara não
  // mostrava NADA do que ela executou — enquanto o do Claude Code mostrava
  // tudo. É o "cada chat parece um app diferente" que o Rica cobrou.
  const chamada = {
    id: 'ctc_1',
    role: 'internal' as const,
    text: "sed -n '1,240p' memory/MEMORY.md",
    timestamp: '2026-08-15T11:09:00Z',
    item_type: 'custom_tool_call',
    visible: true,
    parts: [
      {
        type: 'tool_use' as const,
        id: 'call_1',
        name: 'exec',
        input: { command: "sed -n '1,240p' memory/MEMORY.md" },
      },
    ],
  };

  it('promove a chamada a bolha de assistant com `tool_use` estruturado', () => {
    const adapta = criaAdaptadorCodex();
    const [item] = adapta([chamada]);
    assert.equal(item.kind, 'assistant');
    assert.deepEqual(item.message?.content, [chamada.parts[0]]);
    assert.equal(item.message?.stop_reason, 'tool_use');
  });

  it('`internal` SEM estrutura continua fora — texto viraria fala inventada', () => {
    const adapta = criaAdaptadorCodex();
    const semParts = { ...chamada, parts: undefined };
    assert.deepEqual(adapta([semParts]), []);
  });

  it('`internal` invisível não entra mesmo trazendo estrutura', () => {
    const adapta = criaAdaptadorCodex();
    assert.deepEqual(adapta([{ ...chamada, visible: false }]), []);
  });

  it('preserva identidade do objeto entre polls — senão o feed reclassifica tudo', () => {
    const adapta = criaAdaptadorCodex();
    const primeira = adapta([chamada]);
    const segunda = adapta([chamada]);
    assert.equal(primeira[0], segunda[0]);
  });
});
