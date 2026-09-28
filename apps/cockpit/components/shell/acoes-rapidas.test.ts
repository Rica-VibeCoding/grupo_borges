import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONFIRMA_ACAO_MS,
  ESPERAS_APOS_LIGAR_MS,
  RECIBO_MS,
  descreveAcaoBruta,
  descreveLigar,
  diagnosticaCicloDeVida,
  diagnosticaRelancar,
  leiaDesligar,
  leiaDestrava,
  leiaLigar,
  leiaRelancar,
  rotulaAcaoBruta,
  rotulaDestrava,
  rotulaLigar,
} from './acoes-rapidas.ts';

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

  it('motor não-Anthropic manda o Rica pro Desligar+Ligar, não pro "tente de novo"', () => {
    // O genérico dizia "tente de novo; se repetir, é infra" — conselho errado
    // pra recusa permanente. A Tara cai exatamente aqui.
    const imp = diagnosticaRelancar(new Error('409: relaunch_requer_backend_anthropic_nativo'));
    assert.match(imp.saida, /Desligar/);
    assert.match(imp.saida, /Ligar/);
    assert.doesNotMatch(imp.saida, /tente de novo/);
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

  it('boot em curso é recusa explicada nas duas ações, não erro genérico', () => {
    for (const acao of ['ligar', 'desligar'] as const) {
      const imp = diagnosticaCicloDeVida(new Error('409: ligar_em_curso'), acao);
      assert.match(imp.resumo, /boot deste agente em andamento/i);
      assert.match(imp.saida, /espere ele terminar/i);
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


describe('espera do painel depois do Ligar', () => {
  // O boot medido em 09/09 levou 13 segundos (Ligar 20:39:49, de pé 20:40:02).
  // Estes números são o que impede o F5 de voltar: encurtar a lista devolve o
  // defeito, porque a leitura cai no meio da subida e para de olhar.
  const BOOT_OBSERVADO_MS = 13_000;

  it('a última leitura acontece DEPOIS de o boot típico ter terminado', () => {
    const ultima = ESPERAS_APOS_LIGAR_MS[ESPERAS_APOS_LIGAR_MS.length - 1];
    assert.ok(ultima > BOOT_OBSERVADO_MS, `última espera ${ultima}ms não cobre o boot`);
  });

  it('há leitura DENTRO da janela do boot, não só depois dele', () => {
    // Sem isto, a tela só convergiria no fim: quem liga um agente que sobe
    // rápido esperaria a lista inteira para ver o resultado.
    assert.ok(ESPERAS_APOS_LIGAR_MS.some((ms) => ms < BOOT_OBSERVADO_MS));
  });

  it('as esperas crescem e têm fim — acompanhar boot não é pollar', () => {
    const crescente = [...ESPERAS_APOS_LIGAR_MS].every(
      (ms, i, todas) => i === 0 || ms > todas[i - 1],
    );
    assert.ok(crescente);
    assert.ok(ESPERAS_APOS_LIGAR_MS.length <= 6);
  });
});
