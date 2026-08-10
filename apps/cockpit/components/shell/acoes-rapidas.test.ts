import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  CONFIRMA_ACAO_MS,
  RECIBO_MS,
  descreveAcaoBruta,
  descreveControle,
  descreveLigar,
  diagnosticaAcao,
  diagnosticaCicloDeVida,
  diagnosticaRelancar,
  ehCodex,
  leiaDesligar,
  leiaDestrava,
  leiaLigar,
  leiaRelancar,
  montaControles,
  rotulaAcaoBruta,
  rotulaDestrava,
  rotulaLigar,
  rotulaPermissao,
  rotulaSandbox,
} from './acoes-rapidas.ts';

/** Payload mínimo do `/painel`, no shape que o back devolve. Os campos que
 *  estas funções não leem ficam no piso — o teste não deve depender deles. */
function painel(patch: Partial<AgentPainelResponse> = {}): AgentPainelResponse {
  return {
    slug: 'daniel',
    generated_at: 0,
    vida: { sessao: true, processo: true },
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
    // Piso copiado do back (`get_delivery_channel_state`, sem registro ainda),
    // não inventado: fixture que erra o shape esconde regressão de contrato.
    canal_entrega: {
      estado: 'sem_dados',
      entregando: null,
      motivo: null,
      mensagem: 'Ainda não houve tentativa de entrega desde que a API iniciou.',
      recusas_consecutivas: 0,
      bloqueado_desde: null,
      bloqueado_ha_segundos: 0,
      ultima_tentativa_em: null,
      acao_recomendada: 'Envie uma mensagem para confirmar o canal.',
    },
    ...patch,
  };
}

describe('quais controles existem — é UM por agente, e nunca os dois', () => {
  it('agente Claude Code: só permissão, e NENHUM sandbox', () => {
    const ids = montaControles(painel()).map((c) => c.id);
    assert.deepEqual(ids, ['permissao']);
  });

  it('agente Codex: só sandbox, e NENHUMA permissão', () => {
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
    assert.deepEqual(ids, ['sandbox']);
  });

  it('Codex se reconhece pelo sandbox mesmo sem a flag `codex_native`', () => {
    const p = painel({
      sandbox: { value: 'read-only', allowed: ['read-only'], source: 'teste', session_may_diverge: false },
    });
    assert.equal(ehCodex(p), true);
    assert.equal(ehCodex(painel()), false);
  });

  it('o esforço NÃO nasce aqui, por mais que o back o ofereça', () => {
    // Ordem do Rica em 09/08: *"já temos ele no input"*. O payload continua
    // trazendo `effort` (o composer o consome) — quem não o desenha mais é a
    // gaveta. Este teste é a trava: um `effort` cheio não pode ressuscitar o
    // segmentado sem alguém decidir isso de novo.
    const ids = montaControles(
      painel({
        effort: {
          value: 'max',
          allowed: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
          source: 'teste',
          session_may_diverge: false,
        },
      }),
    ).map((c) => c.id);
    assert.deepEqual(ids, ['permissao']);
  });

  it('Codex sem sandbox no payload não inventa o controle', () => {
    const ids = montaControles(painel({ codex_native: true })).map((c) => c.id);
    assert.deepEqual(ids, []);
  });
});

describe('a ordem é a escada, não o que o back listou', () => {
  it('permissão sobe do mais contido ao mais solto', () => {
    const permissao = montaControles(painel())[0];
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
    )[0];
    assert.deepEqual(
      sandbox.opcoes.map((o) => o.valor),
      ['read-only', 'workspace-write', 'danger-full-access'],
    );
  });

  it('degrau que a escada não conhece vai pro FIM, na ordem em que veio', () => {
    // O back pode ganhar um nível novo antes desta tabela. Sumir com ele
    // esconderia um valor válido; embaralhar a ordem trocaria o segmento de
    // lugar entre um render e outro.
    const [sandbox] = montaControles(
      painel({
        codex_native: true,
        sandbox: {
          value: 'read-only',
          // `allowed` é `string[]` no contrato — de propósito: é a lista que o
          // back monta, e ele pode ganhar um degrau antes desta tabela.
          allowed: ['jaula', 'workspace-write', 'bunker', 'read-only'],
          source: 'teste',
          session_may_diverge: false,
        },
      }),
    );
    assert.deepEqual(
      sandbox.opcoes.map((o) => o.valor),
      ['read-only', 'workspace-write', 'jaula', 'bunker'],
    );
  });
});

describe('o modo em que o agente ESTÁ sempre aparece', () => {
  it('`acceptEdits` não é oferecido por padrão', () => {
    const permissao = montaControles(painel())[0];
    assert.equal(
      permissao.opcoes.some((o) => o.valor === 'acceptEdits'),
      false,
    );
  });

  it('…mas entra no segmentado quando é o valor atual — esconder seria mentir sobre o estado', () => {
    const permissao = montaControles(
      painel({ permission: { mode: 'acceptEdits', source: 'teste', session_may_diverge: false } }),
    )[0];
    assert.deepEqual(
      permissao.opcoes.map((o) => o.valor),
      ['plan', 'ask', 'acceptEdits', 'bypassPermissions'],
    );
    assert.equal(permissao.valor, 'acceptEdits');
  });
});

describe('tradução — português na tela, valor cru pro back', () => {
  it('o valor do segmento nunca é traduzido: é o contrato do endpoint', () => {
    const [permissao] = montaControles(painel());
    assert.deepEqual(
      permissao.opcoes.map((o) => o.valor),
      ['plan', 'ask', 'bypassPermissions'],
    );
    assert.deepEqual(
      permissao.opcoes.map((o) => o.rotulo),
      ['Só planeja', 'Pergunta', 'Livre'],
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
  it('não existe quando o back garante o valor', () => {
    assert.deepEqual(
      montaControles(painel()).map((c) => c.ressalva),
      [null],
    );
  });

  it('existe no controle quando o back avisa que pode divergir', () => {
    const [permissao] = montaControles(
      painel({ permission: { mode: 'ask', source: 't', session_may_diverge: true } }),
    );
    assert.ok(permissao.ressalva);
  });

  it('o anúncio do leitor de tela carrega a ressalva por extenso', () => {
    // Ela saiu da TELA por ordem do Rica (30/07), não do produto: quem usa
    // leitor de tela continua sabendo que o valor pode não ser o da sessão.
    const [permissao] = montaControles(
      painel({ permission: { mode: 'plan', source: 't', session_may_diverge: true } }),
    );
    const texto = descreveControle(permissao);
    assert.match(texto, /Permissões: Só planeja/);
    assert.match(texto, /sessão em execução pode estar em outro valor/);
  });

  it('sem valor, o anúncio diz que não há — não chuta', () => {
    // Montado à mão, não por `montaControles`: `valor: null` é um estado que o
    // código trata (o back pode omitir o campo) mas que o TIPO do payload
    // proíbe — `PainelSandbox.value` e `PainelPermission.mode` são fechados.
    // Passar pelo payload exigiria um cast que só serviria para enganar o
    // compilador; `descreveControle` recebe `Controle`, e é ele que está sob
    // teste.
    assert.equal(
      descreveControle({
        id: 'sandbox',
        titulo: 'Sandbox',
        valor: null,
        ressalva: null,
        opcoes: [{ valor: 'read-only', rotulo: 'Leitura', descricao: 'Só lê.' }],
      }),
      'Sandbox: sem valor',
    );
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
    assert.equal(rotulaDestrava('entregue'), 'Enviado');
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
      const imp = diagnosticaAcao(erro, 'permissao');
      assert.ok(imp.resumo.length > 0, `sem resumo: ${String(erro)}`);
      assert.ok(imp.saida.length > 0, `sem saída: ${String(erro)}`);
    }
  });

  it('agente que deixou de ser Codex manda recarregar, não "tente de novo"', () => {
    const imp = diagnosticaAcao(new Error('400: not_a_codex_agent'), 'sandbox');
    assert.match(imp.saida, /recarregue o painel/);
  });

  it('o caso geral nomeia a ação e avisa que o valor voltou', () => {
    assert.match(diagnosticaAcao(new Error('boom'), 'permissao').resumo, /a permissão/);
    assert.match(diagnosticaAcao(new Error('boom'), 'sandbox').resumo, /o sandbox/);
    assert.match(diagnosticaAcao(new Error('boom'), 'sandbox').saida, /voltou ao que era/);
  });
});

describe('ações brutas', () => {
  it('cada fase tem palavra própria — cor sozinha nunca carrega o significado', () => {
    const fases = ['ocioso', 'confirmando', 'enviando', 'concluido'] as const;
    const rotulos = fases.map((f) => rotulaAcaoBruta(f));
    assert.equal(new Set(rotulos).size, fases.length, 'duas fases dizem a mesma coisa');
    for (const r of rotulos) assert.ok(r.length > 0);
  });

  it('o rótulo do botão é SEMPRE curto — cabe nos ~110px de um dos três botões na mesma linha', () => {
    // Auditoria 03/08: a frase inteira ("Mata o turno atual — tocar de novo
    // confirma", 43 char) cortava em elipse dentro do botão, e a elipse nem
    // aparecia (text-overflow não se aplica a um flex container). O rótulo
    // curto elimina o corte; a frase completa migrou pra `descreveAcaoBruta`.
    for (const fase of ['ocioso', 'confirmando', 'enviando', 'concluido'] as const) {
      for (const acao of ['resume', 'desligar'] as const) {
        assert.ok(
          rotulaAcaoBruta(fase, acao).length <= 12,
          `"${rotulaAcaoBruta(fase, acao)}" (${acao}/${fase}) é longo demais pro botão`,
        );
      }
    }
  });

  it('o ocioso é o rótulo curto pedido pelo Rica; a promessa da conversa mora na descrição', () => {
    assert.equal(rotulaAcaoBruta('ocioso'), 'Resume');
    assert.match(descreveAcaoBruta('ocioso'), /conversa/i);
  });

  it('a confirmação avisa o que se perde, não só que é preciso confirmar — na DESCRIÇÃO, não no rótulo do botão', () => {
    assert.match(descreveAcaoBruta('confirmando'), /turno atual/);
    assert.match(descreveAcaoBruta('confirmando'), /tocar de novo/i);
  });

  it('o nome acessível do ocioso contém o rótulo visível (WCAG 2.5.3)', () => {
    // "Resume" é o rótulo visível; o nome acessível estende, não substitui —
    // senão o comando de voz "clicar em Resume" não acha o botão.
    assert.ok(descreveAcaoBruta('ocioso').startsWith('Resume'));
    assert.match(descreveAcaoBruta('ocioso'), /turno em andamento é perdido/);
  });

  it('o nome acessível de TODA fase começa pelo próprio rótulo do botão (WCAG 2.5.3), não só o ocioso', () => {
    for (const fase of ['ocioso', 'confirmando', 'enviando', 'concluido'] as const) {
      for (const acao of ['resume', 'desligar'] as const) {
        assert.ok(
          descreveAcaoBruta(fase, acao).startsWith(rotulaAcaoBruta(fase, acao)),
          `descrição de "${acao}/${fase}" não começa pelo rótulo`,
        );
      }
    }
  });

  it('desligar promete matar tudo que o agente consome E que a conversa sobrevive', () => {
    // As duas metades importam: a primeira é o pedido do Rica ("desliga o
    // agente e TUDO que o agente consome"), a segunda é o que faz o botão não
    // assustar — Ligar sobe com `--continue`, então desligar não custa conversa.
    assert.equal(rotulaAcaoBruta('ocioso', 'desligar'), 'Desligar');
    assert.match(descreveAcaoBruta('ocioso', 'desligar'), /MCPs|canal/i);
    assert.match(descreveAcaoBruta('ocioso', 'desligar'), /a conversa fica/i);
    assert.match(descreveAcaoBruta('confirmando', 'desligar'), /tira o agente do ar/i);
  });

  it('o Restart saiu — nenhum rótulo de ação bruta promete apagar a conversa', () => {
    // Ordem do Rica em 10/08: *"Restart sai, destravar fica"*. O boot sem
    // contexto virou `/clear` dentro do agente; nada na gaveta pode continuar
    // oferecendo perder a conversa inteira.
    for (const fase of ['ocioso', 'confirmando', 'enviando', 'concluido'] as const) {
      for (const acao of ['resume', 'desligar'] as const) {
        assert.doesNotMatch(rotulaAcaoBruta(fase, acao), /restart/i);
        assert.doesNotMatch(descreveAcaoBruta(fase, acao), /perde a conversa inteira/i);
      }
    }
  });

  it('resume e desligar só precisam diferir no ocioso — as duas nunca ficam fora de ocioso ao mesmo tempo', () => {
    // O hook único do componente (`useAcaoBruta`) garante que só uma `acao` por
    // vez sai de "ocioso" — por isso "Confirmar?" pode ser igual nas duas sem
    // ambiguidade visual: nunca aparece nos dois botões ao mesmo tempo. Só o
    // ocioso, onde os DOIS botões ficam visíveis e ativos simultaneamente,
    // precisa mesmo diferir.
    assert.notEqual(rotulaAcaoBruta('ocioso', 'resume'), rotulaAcaoBruta('ocioso', 'desligar'));
  });

  it('200 com tmux_delivered false NÃO é sucesso', () => {
    assert.equal(leiaRelancar({ tmux_delivered: true, attempted: true }), null);
    const tentou = leiaRelancar({ tmux_delivered: false, attempted: true });
    assert.ok(tentou, 'tentou e não voltou de pé precisa avisar');
    assert.match(tentou.resumo, /não voltou de pé/);
  });

  it('nem tentado e tentado-sem-voltar dão saídas diferentes', () => {
    const nemTentou = leiaRelancar({ tmux_delivered: false, attempted: false });
    const tentou = leiaRelancar({ tmux_delivered: false, attempted: true });
    assert.ok(nemTentou && tentou);
    assert.notEqual(nemTentou.resumo, tentou.resumo);
    // Quem tentou pede pra OLHAR a tela (algo aconteceu lá); quem não tentou
    // pede pra conferir se a sessão existe.
    assert.match(tentou.saida, /terminal/);
    assert.match(nemTentou.saida, /viva/);
  });

  it('Codex é recusa explicada, não erro genérico', () => {
    const imp = diagnosticaRelancar(new Error('409: relaunch_somente_claude_code'));
    assert.match(imp.resumo, /não roda Claude Code/);
    assert.match(imp.saida, /Codex/);
  });

  it('sem conversa para retomar, a tela diz que NÃO relançou', () => {
    const imp = diagnosticaRelancar(new Error('postAgentRelaunch failed: 409: resume_session_not_found'));
    assert.match(imp.resumo, /não achei a conversa/);
    // O ponto que importa: o agente continua de pé. Sem isto o Rica acharia
    // que perdeu a sessão e iria conferir no terminal à toa.
    assert.match(imp.saida, /não relancei/);
  });

  it('tmux recusando não sugere tentar de novo às cegas', () => {
    const imp = diagnosticaRelancar(new Error('relaunch_failed: no server running'));
    assert.match(imp.resumo, /tmux recusou/);
    assert.match(imp.saida, /viva/);
  });

  it('confirmação faltando é defeito nosso e o texto assume isso', () => {
    const imp = diagnosticaRelancar(new Error('400: confirmacao_explicita_obrigatoria'));
    assert.match(imp.saida, /defeito nosso/);
  });

  it('qualquer erro produz resumo e saída, inclusive os que não são Error', () => {
    const casos: unknown[] = [
      new Error('Failed to fetch'),
      new Error('postAgentRelaunch failed: 404'),
      { message: '503' },
      'string crua',
      null,
      undefined,
    ];
    for (const erro of casos) {
      const imp = diagnosticaRelancar(erro);
      assert.ok(imp.resumo.length > 0, `sem resumo: ${String(erro)}`);
      assert.ok(imp.saida.length > 0, `sem saída: ${String(erro)}`);
    }
  });

  it('o caso geral garante que nada foi alterado', () => {
    assert.match(diagnosticaRelancar(new Error('boom')).saida, /Nada foi alterado/i);
  });

  it('a confirmação expira, e com folga para ler a frase', () => {
    assert.ok(CONFIRMA_ACAO_MS >= 5_000, 'curta demais para ler o aviso');
    assert.ok(CONFIRMA_ACAO_MS <= 10_000, 'longa demais: o dedo esquece o que armou');
  });
});

describe('desligar', () => {
  it('já desligado é SUCESSO, não falha — o botão é idempotente', () => {
    // O back devolve `attempted:false` quando não havia sessão. Isso não é
    // erro: o estado final é o pedido. Avisar aqui faria o Rica achar que
    // precisa tentar de novo um desligamento que já estava feito.
    assert.equal(leiaDesligar({ tmux_delivered: true }), null);
    assert.equal(leiaDesligar({ tmux_delivered: true, scopes_resistiram: [] }), null);
  });

  it('cgroup que resistiu vira aviso — é CPU queimando que ninguém vê', () => {
    // O caso que deu origem ao botão: dois `bun server.ts` órfãos a 34% de CPU
    // cada por nove horas. Se o `stop` não pegou, o Rica precisa saber.
    const um = leiaDesligar({ tmux_delivered: false, scopes_resistiram: ['run-ra.scope'] });
    assert.ok(um);
    assert.match(um.resumo, /um processo/i);
    assert.match(um.saida, /CPU/);

    const varios = leiaDesligar({
      tmux_delivered: false,
      scopes_resistiram: ['run-ra.scope', 'run-rb.scope'],
    });
    assert.ok(varios);
    assert.match(varios.resumo, /2 processos/);
  });

  it('a sessão encerrada é dita mesmo quando sobrou processo — meia-verdade confunde mais', () => {
    const imp = leiaDesligar({ tmux_delivered: false, scopes_resistiram: ['run-ra.scope'] });
    assert.ok(imp);
    assert.match(imp.saida, /sessão foi encerrada/i);
  });
});

describe('ligar', () => {
  it('cada fase tem palavra própria e curta', () => {
    const fases = ['ocioso', 'enviando', 'entregue'] as const;
    const rotulos = fases.map((f) => rotulaLigar(f));
    assert.equal(new Set(rotulos).size, fases.length, 'duas fases dizem a mesma coisa');
    for (const r of rotulos) assert.ok(r.length > 0 && r.length <= 12, `"${r}" fora do limite`);
  });

  it('o nome acessível começa pelo rótulo visível (WCAG 2.5.3)', () => {
    for (const fase of ['ocioso', 'enviando', 'entregue'] as const) {
      assert.ok(descreveLigar(fase).startsWith(rotulaLigar(fase)));
    }
  });

  it('o ocioso promete que a conversa volta — é o que faz desligar não assustar', () => {
    assert.equal(rotulaLigar('ocioso'), 'Ligar');
    assert.match(descreveLigar('ocioso'), /de onde ela parou/i);
  });

  it('200 com tmux_delivered false NÃO é sucesso, mas também não manda repetir', () => {
    // O boot segue em curso quando o CLI ainda não apareceu — mandar clicar de
    // novo subiria uma segunda sessão do mesmo agente.
    assert.equal(leiaLigar({ tmux_delivered: true, attempted: true }), null);
    const imp = leiaLigar({ tmux_delivered: false, attempted: true });
    assert.ok(imp);
    assert.match(imp.resumo, /ainda não apareceu/i);
    assert.match(imp.saida, /em curso/i);
    assert.doesNotMatch(imp.saida, /tente de novo/i);
  });

  it('boot já em curso é recusa explicada — o segundo clique não sobe outra sessão', () => {
    const imp = diagnosticaCicloDeVida(new Error('409: ligar_em_curso: boot já está em curso'), 'ligar');
    assert.match(imp.resumo, /já tem um boot/i);
    assert.match(imp.saida, /duas sessões/i);
  });

  it('Codex é recusa explicada nas duas ações, não erro genérico', () => {
    for (const acao of ['ligar', 'desligar'] as const) {
      const imp = diagnosticaCicloDeVida(
        new Error('409: ciclo_de_vida_somente_claude_code'),
        acao,
      );
      assert.match(imp.resumo, /não tem sessão própria/i);
      assert.match(imp.saida, /Codex/);
    }
  });

  it('qualquer erro produz resumo e saída, inclusive os que não são Error', () => {
    const casos: unknown[] = [new Error('Failed to fetch'), { message: '503' }, 'crua', null, undefined];
    for (const acao of ['ligar', 'desligar'] as const) {
      for (const erro of casos) {
        const imp = diagnosticaCicloDeVida(erro, acao);
        assert.ok(imp.resumo.length > 0, `sem resumo: ${String(erro)}`);
        assert.ok(imp.saida.length > 0, `sem saída: ${String(erro)}`);
      }
    }
  });

  it('o caso geral do desligar garante que nada foi alterado; o do ligar aponta o log', () => {
    assert.match(diagnosticaCicloDeVida(new Error('boom'), 'desligar').saida, /nada foi alterado/i);
    assert.match(diagnosticaCicloDeVida(new Error('boom'), 'ligar').saida, /subir-frota\.log/);
  });
});
