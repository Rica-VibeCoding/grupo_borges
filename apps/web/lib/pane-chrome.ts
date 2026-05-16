// Filtragem do chrome do Claude Code que vaza no excerpt do tmux,
// detect de frame parcial e render ANSI mínimo.
//
// Lógica antes embutida em `components/chat-panel.tsx`. Extraída pra
// permitir teste isolado em `tests/pane-chrome.test.mjs`.
//
// JP-11 Fase 1 — DS-58.

const SEPARATOR_RULE = /[─━═│┃╭╮╰╯╱╳─-╿▀-▟]{8,}/u;

// CSI ANSI escapes (cursor moves, clears, SGR). Aplicado quando o caller
// quer texto puro pra teste de regex/parse de statusline.
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

// Statusline modelo: "Opus 4.7 - 32:13 - [█░] 16%". Tolera prefixo livre
// (linha pode vir com glifos/Remote Control concatenado).
const STATUSLINE = /^.*?\b(?:Opus|Sonnet|Haiku)\s+\d+\.\d+\b.*?\d+%/;

// Verb-spinner FINALIZADO: "✻ Brewed for 5m 23s", "⏺ Cogitated for 1m · ↑ 2.7k".
//
// Conservador: exige glifo CC no prefixo OU sufixo "·"/"•" com cauda de
// metadados (tokens/thought). Sem nenhum dos dois, prosa do assistant tipo
// "esperando for 30 segundos" ou "espera for 2 min" fica preservada. O preço
// é não strippar linhas tipo "Brewed for 5m" cruas (sem glifo, sem cauda) —
// raro no CC e prosa hipoteticamente legítima também.
const CC_GLYPH = /[✻✶⏺·•⏵▶★]/u;
const SPINNER_FINISHED = new RegExp(
  // (a) prefixo com glifo CC, depois verbo capitalizado + "for"
  '^\\s*' + CC_GLYPH.source + '\\s+[A-ZÀ-Ÿ][\\wÀ-ÿé]*(?:ed|ing|aed)\\s+for\\s+\\d+m?\\s*\\d*s?(?:\\s*[·•].*)?\\s*$' +
  '|' +
  // (b) sem glifo, mas com cauda metadata "· ↑/↓ N tokens" ou "thought for"
  '^\\s*[A-ZÀ-Ÿ][\\wÀ-ÿé]*(?:ed|ing|aed)\\s+for\\s+\\d+m?\\s*\\d*s?\\s+[·•].*(?:tokens|thought for)\\b.*$',
  'u',
);

// Spinner ATIVO com contador de tokens entre parênteses:
// "· Boogieing… (1m 8s · ↓ 2.7k tokens · thought for 33s)" — pode ter glifo
// CC no prefixo (✻ ✶ ⏺) em vez de bullet.
const SPINNER_ACTIVE = /^[\s·•⏺✻✶★⏵▶]+\w+(?:ing|ed|aed)\.?…?\s*\(.*tokens.*\)\s*$/u;

const REMOTE_CONTROL = /Remote Control\s+\w+/;
const BYPASS_PERMISSIONS = /bypass permissions/;

export const CC_CHROME_PATTERNS: RegExp[] = [
  STATUSLINE,
  SPINNER_FINISHED,
  SPINNER_ACTIVE,
  REMOTE_CONTROL,
  BYPASS_PERMISSIONS,
];

export function isChromeLine(line: string): boolean {
  if (!line) return false;
  const stripped = line.replace(ANSI_CSI, '');
  if (!stripped) return false;
  if (SEPARATOR_RULE.test(stripped)) return true;
  return CC_CHROME_PATTERNS.some((re) => re.test(stripped));
}

export function stripChrome(src: string): string {
  if (!src) return src;
  return src
    .split('\n')
    .map((line) => (isChromeLine(line) ? '' : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '');
}

// Frame parcial detect: última linha não-vazia bate spinner ATIVO.
// Quando true, o caller deve segurar o frame anterior (ref) e descartar
// o atual até o spinner sumir — evita flicker de meio-frame.
export function endsWithActiveSpinner(excerpt: string): boolean {
  if (!excerpt) return false;
  const lines = excerpt.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const stripped = lines[i].replace(ANSI_CSI, '').trim();
    if (!stripped) continue;
    return SPINNER_ACTIVE.test(stripped);
  }
  return false;
}

// ---------- ANSI render --------------------------------------------------

const ANSI_COLOR_MAP: Record<number, string> = {
  30: 'var(--ansi-black, #1a1a1a)',
  31: 'var(--ansi-red, #c44)',
  32: 'var(--ansi-green, #4a4)',
  33: 'var(--ansi-yellow, #ca4)',
  34: 'var(--ansi-blue, #58c)',
  35: 'var(--ansi-magenta, #c4c)',
  36: 'var(--ansi-cyan, #4cc)',
  37: 'var(--ansi-white, #ccc)',
  90: 'var(--ansi-gray, #888)',
  91: 'var(--ansi-bright-red, #f66)',
  92: 'var(--ansi-bright-green, #6f6)',
  93: 'var(--ansi-bright-yellow, #ff6)',
  94: 'var(--ansi-bright-blue, #6af)',
  95: 'var(--ansi-bright-magenta, #f6f)',
  96: 'var(--ansi-bright-cyan, #6ff)',
  97: 'var(--ansi-bright-white, #fff)',
};

export type AnsiSegment = { text: string; color?: string; bold?: boolean };

// Parser pequeno — só SGR (CSI ... m). Cursor moves, clears, scroll regions
// são removidos do texto. Cobre cores básicas 30-37/90-97 + bold/reset, o
// suficiente pro chrome CC. 256-color e truecolor ficam pra Fase 2 com
// `ansi-to-html` se necessário.
const SGR_RE = /\x1b\[((?:\d+;?)*)m/g;

export function parseAnsi(input: string): AnsiSegment[] {
  if (!input) return [];
  const out: AnsiSegment[] = [];
  let cursor = 0;
  let color: string | undefined;
  let bold = false;
  let m: RegExpExecArray | null;
  SGR_RE.lastIndex = 0;
  while ((m = SGR_RE.exec(input)) !== null) {
    if (m.index > cursor) {
      out.push({ text: input.slice(cursor, m.index), color, bold });
    }
    const codes = m[1].split(';').filter((s) => s.length > 0).map(Number);
    if (codes.length === 0) {
      color = undefined;
      bold = false;
    }
    for (const code of codes) {
      if (code === 0) { color = undefined; bold = false; continue; }
      if (code === 1) { bold = true; continue; }
      if (code === 22) { bold = false; continue; }
      if (code === 39) { color = undefined; continue; }
      if (ANSI_COLOR_MAP[code] !== undefined) { color = ANSI_COLOR_MAP[code]; }
      // 38/48 (256/truecolor) e demais: consumidos sem efeito visual.
    }
    cursor = SGR_RE.lastIndex;
  }
  if (cursor < input.length) {
    out.push({ text: input.slice(cursor), color, bold });
  }
  return out
    .map((s) => ({ ...s, text: s.text.replace(ANSI_CSI, '') }))
    .filter((s) => s.text.length > 0);
}
