const assert = require('node:assert/strict');
const { it } = require('node:test');
const { bancada, painel } = require('./seletor-familia-harness.cjs');

async function montar() {
  const b = bancada();
  const { SeletorMotor } = b.shell('seletor-motor');
  const { GatilhoDoSeletor } = b.shell('seletor-motor-gatilho');
  const { ConteudoDoSeletor } = b.shell('seletor-motor-menu');
  let arvore;
  await b.renderer.act(async () => { arvore = b.renderer.create(b.React.createElement(SeletorMotor, b.props)); });
  const publicar = async (novo) => b.renderer.act(async () => b.shell('sincronizacao-painel').publicarPainel(novo));
  const receber = async (novo) => b.renderer.act(async () => b.leituras[0].resolve(novo));
  const gatilho = () => arvore.root.findByType(GatilhoDoSeletor).props;
  const menu = () => arvore.root.findByType(ConteudoDoSeletor).props;
  const fechar = async () => b.renderer.act(async () => arvore.unmount());
  return { ...b, arvore, publicar, receber, gatilho, menu, fechar };
}

it('carregamento, ausência e falha nunca exibem preferência YAML', async () => {
  const b = await montar();
  assert.ok(!JSON.stringify(b.arvore.toJSON()).includes('YAML INCOMPATÍVEL'));
  await b.receber({ ...painel(), model: null, effort: { ...painel().effort, value: null, allowed: [] } });
  assert.equal(b.arvore.toJSON(), null);
  await b.fechar();
  const falha = await montar();
  await falha.renderer.act(async () => falha.leituras[0].reject(new Error('rede')));
  assert.ok(!JSON.stringify(falha.arvore.toJSON()).includes('YAML INCOMPATÍVEL'));
  await falha.fechar();
});

it('mesmo slug atualiza os três campos sem releitura; outro slug e GET velho não vencem', async () => {
  const b = await montar();
  await b.publicar(painel('kimi', 'daniel'));
  assert.ok(!JSON.stringify(b.arvore.toJSON()).includes('K2.7 Coding'));
  await b.publicar(painel());
  assert.equal(b.gatilho().rotuloModelo, 'K2.7 Coding');
  assert.equal(b.gatilho().etiquetaEsforco.palavra, 'padrão');
  assert.equal(b.leituras.length, 1);
  assert.equal(b.leituras[0].signal.aborted, true);
  await b.receber(painel('anthropic'));
  assert.equal(b.gatilho().rotuloModelo, 'K2.7 Coding');
  await b.fechar();
});

it('modelo null oferece escolha neutra com rótulos oficiais, sem seleção inventada', async () => {
  const b = await montar();
  const novo = painel(); novo.model.value = null; novo.effort.value = null;
  await b.receber(novo);
  assert.equal(b.gatilho().rotuloModelo, 'Escolher modelo');
  assert.equal(b.gatilho().rotuloDoEsforco, 'Escolher esforço');
  assert.equal(b.menu().opcoesModelo[0].rotulo, 'K2.7 Coding');
  assert.ok(b.menu().opcoesModelo.every((opcao) => !opcao.selecionado));
  await b.fechar();
});

it('OpenCode conserva só esforço e ressalva aparece apenas com divergência', async () => {
  const b = await montar();
  const novo = painel('opencode');
  await b.receber(novo);
  assert.equal(b.gatilho().rotuloModelo, null);
  assert.equal(b.menu().opcoesModelo.length, 0);
  assert.equal(b.menu().opcoesEsforco.length, 3);
  assert.ok(!JSON.stringify(b.arvore.toJSON()).includes('Vale no próximo boot'));
  await b.publicar({ ...novo, effort: { ...novo.effort, session_may_diverge: true } });
  assert.ok(JSON.stringify(b.arvore.toJSON()).includes(b.shell('troca-de-motor').TEXTO_VALE_NO_BOOT));
  await b.fechar();
});

it('Codex lista e atualiza modelo pelo identificador cru', async () => {
  const b = await montar(); await b.receber(painel('codex-proxy'));
  assert.equal(b.menu().opcoesModelo.length, 2);
  await b.renderer.act(async () => b.menu().opcoesModelo[1].aoSelecionar());
  assert.equal(b.modelos[0].value, 'gpt-5.6-sol[1m]');
  await b.renderer.act(async () => b.modelos[0].resolve({ model: 'gpt-5.6-sol[1m]',
    runtime_switch: false, state_persisted: true, tmux_delivered: false, confirmed: false }));
  assert.equal(b.gatilho().rotuloModelo, '5.6 Sol');
  assert.ok(JSON.stringify(b.arvore.toJSON()).includes('Vale no próximo boot'));
  await b.fechar();
});

for (const tipo of ['modelo', 'esforco']) {
  for (const resultado of ['sucesso', 'erro']) {
    it(`${tipo}: ignora ${resultado} de mutação da família anterior`, async () => {
      const b = await montar(); await b.receber(painel('anthropic'));
      await b.renderer.act(async () => (tipo === 'modelo' ? b.menu().opcoesModelo : b.menu().opcoesEsforco)[0].aoSelecionar());
      await b.publicar(painel('kimi'));
      const pedido = (tipo === 'modelo' ? b.modelos : b.esforcos)[0];
      await b.renderer.act(async () => resultado === 'erro' ? pedido.reject(new Error('antigo')) : pedido.resolve({
        model: 'opus', effort: 'xhigh', written: true, confirmed: true, tmux_delivered: true,
      }));
      assert.equal(b.gatilho().rotuloModelo, 'K2.7 Coding');
      assert.equal(b.gatilho().rotuloDoEsforco, 'alto');
      assert.equal(b.menu().aviso, null);
      assert.equal(b.menu().salvando, false);
      await b.fechar();
    });
  }
}

it('troca de família para convergência e ignora callback antigo', async () => {
  const b = await montar(); await b.receber(painel('anthropic'));
  await b.renderer.act(async () => b.menu().opcoesEsforco[0].aoSelecionar());
  await b.renderer.act(async () => b.esforcos[0].resolve({ written: true, tmux_delivered: true, confirmed: false }));
  assert.equal(b.convergencias.length, 1);
  await b.publicar(painel());
  assert.equal(b.convergencias[0].parado, true);
  await b.renderer.act(async () => b.convergencias[0].receber(painel('anthropic')));
  assert.equal(b.gatilho().rotuloModelo, 'K2.7 Coding');
  await b.fechar();
});

it('BlocoDeAcoes publica somente a leitura mais recente e não publica após desmontar', async () => {
  const b = bancada(); const { BlocoDeAcoes } = b.shell('bloco-de-acoes');
  const recebidos = [];
  const parar = b.shell('sincronizacao-painel').sincronizarPainel('canarinho', () => new Promise(() => {}),
    (novo) => recebidos.push(novo), () => {});
  let arvore;
  await b.renderer.act(async () => { arvore = b.renderer.create(b.React.createElement(BlocoDeAcoes, { agentSlug: 'canarinho', aberto: true })); });
  await b.renderer.act(async () => b.leituras[0].resolve(painel('anthropic')));
  const atualizar = arvore.root.findByType('BlocoDeMotor').props.aoAtualizar;
  await b.renderer.act(async () => { atualizar(); atualizar(); });
  await b.renderer.act(async () => b.leituras[2].resolve(painel('kimi')));
  await b.renderer.act(async () => b.leituras[1].resolve(painel('anthropic')));
  assert.deepEqual(recebidos.map((p) => p.motor.familia), ['anthropic', 'kimi']);
  await b.renderer.act(async () => atualizar());
  await b.renderer.act(async () => arvore.unmount());
  await b.renderer.act(async () => b.leituras[3].resolve(painel('opencode')));
  assert.equal(recebidos.length, 2);
  parar();
});

it('statusline não recicla modelo configurado e preserva modelo realmente lido', async () => {
  const b = bancada(); const { Statusline } = b.shell('statusline');
  const agente = { state_model: 'opus', model_default: 'gpt-6-astra[1m]', pane_excerpt: '',
    pane_session_started_at: null, context_updated_at: null, context_pct: null };
  let arvore;
  await b.renderer.act(async () => { arvore = b.renderer.create(b.React.createElement(Statusline, { agente, agora: 1 })); });
  assert.ok(!JSON.stringify(arvore.toJSON()).includes('Opus'));
  await b.renderer.act(async () => arvore.update(b.React.createElement(Statusline, {
    agente: { ...agente, pane_excerpt: 'Opus 5 - 02:50:23 - [███░] 12%' }, agora: 1,
  })));
  assert.ok(JSON.stringify(arvore.toJSON()).includes('Opus 5'));
  await b.renderer.act(async () => arvore.unmount());
});
