/**
 * A TRAVA DE TELA — que ela exista, que cubra o viewport e que saia sozinha.
 *
 * A régua das fases está em `operacao-de-motor.test.ts`, sem React. Esta é a
 * metade que ela não alcança: montar o `BlocoDeAcoes` de verdade e ver o véu
 * nascer na fase `aplicando`. Sem isto, "trava a tela" seria afirmação sobre
 * código que ninguém executou — e a primeira versão da operação passou verde em
 * tudo e mesmo assim deixou o Rica clicando no meio do religamento (09/09).
 */
const assert = require('node:assert/strict');
const { beforeEach, it } = require('node:test');
const { bancada, painel } = require('./seletor-familia-harness.cjs');

const SLUG = 'canarinho';

function veus(arvore) {
  return arvore.root.findAll((no) => no.props && no.props.role === 'alertdialog', {
    deep: true,
  });
}

async function montarBloco() {
  const b = bancada();
  const operacao = b.shell('operacao-de-motor');
  operacao.esquecerTudo();
  const { BlocoDeAcoes } = b.shell('bloco-de-acoes');
  let arvore;
  await b.renderer.act(async () => {
    arvore = b.renderer.create(
      b.React.createElement(BlocoDeAcoes, { agentSlug: SLUG, aberto: true }),
    );
  });
  await b.renderer.act(async () => b.leituras[0].resolve(painel('kimi', SLUG)));
  return { ...b, operacao, arvore, act: b.renderer.act };
}

beforeEach(() => bancada().shell('operacao-de-motor').esquecerTudo());

it('em repouso não há véu nenhum sobre a tela', async () => {
  const b = await montarBloco();
  assert.equal(veus(b.arvore).length, 0);
});

it('a trava nasce quando a operação começa e cobre o viewport inteiro', async () => {
  const b = await montarBloco();
  await b.act(async () => {
    b.operacao.aplicarMotor(SLUG, {
      aplicar: () => new Promise(() => {}),
      reler: () => {},
    });
  });

  const [veu] = veus(b.arvore);
  assert.ok(veu, 'a fase aplicando tem de montar a trava');
  assert.match(veu.props.className, /fixed/, 'preso ao viewport, não à caixa da gaveta');
  assert.match(veu.props.className, /inset-0/, 'cobre a tela toda');
  assert.equal(veu.props.style.zIndex, 'var(--ck-z-modal)', 'acima da gaveta e dos menus');
  assert.equal(veu.props['aria-busy'], true);
  assert.equal(veu.props['aria-modal'], true);
  assert.equal(
    veu.props['aria-label'],
    b.shell('operacao-de-motor').textoDesligando(),
    'quem não vê a tela precisa ouvir o mesmo aviso',
  );
});

it('a falha troca a trava por um alerta — a tela volta a ser do Rica', async () => {
  const b = await montarBloco();
  const erro = Object.assign(new Error('deu ruim'), { status: 500, detail: 'deu ruim' });
  await b.act(async () => {
    b.operacao.aplicarMotor(SLUG, { aplicar: () => Promise.reject(erro), reler: () => {} });
  });
  assert.equal(veus(b.arvore).length, 0, 'véu que sobrevive à falha prende o Rica na tela');
});

it('a pergunta do turno em voo não trava a tela — ela espera o toque dele', async () => {
  const b = await montarBloco();
  const busy = Object.assign(new Error('busy'), {
    status: 409, detail: 'agent_busy_confirm_required',
  });
  await b.act(async () => {
    b.operacao.aplicarMotor(SLUG, { aplicar: () => Promise.reject(busy), reler: () => {} });
  });
  assert.equal(b.operacao.leiaOperacao(SLUG).fase, 'confirmando');
  assert.equal(veus(b.arvore).length, 0, 'travar a tela sem estar aplicando nada é tela morta');
});

it('a escolha guardada não trava a tela — é com ela aberta que ele escolhe o resto', async () => {
  const b = await montarBloco();
  await b.act(async () => {
    b.operacao.marcarPendente(SLUG, { aplicar: () => Promise.resolve({}), reler: () => {} });
  });
  assert.equal(b.operacao.leiaOperacao(SLUG).fase, 'agrupando');
  assert.equal(veus(b.arvore).length, 0, 'véu antes de aplicar impediria a segunda escolha');
});
