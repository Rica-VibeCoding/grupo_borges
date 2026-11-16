import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agruparPorDia,
  chaveDoDia,
  consulta,
  ErroDaApi,
  lerPodas,
  lerTipo,
  mensagemDeErro,
  nomeDoAgente,
  oQueAconteceu,
  podaPermitida,
  rotuloDoDia,
  tituloLegivel,
  type NoAprendizado,
} from './aprendizado.ts';

// 16/11/2026 05:10:35 UTC = 02:10 em São Paulo (o nó real do Pavan no contrato).
const PAVAN = 1794805835;

function no(id: string, data: number): NoAprendizado {
  return {
    id,
    agente: 'pavan',
    tipo: 'memoria',
    acao: 'mudou',
    data,
    titulo: 'feedback_x',
    descricao: null,
    origem: 'agente',
    caminho: '/x.md',
    fonte_data: 'git',
  };
}

test('título legível tira o prefixo da memória e preserva o nome da skill', () => {
  assert.equal(
    tituloLegivel({ titulo: 'feedback_veto_do_rica_se_anota_na_hora', tipo: 'memoria' }),
    'Veto do rica se anota na hora',
  );
  assert.equal(tituloLegivel({ titulo: 'shared_mascarar_cofre', tipo: 'memoria_compartilhada' }), 'Mascarar cofre');
  assert.equal(tituloLegivel({ titulo: 'promob-catalogo', tipo: 'skill' }), 'promob-catalogo');
});

test('agente e ação viram frase', () => {
  assert.equal(nomeDoAgente('ze-shared'), 'Frota');
  assert.equal(nomeDoAgente('miga_dani'), 'Miga dani');
  assert.equal(oQueAconteceu({ acao: 'criou', tipo: 'memoria_compartilhada' }), 'criou memória compartilhada');
});

test('dia é o de São Paulo, não o de UTC', () => {
  // 02:10 em SP: já é dia 16 lá também; 01:00 UTC de 16/11 ainda é dia 15 em SP.
  assert.equal(chaveDoDia(PAVAN), '2026-11-16');
  assert.equal(chaveDoDia(Date.UTC(2026, 10, 16, 1, 0) / 1000), '2026-11-15');
});

test('rótulo do dia: Hoje, Ontem e data por extenso', () => {
  const agora = PAVAN + 3600;
  assert.equal(rotuloDoDia(PAVAN, agora), 'Hoje');
  assert.equal(rotuloDoDia(PAVAN - 86400, agora), 'Ontem');
  assert.match(rotuloDoDia(PAVAN - 3 * 86400, agora), /^Sexta-feira, 13 de novembro$/);
});

test('agrupa preservando a ordem da API', () => {
  const dias = agruparPorDia([no('a', PAVAN), no('b', PAVAN - 60), no('c', PAVAN - 86400)]);
  assert.deepEqual(
    dias.map((d) => d.itens.map((n) => n.id)),
    [['a', 'b'], ['c']],
  );
});

test('poda só onde o contrato deixa', () => {
  assert.equal(podaPermitida('memoria'), 'apagar');
  assert.equal(podaPermitida('skill'), 'arquivar');
  assert.equal(podaPermitida('memoria_compartilhada'), null);
});

test('filtros: tipo inválido cai em tudo; consulta só leva o que há', () => {
  assert.equal(lerTipo('memoria'), 'memoria');
  assert.equal(lerTipo('qualquer'), null);
  assert.equal(consulta({ agente: null, tipo: null }, 0), 'offset=0&limite=100');
  assert.equal(consulta({ agente: 'pavan', tipo: 'skill' }, 100), 'agente=pavan&tipo=skill&offset=100&limite=100');
});

test('desfazer de skill antes da Faxina explica a espera', () => {
  assert.match(mensagemDeErro(new ErroDaApi(409, 'x'), 'desfazer', 'skill'), /ainda não arquivou/);
  assert.match(mensagemDeErro(new ErroDaApi(404, null), 'podar', 'memoria'), /Recarregue/);
  assert.match(mensagemDeErro(new Error('rede'), 'abrir'), /Sem resposta/);
});

test('podas guardadas: descarta lixo e o que passou de 7 dias', () => {
  const ok = { no_id: 'a', operacao_id: 'memoria-1', tipo: 'memoria', titulo: 't', agente: 'pavan', em: PAVAN, estado: 'apagada' };
  const velha = { ...ok, no_id: 'b', em: PAVAN - 8 * 86400 };
  assert.deepEqual(lerPodas(JSON.stringify([ok, velha, { lixo: 1 }]), PAVAN), [ok]);
  assert.deepEqual(lerPodas('não é json', PAVAN), []);
  assert.deepEqual(lerPodas(null, PAVAN), []);
});
