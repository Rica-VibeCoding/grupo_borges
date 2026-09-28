/**
 * O envelope de VÍDEO que o `/file` entrega ao agente e que volta no feed.
 *
 * Formato produzido por `_agent_file_message` (apps/api/routers/agents.py):
 *   Vídeo enviado via cockpit:
 *   /.../uploads/agents/<slug>/<arquivo>.mp4
 *   Nome original: <nome>
 *   Não há visão de vídeo nativa: …
 *   Caption: <legenda opcional, inclusive com novas linhas>
 *
 * Diferente da imagem, o CC não anexa vídeo sozinho: o envelope chega inteiro,
 * numa mensagem só. Sem este leitor ele aparecia na tela como texto cru, com o
 * caminho absoluto e a instrução de ffmpeg que é recado para o agente.
 *
 * Só o envelope INTEIRO vira vídeo: cabeçalho na primeira linha e o caminho,
 * sozinho, na segunda. Fala do Rica que cita o prefixo continua fala.
 */

export type AnexoVideo = { filename: string; legenda: string | null };

const ABERTURA = /^V[ií]deo enviado via cockpit:\s*$/i;

const CAMINHO_DO_UPLOAD =
  /^(?:\S*[\\/])?uploads[\\/]agents[\\/][^\\/\s]+[\\/]([^\\/\s]+\.(?:mp4|mov|webm|m4v))$/i;

const LEGENDA = /^Caption:[ \t]*([\s\S]*)$/;

export function leAnexoVideo(texto: string): AnexoVideo | null {
  const linhas = texto.trim().split(/\r?\n/);
  if (!ABERTURA.test(linhas[0] ?? '')) return null;
  const filename = (linhas[1] ?? '').trim().match(CAMINHO_DO_UPLOAD)?.[1];
  if (!filename) return null;

  // Entre o caminho e a legenda vêm as linhas de serviço ("Nome original",
  // o recado do ffmpeg) — são para o agente, não para a tela. A legenda é tudo
  // a partir da primeira linha `Caption:`, com as quebras que o Rica digitou.
  const resto = linhas.slice(2);
  const inicio = resto.findIndex((linha) => LEGENDA.test(linha));
  if (inicio === -1) return { filename, legenda: null };
  const legenda = resto.slice(inicio).join('\n').match(LEGENDA)?.[1]?.trim();
  return { filename, legenda: legenda || null };
}
