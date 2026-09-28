'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { assinaAnexosPendentes, leAnexoPendente } from '@/lib/anexo-pendente.ts';

import { AnexoImagemView } from './cartao-anexo-imagem.tsx';
import { AnexoVideoView } from './cartao-anexo-video.tsx';

/** Prefixo do uuid que o feed dá à bolha otimista de anexo. */
export const PREFIXO_ANEXO_OTIMISTA = 'cc-otimista-anexo-';

/**
 * A bolha do anexo ANTES do eco: o arquivo local, com a legenda, no mesmo
 * cartão que a bolha real vai usar — quando o eco chega, troca a fonte e o
 * desenho fica.
 *
 * Lê a pendência direto do store (`anexo-pendente.ts`) e não do payload: o
 * "enviando…" some quando o upload confirma, e o payload do feed não muda
 * nessa hora — mudar o `uuid` remontaria o `<video>` e o player recomeçaria.
 */
export function BolhaAnexoOtimista({ agentSlug, uuid }: { agentSlug: string; uuid: string }) {
  const id = uuid.slice('cc-otimista-'.length);
  const assina = useCallback((fn: () => void) => assinaAnexosPendentes(agentSlug, fn), [agentSlug]);
  const le = useCallback(() => leAnexoPendente(agentSlug, id), [agentSlug, id]);
  const pendente = useSyncExternalStore(assina, le, () => null);
  if (!pendente) return null;

  // Pelo desfecho, não pelo nome: o não confirmado sem resposta não tem nome
  // gravado e já não está enviando.
  const enviando = pendente.confirmadoEmMs === null;
  const legenda = pendente.legenda || null;
  if (pendente.especie === 'video') {
    return <AnexoVideoView url={pendente.url} legenda={legenda} eco={uuid} enviando={enviando} />;
  }
  return (
    <AnexoImagemView
      anexo={{ filename: pendente.url, legenda }}
      agentSlug={agentSlug}
      eco={uuid}
      enviando={enviando}
    />
  );
}
