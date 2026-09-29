'use client';

import { useEffect, useMemo, useRef } from 'react';

import { estaTocando, iniciaSequencia } from '@/components/feed/reprodutor-unico';
import { pedeFala } from '@/components/feed/stream-voz';

import type { SonsLocais } from './sons-locais';
import { criaVozDeApoio, type VozDeApoio } from './voz-de-apoio';

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

/** Cabeçalho da ferramenta e aviso de erro na voz do agente. */
export function useVozDeApoio({
  slug,
  sons,
  cancelaTurno,
  bloqueado,
  cabecalhoAtual,
  preparaApoio,
  aoTerminar,
}: {
  slug: string;
  sons: () => SonsLocais;
  cancelaTurno: () => void;
  bloqueado?: () => boolean;
  cabecalhoAtual: () => string | null;
  preparaApoio?: () => boolean;
  aoTerminar?: () => void;
}): VozDeApoio {
  const callbacks = useRef({ bloqueado, cabecalhoAtual, preparaApoio, aoTerminar });
  callbacks.current = { bloqueado, cabecalhoAtual, preparaApoio, aoTerminar };
  const apoio = useMemo(() => {
    return criaVozDeApoio({
      sintetiza: (texto) => sintetiza(slug, texto),
      iniciaSequencia,
      ocupado: estaTocando,
      reserva: (texto, aoTerminar) => sons().fala(texto, aoTerminar),
      bloqueado: () => callbacks.current.bloqueado?.() ?? false,
      cabecalhoAtual: () => callbacks.current.cabecalhoAtual(),
      preparaApoio: () => callbacks.current.preparaApoio?.() ?? true,
      aoTerminar: () => callbacks.current.aoTerminar?.(),
      calaReserva: () => sons().cancelaFala(),
      cancelaTurno,
    });
  }, [slug, sons, cancelaTurno]);

  useEffect(() => () => apoio.cala(), [apoio]);

  return apoio;
}
