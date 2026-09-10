/**
 * O AGRUPAMENTO DE PONTA A PONTA — do toque na gaveta ao boot do agente.
 *
 * As outras provas param na borda: `operacao-de-motor.test.ts` mede a régua sem
 * React, `operacao-unica.test.cjs` monta o componente com a rede fingida.
 * Nenhuma das duas responde "trocar modelo e esforço na tela custa quantos
 * boots de verdade?" — que é a pergunta do Rica em 09/09, e a que eu já errei
 * uma vez respondendo por leitura de código.
 *
 * Aqui o componente é o de verdade, o cliente é o de `cockpit-core`, o servidor
 * é a 3008 publicada, o agente é um agente real e a contagem sai do journal do
 * systemd. O que falta para ser navegador é pixel e evento de mouse — o caminho
 * de dados é o mesmo.
 *
 * ⚠️ ISTO DESLIGA E RELIGA UM AGENTE DE VERDADE. Por isso o slug é obrigatório
 * na linha de comando, sem default: rodar por acidente custa a sessão de alguém.
 *
 *   npm install --prefix /tmp/rtr --no-save react-test-renderer@19.2.6 react@19.2.6
 *   cd apps/cockpit && REACT_TEST_RENDERER=/tmp/rtr/node_modules/react-test-renderer \
 *     node scripts/prova/agrupamento-ponta-a-ponta.cjs tara
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const SLUG = process.argv[2];
if (!SLUG) {
  console.error('uso: node scripts/prova/agrupamento-ponta-a-ponta.cjs <slug-do-agente>');
  console.error('     (o agente é DESLIGADO e RELIGADO de verdade)');
  process.exit(2);
}
const BASE = process.env.COCKPIT_URL || 'http://127.0.0.1:3008';

// O cliente de `cockpit-core` fala em caminho relativo porque no navegador a
// origem é o próprio cockpit. Em Node não há origem: é ela que entra aqui.
const fetchDireto = globalThis.fetch;
globalThis.fetch = (url, opcoes) =>
  fetchDireto(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, opcoes);

const { bancada } = require('./seletor-familia-harness.cjs');

const esperar = (ms) => new Promise((pronto) => setTimeout(pronto, ms));

function agora() {
  return execFileSync('date', ['+%Y-%m-%d %H:%M:%S'], { encoding: 'utf8' }).trim();
}

function bootsDesde(marco) {
  const saida = execFileSync(
    'journalctl',
    ['--user', '-u', `cockpit-ligar-${SLUG}.service`, '--since', marco, '--no-pager'],
    { encoding: 'utf8' },
  );
  return saida.split('\n').filter((l) => l.includes(`Started cockpit-ligar-${SLUG}`)).length;
}

/** O motor que o processo vivo carrega — a única fonte que não mente sobre
 *  modelo e esforço (a statusline do agente com motor trocado mente). */
function motorDoProcesso() {
  for (const pid of fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    let cwd;
    try {
      cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      if (!cwd.includes(`/${SLUG}`)) continue;
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmd.includes('bin/claude')) continue;
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      const ler = (chave) => env.find((l) => l.startsWith(`${chave}=`))?.slice(chave.length + 1);
      return { pid, modelo: ler('ANTHROPIC_MODEL'), esforco: ler('CLAUDE_CODE_EFFORT_LEVEL') };
    } catch {
      continue;
    }
  }
  return null;
}

async function main() {
  const b = bancada({ apiDeVerdade: true });
  const operacao = b.shell('operacao-de-motor');
  operacao.esquecerTudo();
  const { SeletorMotor } = b.shell('seletor-motor');
  const { ConteudoDoSeletor } = b.shell('seletor-motor-menu');

  const antes = motorDoProcesso();
  assert.ok(antes, `nenhum processo do ${SLUG} vivo — a prova precisa dele de pé`);
  console.log(`• antes: pid ${antes.pid}, ${antes.modelo} + ${antes.esforco}`);

  let arvore;
  await b.renderer.act(async () => {
    arvore = b.renderer.create(
      b.React.createElement(SeletorMotor, { ...b.props, agentSlug: SLUG, agentName: SLUG }),
    );
  });
  // O painel vem do servidor: aqui não há promessa para resolver à mão.
  for (let i = 0; i < 40 && !arvore.root.findAllByType(ConteudoDoSeletor).length; i += 1) {
    await b.renderer.act(async () => esperar(250));
  }
  const menu = () => arvore.root.findByType(ConteudoDoSeletor).props;
  assert.ok(menu().opcoesModelo.length, 'a gaveta chegou sem modelo para escolher');
  console.log('✓ o painel do servidor chegou na gaveta');

  const modeloNovo = menu().opcoesModelo.find((o) => !o.selecionado);
  const esforcoNovo = menu().opcoesEsforco.find((o) => !o.selecionado);
  assert.ok(modeloNovo && esforcoNovo, 'sem um segundo valor não há o que agrupar');

  const marco = agora();
  console.log(`• marco ${marco} — tocando ${modeloNovo.rotulo} e ${esforcoNovo.rotulo}`);

  await b.renderer.act(async () => modeloNovo.aoSelecionar());
  await b.renderer.act(async () => esperar(1200));
  assert.equal(
    operacao.leiaOperacao(SLUG).fase,
    'agrupando',
    'a primeira escolha tinha de guardar a pendência, não religar',
  );
  assert.equal(bootsDesde(marco), 0, 'religou na primeira escolha — é o defeito de volta');
  console.log('✓ a primeira escolha ficou guardada, sem boot');

  await b.renderer.act(async () => esforcoNovo.aoSelecionar());
  await b.renderer.act(async () => esperar(1200));
  assert.equal(bootsDesde(marco), 0, 'a segunda escolha não pode cobrar o seu próprio boot');
  console.log('✓ a segunda escolha entrou com a gaveta ainda aberta');

  // O gatilho: fechar a gaveta é dizer "escolhi".
  await b.renderer.act(async () => menu().aoFechar());
  console.log('• gaveta fechada — esperando o boot');
  await b.renderer.act(async () => esperar(25_000));

  const boots = bootsDesde(marco);
  assert.equal(boots, 1, `duas escolhas, ${boots} boots — era um`);
  console.log('✓ UM boot para as duas escolhas');

  const depois = motorDoProcesso();
  assert.ok(depois, 'o agente não voltou depois do religar');
  assert.notEqual(depois.pid, antes.pid, 'mesmo pid: não houve religar nenhum');
  assert.equal(depois.modelo, modeloNovo.chave, 'o modelo escolhido não entrou no boot');
  assert.equal(depois.esforco, esforcoNovo.chave, 'o esforço escolhido não entrou no boot');
  console.log(`✓ o processo novo (pid ${depois.pid}) carrega ${depois.modelo} + ${depois.esforco}`);

  arvore.unmount();
  operacao.esquecerTudo();
  console.log('\nTUDO CERTO — do toque na gaveta ao motor do processo, um religar só.');
}

main().then(
  () => process.exit(0),
  (erro) => {
    console.error(`\nFALHOU: ${erro.message}`);
    process.exit(1);
  },
);
