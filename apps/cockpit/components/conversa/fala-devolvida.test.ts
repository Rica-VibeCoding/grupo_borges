import assert from 'node:assert/strict';
import { it } from 'node:test';

import { criaFalaDevolvida } from './fala-devolvida.ts';

/** Fala, envia e confirma a entrega; devolve o texto que foi ao servidor. */
const fala = (d: ReturnType<typeof criaFalaDevolvida>, texto: string) => {
  const envio = d.envio(texto);
  const enviado = envio.monta();
  envio.entrou();
  return enviado;
};

it('sem freio, o envio sai como foi dito', () => {
  const d = criaFalaDevolvida();
  assert.equal(fala(d, 'abre o painel'), 'abre o painel');
});

it('freio que limpou o pedido guarda a fala, e a próxima sai emendada nela', () => {
  const d = criaFalaDevolvida();
  fala(d, 'abre o painel');
  d.freio()({ pedido_limpo: true });
  assert.equal(fala(d, 'e mostra o card'), 'abre o painel e mostra o card');
});

it('freio sem pedido limpo não guarda nada: a fala já está no histórico', () => {
  const d = criaFalaDevolvida();
  fala(d, 'abre o painel');
  d.freio()({ pedido_limpo: false });
  assert.equal(fala(d, 'e mostra o card'), 'e mostra o card');
});

it('sem fala enviada antes do freio, não há o que guardar', () => {
  const d = criaFalaDevolvida();
  d.freio()({ pedido_limpo: true });
  assert.equal(fala(d, 'oi'), 'oi');
});

it('enviada a emenda, a guardada sai: a terceira fala não repete a primeira', () => {
  const d = criaFalaDevolvida();
  fala(d, 'abre o painel');
  d.freio()({ pedido_limpo: true });
  fala(d, 'e mostra o card');
  assert.equal(fala(d, 'obrigado'), 'obrigado');
});

it('emenda apagada de novo vira a guardada inteira', () => {
  const d = criaFalaDevolvida();
  fala(d, 'abre o painel');
  d.freio()({ pedido_limpo: true });
  fala(d, 'e mostra');
  d.freio()({ pedido_limpo: true });
  assert.equal(fala(d, 'o card'), 'abre o painel e mostra o card');
});

it('freio que responde durante a retentativa entra na tentativa seguinte', () => {
  const d = criaFalaDevolvida();
  fala(d, 'abre o painel');
  const resposta = d.freio();
  const envio = d.envio('e mostra o card');
  assert.equal(envio.monta(), 'e mostra o card'); // 409: pane preso pelo freio
  resposta({ pedido_limpo: true });
  assert.equal(envio.monta(), 'abre o painel e mostra o card');
});

it('pedido que entrou na fila ou conversa encerrada descartam a guardada', () => {
  const d = criaFalaDevolvida();
  fala(d, 'abre o painel');
  d.freio()({ pedido_limpo: true });
  d.descarta();
  assert.equal(fala(d, 'oi'), 'oi');
});
