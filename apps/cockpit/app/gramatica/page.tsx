/**
 * Vitrine da gramática da execução — rota de trabalho, não de produto.
 *
 * Existe porque a linha de ferramenta não tem onde ser vista: a `/agente/[slug]`
 * ainda não monta o feed, e a `/spike` é bancada calibrada do gate numérico —
 * trocar a peça medida lá invalidaria a comparação com as rodadas anteriores.
 *
 * Os casos abaixo são reais, tirados de sessões desta semana. Vitrine com dado
 * inventado mente sobre comprimento, e comprimento é metade do problema numa
 * tela de 390px.
 */
import { LinhaExecucao } from '@/components/renderers/linha-execucao';
import type { EntradaExecucao } from '@/components/renderers/gramatica';

function Secao({ titulo, nota, children }: {
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <div
        className="flex flex-col"
        style={{ gap: '2px', padding: '0 var(--ck-space-3)' }}
      >
        <span
          style={{
            fontSize: 'var(--ck-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ck-track-overline)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          {titulo}
        </span>
        {nota ? (
          <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            {nota}
          </span>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

const CORRIDA: EntradaExecucao[] = [
  {
    toolName: 'Bash',
    args: { command: 'git pull --rebase', description: 'Sincroniza antes de editar' },
    result: 'Current branch main is up to date.',
  },
  {
    toolName: 'Bash',
    args: { command: 'git status --short', description: 'Foto do que está em andamento' },
    result: '?? .claude/worktrees/',
  },
  {
    toolName: 'Read',
    args: { file_path: '/home/clawd/repos/grupo_borges/docs/cockpit-v2-estetica.md' },
    result: '# Contrato de estética — Cockpit v2\n'.repeat(569),
  },
  {
    toolName: 'Bash',
    args: {
      command: 'npm test 2>&1 | grep -E "^# (tests|pass|fail)"',
      description: 'Roda a suíte inteira',
    },
    result: '# tests 85\n# pass 85\n# fail 0',
  },
  {
    toolName: 'Edit',
    args: {
      file_path: '/home/clawd/repos/grupo_borges/apps/cockpit/components/renderers/gramatica.ts',
      old_string: "import { calculateDiff, summarizeDiff } from './diff-lines';\n",
      new_string:
        '// Extensão explícita porque este módulo é lido pelo `node --test` direto.\n' +
        "import { calculateDiff, summarizeDiff } from './diff-lines.ts';\n",
    },
    result: 'The file has been updated successfully.',
  },
  {
    toolName: 'WebFetch',
    args: {
      url: 'https://react.dev/reference/react/useMemo',
      prompt: 'Quando useMemo não preserva identidade entre renders?',
    },
    result: 'useMemo is a React Hook that lets you cache the result…\n'.repeat(38),
  },
  {
    toolName: 'Bash',
    args: { command: 'npx tsc --noEmit', description: 'Confere os tipos' },
    result: '',
  },
];

const VOCABULARIO: EntradaExecucao[] = [
  {
    toolName: 'WebSearch',
    args: { query: 'assistant-ui external store runtime virtualization' },
    result: 'Links (8)\n'.repeat(8),
  },
  {
    toolName: 'mcp__supabase_geral__execute_sql',
    args: { query: "select slug, status from fc_backlog where tipo = 'melhoria' order by id desc" },
    result: [{ type: 'text', text: 'slug | status\n'.repeat(14) }],
  },
  {
    toolName: 'Write',
    args: {
      file_path:
        '/home/clawd/repos/grupo_borges/apps/cockpit/components/renderers/linha-execucao.tsx',
      content: 'export function LinhaExecucao() {}\n'.repeat(287),
    },
    result: 'File created successfully.',
  },
  {
    toolName: 'Agent',
    args: {
      description: 'Audita a camada de renderers',
      subagent_type: 'general-purpose',
      prompt: 'Varre components/renderers e relate divergências contra o contrato de estética.',
    },
    result: 'Relatório\n'.repeat(52),
  },
  {
    toolName: 'mcp__plugin_telegram_telegram__reply',
    args: { chat_id: '000', format: 'markdownv2', text: 'A gramática da execução está de pé.' },
    result: 'ok',
  },
  { toolName: 'Skill', args: { skill: 'canal-telegram' }, result: 'skill carregada' },
  { toolName: 'TaskList', args: {}, result: '' },
];

const ESTADOS: EntradaExecucao[] = [
  {
    toolName: 'Bash',
    args: { command: 'npm run build', description: 'Compila para produção' },
    estado: 'running',
  },
  {
    toolName: 'Bash',
    args: { command: 'rm -rf apps/api/db/grupo_borges.db', description: 'Limpa o banco do canário' },
    estado: 'requires-action',
  },
  {
    toolName: 'Bash',
    args: { command: 'node --test components/renderers/gramatica.test.ts', description: 'Roda o teste novo' },
    isError: true,
    result:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/renderers/diff-lines' imported from" +
      " …/renderers/gramatica.ts\n    at finalizeResolution (node:internal/modules/esm/resolve:275:11)",
  },
];

export default function GramaticaPage() {
  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{
        gap: 'var(--ck-space-6)',
        background: 'var(--ck-surface-canvas)',
        padding: 'calc(var(--ck-space-5) + var(--ck-safe-top)) 0 var(--ck-space-8)',
      }}
    >
      <header className="flex flex-col" style={{ gap: '2px', padding: '0 var(--ck-space-3)' }}>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--ck-text-hero)',
            lineHeight: 'var(--ck-leading-hero)',
            letterSpacing: 'var(--ck-track-hero)',
            color: 'var(--ck-text-primary)',
          }}
        >
          A gramática da execução
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
          Sete verbos, um caractere cada. Toque numa linha para abrir.
        </p>
      </header>

      <Secao
        titulo="A corrida"
        nota="O caso de sempre: uma sequência de execução. A coluna à esquerda lê-se de cima a baixo."
      >
        {CORRIDA.map((entrada, i) => (
          <LinhaExecucao key={i} {...entrada} />
        ))}
      </Secao>

      <Secao titulo="Aberta" nota="A frase que o agente escreveu, o pedido íntegro e o que saiu.">
        <LinhaExecucao
          aberta
          toolName="Bash"
          args={{
            command:
              "cd /home/clawd/repos/grupo_borges && npm test 2>&1 | grep -E '^# (tests|pass|fail)'",
            description: 'Roda a suíte inteira e resume o placar',
          }}
          result={'# tests 85\n# pass 85\n# fail 0'}
        />
      </Secao>

      <Secao titulo="Aberta — edição" nota="O diff sai dos próprios argumentos do Edit.">
        <LinhaExecucao
          aberta
          toolName="Edit"
          args={{
            file_path: '/home/clawd/repos/grupo_borges/apps/cockpit/app/globals.css',
            old_string: '  --ck-dur-fast: 120ms;\n  --ck-dur-calm: 320ms;\n',
            new_string: '  --ck-dur-fast: 120ms;\n  --ck-dur-enter: 200ms;\n  --ck-dur-calm: 320ms;\n',
          }}
          result="The file has been updated successfully."
        />
      </Secao>

      <Secao titulo="O vocabulário" nota="Cada sigilo cobre um verbo, não uma marca.">
        {VOCABULARIO.map((entrada, i) => (
          <LinhaExecucao key={i} {...entrada} />
        ))}
      </Secao>

      <Secao
        titulo="Quando a máquina precisa de você"
        nota="Concluído é silêncio. Só rodando, esperando e falhando têm cor."
      >
        {ESTADOS.map((entrada, i) => (
          <LinhaExecucao key={i} {...entrada} />
        ))}
      </Secao>

      <Secao titulo="Aberta — falha" nota="Nada pisca: a superfície perde o fio de luz.">
        <LinhaExecucao aberta {...ESTADOS[2]} />
      </Secao>
    </div>
  );
}
