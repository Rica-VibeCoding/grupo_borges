'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnexoComFoto } from './anexo-imagem';
import { urlDoAnexoImagem } from './anexo-imagem';

/**
 * Um gesto, um cartão: foto em cima e legenda embaixo. A largura vem da medida
 * da referência (um terço da coluna de 48rem), mas no celular pode ocupar até
 * dois terços da tela para continuar legível.
 */
export function AnexoImagemView({
  anexo,
  agentSlug,
}: {
  anexo: AnexoComFoto;
  agentSlug: string;
}) {
  // O sweep de retenção (apps/api/orchestrator/uploads_sweeper.py) apaga
  // upload velho do disco; o evento no feed continua existindo. Sem isso o
  // <img> vira o ícone de imagem quebrada do browser — `expirado` troca pelo
  // recado antes que o layout precise da altura da foto.
  const [expirado, setExpirado] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const url = urlDoAnexoImagem(agentSlug, anexo.filename);

  // O <img> é SSR'd: o browser começa a buscar o arquivo ao parsear o HTML,
  // antes de o React hidratar. Um 404 local é rápido o bastante pra terminar
  // (e disparar `error` no DOM cru) antes do listener existir — medido aqui,
  // sem isso `naturalWidth: 0` fica mudo e o ícone quebrado nunca vira o
  // recado. Checar o estado já resolvido no mount cobre essa corrida; o
  // `onError` continua para falha que acontece depois (rede lenta, sweep
  // rodando com a página já aberta).
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setExpirado(true);
    }
  }, [url]);

  return (
    <article
      data-feed-image=""
      className="min-w-0 self-end overflow-hidden rounded-[var(--ck-radius-caixa)]"
      style={{
        width: 'min(66vw, calc(var(--ck-read-wide) / 3))',
        background: anexo.legenda || expirado ? 'var(--ck-surface-raised)' : undefined,
      }}
    >
      {expirado ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            aspectRatio: 'auto 4 / 3',
            padding: 'var(--ck-space-3)',
            textAlign: 'center',
            color: 'var(--ck-text-secondary)',
            fontSize: 'var(--ck-text-sm)',
          }}
        >
          anexo expirado
        </div>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir imagem em tamanho completo"
          style={{ display: 'block', minWidth: 0 }}
        >
          {/* A rota já entrega o arquivo normalizado, com MIME fechado e cache
              immutable. Um loader só o reprocessaria. `aspect-ratio: auto 4/3`
              reserva altura enquanto os metadados chegam; depois prevalece a
              proporção real, sem cortar a foto. O envelope externo do feed usa
              `measureElement`, então o ResizeObserver atualiza o virtualizador. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={url}
            alt="Imagem enviada por você"
            loading="lazy"
            decoding="async"
            onError={() => setExpirado(true)}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              aspectRatio: 'auto 4 / 3',
            }}
          />
        </a>
      )}

      {anexo.legenda ? (
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
          {anexo.legenda}
        </p>
      ) : null}
    </article>
  );
}
