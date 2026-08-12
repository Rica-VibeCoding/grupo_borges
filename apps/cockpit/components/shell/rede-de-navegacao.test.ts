import assert from 'node:assert/strict';
import { test } from 'node:test';

import { criaRedeDeNavegacao } from './rede-de-navegacao.ts';

const LIMITE = 1_200;

/** Relógio de mentira: nada de `setTimeout` de verdade num teste que fala de
 *  1,2 s. `avanca` roda o que venceu, inclusive o que foi reagendado no meio. */
function bancada(inicial: string) {
  let href = inicial;
  let navegando = true;
  const recarregou: string[] = [];
  let proximo = 1;
  const timers = new Map<number, { em: number; fn: () => void }>();
  let agora = 0;

  const rede = criaRedeDeNavegacao({
    hrefAtual: () => href,
    navegando: () => navegando,
    recarrega: (h) => recarregou.push(h),
    agendar: (fn, ms) => {
      const id = proximo++;
      timers.set(id, { em: agora + ms, fn });
      return id;
    },
    cancelar: (id) => timers.delete(id),
    limiteMs: LIMITE,
  });

  return {
    rede,
    recarregou,
    timersVivos: () => timers.size,
    chega: (novo: string) => {
      href = novo;
      navegando = false;
    },
    transicaoTerminou: () => {
      navegando = false;
    },
    avanca(ms: number) {
      const ate = agora + ms;
      while (true) {
        const vencido = [...timers.entries()]
          .filter(([, t]) => t.em <= ate)
          .sort((a, b) => a[1].em - b[1].em)[0];
        if (!vencido) break;
        const [id, t] = vencido;
        timers.delete(id);
        agora = t.em;
        t.fn();
      }
      agora = ate;
    },
  };
}

test('navegação que commita dentro do limite não recarrega nada', () => {
  const b = bancada('/agente/daniel');
  b.rede.arma('/agente/daniel?painel=detalhes');
  b.chega('/agente/daniel?painel=detalhes');
  b.avanca(LIMITE * 3);
  assert.deepEqual(b.recarregou, []);
});

// O DEFEITO de 12/08. A URL só muda quando a navegação COMMITA, e a rota do
// agente levava de 0,4 s a 10,5 s no servidor. A rede antiga lia esses segundos
// como falha e dava `window.location.assign` por cima de uma navegação que
// estava indo bem — o "pisca, refaz a tela" do Rica, que leva junto o texto do
// composer e a barra de compactação.
test('navegação lenta ainda em voo é reexaminada, nunca recarregada', () => {
  const b = bancada('/agente/daniel');
  b.rede.arma('/agente/daniel?painel=detalhes');

  // Cinco segundos de servidor lento: a transição segue pendente o tempo todo.
  b.avanca(5_000);
  assert.deepEqual(b.recarregou, [], 'recarregou uma navegação que estava em voo');

  // E quando enfim chega, continua sem recarregar.
  b.chega('/agente/daniel?painel=detalhes');
  b.avanca(LIMITE * 2);
  assert.deepEqual(b.recarregou, []);
});

test('navegação que morreu de verdade cai pro navegador', () => {
  const b = bancada('/agente/daniel');
  b.rede.arma('/agente/daniel?painel=detalhes');
  // A transição terminou e a URL é a mesma: o roteador não levou a lugar nenhum.
  b.transicaoTerminou();
  b.avanca(LIMITE);
  assert.deepEqual(b.recarregou, ['/agente/daniel?painel=detalhes']);
});

test('um toque só recarrega uma vez, mesmo depois de reexames', () => {
  const b = bancada('/agente/daniel');
  b.rede.arma('/agente/daniel?painel=detalhes');
  b.avanca(5_000);
  b.transicaoTerminou();
  b.avanca(LIMITE * 5);
  assert.deepEqual(b.recarregou, ['/agente/daniel?painel=detalhes']);
});

// Abrir e fechar a gaveta em menos de 1,2 s deixava DOIS disparos armados, e o
// primeiro comparava contra um href que a segunda navegação tinha acabado de
// restaurar — recarregava reabrindo a gaveta que o Rica tinha fechado.
test('toque novo desarma o anterior', () => {
  const b = bancada('/agente/daniel');
  b.rede.arma('/agente/daniel?painel=detalhes');
  b.rede.arma('/agente/daniel');
  assert.equal(b.timersVivos(), 1, 'deixou disparo solto do toque anterior');
  b.transicaoTerminou();
  b.avanca(LIMITE);
  assert.deepEqual(b.recarregou, ['/agente/daniel']);
});

test('desarmar no desmonte não deixa disparo pendente', () => {
  const b = bancada('/agente/daniel');
  b.rede.arma('/agente/daniel?painel=detalhes');
  b.rede.cancela();
  assert.equal(b.timersVivos(), 0);
  b.transicaoTerminou();
  b.avanca(LIMITE * 5);
  assert.deepEqual(b.recarregou, []);
});
