// Lê o envelope que embrulha mensagem vinda de fora (Telegram, WhatsApp).
//
// Mora fora do `.tsx` porque a suíte roda `node --test` sem transpilação de
// JSX — mesmo precedente de `execucao-do-item.ts` e `linha-seca.ts`.
//
// Por que existe: até 15/08 o v2 desenhava `<LinhaSeca rotulo="canal"
// corpo={raw} />`, ou seja, o XML inteiro numa linha cortada. O Rica descreveu
// como "sai quebrado". O renderer rico existe só no v1
// (`apps/web/components/channel-envelope.tsx`), e trazê-lo inteiro arrastaria
// uma rota de anexo que o v2 não tem — então aqui fica só o que dá pra
// desenhar com honestidade: o texto que ele escreveu, e de onde veio.

export type EnvelopeDeCanal = {
  /** `telegram`, `whatsapp`… */
  origem: string;
  /** Quem mandou, quando o envelope diz. */
  autor?: string;
  /** O que a pessoa realmente escreveu — é isto que vai pra bolha. */
  texto: string;
  /** Anexo declarado no envelope, quando há. */
  anexo?: { tipo: string; nome?: string; mime?: string; caminho?: string };
};

const ENVELOPE_RE = /<channel\s+([^>]*)>([\s\S]*?)<\/channel>/;
const ATRIBUTO_RE = /([a-zA-Z_][\w-]*)="([^"]*)"/g;

export function leEnvelopeDeCanal(raw: string): EnvelopeDeCanal | null {
  const casou = ENVELOPE_RE.exec(raw);
  if (!casou) return null;

  const attrs: Record<string, string> = {};
  for (const a of casou[1].matchAll(ATRIBUTO_RE)) attrs[a[1]] = a[2];

  const origem = attrs.source;
  if (!origem) return null;

  // Foto do Telegram vem em `image_path`; os demais anexos, em
  // `attachment_path`. Sem ler nenhum dos dois, o feed desenhava o corpo da
  // mensagem — a palavra literal `(photo)` — e a imagem não aparecia em lugar
  // nenhum (print do Rica, 15/08). A rota que serve esse caminho já existia na
  // API desde o v1: `GET /api/agents/{slug}/channel-attachment`.
  const caminho = attrs.image_path || attrs.attachment_path;
  const tipo = attrs.attachment_kind ?? tipoPeloMime(attrs.attachment_mime) ?? (attrs.image_path ? 'image' : undefined);

  return {
    origem,
    ...(attrs.user ? { autor: attrs.user } : {}),
    texto: casou[2].trim(),
    ...(tipo
      ? {
          anexo: {
            tipo,
            ...(attrs.attachment_name ? { nome: attrs.attachment_name } : {}),
            ...(attrs.attachment_mime ? { mime: attrs.attachment_mime } : {}),
            ...(caminho ? { caminho } : {}),
          },
        }
      : {}),
  };
}

function tipoPeloMime(mime: string | undefined): string | undefined {
  if (!mime) return undefined;
  const familia = mime.split('/')[0];
  return familia === 'image' || familia === 'audio' || familia === 'video' ? familia : 'documento';
}

/** Como anunciar a procedência sem competir com a fala. */
export function procedencia(envelope: EnvelopeDeCanal): string {
  return envelope.autor ? `${envelope.origem} · ${envelope.autor}` : envelope.origem;
}
