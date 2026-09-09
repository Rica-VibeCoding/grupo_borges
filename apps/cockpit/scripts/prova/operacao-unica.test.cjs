/**
 * A OPERAÇÃO ÚNICA no componente — escolher aplica sozinho.
 *
 * A régua da máquina está em `operacao-de-motor.test.ts`, sem React. Aqui é a
 * outra metade, a que ela não alcança: que a ESCOLHA na gaveta dispara a
 * operação, e só quando a escolha não vale na sessão viva. Sem isto, "aplica
 * sozinho" seria afirmação sobre código que ninguém executou.
 *
 * O que a escolha dispara é o AGRUPAMENTO, não o religar — modelo e esforço são
 * duas escolhas para o mesmo boot, e uma por religar custava dois (Rica, 09/09).
 * Quanto tempo ele espera e que sai um religar só é régua da máquina, provada
 * com relógio falso no teste de lá; aqui vale que a escolha certa agenda e a
 * que troca a quente não agenda nada.
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
  assert.equal(
    b.shell('operacao-de-motor').leiaOperacao('canarinho').fase,
    'agrupando',
    'persist-only tem de religar',
  );
  assert.equal(b.aplicacoes.length, 0, 'religar na hora é o que custava o segundo boot');
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
  assert.equal(
    vivo.shell('operacao-de-motor').leiaOperacao('canarinho').fase,
    'ocioso',
    'nem o relógio do agrupamento — não há nada para aplicar',
  );
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
  assert.equal(b.shell('operacao-de-motor').leiaOperacao('canarinho').fase, 'agrupando');
  assert.equal(b.aplicacoes.length, 0);
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
  assert.equal(vivo.shell('operacao-de-motor').leiaOperacao('canarinho').fase, 'ocioso');
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
  // O relógio do agrupamento é de parede, e o timer falso não atravessa o `vm`
  // onde a bancada carrega o módulo. Nove segundos parados custam menos que uma
  // prova que não exercita o caminho da tela.
  const { ESPERA_DE_AGRUPAMENTO_MS } = b.shell('operacao-de-motor');
  await b.act(async () => esperar(ESPERA_DE_AGRUPAMENTO_MS + 500));
  assert.equal(b.aplicacoes.length, 1, 'passado o relógio, o religar sai uma vez');

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

function esperar(ms) {
  return new Promise((pronto) => setTimeout(pronto, ms));
}

function arvoreFecha(b) {
  b.arvore.unmount();
  b.shell('operacao-de-motor').esquecerTudo();
}
