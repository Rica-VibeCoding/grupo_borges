import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONFIRMA_ACAO_MS,
  ESPERAS_APOS_LIGAR_MS,
  RECIBO_MS,
  descreveAcaoBruta,
  descreveLigar,
  diagnosticaCicloDeVida,
  leiaDesligar,
  leiaDestrava,
  leiaLigar,
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

  it('o rótulo do botão é SEMPRE curto — a frase longa mora na descrição', () => {
    // Auditoria 03/08: a frase inteira cortava dentro do botão, e a elipse nem
    // aparecia (text-overflow não se aplica a um flex container).
    for (const fase of ['ocioso', 'confirmando', 'enviando', 'concluido'] as const) {
      assert.ok(rotulaAcaoBruta(fase).length <= 12, `"${rotulaAcaoBruta(fase)}" é longo demais pro botão`);
    }
  });

  it('o nome acessível de TODA fase começa pelo próprio rótulo do botão (WCAG 2.5.3)', () => {
    for (const fase of ['ocioso', 'confirmando', 'enviando', 'concluido'] as const) {
      assert.ok(descreveAcaoBruta(fase).startsWith(rotulaAcaoBruta(fase)), `descrição de "${fase}" não começa pelo rótulo`);
    }
  });

  it('desligar promete matar tudo que o agente consome E que a conversa sobrevive', () => {
    // As duas metades importam: a primeira é o pedido do Rica ("desliga o
    // agente e TUDO que o agente consome"), a segunda é o que faz o botão não
    // assustar — Ligar sobe com `--continue`, então desligar não custa conversa.
    assert.equal(rotulaAcaoBruta('ocioso'), 'Desligar');
    assert.match(descreveAcaoBruta('ocioso'), /MCPs|canal/i);
    assert.match(descreveAcaoBruta('ocioso'), /a conversa fica/i);
    assert.match(descreveAcaoBruta('confirmando'), /tira o agente do ar/i);
    assert.match(descreveAcaoBruta('confirmando'), /tocar de novo/i);
  });

  it('o Restart saiu — nenhum rótulo de ação bruta promete apagar a conversa', () => {
    // Ordem do Rica em 10/08: *"Restart sai, destravar fica"*.
    for (const fase of ['ocioso', 'confirmando', 'enviando', 'concluido'] as const) {
      assert.doesNotMatch(rotulaAcaoBruta(fase), /restart/i);
      assert.doesNotMatch(descreveAcaoBruta(fase), /perde a conversa inteira/i);
    }
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
