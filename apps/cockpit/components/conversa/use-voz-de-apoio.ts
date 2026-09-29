'use client';

import { useEffect, useMemo } from 'react';

import { estaTocando, iniciaSequencia } from '@/components/feed/reprodutor-unico';
import { pedeFala } from '@/components/feed/stream-voz';

import type { SonsLocais } from './sons-locais';
import { criaVozDeApoio, type VozDeApoio } from './voz-de-apoio';

/* O áudio das frases de apoio, por agente: sintetizado uma vez e guardado enquanto a aba vive. */
const CACHES = new Map<string, Map<string, Promise<string[]>>>();

/** Uma frase pela rota de voz do agente (a mesma das respostas): as URLs do áudio, no fim. */
function sintetiza(slug: string, texto: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const urls: string[] = [];
    pedeFala(texto, slug, {
      aoMeta: () => {},
      aoPeaks: () => {},
      aoAudio: (_id, url) => void urls.push(url),
      aoFim: () => (urls.length > 0 ? resolve(urls) : reject(new Error('a fala veio sem áudio'))),
      aoErro: (mensagem) => {
        for (const url of urls) URL.revokeObjectURL(url);
        reject(new Error(mensagem));
      },
    });
  });
}

/** A voz de apoio da tela (`voz-de-apoio.ts`): ponte, demora e erro na voz do agente. */
export function useVozDeApoio({
  slug,
  sons,
  cancelaTurno,
}: {
  slug: string;
  sons: () => SonsLocais;
  cancelaTurno: () => void;
}): VozDeApoio {
  const apoio = useMemo(() => {
    let cache = CACHES.get(slug);
    if (cache === undefined) CACHES.set(slug, (cache = new Map()));
    return criaVozDeApoio({
      sintetiza: (texto) => sintetiza(slug, texto),
      iniciaSequencia,
      ocupado: estaTocando,
      reserva: (texto) => sons().fala(texto),
      calaReserva: () => sons().cancelaFala(),
      cancelaTurno,
      cache,
    });
  }, [slug, sons, cancelaTurno]);

  // Abrir a tela já prepara as frases: pedida na hora, a ponte chegaria ~1,7 s atrasada.
  useEffect(() => {
    apoio.prepara();
    return () => apoio.cala();
  }, [apoio]);

  return apoio;
}
