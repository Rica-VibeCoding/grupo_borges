import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  RECIBO_MS,
  descreveControle,
  diagnosticaAcao,
  ehCodex,
  leiaDestrava,
  montaControles,
  rotulaDestrava,
  rotulaPermissao,
  rotulaSandbox,
} from './acoes-rapidas.ts';

/** Payload mínimo do `/painel`, no shape que o back devolve. Os campos que
 *  estas funções não leem ficam no piso — o teste não deve depender deles. */
function painel(patch: Partial<AgentPainelResponse> = {}): AgentPainelResponse {
  return {
    slug: 'daniel',
    generated_at: 0,
    contexto: {
      model: null,
      model_family: null,
      context_window: null,
      tokens: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 },
      pct: null,
      source: 'teste',
      updated_at: null,
      available: false,
      stale: false,
    },
    effort: { value: 'high', allowed: ['low', 'medium', 'high'], source: 'teste', session_may_diverge: false },
    permission: { mode: 'ask', source: 'teste', session_may_diverge: false },
    quotas: { status: 'unknown', stale_after_seconds: 0 },
    subagents: { count: 0, active_count: 0, items: [] },
    ...patch,
  };
}

describe('quais controles existem — os quatro nunca aparecem juntos', () => {
  it('agente Claude Code: esforço + permissão, e NENHUM sandbox', () => {
    const ids = montaControles(painel()).map((c) => c.id);
    assert.deepEqual(ids, ['esforco', 'permissao']);
  });

  it('agente Codex: esforço + sandbox, e NENHUMA permissão', () => {
    const ids = montaControles(
      painel({
        codex_native: true,
        sandbox: {
          value: 'workspace-write',
          allowed: ['read-only', 'workspace-write', 'danger-full-access'],
          source: 'teste',
          session_may_diverge: true,
        },
      }),
    ).map((c) => c.id);
    // Permissão fora não é economia de tela: o endpoint escreve o settings do
    // Claude Code, que não governa a Tara.
    assert.deepEqual(ids, ['esforco', 'sandbox']);
  });

  it('Codex se reconhece pelo sandbox mesmo sem a flag `codex_native`', () => {
    const p = painel({
      sandbox: { value: 'read-only', allowed: ['read-only'], source: 'teste', session_may_diverge: false },
    });
    assert.equal(ehCodex(p), true);
    assert.equal(ehCodex(painel()), false);
  });

  it('sem lista de esforço permitida, o controle não nasce — nem vazio', () => {
    const ids = montaControles(
      painel({ effort: { value: null, allowed: [], source: 'teste', session_may_diverge: false } }),
    ).map((c) => c.id);
    assert.deepEqual(ids, ['permissao']);
  });

  it('Codex sem sandbox no payload não inventa o controle', () => {
    const ids = montaControles(painel({ codex_native: true })).map((c) => c.id);
    assert.deepEqual(ids, ['esforco']);
  });
});

describe('a ordem é a escada, não o que o back listou', () => {
  it('esforço sobe de baixo para máximo mesmo chegando embaralhado', () => {
    const [esforco] = montaControles(
      painel({
        effort: {
          value: 'max',
          allowed: ['max', 'low', 'xhigh', 'high', 'medium'],
          source: 'teste',
          session_may_diverge: false,
        },
      }),
    );
    assert.deepEqual(
      esforco.opcoes.map((o) => o.valor),
      ['low', 'medium', 'high', 'xhigh', 'max'],
    );
  });

  it('permissão sobe do mais contido ao mais solto', () => {
    const permissao = montaControles(painel())[1];
    assert.deepEqual(
      permissao.opcoes.map((o) => o.valor),
      ['plan', 'ask', 'bypassPermissions'],
    );
  });

  it('sandbox sobe de leitura a total', () => {
    const sandbox = montaControles(
      painel({
        codex_native: true,
        sandbox: {
          value: 'read-only',
          allowed: ['danger-full-access', 'read-only', 'workspace-write'],
          source: 'teste',
          session_may_diverge: false,
        },
      }),
    )[1];
    assert.deepEqual(
      sandbox.opcoes.map((o) => o.valor),
      ['read-only', 'workspace-write', 'danger-full-access'],
    );
  });

  it('degrau que a escada não conhece vai pro FIM, na ordem em que veio', () => {
    // O back pode ganhar um nível novo antes desta tabela. Sumir com ele
    // esconderia um valor válido; embaralhar a ordem trocaria o segmento de
    // lugar entre um render e outro.
    const [esforco] = montaControles(
      painel({
        effort: {
          value: 'ultra',
          allowed: ['ultra', 'high', 'plasma', 'low'],
          source: 'teste',
          session_may_diverge: false,
        },
      }),
    );
    assert.deepEqual(
      esforco.opcoes.map((o) => o.valor),
      ['low', 'high', 'ultra', 'plasma'],
    );
  });
});

describe('o modo em que o agente ESTÁ sempre aparece', () => {
  it('`acceptEdits` não é oferecido por padrão', () => {
    const permissao = montaControles(painel())[1];
    assert.equal(
      permissao.opcoes.some((o) => o.valor === 'acceptEdits'),
      false,
    );
  });

  it('…mas entra no segmentado quando é o valor atual — esconder seria mentir sobre o estado', () => {
    const permissao = montaControles(
      painel({ permission: { mode: 'acceptEdits', source: 'teste', session_may_diverge: false } }),
    )[1];
    assert.deepEqual(
      permissao.opcoes.map((o) => o.valor),
      ['plan', 'ask', 'acceptEdits', 'bypassPermissions'],
    );
    assert.equal(permissao.valor, 'acceptEdits');
  });
});

describe('tradução — português na tela, valor cru pro back', () => {
  it('o valor do segmento nunca é traduzido: é o contrato do endpoint', () => {
    const [esforco] = montaControles(painel());
    assert.deepEqual(
      esforco.opcoes.map((o) => o.valor),
      ['low', 'medium', 'high'],
    );
    assert.deepEqual(
      esforco.opcoes.map((o) => o.rotulo),
      ['baixo', 'médio', 'alto'],
    );
  });

  it('permissão e sandbox têm rótulo em português', () => {
    assert.equal(rotulaPermissao('bypassPermissions'), 'Livre');
    assert.equal(rotulaPermissao('plan'), 'Só planeja');
    assert.equal(rotulaSandbox('danger-full-access'), 'Total');
    assert.equal(rotulaSandbox('workspace-write'), 'Workspace');
  });

  it('valor desconhecido aparece cru — melhor que sumir, e o back é quem manda', () => {
    assert.equal(rotulaPermissao('modoNovo'), 'modoNovo');
    assert.equal(rotulaSandbox('sandbox-novo'), 'sandbox-novo');
  });

  it('toda opção carrega descrição — ela vira title E aria-label', () => {
    for (const controle of montaControles(painel())) {
      for (const opcao of controle.opcoes) {
        assert.ok(opcao.descricao.length > 0, `${controle.id}/${opcao.valor} sem descrição`);
      }
    }
  });
});

describe('a ressalva do back — some da tela, fica no leitor de tela', () => {
  it('não existe quando o back garante os dois valores', () => {
    assert.deepEqual(
      montaControles(painel()).map((c) => c.ressalva),
      [null, null],
    );
  });

  it('existe no controle quando o back avisa que pode divergir', () => {
    const [esforco] = montaControles(
      painel({
        effort: { value: 'high', allowed: ['low', 'high'], source: 't', session_may_diverge: true },
      }),
    );
    assert.ok(esforco.ressalva);
  });

  it('o anúncio do leitor de tela carrega a ressalva por extenso', () => {
    // Ela saiu da TELA por ordem do Rica (30/07), não do produto: quem usa
    // leitor de tela continua sabendo que o valor pode não ser o da sessão.
    const [esforco] = montaControles(
      painel({
        effort: { value: 'xhigh', allowed: ['low', 'xhigh'], source: 't', session_may_diverge: true },
      }),
    );
    const texto = descreveControle(esforco);
    assert.match(texto, /Esforço: extra alto/);
    assert.match(texto, /sessão em execução pode estar em outro valor/);
  });

  it('sem valor, o anúncio diz que não há — não chuta', () => {
    const [esforco] = montaControles(
      painel({ effort: { value: null, allowed: ['low'], source: 't', session_may_diverge: false } }),
    );
    assert.equal(descreveControle(esforco), 'Esforço: sem valor');
  });
});

describe('destrava — o 200 não é sucesso', () => {
  it('`tmux_delivered: false` vira aviso, nunca recibo', () => {
    // Mesmo literal mentiroso que a máquina de envio existe pra não repetir:
    // com o pane morto, o 200 volta e a tecla não chegou em lugar nenhum.
    const aviso = leiaDestrava({ tmux_delivered: false });
    assert.ok(aviso);
    assert.match(aviso.resumo, /não chegou/);
    assert.ok(aviso.saida.length > 0);
  });

  it('entregue de verdade não produz aviso', () => {
    assert.equal(leiaDestrava({ tmux_delivered: true }), null);
  });

  it('o rótulo do botão conta as três fases', () => {
    assert.equal(rotulaDestrava('ocioso'), 'Destravar');
    assert.equal(rotulaDestrava('enviando'), 'Destravando…');
    assert.equal(rotulaDestrava('entregue'), 'Escape enviado');
  });

  it('o recibo é curto: recibo, não estado', () => {
    assert.ok(RECIBO_MS > 0 && RECIBO_MS <= 2000);
  });
});

describe('falha — nunca só o diagnóstico, sempre a saída', () => {
  it('todo caminho devolve resumo E saída preenchidos', () => {
    const casos: unknown[] = [
      new Error('patchAgentCodexSandbox failed: 400: not_a_codex_agent'),
      new Error('kimi_effort_not_allowed'),
      new Error('patchAgentEffort failed: 404'),
      new Error('500 Internal Server Error'),
      new Error('Failed to fetch'),
      'string crua',
      null,
    ];
    for (const erro of casos) {
      const imp = diagnosticaAcao(erro, 'esforco');
      assert.ok(imp.resumo.length > 0, `sem resumo: ${String(erro)}`);
      assert.ok(imp.saida.length > 0, `sem saída: ${String(erro)}`);
    }
  });

  it('agente que deixou de ser Codex manda recarregar, não "tente de novo"', () => {
    const imp = diagnosticaAcao(new Error('400: not_a_codex_agent'), 'sandbox');
    assert.match(imp.saida, /recarregue o painel/);
  });

  it('nível recusado pelo motor explica que a escala é por família', () => {
    const imp = diagnosticaAcao(new Error('codex_effort_not_allowed'), 'esforco');
    assert.match(imp.resumo, /recusou/);
  });

  it('o caso geral nomeia a ação e avisa que o valor voltou', () => {
    assert.match(diagnosticaAcao(new Error('boom'), 'permissao').resumo, /a permissão/);
    assert.match(diagnosticaAcao(new Error('boom'), 'sandbox').resumo, /o sandbox/);
    assert.match(diagnosticaAcao(new Error('boom'), 'esforco').saida, /voltou ao que era/);
  });
});
