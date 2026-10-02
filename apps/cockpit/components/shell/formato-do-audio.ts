/**
 * O formato do áudio que sobe — mime, extensão e assinatura do container. Saiu
 * de `voz.ts` (02/10) com os comentários; lá ficam o gesto, o piso e a aparência.
 */

// ---------------------------------------------------------------------------
// Formato — o item 5 do despacho.
// ---------------------------------------------------------------------------

/** Os quatro que o back aceita (`_VOICE_ALLOWED_MIMES`, agents.py:1991). */
export const MIMES_ACEITOS = ['audio/ogg', 'audio/webm', 'audio/mp4', 'audio/mpeg'] as const;

/** Ordem de preferência ao CONSTRUIR o gravador.
 *
 * `audio/webm;codecs=opus` primeiro porque opus é o codec de voz — comprime
 * fala melhor que qualquer outro nessa lista, e é o que o Chrome/Android usa.
 * `audio/mp4` é o caminho do Safari, e cobre o iPhone do Rica.
 *
 * Pedir explicitamente importa: a MDN diz que `MediaRecorder.mimeType` devolve
 * **o que foi pedido na construção**, e só escolhe sozinho quando não pedimos.
 * Escolhendo nós, sabemos o que sai. */
const PREFERIDOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

export function escolheMime(suportado: (mime: string) => boolean): string | null {
  return PREFERIDOS.find((mime) => suportado(mime)) ?? null;
}

/** Normaliza o que sai do gravador para um dos quatro aceitos.
 *
 * Três coisas acontecem aqui, e nenhuma é decorativa:
 *
 * 1. **Parâmetro de codec cai fora.** O back já corta (`content_type.split(";")`
 *    em agents.py:2064), então isto é cinto E suspensório — mas o `filename`
 *    que sobe no FormData também é derivado daqui, e ele não passa por corte
 *    nenhum.
 * 2. **`video/mp4` vira `audio/mp4`.** O fallback sem opções deixa o browser
 *    escolher, e o WebKit já devolveu container MP4 rotulado como vídeo para
 *    captura só-áudio. O arquivo é o mesmo: o back grava tudo como `.oga` e
 *    manda pro ffmpeg, que decide pelo CONTEÚDO, não pela extensão. Recusar
 *    esse áudio por causa do rótulo seria perder a fala por burocracia.
 * 3. **Vazio devolve `null`.** Sem `type` o `FormData` manda
 *    `application/octet-stream` e o back recusa com 422 — melhor a tela dizer
 *    que não conseguiu gravar do que o Rica falar por um minuto e receber um
 *    erro de servidor.
 */
export function normalizaMime(bruto: string | null | undefined): string | null {
  const base = (bruto ?? '').split(';')[0].trim().toLowerCase();
  if (!base) return null;
  if (base === 'video/mp4') return 'audio/mp4';
  if (base === 'audio/mp3') return 'audio/mpeg';
  return (MIMES_ACEITOS as readonly string[]).includes(base) ? base : null;
}

/** Extensão do arquivo que sobe. Só cosmética de log no back, mas errar aqui
 *  atrapalha quem for depurar um áudio perdido. */
export function extensaoDe(mime: string): string {
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/ogg') return 'ogg';
  return 'webm';
}

/** Assinaturas mínimas dos containers que o gravador entrega de verdade.
 *  WebM começa no EBML magic; MP4 carrega "ftyp" no offset 4. Conferir ANTES
 *  de subir: em gravação longa o muxer do navegador às vezes larga o primeiro
 *  pedaço — o que carrega o header — e o "webm" começa no meio da fala. O back
 *  vê "Invalid data found when processing input" e o STT morre com 502; aqui o
 *  defeito vira "grave de novo", que é a verdade. */
const ASSINATURAS: Readonly<Record<string, readonly number[]>> = {
  'audio/webm': [0x1a, 0x45, 0xdf, 0xa3],
  'audio/mp4': [0x66, 0x74, 0x79, 0x70],
};

/** `true` quando a cabeça do arquivo casa com o container que o mime declara.
 *  Formato sem assinatura conhecida (ogg, mpeg) passa — conferir é opcional, o
 *  back decide. Pede pelo menos 8 bytes porque o `ftyp` do MP4 mora no offset 4. */
export function assinaturaDoContainer(
  mime: string | null | undefined,
  cabeca: Uint8Array,
): boolean {
  const base = (mime ?? '').split(';')[0].trim().toLowerCase();
  const assinatura = ASSINATURAS[base];
  if (!assinatura) return true;
  if (cabeca.length < 8) return false;
  const offset = base === 'audio/mp4' ? 4 : 0;
  return assinatura.every((byte, i) => cabeca[offset + i] === byte);
}
