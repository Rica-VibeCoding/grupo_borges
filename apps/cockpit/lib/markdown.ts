import { defaultUrlTransform } from 'react-markdown';

function isTextPart(value: unknown): value is { type: 'text'; text: string } {
  if (typeof value !== 'object' || value === null) return false;
  const part = value as Record<string, unknown>;
  return part.type === 'text' && typeof part.text === 'string';
}

/**
 * Normaliza as três formas reais de `message.content`. Ausência ou array sem
 * texto não cria wrapper vazio; string legada atravessa sem transformação.
 */
export function normalizeMarkdownContent(content: unknown): string | null {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter(isTextPart).map((part) => part.text).join('\n\n')
        : '';

  return text === '' ? null : text;
}

/**
 * Mantém a política de URL do react-markdown explícita e testável fora do DOM.
 * Protocolos perigosos ou não reconhecidos viram href/src vazio.
 */
export function transformMarkdownUrl(url: string): string {
  return defaultUrlTransform(url);
}

export function mergeMarkdownClassName(base: string, received?: string): string {
  return received ? `${base} ${received}` : base;
}

export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * O marcador só vale ocupando a primeira linha inteira da citação — é a regra
 * do GitHub, e é o que impede que uma citação FALANDO de `[!NOTE]` vire alerta.
 *
 * Casa contra UM nó de texto porque no mdast a quebra MOLE não vira nó: só a
 * quebra dura vira `Break` ("represents a hard line break", content-model do
 * syntax-tree/mdast). Logo `> [!NOTE]` + quebra normal chega inteiro como
 * `"[!NOTE]\ntexto"` — confirmado despejando a árvore do pipeline real.
 *
 * Case-insensitive de propósito, mesmo o GitHub exigindo maiúscula: quem escreve
 * aqui é LLM, e `[!note]` cairia exatamente no bug que este plugin conserta.
 */
const ALERT_PREFIX = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\S\r\n]*(?:\r?\n|$)/i;

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> } & Record<string, unknown>;
};

/**
 * Corta o `[!NOTE]` do texto e devolve o tipo. Mutação intencional: é assim que
 * plugin remark trabalha, e é o que tira o marcador literal da tela.
 */
function extractAlertKind(blockquote: MdastNode): AlertKind | null {
  const paragraph = blockquote.children?.[0];
  if (paragraph?.type !== 'paragraph') return null;

  const first = paragraph.children?.[0];
  if (first?.type !== 'text' || typeof first.value !== 'string') return null;

  const match = ALERT_PREFIX.exec(first.value);
  if (match === null) return null;

  first.value = first.value.slice(match[0].length);

  // Sobra vazia em três formas medidas na árvore real: marcador seguido de
  // linha em branco (parágrafo só dele), marcador seguido de negrito
  // (`"[!WARNING]\n"` + strong) e marcador com quebra DURA — dois espaços no
  // fim, que viram um nó `break` à parte. Sem podar, o alerta abre com uma
  // linha vazia no topo.
  if (first.value === '') {
    paragraph.children?.shift();
    if (paragraph.children?.[0]?.type === 'break') paragraph.children.shift();
    if (paragraph.children?.length === 0) blockquote.children?.shift();
  }

  return match[1].toLowerCase() as AlertKind;
}

function visitBlockquotes(node: MdastNode, visit: (blockquote: MdastNode) => void): void {
  if (node.type === 'blockquote') visit(node);
  for (const child of node.children ?? []) visitBlockquotes(child, visit);
}

/**
 * Plugin remark: marca `> [!NOTE]` & cia com `data-alert` para o componente
 * pintar. Roda antes do remark-rehype (react-markdown monta
 * `remarkParse → remarkPlugins → remarkRehype → rehypePlugins`), então o
 * `data.hProperties` é honrado na conversão para hast — medido, chega como
 * prop `data-alert` no override de `blockquote`.
 *
 * Feito à mão, sem dependência: o remark-gfm não implementa alerts (não estão
 * na spec do GFM, são extensão do GitHub) e nenhum plugin de terceiro entra
 * num `pnpm-lock.yaml` que é de todo mundo por 20 linhas de AST.
 */
export function remarkCockpitAlerts() {
  return (tree: MdastNode): void => {
    visitBlockquotes(tree, (blockquote) => {
      const kind = extractAlertKind(blockquote);
      if (kind === null) return;

      blockquote.data = {
        ...blockquote.data,
        hProperties: { ...blockquote.data?.hProperties, 'data-alert': kind },
      };
    });
  };
}

export function parseAlertKind(value: unknown): AlertKind | null {
  return ALERT_KINDS.includes(value as AlertKind) ? (value as AlertKind) : null;
}
