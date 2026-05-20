// Fixtures pro OneLineChip (DS-70/JP-17).
//
// Cada caso = props prontas pra passar pro componente. Cobertura: cada
// `kind`, cada `tone`, expansível vs não-expansível, summary curta vs
// truncada, com/sem trailing. Usado na preview manual via dev server
// e como referência viva pra integração final (chat-messages.tsx + classifier
// da Tara).
//
// Não há suite Vitest no apps/web — render snapshot ficaria como teste manual
// até Pavan/Rica decidirem investir em fixture runner. Por ora, este arquivo
// é o "storybook lite" do componente.

import type { OneLineChipKind, OneLineChipTone } from '../../components/one-line-chip';

export type OneLineChipFixture = {
  name: string;
  /** Glyph como string — caller pode embrulhar em <span> se quiser. */
  icon: string;
  label: string;
  summary?: string;
  trailing?: string;
  expandBody?: string | null;
  kind: OneLineChipKind;
  tone?: OneLineChipTone;
};

export type OneLineChipFixtureExt = OneLineChipFixture & { timestamp?: string };

export const ONE_LINE_CHIP_FIXTURES: OneLineChipFixtureExt[] = [
  // --- slash command -----------------------------------------------------
  {
    name: 'slash-model-opus',
    icon: '⌘',
    label: 'slash command',
    summary: '/model → Set model to opus-4.7',
    expandBody: '/model opus-4.7\n\nSet model to claude-opus-4-7.',
    kind: 'slash',
  },
  {
    name: 'slash-clear-no-output',
    icon: '⌘',
    label: 'slash command',
    summary: '/clear',
    expandBody: null,
    kind: 'slash',
  },
  {
    name: 'slash-reload-plugins',
    icon: '⌘',
    label: 'slash command',
    summary: '/reload-plugins → Reloaded 2 plugins · 6 agents · 14 skills',
    expandBody: 'Reloaded 2 plugins.\nReloaded 6 agents.\nReloaded 14 skills.\nReloaded 4 hooks.',
    kind: 'slash',
  },

  // --- skill -------------------------------------------------------------
  {
    name: 'skill-memoria',
    icon: '✦',
    label: 'skill',
    summary: 'memoria · "tara codex isolation worktree"',
    trailing: '4 hits',
    expandBody: '[shared_decisao_codex_skill] codex consolidado em skill...\n[shared_tara_sala_guia_tmp] sala da Tara...',
    kind: 'skill',
  },
  {
    name: 'skill-codex-imagem',
    icon: '✦',
    label: 'skill',
    summary: 'codex · gerar mockup hero light',
    trailing: '23s',
    expandBody: 'codex exec image generation\n  → /home/clawd/.codex/generated_images/2026-05-17-hero-mockup.png',
    kind: 'skill',
    tone: 'completed',
  },

  // --- tool --------------------------------------------------------------
  {
    name: 'tool-bash-git-status',
    icon: '🔧',
    label: 'Bash',
    summary: 'git status',
    expandBody: 'On branch main\nYour branch is up to date with origin/main.\nnothing to commit, working tree clean',
    kind: 'tool',
  },
  {
    name: 'tool-edit-long-path-truncado',
    icon: '🔧',
    label: 'Edit',
    summary: '/home/clawd/repos/grupo_borges/apps/web/components/chat-messages.tsx',
    expandBody: '@@ -255,6 +256,12 @@\n+      if (looksLikeLocalCommandWrapper(text)) continue;',
    kind: 'tool',
  },
  {
    name: 'tool-bash-erro',
    icon: '🔧',
    label: 'Bash',
    summary: 'pnpm lint',
    trailing: 'exit 1',
    expandBody: 'Invalid project directory provided, no such directory: ./lint',
    kind: 'tool',
    tone: 'error',
  },

  // --- sidechain (subagent) ----------------------------------------------
  {
    name: 'sidechain-rodando',
    icon: '⏳',
    label: 'subagent',
    summary: 'general-purpose · review F5-4 segurança regex',
    trailing: '12s',
    expandBody: null,
    kind: 'sidechain-cluster',
    tone: 'active',
  },
  {
    name: 'sidechain-concluido',
    icon: '✓',
    label: 'subagent',
    summary: 'general-purpose · review F5-4 arquitetural',
    trailing: '28s',
    expandBody: '47k tokens · 6 tool uses · patch passa, sem blockers.',
    kind: 'sidechain-cluster',
    tone: 'completed',
  },
  {
    name: 'sidechain-stalled',
    icon: '⚠',
    label: 'subagent',
    summary: 'Explore · listing apps/web/components',
    trailing: 'sem resposta há 42s',
    kind: 'sidechain-cluster',
    tone: 'stalled',
  },

  // --- envelope ----------------------------------------------------------
  {
    name: 'envelope-whatsapp-audio',
    icon: '🎙',
    label: 'WhatsApp',
    summary: 'Rica · áudio recebido',
    trailing: '14:32',
    expandBody: '[player de áudio aqui na integração real]',
    kind: 'channel-envelope',
  },
  {
    name: 'envelope-telegram-foto',
    icon: '🖼',
    label: 'Telegram',
    summary: 'Rica · print do bug',
    trailing: '23:18',
    expandBody: '[<img/> da foto na integração real]',
    kind: 'channel-envelope',
  },
  {
    name: 'envelope-whatsapp-texto',
    icon: '💬',
    label: 'WhatsApp',
    summary: 'Rica: pusha F5-4 agora',
    trailing: '18:42',
    expandBody: null,
    kind: 'channel-envelope',
  },

  // --- thinking ----------------------------------------------------------
  {
    name: 'thinking-curto',
    icon: '💭',
    label: 'pensou 3s',
    timestamp: '22:15',
    expandBody: 'Rica quer chip único universal — vou refatorar 9 variantes em sprint.',
    kind: 'thinking',
  },

  // --- meta-decision -----------------------------------------------------
  {
    name: 'meta-decision-silenciado',
    icon: '🤐',
    label: 'meta-decisão',
    summary: 'silenciado',
    timestamp: '22:18',
    expandBody: 'eco da minha própria mensagem — não respondo.',
    kind: 'meta-decision',
  },

  // --- user --------------------------------------------------------------
  {
    name: 'user-mensagem-curta',
    icon: '👤',
    label: 'você',
    summary: 'pusha F5-4 agora, sangramento na UI',
    timestamp: '18:42',
    expandBody: 'pusha F5-4 agora, sangramento na UI\n\nResposta curta.',
    kind: 'user',
  },

  // --- user-internal -----------------------------------------------------
  {
    name: 'user-internal-hook',
    icon: '⚙',
    label: 'evento interno',
    summary: 'hook UserPromptSubmit injetou contexto Telegram',
    timestamp: '22:20',
    expandBody: '<channel source="telegram" chat_id="7262275215" message_id="2886"…>',
    kind: 'user-internal',
  },

  // --- synthetic (wakeup ScheduleWakeup + STT 🎙) -------------------------
  {
    name: 'synthetic-wakeup-dynamic',
    icon: '⏰',
    label: 'Wakeup dinâmico',
    summary: 'ScheduleWakeup',
    timestamp: '00:25',
    kind: 'synthetic',
  },
  {
    name: 'synthetic-wakeup-cron',
    icon: '🗓',
    label: 'Wakeup agendado',
    summary: 'CronCreate',
    timestamp: '07:00',
    kind: 'synthetic',
  },
  {
    name: 'synthetic-stt',
    icon: '🎙',
    label: 'Áudio transcrito',
    summary: 'Testando áudio pelo cockpit',
    timestamp: '00:31',
    expandBody: 'Testando áudio pelo cockpit.',
    kind: 'synthetic',
  },
];
