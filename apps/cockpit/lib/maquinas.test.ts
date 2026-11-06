import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agrupa,
  atividade,
  maquinasDeFora,
  nomeNaLinha,
  seloDaMaquina,
  temperaturaEmAlerta,
  textoDaCpu,
  textoDaTela,
  textoDasAbas,
  textoDoParado,
  type ItemAberto,
  type ResumoOnline,
} from './maquinas.ts';

const AGORA = 1_793_880_000;

function item(parcial: Partial<ItemAberto> & Pick<ItemAberto, 'id' | 'grupo'>): ItemAberto {
  return {
    rotulo: parcial.id,
    dono: null,
    memoria_mb: 100,
    parado_s: null,
    abas: [],
    pede_confirmacao: false,
    acao_rotulo: `Fechar ${parcial.id}`,
    ...parcial,
  };
}

function resumo(parcial: Partial<ResumoOnline> = {}): ResumoOnline {
  const recurso = { usado_mb: 1, livre_mb: 1, total_mb: 2, pct: 50 };
  return {
    online: true,
    cpu_pct: 10,
    ram: recurso,
    disco: recurso,
    temperatura_c: 50,
    parados_30min: 0,
    tela: { em_uso: null, ultimo_uso_s: null },
    medido_em: AGORA,
    ...parcial,
  };
}

test('agrupa na ordem Seus, Agentes, Chrome de agente, Protegido, do que mais come ao que menos, e some com grupo vazio', () => {
  const grupos = agrupa([
    item({ id: 'sshd', grupo: 'protegido', memoria_mb: 8 }),
    item({ id: 'pavan', grupo: 'agente', memoria_mb: 520 }),
    item({ id: 'foot', grupo: 'seus', memoria_mb: 38 }),
    item({ id: 'fluyt', grupo: 'agente', memoria_mb: 410 }),
    item({ id: 'chrome', grupo: 'seus', memoria_mb: 1840 }),
    item({ id: 'terminal-fluyt', grupo: 'terminal', memoria_mb: 480 }),
  ]);
  assert.deepEqual(
    grupos.map((g) => [g.nome, g.itens.map((i) => i.id), g.memoria_mb]),
    [
      ['Seus', ['chrome', 'foot'], 1878],
      ['Agentes', ['terminal-fluyt'], 480],
      ['Chrome de agente', ['pavan', 'fluyt'], 930],
      ['Protegido', ['sshd'], 8],
    ],
  );
  assert.deepEqual(agrupa([item({ id: 'a', grupo: 'agente' })]).map((g) => g.grupo), ['agente']);
});

test('parado só diz o tempo que o painel viu', () => {
  const desde = AGORA - 12 * 60;
  assert.equal(textoDoParado(5 * 60, desde, AGORA), 'parado há 5 min');
  // Parado o tempo todo da observação: o número é piso, a frase avisa.
  assert.equal(textoDoParado(12 * 60, desde, AGORA), 'parado há 12+ min');
  assert.equal(textoDoParado(40 * 60, AGORA - 3 * 3600, AGORA), 'parado há 40 min');
  assert.equal(textoDoParado(3 * 3600, AGORA - 5 * 3600, AGORA), 'parado há 3 h');
});

test('em uso ou sem leitura não vira "parado"', () => {
  assert.equal(textoDoParado(null, AGORA - 600, AGORA), null);
  assert.equal(textoDoParado(30, AGORA - 600, AGORA), null);
});

test('abas: contagem e títulos; sem abas, nada', () => {
  assert.equal(textoDasAbas(['Supabase', 'Vercel']), '2 abas: Supabase, Vercel');
  assert.equal(textoDasAbas(['Gmail']), '1 aba: Gmail');
  assert.equal(textoDasAbas([]), null);
});

test('linha Tela nos três estados', () => {
  assert.equal(textoDaTela({ em_uso: true, ultimo_uso_s: 3 }), 'Alguém está usando agora');
  assert.equal(textoDaTela({ em_uso: false, ultimo_uso_s: 2400 }), 'Ninguém mexe há 40 min');
  assert.equal(textoDaTela({ em_uso: null, ultimo_uso_s: null }), 'Não sei se alguém está usando');
});

test('selo: contagem de parados; RAM alta pinta de vermelho mesmo sem parados, e diz por quê', () => {
  assert.deepEqual(seloDaMaquina(resumo({ parados_30min: 3 }), 'Arsenal'), {
    texto: '3',
    vermelho: false,
    descricao: 'Arsenal: 3 parados há mais de 30 min',
  });
  const ramAlta = resumo({ ram: { usado_mb: 14600, livre_mb: 1784, total_mb: 16384, pct: 89.1 } });
  assert.deepEqual(seloDaMaquina(ramAlta, 'Arsenal'), {
    texto: '!',
    vermelho: true,
    descricao: 'Arsenal: RAM em 89%',
  });
  assert.equal(seloDaMaquina({ ...ramAlta, parados_30min: 1 }, 'Arsenal').texto, '1');
  assert.equal(seloDaMaquina({ ...ramAlta, parados_30min: 1 }, 'Arsenal').descricao, 'Arsenal: 1 parado há mais de 30 min, RAM em 89%');
});

test('selo some com tudo em dia, sem leitura ou com a máquina fora', () => {
  assert.equal(seloDaMaquina(resumo(), 'Arsenal').texto, null);
  assert.equal(seloDaMaquina(resumo({ ram: { usado_mb: 1, livre_mb: 1, total_mb: 2, pct: 85 } }), 'Arsenal').vermelho, false);
  assert.equal(seloDaMaquina(null, 'Arsenal').texto, null);
  assert.equal(seloDaMaquina({ online: false, motivo: 'tempo esgotado' }, 'Arsenal').texto, null);
});

test('temperatura acende só acima de 85 °C', () => {
  assert.equal(temperaturaEmAlerta(85), false);
  assert.equal(temperaturaEmAlerta(86), true);
  assert.equal(temperaturaEmAlerta(null), false);
});

test('mini cartão some com a máquina que o cartão de recursos já mede, sem olhar maiúscula', () => {
  const lista = [{ id: 'arsenal', nome: 'Arsenal' }, { id: 'note', nome: 'Note' }];
  assert.deepEqual(maquinasDeFora(lista, 'ARSENAL').map((m) => m.id), ['note']);
  assert.deepEqual(maquinasDeFora(lista, 'VPS').map((m) => m.id), ['arsenal', 'note']);
});

test('coluna Atividade: em uso, parado com o tempo (e o "+" do piso) ou desconhecido', () => {
  assert.deepEqual(atividade(600, AGORA - 3600, AGORA), { estado: 'parado', texto: '10 min' });
  assert.deepEqual(atividade(3600, AGORA - 720, AGORA), { estado: 'parado', texto: '12+ min' });
  assert.deepEqual(atividade(60, AGORA - 3600, AGORA), { estado: 'parado', texto: '1 min' });
  assert.deepEqual(atividade(59, AGORA - 3600, AGORA), { estado: 'em-uso' });
  assert.deepEqual(atividade(0, AGORA - 3600, AGORA), { estado: 'em-uso' });
  assert.deepEqual(atividade(null, AGORA - 3600, AGORA), { estado: 'desconhecido' });
});

test('CPU: arredonda, "<1%" no quase nada e traço sem amostra', () => {
  assert.equal(textoDaCpu(12.6), '13%');
  assert.equal(textoDaCpu(0.4), '<1%');
  assert.equal(textoDaCpu(0), '0%');
  assert.equal(textoDaCpu(null), '—');
  assert.equal(textoDaCpu(undefined), '—');
});

test('nome na linha: tira só o prefixo que o grupo já diz', () => {
  assert.equal(nomeNaLinha({ grupo: 'terminal', rotulo: 'Terminal Fluyt Com' }), 'Fluyt Com');
  assert.equal(nomeNaLinha({ grupo: 'terminal', rotulo: 'Fluyt Com' }), 'Fluyt Com');
  assert.equal(nomeNaLinha({ grupo: 'agente', rotulo: 'Chrome do Fluyt Com' }), 'Fluyt Com');
  assert.equal(nomeNaLinha({ grupo: 'seus', rotulo: 'Chrome do Rica' }), 'Chrome do Rica');
});

test('PC sem suporte diz o motivo sem prometer nova tentativa', async () => {
  const { fetchAbertos, FalhaDaMaquina, textoDaFalhaDosAbertos } = await import('./maquinas.ts');
  const anterior = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ mensagem: 'o PC ainda não lista o que está aberto' }), { status: 501 });
  try {
    await assert.rejects(fetchAbertos('pc'), (erro: Error) => {
      assert.ok(erro instanceof FalhaDaMaquina);
      assert.equal(erro.status, 501);
      assert.equal(textoDaFalhaDosAbertos(erro.message, erro.status), 'o PC ainda não lista o que está aberto');
      return true;
    });
    assert.match(textoDaFalhaDosAbertos('não responde', 502), /Tento de novo sozinho/);
  } finally { globalThis.fetch = anterior; }
});

test('resumo sem primeira amostra não inventa selo de parados', () => {
  assert.deepEqual(seloDaMaquina(resumo({ cpu_pct: null, parados_30min: null }), 'PC'), {
    texto: null, vermelho: false, descricao: '',
  });
});

test('RAM desconhecida deixa a soma desconhecida e vem depois das medidas conhecidas', () => {
  const [grupo] = agrupa([item({ id: 'incerto', grupo: 'agente', memoria_mb: null }), item({ id: 'medido', grupo: 'agente', memoria_mb: 20 })]);
  assert.equal(grupo.memoria_mb, null);
  assert.deepEqual(grupo.itens.map(i => i.id), ['medido', 'incerto']);
});

test('fechar sem medida confirma fechamento sem inventar RAM liberada', async () => {
  const { textoDoFechado } = await import('./maquinas.ts');
  assert.equal(textoDoFechado(null), 'Fechado · RAM sem leitura');
  assert.equal(textoDoFechado(10), 'Liberou 10 MB');
});
