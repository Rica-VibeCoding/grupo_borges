const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const app = path.resolve(__dirname, '../..');
const local = createRequire(path.join(app, 'package.json'));
const ts = local('typescript');
const rendererPath = require.resolve(process.env.REACT_TEST_RENDERER || 'react-test-renderer');
const renderer = require(rendererPath);
const React = createRequire(rendererPath)('react');
global.IS_REACT_ACT_ENVIRONMENT = true;
global.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };

function pendente() {
  let resolve, reject;
  const promise = new Promise((sim, nao) => { resolve = sim; reject = nao; });
  return { promise, resolve, reject };
}

function painel(familia = 'kimi', slug = 'canarinho') {
  const modelos = familia === 'kimi' ? ['kimi-for-coding', 'k3', 'k3-256k']
    : familia === 'codex-proxy' ? ['gpt-6-astra[1m]', 'gpt-5.6-sol[1m]'] : ['opus', 'sonnet'];
  return {
    slug, generated_at: 1,
    motor: { familia, override: familia, source: 'agent_state' },
    model: familia === 'opencode' ? null : {
      value: modelos[0], allowed: modelos, source: 'state_model',
      labels: { 'kimi-for-coding': 'K2.7 Coding', 'k3-256k': 'K3-256k' },
      session_may_diverge: false, runtime_switch: familia === 'anthropic',
    },
    effort: { value: 'high', allowed: ['low', 'high', 'max'], requested: null,
      source: 'statusline', session_may_diverge: false },
    vida: { processo: true }, permission: { mode: 'ask' }, contexto: {}, quotas: {},
    canal_entrega: {}, subagents: {},
  };
}

/**
 * `opcoes.apiDeVerdade` troca o cliente falso pelo de `cockpit-core` — é o que
 * permite a prova que atravessa do toque na gaveta até o boot do agente
 * (`agrupamento-ponta-a-ponta.cjs`). Sem ele a bancada nunca sai da memória.
 */
function bancada(opcoes = {}) {
  const cache = new Map();
  const leituras = [], esforcos = [], modelos = [], convergencias = [], aplicacoes = [], familias = [];
  class AgentInputError extends Error {}
  let api = {
    AgentInputError,
    fetchAgentPainel(slug, signal) {
      const espera = pendente(); leituras.push({ slug, signal, ...espera }); return espera.promise;
    },
    patchAgentEffort(slug, value) {
      const espera = pendente(); esforcos.push({ slug, value, ...espera }); return espera.promise;
    },
    postAgentModel(slug, value) {
      const espera = pendente(); modelos.push({ slug, value, ...espera }); return espera.promise;
    },
    postAgentAplicarMotor(slug, options) {
      const espera = pendente();
      aplicacoes.push({ slug, force: options?.force ?? false, ...espera });
      return espera.promise;
    },
    patchAgentMotorFamilia(slug, familia) {
      const espera = pendente(); familias.push({ slug, familia, ...espera }); return espera.promise;
    },
  };
  const ui = new Proxy({}, { get: (_, nome) => function Item(props) {
    return React.createElement(nome === 'DropdownMenuItem' ? 'button' : 'div', props, props.children);
  } });
  function carregar(nome) {
    let arquivo = nome;
    if (!path.extname(arquivo)) arquivo += fs.existsSync(`${arquivo}.tsx`) ? '.tsx' : '.ts';
    if (cache.has(arquivo)) return cache.get(arquivo).exports;
    const modulo = { exports: {} }; cache.set(arquivo, modulo);
    function importar(id) {
      if (id === 'react') return React;
      if (id === 'react/jsx-runtime') return createRequire(rendererPath)(id);
      if (id === '@grupo_borges/cockpit-core/api') return api;
      if (id.includes('/ui/dropdown-menu')) return ui;
      if (id === './superficie-otimista') return { usePainelAberto: (aberto) => aberto };
      if (id === '../../lib/compact') return { usaCompact: () => ({ estado: { fase: 'ocioso' } }) };
      if (['./bloco-de-motor', './bloco-de-cota', './bloco-de-comandos'].includes(id)) {
        const nome = { './bloco-de-motor': 'BlocoDeMotor', './bloco-de-cota': 'BlocoDeCota', './bloco-de-comandos': 'BlocoDeComandos' }[id];
        return { [nome]: (props) => React.createElement(nome, props) };
      }
      if (id === './convergencia-esforco') return {
        esperaConvergenciaDoEsforco(valor, ler, receber) {
          const controle = { valor, ler, receber, parado: false, parar() { this.parado = true; } };
          convergencias.push(controle); return controle;
        },
      };
      if (id.startsWith('.')) return carregar(path.resolve(path.dirname(arquivo), id));
      return local(id);
    }
    const codigo = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${codigo}\n})`, { filename: arquivo })(importar, modulo, modulo.exports);
    return modulo.exports;
  }
  if (opcoes.apiDeVerdade) {
    api = carregar(path.join(app, '../../packages/cockpit-core/src/api.ts'));
  }
  const shell = (nome) => carregar(path.join(app, 'components/shell', nome));
  const props = { agentSlug: 'canarinho', agentName: 'Canário',
    motor: { modelo: 'YAML INCOMPATÍVEL', esforco: 'extra alto', certeza: 'pode-divergir' },
    esforcoCobrePedido: false };
  return { React, renderer, shell, props, leituras, esforcos, modelos, convergencias, aplicacoes, familias, api };
}
module.exports = { bancada, painel };
