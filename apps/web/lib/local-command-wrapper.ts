// DS-65 F5-4 — slash-command wrappers que vazam pro JSONL como user message.
//
// Quando o user roda slash command nativo do CC (/model, /clear, /compact,
// /reload-plugins, etc), o CLI grava bubbles user com wrappers internos que
// não foram digitados pelo user — e o ChatMessages os renderia como bubbles
// gigantes com XML cru. Mesmo problema visual do `<channel source=>` (F4-1)
// e `<task-notification>` (F5-1): ruído de protocolo onde devia ter conversa.
//
// Estratégia: ocultar totalmente o user message quando seu content (após
// trim) é composto EXCLUSIVAMENTE pelas tags abaixo, possivelmente várias
// concatenadas entre si. O ChatPanel já comunica modelo atual via header /
// statusline, então o user não perde informação. Texto livre misturado com
// uma dessas tags inline → mantém bubble (proteção contra falso-positivo).
//
// Whitelist conservadora (6 tags). Alargar só quando aparecer um wrapper
// novo que vaze cru — não usar regex genérico de "qualquer XML no início".

const WRAPPER_TAGS = [
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-caveat',
  'system-reminder',
] as const;

// `[\s\S]*?` em vez de `.*?` porque os bodies de stdout/caveat/system-reminder
// frequentemente têm quebras de linha. Backreference \1 garante tag de
// fechamento idêntica à de abertura. `\s*` antes do `>` em ambas as pontas
// tolera variantes raras tipo `<command-name >x</command-name >` que algum
// build do CC possa emitir — sem custo prático e fecha um silenciamento
// silencioso. Wrapper com atributo (`<system-reminder priority="x">`) NÃO
// casa de propósito: comportamento conservador deixa bubble visível em
// vez de esconder por engano.
const WRAPPER_BLOCK_RE = new RegExp(
  `<(${WRAPPER_TAGS.join('|')})\\s*>[\\s\\S]*?</\\1\\s*>`,
  'g',
);

// Detecção barata pré-strip: se nem a abertura aparece, sai cedo sem alocar
// a string limpa.
const WRAPPER_OPEN_RE = new RegExp(
  `<(${WRAPPER_TAGS.join('|')})\\s*>`,
);

/**
 * `true` quando o texto inteiro (após trim) é composto APENAS por wrappers
 * de slash command nativos do CC, possivelmente concatenados, possivelmente
 * com whitespace entre eles. Texto livre fora dos wrappers → `false`.
 *
 * O caller deve usar isso ANTES de qualquer render de bubble user pra
 * suprimir o item completamente (Opção A do DS-65 F5-4).
 */
export function looksLikeLocalCommandWrapper(raw: string): boolean {
  if (!raw) return false;
  if (!WRAPPER_OPEN_RE.test(raw)) return false;
  const stripped = raw.replace(WRAPPER_BLOCK_RE, '').trim();
  return stripped.length === 0;
}
