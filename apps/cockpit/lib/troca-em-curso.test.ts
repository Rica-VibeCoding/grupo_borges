import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { CONFERE_ERRO_MS } from './regua-da-troca.ts';
import { assinaTrocaNoChat, assinaTrocaFeita, carimboDaLeitura, comecarTroca, confereTroca, conversaTrocada, dispensaTroca,
  leTroca, leTrocaNoChat, leituraMorreu, limpaTrocasNoChat, operacaoLida, postMorreu, postRecusado, postRespondeu,
  restauraTroca, type Operacao } from './troca-em-curso.ts';

const pedido = { tipo: 'retomar' as const, alvo: 'destino', forcar: false, desligado: false };
const op = (id: string | null, fase: Operacao['fase']): Operacao => ({ id, fase, session_id: null, desde: null, detalhe: 'erro da API' });
const memoria = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const chave = 'ck-conversa-troca:pavan';
beforeEach(() => limpaTrocasNoChat());
function inicia() {
  const guarda = memoria();
  restauraTroca('pavan', guarda, 0);
  comecarTroca('pavan', pedido, 0, 'cliente');
  return guarda;
}
test('store: um estado por agente, aviso e snapshot estável do chat', () => {
  inicia();
  let avisos = 0;
  const solta = assinaTrocaNoChat('pavan', () => avisos++);
  assert.equal(leTrocaNoChat('pavan'), null);
  postRespondeu('pavan', 'cliente', op('cliente', 'estacionando'), 100);
  const chat = leTrocaNoChat('pavan');
  assert.equal(chat?.fase, 'trocando');
  operacaoLida('pavan', carimboDaLeitura('pavan'), op('cliente', 'estacionando'), 200);
  assert.equal(leTrocaNoChat('pavan'), chat);
  assert.equal(leTroca('outra'), null);
  assert.equal(avisos, 2); // o contato foi atualizado; o snapshot visual continua igual
  solta();
});
test('a: leitura da montagem que volta depois do clique não encerra o pedido novo', () => {
  const carimbo = carimboDaLeitura('pavan');
  inicia();
  operacaoLida('pavan', carimbo, op('anterior', 'pronta'), 100);
  assert.equal(leTroca('pavan')?.fase, 'esperando');
});
test('a: leitura já em voo no 409 não decide adoção; evento já recebido é reconsiderado', () => {
  inicia();
  const anterior = carimboDaLeitura('pavan');
  conversaTrocada('pavan', { operacaoId: 'bloqueou', sessionId: 'destino' }, 20);
  postRecusado('pavan', 'cliente', 'operacao_em_curso', 30);
  operacaoLida('pavan', anterior, op('velha', 'pronta'), 40);
  assert.equal(leTroca('pavan')?.id, 'cliente');
  operacaoLida('pavan', carimboDaLeitura('pavan'), op('bloqueou', 'erro'), 50);
  assert.equal(leTroca('pavan')?.id, 'bloqueou');
  assert.equal(leTroca('pavan')?.fase, 'concluida');
  assert.equal(leTrocaNoChat('pavan'), null);
});
test('b: evento sem id conclui no store', () => {
  inicia();
  conversaTrocada('pavan', { sessionId: 'destino' }, 20);
  assert.equal(leTroca('pavan')?.fase, 'concluida');
});
test('c/f: recarga com POST pendente vira morto, sumiu em 15 s e falha após conferência', () => {
  const guarda = inicia();
  limpaTrocasNoChat();
  restauraTroca('pavan', guarda, 1_000);
  assert.equal(leTroca('pavan')?.post, 'morto');
  const carimbo = carimboDaLeitura('pavan');
  operacaoLida('pavan', carimbo, op('anterior', 'pronta'), 14_999);
  assert.equal(leTroca('pavan')?.fase, 'esperando');
  operacaoLida('pavan', carimbo, op('anterior', 'pronta'), 15_000);
  assert.match(leTroca('pavan')?.conferencia?.erro ?? '', /não começou/);
  confereTroca('pavan', { atual: 'origem' }, 15_000 + CONFERE_ERRO_MS);
  assert.equal(leTrocaNoChat('pavan')?.fase, 'falhou');
  assert.equal(guarda.getItem(chave), null);
});
test('f: erro F11 recebido ao restaurar conserva prazo após nova recarga', () => {
  const guarda = inicia();
  limpaTrocasNoChat();
  restauraTroca('pavan', guarda, 100);
  operacaoLida('pavan', carimboDaLeitura('pavan'), op('cliente', 'erro'), 1_000);
  assert.equal(leTroca('pavan')?.fase, 'conferindo');
  assert.notEqual(leTrocaNoChat('pavan')?.fase, 'falhou');
  limpaTrocasNoChat();
  restauraTroca('pavan', guarda, 2_000);
  assert.equal(leTroca('pavan')?.conferencia?.ate, 1_000 + CONFERE_ERRO_MS);
  conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 3_000);
  assert.equal(leTrocaNoChat('pavan'), null);
  assert.equal(guarda.getItem(chave), null);
});
test('persistência: atalho também guarda alvo, entrou, id adotado e eventos', () => {
  const guarda = inicia();
  postRecusado('pavan', 'cliente', 'operacao_em_curso', 10);
  operacaoLida('pavan', carimboDaLeitura('pavan'), { ...op('bloqueou', 'religando'), session_id: 'destino' }, 20);
  limpaTrocasNoChat();
  restauraTroca('pavan', guarda, 30);
  assert.equal(leTroca('pavan')?.id, 'bloqueou');
  assert.equal(leTroca('pavan')?.alvo, 'destino');
  assert.equal(leTroca('pavan')?.entrou, 'destino');
  assert.equal(leTroca('pavan')?.post, 'aceito');
});
test('persistência: descarta pedido da rodada 3 sem fabricar uma operação', () => {
  const guarda = memoria();
  guarda.setItem(chave, JSON.stringify({ ...pedido, acompanhamento: { id: 'cliente', inicio: 10 } }));
  restauraTroca('pavan', guarda, 100);
  assert.equal(leTroca('pavan'), null);
  assert.equal(guarda.getItem(chave), null);
  conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 300);
  assert.equal(leTroca('pavan'), null);
});
test('e: recusas não publicam espera e a pendência escurece só após 2 s', () => {
  inicia();
  confereTroca('pavan', {}, 1_999);
  assert.equal(leTrocaNoChat('pavan'), null);
  confereTroca('pavan', {}, 2_000);
  assert.equal(leTrocaNoChat('pavan')?.fase, 'trocando');
  postRecusado('pavan', 'cliente', 'ocupado', 2_100);
  assert.equal(leTrocaNoChat('pavan'), null);
});
test('g: stream concluiu antes do POST; pronta/erro/rede tardios não reabrem nada', () => {
  const guarda = inicia();
  conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 10);
  postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 20);
  postMorreu('pavan', 'cliente', 30);
  confereTroca('pavan', {}, 9_000);
  assert.equal(leTrocaNoChat('pavan'), null);
  assert.equal(guarda.getItem(chave), null);
});
test('g: resposta tardia do pedido anterior não afeta o seguinte', () => {
  inicia();
  conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 10);
  comecarTroca('pavan', pedido, 20, 'outra');
  postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 30);
  assert.equal(leTroca('pavan')?.clienteId, 'outra');
  assert.equal(leTroca('pavan')?.post, 'pendente');
});
test('leitura: cinco falhas abrem conferência, com Histórico ou só chat', () => {
  inicia();
  const c = carimboDaLeitura('pavan');
  for (let i = 0; i < 4; i++) leituraMorreu('pavan', c, 100);
  assert.equal(leTroca('pavan')?.fase, 'esperando');
  leituraMorreu('pavan', c, 100);
  assert.equal(leTroca('pavan')?.fase, 'conferindo');
  confereTroca('pavan', { atual: 'origem' }, 100 + CONFERE_ERRO_MS);
  assert.equal(leTroca('pavan')?.fase, 'falhou');
  dispensaTroca('pavan');
  postRespondeu('pavan', 'cliente', op('cliente', 'religando'), 50_000);
  assert.equal(leTroca('pavan'), null);
});
test('persistência: lixo e Safari privado não impedem começar', () => {
  for (const cru of ['{quebrado', '{"tipo":"outra"}']) {
    const g = memoria();
    g.setItem(chave, cru);
    limpaTrocasNoChat();
    restauraTroca('pavan', g, 0);
    assert.equal(leTroca('pavan'), null);
  }
  limpaTrocasNoChat();
  const falha = () => { throw new Error('privado'); };
  restauraTroca('pavan', { getItem: falha, setItem: falha, removeItem: falha }, 0);
  comecarTroca('pavan', pedido, 0, 'cliente');
  assert.equal(leTroca('pavan')?.clienteId, 'cliente');
});

test('F11: Nova direta usa sessão resolvida antes do pedido e conferência no stream', () => {
  const guarda = memoria();
  restauraTroca('pavan', guarda, 0);
  confereTroca('pavan', { sessao: 'origem' }, 0);
  comecarTroca('pavan', { tipo: 'nova', alvo: null, desligado: false, forcar: false }, 100, 'cliente');
  assert.equal(leTroca('pavan')?.antes, 'origem');
  postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 200);
  confereTroca('pavan', { sessao: 'destino' }, 300);
  assert.equal(leTroca('pavan')?.fase, 'concluida');
  assert.equal(guarda.getItem(chave), null);
});
test('g: dispensar falha não permite começar a mesma operação de novo', () => {
  inicia();
  postRecusado('pavan', 'cliente', 'Conversa não encontrada', 100);
  dispensaTroca('pavan');
  comecarTroca('pavan', pedido, 200, 'cliente');
  assert.equal(leTroca('pavan'), null);
});
test('troca rápida atualiza consumidores do resultado mesmo sem escurecer o chat', () => {
  inicia();
  let concluidas = 0;
  const solta = assinaTrocaFeita('pavan', () => concluidas++);
  conversaTrocada('pavan', { operacaoId: 'cliente', sessionId: 'destino' }, 100);
  postRespondeu('pavan', 'cliente', op('cliente', 'pronta'), 200);
  assert.equal(leTrocaNoChat('pavan'), null);
  assert.equal(concluidas, 1);
  solta();
});
test('a lista libera nova troca enquanto o chat ainda espera a sessão; resposta anterior não interfere', () => {
  inicia();
  postRespondeu('pavan', 'cliente', op('cliente', 'pronta'), 100);
  confereTroca('pavan', { atual: 'destino' }, 200);
  assert.equal(leTrocaNoChat('pavan')?.fase, 'pronta');
  assert.equal(comecarTroca('pavan', pedido, 300, 'outra'), 'outra');
  postRespondeu('pavan', 'cliente', op('cliente', 'erro'), 400);
  assert.equal(leTroca('pavan')?.id, 'outra');
  assert.equal(leTroca('pavan')?.post, 'pendente');
});
