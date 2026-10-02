import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ATUAL,
  CONFERE_ERRO_MS,
  CONFERE_PRONTA_MS,
  depoisDaTroca,
  fimDaConferencia,
  trocaRefletida,
  explicaRecusa,
  guardaTroca,
  leOperacao,
  ondeMostra,
  textoDaEspera,
  textoDaTroca,
  trocaEmCurso,
  trocaGuardada,
  type Troca,
} from './acoes-de-conversa.ts';

const retomar = (campos: Partial<Troca> = {}): Troca => ({ tipo: 'retomar', alvo: 'b', forcar: false, desligado: false, ...campos });
const nova: Troca = { tipo: 'nova', alvo: null, forcar: false, desligado: false };

describe('onde a ação aparece', () => {
  it('Retomar na linha da conversa pedida; Nova no cartão de cima', () => {
    assert.equal(ondeMostra({ fase: 'ocupado', troca: retomar() }), 'b');
    assert.equal(ondeMostra({ fase: 'ocupado', troca: nova }), ATUAL);
  });

  it('a espera que voltou sem alvo fica no cartão de cima', () => {
    assert.equal(ondeMostra({ fase: 'esperando', troca: null, etapa: 'religando', inicio: 0 }), ATUAL);
    assert.equal(trocaEmCurso({ fase: 'esperando', troca: null, etapa: 'religando', inicio: 0 }), true);
  });

  it('livre não mostra nada; exclusão fica na própria linha', () => {
    assert.equal(ondeMostra({ fase: 'livre' }), null);
    assert.equal(ondeMostra({ fase: 'confirmando-exclusao', id: 'c' }), 'c');
    assert.equal(trocaEmCurso({ fase: 'excluindo', id: 'c' }), false);
  });
});

describe('botão de troca, sem confirmação (rodada 2)', () => {
  it('parado: Continuar esta; no meio de um turno, interrompe', () => {
    assert.equal(textoDaTroca('retomar', false), 'Continuar esta');
    assert.equal(textoDaTroca('retomar', true), 'Interromper e continuar esta');
  });

  it('a Nova segue a mesma régua', () => {
    assert.equal(textoDaTroca('nova', false), 'Nova conversa');
    assert.equal(textoDaTroca('nova', true), 'Interromper e abrir nova');
  });
});

describe('espera em barra', () => {
  it('uma frase só, sem etapa nem contagem', () => {
    assert.equal(textoDaEspera(retomar(), 'Pavan'), 'Abrindo esta conversa…');
    assert.equal(textoDaEspera(retomar({ forcar: true }), 'Pavan'), 'Abrindo esta conversa…');
    assert.equal(textoDaEspera(nova, 'Pavan'), 'Abrindo a conversa nova…');
  });

  it('desligado liga; sem alvo conhecido, não promete destino', () => {
    assert.equal(textoDaEspera(retomar({ desligado: true }), 'Pavan'), 'Ligando Pavan nesta conversa…');
    assert.equal(textoDaEspera(null, 'Pavan'), 'Trocando a conversa de Pavan…');
  });
});

describe('leitura do /operacao', () => {
  it('em curso segue com a etapa', () => {
    assert.deepEqual(leOperacao({ fase: 'religando', desde: 1, detalhe: null }), { tipo: 'segue', etapa: 'religando' });
  });

  it('erro traz o detalhe da API como veio', () => {
    const detalhe = 'Não subiu na conversa pedida; voltou na conversa anterior.';
    assert.deepEqual(leOperacao({ fase: 'erro', desde: 1, detalhe }), { tipo: 'erro', texto: detalhe });
  });

  it('fase nula: a operação sumiu (restart da API)', () => {
    assert.deepEqual(leOperacao({ fase: null, desde: null, detalhe: null }), { tipo: 'sumiu' });
    assert.deepEqual(leOperacao({ fase: 'pronta', desde: 1, detalhe: null }), { tipo: 'pronta' });
  });
});

describe('recusas', () => {
  it('códigos da API viram frase; os já em português passam', () => {
    assert.match(explicaRecusa('desligado', 'Pavan'), /Pavan está desligado/);
    assert.match(explicaRecusa('motor_sem_conversas', 'Pavan'), /motor/);
    assert.equal(explicaRecusa('Conversa aberta na linha felipe', 'Pavan'), 'Conversa aberta na linha felipe');
  });
});

describe('troca guardada na aba', () => {
  const memoria = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('guarda, lê de volta e apaga, por agente', () => {
    const g = memoria();
    guardaTroca(g, 'pavan', retomar({ forcar: true }));
    assert.deepEqual(trocaGuardada(g, 'pavan'), retomar({ forcar: true }));
    assert.equal(trocaGuardada(g, 'felipe'), null);
    guardaTroca(g, 'pavan', null);
    assert.equal(trocaGuardada(g, 'pavan'), null);
  });

  it('lixo na chave não quebra', () => {
    const g = memoria();
    g.setItem('ck-conversa-troca:pavan', '{quebrado');
    assert.equal(trocaGuardada(g, 'pavan'), null);
    g.setItem('ck-conversa-troca:pavan', '{"tipo":"outra"}');
    assert.equal(trocaGuardada(g, 'pavan'), null);
    assert.equal(trocaGuardada(null, 'pavan'), null);
  });
});

describe('conferência depois da troca (F12)', () => {
  const novaDe = (antes: string | null): Troca => ({ ...nova, antes });

  it('a Nova se prova quando o cartão sai da conversa de antes', () => {
    assert.equal(trocaRefletida(novaDe('a'), 'a'), false);
    assert.equal(trocaRefletida(novaDe('a'), 'z'), true);
    assert.equal(trocaRefletida(novaDe('a'), undefined), false);
    assert.equal(trocaRefletida(novaDe(null), 'z'), true);
  });

  it('o Retomar se prova quando o cartão mostra a pedida', () => {
    assert.equal(trocaRefletida(retomar(), 'a'), false);
    assert.equal(trocaRefletida(retomar(), 'b'), true);
  });

  it('pronta e erro viram conferência, com prazos diferentes, e o relógio não zera', () => {
    const p = depoisDaTroca({ tipo: 'pronta' }, novaDe('a'), 100, 1_000);
    assert.deepEqual(p, { fase: 'conferindo', troca: novaDe('a'), inicio: 100, ate: 1_000 + CONFERE_PRONTA_MS, erro: null });
    const e = depoisDaTroca({ tipo: 'erro', texto: 'o /clear não chegou' }, retomar(), 100, 1_000);
    assert.equal(e.fase === 'conferindo' && e.ate, 1_000 + CONFERE_ERRO_MS);
    assert.equal(trocaEmCurso(e), true);
  });

  it('sem saber o que foi pedido, encerra na hora como antes', () => {
    assert.deepEqual(depoisDaTroca({ tipo: 'pronta' }, null, 0, 0), { fase: 'livre' });
    assert.deepEqual(depoisDaTroca({ tipo: 'erro', texto: 'x' }, nova, 0, 0), { fase: 'falhou', onde: ATUAL, texto: 'x' });
  });

  it('o alerta falso some quando a lista mostra a troca feita', () => {
    const c = depoisDaTroca({ tipo: 'erro', texto: 'o /clear não chegou' }, novaDe('a'), 0, 0);
    assert.ok(c.fase === 'conferindo');
    assert.equal(fimDaConferencia(c, 'a', 1_000), null);
    assert.deepEqual(fimDaConferencia(c, 'z', 1_000), { fase: 'livre' });
  });

  it('prazo vencido: o erro aparece; a pronta só libera', () => {
    const e = depoisDaTroca({ tipo: 'erro', texto: 'falhou' }, novaDe('a'), 0, 0);
    assert.ok(e.fase === 'conferindo');
    assert.deepEqual(fimDaConferencia(e, 'a', CONFERE_ERRO_MS), { fase: 'falhou', onde: ATUAL, texto: 'falhou' });
    const p = depoisDaTroca({ tipo: 'pronta' }, retomar(), 0, 0);
    assert.ok(p.fase === 'conferindo');
    assert.equal(ondeMostra(p), 'b');
    assert.deepEqual(fimDaConferencia(p, 'a', CONFERE_PRONTA_MS), { fase: 'livre' });
  });

  it('a conversa de antes sobrevive ao recarregar', () => {
    const mapa = new Map<string, string>();
    const guarda = { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v), removeItem: (k: string) => void mapa.delete(k) };
    guardaTroca(guarda, 'c', novaDe('a'));
    assert.deepEqual(trocaGuardada(guarda, 'c'), novaDe('a'));
    guardaTroca(guarda, 'c', nova);
    assert.equal(trocaGuardada(guarda, 'c')?.antes, undefined);
  });
});
