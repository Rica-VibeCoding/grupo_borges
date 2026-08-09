/**
 * O envelope continua sendo o contrato entre o backend e o agente; esta camada
 * só o traduz para apresentação. O caminho absoluto nunca chega ao DOM.
 *
 * Formato produzido por `_agent_file_message`:
 *   Imagem enviada via cockpit: <nome gravado>
 *   /.../uploads/agents/<slug>/<nome gravado>
 *   Caption: <legenda opcional, inclusive com novas linhas>
 *
 * O CC anexa a imagem por conta própria: apaga a linha do caminho, prefixa
 * `[Image #N]` ao texto e grava logo depois uma linha `[Image: source: …]` com
 * o caminho de volta. Por isso o nome vai TAMBÉM no cabeçalho — é o único
 * pedaço do envelope que sobrevive à mastigação — e por isso a linha do
 * caminho é opcional na leitura.
 */

export type AnexoImagem = {
  filename: string;
  legenda: string | null;
};

/** Prefixo que o CC cola no texto ao anexar a imagem sozinho. */
const MARCADOR_DE_ANEXO = /^\[Image #\d+]/;

/** A linha que o CC grava DEPOIS da mensagem, com o caminho de origem. */
const MARCADOR_DE_ORIGEM = /^\[Image: source: .+]$/;

const ABERTURA = /^Imagem enviada via cockpit:[ \t]*(.*)$/i;

const NOME_GRAVADO = /^[\w.-]+\.(?:jpg|png|webp)$/i;

const CAMINHO_DO_UPLOAD =
  /(?:^|[\\/])uploads[\\/]agents[\\/][^\\/\s]+[\\/]([^\\/\s]+\.(?:jpg|png|webp))$/i;

const LEGENDA = /^Caption:[ \t]*([\s\S]*)$/;

/** Registro do harness, não fala de ninguém: sozinho não desenha nada. */
export function ehMarcadorDeOrigem(texto: string): boolean {
  return MARCADOR_DE_ORIGEM.test(texto.trim());
}

/** Só reconhece o envelope inteiro. Texto comum que apenas menciona o prefixo
 * continua sendo fala do Rica, sem desaparecer dentro de uma imagem. */
export function leAnexoImagem(texto: string): AnexoImagem | null {
  const linhas = texto.split(/\r?\n/);
  const abertura = (linhas[0] ?? '').replace(MARCADOR_DE_ANEXO, '').match(ABERTURA);
  if (!abertura) return null;

  // O caminho vence o cabeçalho quando existe: é ele que aponta o arquivo em
  // disco. O cabeçalho é a rede que segura o caso em que o CC comeu a linha.
  const cabecalho = (abertura[1] ?? '').trim();
  const doCaminho = (linhas[1] ?? '').trim().match(CAMINHO_DO_UPLOAD)?.[1];
  const filename = doCaminho ?? (NOME_GRAVADO.test(cabecalho) ? cabecalho : undefined);
  if (!filename) return null;

  const resto = linhas.slice(doCaminho ? 2 : 1).join('\n');
  if (!resto) return { filename, legenda: null };

  const legenda = resto.match(LEGENDA);
  if (!legenda) return null;
  return { filename, legenda: legenda[1]?.trim() || null };
}

export function urlDoAnexoImagem(agentSlug: string, filename: string): string {
  return `/api/agents/${encodeURIComponent(agentSlug)}/file/${encodeURIComponent(filename)}`;
}
