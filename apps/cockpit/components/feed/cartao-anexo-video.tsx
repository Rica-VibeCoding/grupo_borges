'use client';

import { useState } from 'react';

import { RotuloEnviando } from './rotulo-enviando.tsx';

/**
 * O vídeo que o Rica mandou, na mesma moldura do cartão de imagem
 * (`cartao-anexo-imagem.tsx`): mesma largura, mesmo raio, legenda embaixo. Um
 * gesto, um cartão — foto ou vídeo, o feed desenha o envio do mesmo jeito.
 *
 * `preload="metadata"`: baixa só o cabeçalho (duração e primeiro quadro), não o
 * arquivo. São até 50 MB por vídeo, e o feed pode ter vários.
 * `playsInline`: sem ele o iPhone abre o player em tela cheia ao tocar.
 *
 * Serve às duas bolhas: a real (URL da rota `/file`) e a otimista (objectURL do
 * arquivo local, antes do upload voltar).
 */
export function AnexoVideoView({
  url,
  legenda,
  eco,
  enviando = false,
}: {
  url: string;
  legenda: string | null;
  /** Bolha otimista: a ponta de chegada do voo (`voo-do-envio.ts`). */
  eco?: string;
  enviando?: boolean;
}) {
  // O sweep de retenção apaga upload velho e o evento continua no feed; e o
  // navegador pode não ter o codec (Chromium sem H.264, HEVC fora do Safari).
  // O `<video>` dá o MESMO erro nos dois casos, então o recado não afirma
  // qual foi — sem isto sobraria um player morto.
  const [expirado, setExpirado] = useState(false);
  const recado = url.startsWith('blob:') ? 'prévia indisponível' : 'vídeo indisponível';

  return (
    <article
      data-feed-video=""
      data-eco={eco}
      aria-busy={enviando || undefined}
      className="min-w-0 self-end overflow-hidden rounded-[var(--ck-radius-caixa)]"
      style={{
        width: 'min(66vw, calc(var(--ck-read-wide) / 3))',
        background: 'var(--ck-surface-raised)',
        opacity: enviando ? 'var(--ck-anexo-enviando-opacidade)' : undefined,
        transition: 'opacity var(--ck-dur-enter, 200ms) var(--ck-ease)',
      }}
    >
      {expirado ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            aspectRatio: '16 / 9',
            padding: 'var(--ck-space-3)',
            textAlign: 'center',
            color: 'var(--ck-text-secondary)',
            fontSize: 'var(--ck-text-sm)',
          }}
        >
          {recado}
        </div>
      ) : (
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label="Vídeo enviado por você"
          onError={() => setExpirado(true)}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            // Reserva altura antes dos metadados; depois vale a proporção real.
            aspectRatio: 'auto 16 / 9',
            background: 'var(--ck-surface-canvas)',
          }}
        />
      )}

      {legenda ? (
        <p
          className="min-w-0"
          style={{
            margin: 0,
            padding: 'var(--ck-space-3)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: 'var(--ck-text-primary)',
            fontSize: 'var(--ck-text-md)',
          }}
        >
          {legenda}
        </p>
      ) : null}
      {enviando ? <RotuloEnviando /> : null}
    </article>
  );
}
