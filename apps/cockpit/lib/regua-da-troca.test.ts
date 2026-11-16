import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comecaTroca, reduzTroca, leOperacao, CONFERE_ERRO_MS, CONFERE_PRONTA_MS, PRAZO_DA_TROCA_MS,
  type Operacao, type SinalDaTroca, type TrocaEmCurso } from './regua-da-troca.ts';

const pedido = { tipo: 'retomar' as const, alvo: 'destino', forcar: false, desligado: false };
const inicio = () => comecaTroca(pedido, 'cliente', 0);
const op = (id: string | null | undefined, fase: Operacao['fase'], session_id: string | null = null): Operacao => ({ id, fase, session_id, desde: null, detalhe: 'falha da API' });
const ler = (t: TrocaEmCurso, id: string | null | undefined, fase: Operacao['fase'], agora = 100) => reduzTroca(t, { tipo: 'operacao', op: op(id, fase) }, agora);
const sinal = (t: TrocaEmCurso, s: SinalDaTroca, agora = 100) => reduzTroca(t, s, agora);

test('R7: relógio aplica teto de 240 s sem nenhuma leitura bem-sucedida', () => {
  const t = sinal(inicio(), { tipo: 'post-morreu' });
  assert.equal(sinal(t, { tipo: 'relogio' }, PRAZO_DA_TROCA_MS - 1).fase, 'esperando');
  const prazo = sinal(t, { tipo: 'relogio' }, PRAZO_DA_TROCA_MS);
  assert.equal(prazo.fase, 'conferindo');
  assert.match(prazo.conferencia!.erro!, /contato/);
  assert.equal(sinal(prazo, { tipo: 'relogio', listaFalhou: true }, PRAZO_DA_TROCA_MS + CONFERE_ERRO_MS).fase, 'falhou');
});

for (const fase of ['estacionando', 'religando', 'pronta', 'erro', null] as const) {
  test(`a: ignora leitura de outro id (${fase}) sem alterar argumento`, () => {
    const t = Object.freeze(inicio());
    assert.equal(ler(t, 'outra', fase), t);
    assert.equal(t.viuId, false);
  });
  test(`a: 409 adota primeira leitura em qualquer fase (${fase})`, () => {
    const t = sinal(inicio(), { tipo: 'post-recusado', codigo: 'operacao_em_curso' });
    const adotada = ler(t, 'bloqueou', fase);
    assert.equal(adotada.id, 'bloqueou');
    assert.equal(adotada.clienteId, 'cliente');
    assert.equal(adotada.post, 'aceito');
    assert.equal(ler(adotada, 'terceira', 'pronta').id, 'bloqueou');
    if (fase === 'pronta' || fase === 'erro' || fase === null) assert.equal(adotada.fase, 'conferindo');
    else assert.equal(adotada.etapa, fase);
  });
}
test('a: evento confere operacao_id; relógios do cliente e servidor não participam', () => {
  const t = sinal(inicio(), { tipo: 'evento', evento: { operacaoId: 'anterior', sessionId: 'antiga' } });
  assert.equal(t.fase, 'esperando');
  const fim = sinal(t, { tipo: 'evento', evento: { operacaoId: 'cliente', sessionId: 'destino' } });
  assert.equal(fim.fase, 'concluida');
  assert.equal(fim.entrou, 'destino');
});
for (const antesDo409 of [false, true]) {
  test(`a: evento antes da adoção é reconsiderado; antes do 409=${antesDo409}`, () => {
    let t = inicio();
    const conflito: SinalDaTroca = { tipo: 'post-recusado', codigo: 'operacao_em_curso' };
    const evento: SinalDaTroca = { tipo: 'evento', evento: { operacaoId: 'bloqueou', sessionId: 'outra-sessao' } };
    t = sinal(sinal(t, antesDo409 ? evento : conflito), antesDo409 ? conflito : evento);
    t = ler(t, 'bloqueou', 'erro');
    assert.equal(t.fase, 'concluida');
    assert.equal(t.entrou, 'outra-sessao');
  });
}
for (const fase of ['religando', 'pronta', 'erro', null] as const) {
  test(`b: API antiga sem id usa leOperacao (${fase})`, () => {
    const l = leOperacao(op(undefined, fase));
    const aceito = sinal(inicio(), { tipo: 'post-aceito', op: op(undefined, 'religando') });
    const t = ler(aceito, undefined, fase);
    assert.equal(t.fase, l.tipo === 'segue' ? 'esperando' : 'conferindo');
    if (l.tipo === 'erro') assert.equal(t.conferencia?.erro, l.texto);
    if (l.tipo === 'sumiu') assert.match(t.conferencia!.erro!, /não começou/);
  });
}
test('b: evento antigo sem operacao_id conclui', () => {
  assert.equal(sinal(inicio(), { tipo: 'evento', evento: { sessionId: 'destino' } }).fase, 'concluida');
});
for (const fase of ['pronta', 'religando', 'erro', null] as const) {
  test(`c: POST pendente não some aos 15 s (${fase}); morto some`, () => {
    const id = fase === null ? null : 'anterior';
    assert.equal(ler(inicio(), id, fase, 239_999).fase, 'esperando');
    const morto = sinal(inicio(), { tipo: 'post-morreu' });
    assert.equal(ler(morto, id, fase, 14_999).fase, 'esperando');
    assert.match(ler(morto, id, fase, 15_000).conferencia!.erro!, /não começou/);
    assert.equal(ler(inicio(), id, fase, PRAZO_DA_TROCA_MS).fase, 'conferindo');
  });
}
test('c: POST aceito ou morto com id visto + fase null = sumiu', () => {
  const aceito = sinal(inicio(), { tipo: 'post-aceito', op: op('cliente', 'religando') });
  const visto = sinal(ler(inicio(), 'cliente', 'estacionando'), { tipo: 'post-morreu' });
  for (const t of [aceito, visto]) assert.match(ler(t, null, null).conferencia!.erro!, /desapareceu/);
});
test('c: POST morto que já viu seu id não acusa não começou por ver outro id depois', () => {
  const t = sinal(ler(inicio(), 'cliente', 'religando'), { tipo: 'post-morreu' });
  assert.equal(ler(t, 'outra', 'pronta', 15_000).fase, 'esperando');
});
test('d: Safari congelado aceita pronta nossa e adotada antes do teto', () => {
  for (const adotar of [false, true]) {
    let t = inicio();
    if (adotar) t = sinal(t, { tipo: 'post-recusado', codigo: 'operacao_em_curso' });
    t = ler(t, adotar ? 'bloqueou' : 'cliente', 'pronta', PRAZO_DA_TROCA_MS + 999_999);
    assert.equal(t.conferencia?.erro, null);
  }
  assert.equal(ler(inicio(), 'outra', 'pronta', PRAZO_DA_TROCA_MS).conferencia?.erro?.includes('contato'), true);
});
test('e: chat só escurece após aceite ou 2 s de POST pendente', () => {
  assert.equal(inicio().visivel, false);
  assert.equal(sinal(inicio(), { tipo: 'relogio' }, 1_999).visivel, false);
  assert.equal(sinal(inicio(), { tipo: 'relogio' }, 2_000).visivel, true);
  assert.equal(sinal(inicio(), { tipo: 'post-aceito', op: op('cliente', 'religando') }).visivel, true);
});
for (const codigo of ['ocupado', 'É a conversa atual', 'Conversa não encontrada']) {
  test(`e: recusa imediata ${codigo} encerra sem escurecer`, () => {
    const t = sinal(inicio(), { tipo: 'post-recusado', codigo });
    assert.equal(t.visivel, false);
    assert.equal(t.fase, 'recusada');
  });
}
for (const caminho of ['post', 'operacao', 'legada', 'adocao', 'rede'] as const) {
  test(`f: F11 espera CONFERE_ERRO_MS pelo caminho ${caminho}`, () => {
    let t = inicio();
    if (caminho === 'adocao') t = sinal(t, { tipo: 'post-recusado', codigo: 'operacao_em_curso' });
    t = caminho === 'post' ? sinal(t, { tipo: 'post-aceito', op: op('cliente', 'erro') }, 1_000)
      : caminho === 'rede' ? sinal(t, { tipo: 'falha-de-leitura' }, 1_000)
      : ler(t, caminho === 'adocao' ? 'bloqueou' : caminho === 'legada' ? undefined : 'cliente', 'erro', 1_000);
    assert.equal(t.fase, 'conferindo');
    assert.equal(sinal(t, { tipo: 'relogio', atual: 'origem' }, 1_000 + CONFERE_ERRO_MS - 1).fase, 'conferindo');
    assert.equal(sinal(t, { tipo: 'relogio', atual: 'origem' }, 1_000 + CONFERE_ERRO_MS).fase, 'falhou');
    assert.equal(sinal(t, { tipo: 'evento', evento: { operacaoId: t.id, sessionId: 'destino' } }).fase, 'concluida');
    if (caminho !== 'adocao') assert.equal(sinal(t, { tipo: 'relogio', atual: 'destino' }).conferencia?.erro, null);
    // Uma segunda leitura/POST não reinicia a conferência.
    assert.equal(ler(t, t.id, 'erro', 2_000).conferencia?.ate, 1_000 + CONFERE_ERRO_MS);
  });
}
test('f: erro sem alvo conhecido também passa pela conferência', () => {
  const t = comecaTroca({ tipo: 'nova', alvo: null, forcar: false, desligado: false }, 'cliente', 0);
  const erro = ler(t, 'cliente', 'erro');
  assert.equal(erro.fase, 'conferindo');
  assert.equal(sinal(erro, { tipo: 'relogio', atual: 'origem' }, 100 + CONFERE_ERRO_MS).fase, 'falhou');
});
test('F12: lista prova Nova/Retomar; pronta espera sessão de destino ou teto', () => {
  const pronta = sinal(inicio(), { tipo: 'post-aceito', op: op('cliente', 'pronta', 'destino') });
  assert.equal(sinal(pronta, { tipo: 'relogio', sessao: 'origem' }, 2_100).fase, 'conferindo');
  assert.equal(sinal(pronta, { tipo: 'relogio', sessao: 'destino' }).fase, 'concluida');
  assert.equal(sinal(pronta, { tipo: 'relogio' }, 100 + CONFERE_PRONTA_MS).fase, 'concluida');
  const nova = comecaTroca({ tipo: 'nova', alvo: null, antes: 'origem', forcar: false, desligado: false }, 'cliente', 0);
  assert.equal(sinal(ler(nova, 'cliente', 'erro'), { tipo: 'relogio', atual: 'destino' }).conferencia?.listaConferida, true);
});
for (const fase of ['falhou', 'concluida'] as const) {
  test(`g: ${fase} não reacende espera com sinais atrasados`, () => {
    const t: TrocaEmCurso = { ...inicio(), fase };
    const sinais: SinalDaTroca[] = [
      { tipo: 'post-aceito', op: op('cliente', 'religando') }, { tipo: 'post-morreu' },
      { tipo: 'post-recusado', codigo: 'operacao_em_curso' }, { tipo: 'operacao', op: op('cliente', 'erro') },
      { tipo: 'evento', evento: { operacaoId: fase === 'falhou' ? 'outra' : 'cliente', sessionId: 'destino' } },
      { tipo: 'falha-de-leitura' }, { tipo: 'relogio' },
    ];
    for (const s of sinais) assert.equal(sinal(t, s), t);
  });
}

test('F12: lista libera Histórico, mas pronta só libera chat ao resolver a sessão ou atingir teto', () => {
  const pronta = ler(inicio(), 'cliente', 'pronta');
  const refletida = sinal(pronta, { tipo: 'relogio', atual: 'destino' });
  assert.equal(refletida.conferencia?.listaConferida, true);
  assert.equal(refletida.fase, 'conferindo');
  assert.equal(sinal(refletida, { tipo: 'relogio', sessao: 'origem' }).fase, 'conferindo');
  assert.equal(sinal(refletida, { tipo: 'relogio', sessao: 'destino' }).fase, 'concluida');
});
test('f: pronta da mesma operação conclui durante conferência de erro', () => {
  const erro = ler(inicio(), 'cliente', 'erro');
  const pronta = ler(erro, 'cliente', 'pronta', 200);
  assert.equal(pronta.fase, 'concluida');
  assert.equal(ler(pronta, 'cliente', 'pronta', 300), pronta);
});

for (const tipo of ['nova', 'retomar'] as const) {
  test(`f: sessão resolvida confirma ${tipo} no erro mesmo sem evento ou session_id na API`, () => {
    const t = comecaTroca({ ...pedido, tipo, antes: 'origem' }, 'cliente', 0);
    const erro = ler(t, 'cliente', 'erro');
    assert.equal(sinal(erro, { tipo: 'relogio', sessao: 'origem' }).fase, 'conferindo');
    assert.equal(sinal(erro, { tipo: 'relogio', sessao: 'destino' }).fase, 'concluida');
  });
}

test('R9: POST pronta nosso após falhou reabre conferência e apaga alerta ao confirmar', () => {
  const erro = sinal(inicio(), { tipo: 'falha-de-leitura' }, 100);
  const falhou = sinal(erro, { tipo: 'relogio', atual: 'origem' }, 100 + CONFERE_ERRO_MS);
  assert.equal(falhou.fase, 'falhou');
  assert.ok(falhou.erro);
  for (const id of ['outra', null, undefined]) {
    assert.equal(sinal(falhou, { tipo: 'post-aceito', op: op(id, 'pronta', 'destino') }, 20_000), falhou);
  }
  const pronta = sinal(falhou, { tipo: 'post-aceito', op: op('cliente', 'pronta', 'destino') }, 20_000);
  assert.equal(pronta.fase, 'conferindo');
  assert.equal(pronta.erro, undefined);
  assert.equal(pronta.conferencia?.erro, null);
  assert.equal(pronta.conferencia?.desde, 20_000);
  assert.equal(pronta.conferencia?.ate, 20_000 + CONFERE_PRONTA_MS);
  const lista = sinal(pronta, { tipo: 'relogio', atual: 'destino', sessao: 'origem' }, 20_001);
  assert.equal(lista.fase, 'conferindo');
  assert.equal(lista.conferencia?.listaConferida, true);
  const concluida = sinal(lista, { tipo: 'relogio', sessao: 'destino' }, 20_002);
  assert.equal(concluida.fase, 'concluida');
  assert.equal(concluida.erro, undefined);
});

test('R9: Retomar após falhou aceita stream no alvo sem session_id da API', () => {
  const erro = ler(inicio(), 'cliente', 'erro');
  const falhou = sinal(erro, { tipo: 'relogio', atual: 'origem' }, 100 + CONFERE_ERRO_MS);
  assert.equal(falhou.fase, 'falhou');
  assert.equal(falhou.entrou, null);
  assert.equal(sinal(falhou, { tipo: 'relogio', sessao: 'outra' }), falhou);
  const adotada = { ...falhou, adotada: true };
  assert.equal(sinal(adotada, { tipo: 'relogio', sessao: 'destino' }), adotada);
  const concluida = sinal(falhou, { tipo: 'relogio', sessao: 'destino' }, 20_000);
  assert.equal(concluida.fase, 'concluida');
  assert.equal(concluida.entrou, 'destino');
  assert.equal(concluida.erro, undefined);
  assert.equal(concluida.conferencia, undefined);
});
