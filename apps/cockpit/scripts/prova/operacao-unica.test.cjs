/**
 * A OPERAÇÃO ÚNICA no componente — escolher aplica sozinho.
 *
 * A régua da máquina está em `operacao-de-motor.test.ts`, sem React. Aqui é a
 * outra metade, a que ela não alcança: que a ESCOLHA na gaveta dispara a
 * operação, e só quando a escolha não vale na sessão viva. Sem isto, "aplica
 * sozinho" seria afirmação sobre código que ninguém executou.
 */
const assert = require('node:assert/strict');
const { beforeEach, it } = require('node:test');
const { bancada, painel } = require('./seletor-familia-harness.cjs');

async function montarSeletor(familia = 'kimi') {
  const b = bancada();
  b.shell('operacao-de-motor').esquecerTudo();
  const { SeletorMotor } = b.shell('seletor-motor');
  const { ConteudoDoSeletor } = b.shell('seletor-motor-menu');
  let arvore;
  await b.renderer.act(async () => {
    arvore = b.renderer.create(b.React.createElement(SeletorMotor, b.props));
  });
  await b.renderer.act(async () => b.leituras[0].resolve(painel(familia)));
  const menu = () => arvore.root.findByType(ConteudoDoSeletor).props;
  return { ...b, arvore, menu, act: b.renderer.act };
}

beforeEach(() => bancada().shell('operacao-de-motor').esquecerTudo());

it('modelo que só vale no boot dispara a operação; o que troca a quente NÃO', async () => {
  const b = await montarSeletor('kimi');
  await b.act(async () => b.menu().opcoesModelo[1].aoSelecionar());
  await b.act(async () =>
    b.modelos[0].resolve({
      tmux_delivered: false, state_persisted: true, confirmed: false,
      runtime_switch: false, model: 'k3',
    }),
  );
  assert.equal(b.aplicacoes.length, 1, 'persist-only tem de religar');
  assert.equal(b.aplicacoes[0].force, false, 'o primeiro toque nunca força');
  await b.act(async () => arvoreFecha(b));

  const vivo = await montarSeletor('anthropic');
  await vivo.act(async () => vivo.menu().opcoesModelo[1].aoSelecionar());
  await vivo.act(async () =>
    vivo.modelos[0].resolve({
      tmux_delivered: true, state_persisted: true, confirmed: true,
      runtime_switch: true, model: 'sonnet',
    }),
  );
  assert.equal(vivo.aplicacoes.length, 0, 'troca a quente não custa boot nenhum');
});

it('esforço que só vale no boot dispara; o que a sessão assume NÃO', async () => {
  const b = await montarSeletor('kimi');
  await b.act(async () => b.menu().opcoesEsforco[0].aoSelecionar());
  await b.act(async () =>
    b.esforcos[0].resolve({
      slug: 'canarinho', effort: 'low', source: 'agent_state.kimi_reasoning_effort',
      session_may_diverge: true, written: true,
    }),
  );
  assert.equal(b.aplicacoes.length, 1);
  await b.act(async () => arvoreFecha(b));

  const vivo = await montarSeletor('anthropic');
  await vivo.act(async () => vivo.menu().opcoesEsforco[0].aoSelecionar());
  await vivo.act(async () =>
    vivo.esforcos[0].resolve({
      slug: 'canarinho', effort: 'low', source: 'settings', written: true,
      session_may_diverge: false, confirmed: true,
    }),
  );
  assert.equal(vivo.aplicacoes.length, 0);
});

it('agente no meio de um turno: nada é desligado até o segundo toque', async () => {
  const b = await montarSeletor('kimi');
  await b.act(async () => b.menu().opcoesModelo[1].aoSelecionar());
  await b.act(async () =>
    b.modelos[0].resolve({
      tmux_delivered: false, state_persisted: true, confirmed: false,
      runtime_switch: false, model: 'k3',
    }),
  );
  const ocupado = Object.assign(new Error('busy'), {
    status: 409, detail: 'agent_busy_confirm_required',
  });
  await b.act(async () => b.aplicacoes[0].reject(ocupado));

  const operacao = b.shell('operacao-de-motor');
  assert.equal(operacao.leiaOperacao('canarinho').fase, 'confirmando');
  assert.equal(b.aplicacoes.length, 1, 'a recusa não pode virar retentativa automática');

  const texto = JSON.stringify(b.arvore.toJSON());
  assert.ok(texto.includes('Confirmar?'), 'sem alvo, a pergunta ficaria sem resposta possível');
  assert.ok(texto.includes('meio de um turno'));
});

function arvoreFecha(b) {
  b.arvore.unmount();
  b.shell('operacao-de-motor').esquecerTudo();
}
