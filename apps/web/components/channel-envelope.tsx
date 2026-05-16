'use client';

// ChannelEnvelope — DS-64 F4-1
//
// Hook `UserPromptSubmit` injeta no contexto do agente o XML:
//
//   <channel source="whatsapp|telegram|..." chat_id="..." message_id="..."
//            user="..." ts="..."
//            [attachment_kind="audio|image|video|document"]
//            [attachment_path="/abs/path"]
//            [attachment_mime="..."]>
//   (sem texto) | <texto do usuário>
//   </channel>
//
// Como o JSONL grava esse texto na user message, o ChatMessages renderiza
// como bubble user gigante com XML cru. Aqui parseamos e mostramos um chip
// discreto por tipo. Texto puro de canal (sem attachment) cai em bubble
// normal de user. Múltiplos envelopes concatenados no mesmo turn (Rica
// manda 3 áudios seguidos antes do agente acordar) são parseados todos.

import { memo, useMemo, useState, type ReactNode } from 'react';

export type ChannelAttachmentKind = 'audio' | 'image' | 'video' | 'document' | 'unknown';

export type ChannelEnvelope = {
  attrs: {
    source?: string;
    chat_id?: string;
    message_id?: string;
    user?: string;
    ts?: string;
    attachment_kind?: string;
    attachment_path?: string;
    attachment_mime?: string;
  };
  body: string;
};

export type ChannelSegment =
  | { kind: 'envelope'; envelope: ChannelEnvelope }
  | { kind: 'text'; text: string };

const CHANNEL_RE = /<channel\s+([^>]+)>([\s\S]*?)<\/channel>/g;
const ATTR_RE = /([a-zA-Z_][\w-]*)="([^"]*)"/g;

export function looksLikeChannelEnvelope(raw: string): boolean {
  return /^\s*<channel\s+source=/.test(raw);
}

/**
 * Parseia um text user que começa com `<channel source=`. Retorna a sequência
 * de envelopes + qualquer texto solto entre/depois. Vários envelopes
 * concatenados (separados por `\r` ou whitespace) são todos extraídos.
 *
 * Não-channel content (texto digitado normalmente, sem envelope) NÃO chega
 * aqui — o caller chama `looksLikeChannelEnvelope()` antes.
 */
export function parseChannelEnvelopes(raw: string): ChannelSegment[] {
  const segments: ChannelSegment[] = [];
  let lastEnd = 0;
  // matchAll é seguro com /g — re-uso da regex stateful evitado.
  for (const match of raw.matchAll(CHANNEL_RE)) {
    const start = match.index ?? 0;
    if (start > lastEnd) {
      const between = raw.slice(lastEnd, start).trim();
      if (between) segments.push({ kind: 'text', text: between });
    }
    const attrs: ChannelEnvelope['attrs'] = {};
    for (const am of match[1].matchAll(ATTR_RE)) {
      (attrs as Record<string, string>)[am[1]] = am[2];
    }
    segments.push({ kind: 'envelope', envelope: { attrs, body: match[2].trim() } });
    lastEnd = start + match[0].length;
  }
  if (lastEnd < raw.length) {
    const tail = raw.slice(lastEnd).trim();
    if (tail) segments.push({ kind: 'text', text: tail });
  }
  return segments;
}

function classifyAttachment(kind?: string, mime?: string): ChannelAttachmentKind {
  const k = (kind ?? '').toLowerCase();
  if (k === 'audio' || k === 'voice') return 'audio';
  if (k === 'image' || k === 'photo' || k === 'sticker') return 'image';
  if (k === 'video' || k === 'gif') return 'video';
  if (k === 'document' || k === 'file') return 'document';
  // Fallback pelo mime quando attachment_kind veio inesperado.
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m) return 'document';
  return 'unknown';
}

function attachmentUrl(slug: string, path: string): string {
  return `/api/agents/${encodeURIComponent(slug)}/channel-attachment?path=${encodeURIComponent(path)}`;
}

function basename(path: string): string {
  const ix = path.lastIndexOf('/');
  return ix >= 0 ? path.slice(ix + 1) : path;
}

function formatTs(ts?: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

function sourceLabel(source?: string): string {
  if (!source) return 'canal';
  const lower = source.toLowerCase();
  if (lower.includes('whatsapp')) return SOURCE_LABEL.whatsapp;
  if (lower.includes('telegram')) return SOURCE_LABEL.telegram;
  return source;
}

// Header comum dos chips: emissor + horário, em monospace discreto.
function MetaLine({ envelope }: { envelope: ChannelEnvelope }) {
  const ts = formatTs(envelope.attrs.ts);
  const user = envelope.attrs.user;
  const source = sourceLabel(envelope.attrs.source);
  const bits: string[] = [];
  bits.push(source);
  if (user) bits.push(user);
  if (ts) bits.push(ts);
  return <span className="channel-meta mono">{bits.join(' · ')}</span>;
}

// --- Variants ----------------------------------------------------------------

// Audio/Image/Video compartilham shell idêntico (toggle, header, body
// condicional). Único delta é glyph/label, conteúdo do body, e a extra
// opcional no header (thumb da imagem). Document fica fora — sem toggle,
// ação é "abrir" direto.
type MediaVariantKind = 'audio' | 'image' | 'video';

type MediaVariant = {
  glyph: string;
  label: string;
  /** Extra inline no header (ex.: thumb da imagem, basename do vídeo). */
  renderHeadExtra?: (url: string, envelope: ChannelEnvelope) => ReactNode;
  /** Conteúdo expandido. Recebe url já validada. */
  renderBody: (url: string) => ReactNode;
};

const MEDIA_VARIANTS: Record<MediaVariantKind, MediaVariant> = {
  audio: {
    glyph: '🎙',
    label: 'áudio recebido',
    // eslint-disable-next-line jsx-a11y/media-has-caption
    renderBody: (url) => (
      <audio controls preload="none" src={url} className="channel-env-audio">
        seu navegador não suporta áudio
      </audio>
    ),
  },
  image: {
    glyph: '🖼',
    label: 'imagem recebida',
    renderHeadExtra: (url) => (
      <img src={url} alt="" loading="lazy" className="channel-env-thumb" />
    ),
    renderBody: (url) => (
      <a href={url} target="_blank" rel="noreferrer noopener" className="channel-env-link">
        <img src={url} alt="" loading="lazy" className="channel-env-image-full" />
      </a>
    ),
  },
  video: {
    glyph: '🎞',
    label: 'vídeo recebido',
    renderHeadExtra: (_url, env) => {
      const name = env.attrs.attachment_path ? basename(env.attrs.attachment_path) : 'vídeo';
      return <span className="channel-env-arg mono">{name}</span>;
    },
    // eslint-disable-next-line jsx-a11y/media-has-caption
    renderBody: (url) => (
      <video controls preload="none" src={url} className="channel-env-video" />
    ),
  },
};

const MediaEnvelope = memo(function MediaEnvelope({
  envelope,
  slug,
  variant,
}: {
  envelope: ChannelEnvelope;
  slug: string;
  variant: MediaVariantKind;
}) {
  const [open, setOpen] = useState(false);
  const path = envelope.attrs.attachment_path ?? '';
  const url = path ? attachmentUrl(slug, path) : '';
  const v = MEDIA_VARIANTS[variant];
  return (
    <div className="channel-env" data-kind={variant} data-open={open ? '1' : '0'}>
      <button
        type="button"
        className="channel-env-head"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="channel-env-glyph" aria-hidden="true">{v.glyph}</span>
        <span className="channel-env-label">{v.label}</span>
        {v.renderHeadExtra && url ? v.renderHeadExtra(url, envelope) : null}
        <MetaLine envelope={envelope} />
        <span className="channel-env-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && url && (
        <div className="channel-env-body">{v.renderBody(url)}</div>
      )}
    </div>
  );
});

const DocumentEnvelope = memo(function DocumentEnvelope({
  envelope,
  slug,
}: {
  envelope: ChannelEnvelope;
  slug: string;
}) {
  const path = envelope.attrs.attachment_path ?? '';
  const url = path ? attachmentUrl(slug, path) : '';
  const name = path ? basename(path) : 'arquivo';
  return (
    <div className="channel-env" data-kind="document">
      <div className="channel-env-head">
        <span className="channel-env-glyph" aria-hidden="true">📄</span>
        <span className="channel-env-label">documento recebido</span>
        <span className="channel-env-arg mono">{name}</span>
        <MetaLine envelope={envelope} />
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="channel-env-link channel-env-cta"
          >
            abrir
          </a>
        )}
      </div>
    </div>
  );
});

// Texto solto enviado pelo canal — bubble compacto sem chip de anexo.
function TextEnvelope({ envelope }: { envelope: ChannelEnvelope }) {
  return (
    <div className="channel-env" data-kind="text">
      <div className="channel-env-text">
        <MetaLine envelope={envelope} />
        <div className="channel-env-text-body">{envelope.body}</div>
      </div>
    </div>
  );
}

// --- Renderer principal ------------------------------------------------------

export function ChannelEnvelopeView({
  raw,
  slug,
}: {
  raw: string;
  slug: string;
}) {
  const segments = useMemo(() => parseChannelEnvelopes(raw), [raw]);
  if (segments.length === 0) {
    // Texto não casou nenhum envelope — fallback pra texto cru.
    return <div className="channel-env-text-body">{raw}</div>;
  }
  return (
    <div className="channel-env-stack">
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return (
            <div key={i} className="channel-env" data-kind="loose-text">
              <div className="channel-env-text-body">{seg.text}</div>
            </div>
          );
        }
        const env = seg.envelope;
        const hasAttach = Boolean(env.attrs.attachment_path);
        if (!hasAttach) {
          return <TextEnvelope key={i} envelope={env} />;
        }
        const kind = classifyAttachment(env.attrs.attachment_kind, env.attrs.attachment_mime);
        if (kind === 'audio' || kind === 'image' || kind === 'video') {
          return <MediaEnvelope key={i} envelope={env} slug={slug} variant={kind} />;
        }
        return <DocumentEnvelope key={i} envelope={env} slug={slug} />;
      })}
    </div>
  );
}
