/**
 * O envelope continua sendo o contrato entre o backend e o agente; esta camada
 * só o traduz para apresentação. O caminho absoluto nunca chega ao DOM.
 *
 * Formato produzido por `_agent_file_message`:
 *   Imagem enviada via cockpit:
 *   /.../uploads/agents/<slug>/<arquivo>
 *   Caption: <legenda opcional, inclusive com novas linhas>
 */

export type AnexoImagem = {
  filename: string;
  legenda: string | null;
};

const ENVELOPE_IMAGEM =
  /^Imagem enviada via cockpit:[ \t]*\r?\n([^\r\n]+?)(?:\r?\nCaption:[ \t]*([\s\S]*))?$/i;

const CAMINHO_DO_UPLOAD =
  /(?:^|[\\/])uploads[\\/]agents[\\/][^\\/\s]+[\\/]([^\\/\s]+\.(?:jpg|png|webp))$/i;

/** Só reconhece o envelope inteiro. Texto comum que apenas menciona o prefixo
 * continua sendo fala do Rica, sem desaparecer dentro de uma imagem. */
export function leAnexoImagem(texto: string): AnexoImagem | null {
  const envelope = texto.match(ENVELOPE_IMAGEM);
  if (!envelope) return null;

  const caminho = envelope[1]?.trim();
  if (!caminho) return null;

  const upload = caminho.match(CAMINHO_DO_UPLOAD);
  const filename = upload?.[1];
  if (!filename) return null;

  const legenda = envelope[2]?.trim() || null;
  return { filename, legenda };
}

export function urlDoAnexoImagem(agentSlug: string, filename: string): string {
  return `/api/agents/${encodeURIComponent(agentSlug)}/file/${encodeURIComponent(filename)}`;
}
