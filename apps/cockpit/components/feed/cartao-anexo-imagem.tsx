'use client';

import type { AnexoImagem } from './anexo-imagem';
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
  anexo: AnexoImagem;
  agentSlug: string;
}) {
  const url = urlDoAnexoImagem(agentSlug, anexo.filename);

  return (
    <article
      data-feed-image=""
      className="min-w-0 self-end overflow-hidden rounded-[var(--ck-radius-caixa)]"
      style={{
        width: 'min(66vw, calc(var(--ck-read-wide) / 3))',
        background: anexo.legenda ? 'var(--ck-surface-raised)' : undefined,
      }}
    >
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
          src={url}
          alt="Imagem enviada por você"
          loading="lazy"
          decoding="async"
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            aspectRatio: 'auto 4 / 3',
          }}
        />
      </a>

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
