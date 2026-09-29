'use client';

import { useEffect, useMemo, useRef } from 'react';

import { estaTocando, iniciaSequencia } from '@/components/feed/reprodutor-unico';
import { pedeFala } from '@/components/feed/stream-voz';

import { criaVozDeApoio, type VozDeApoio } from './voz-de-apoio';

/**
 * Uma frase pela rota de voz do agente (a mesma das respostas): as URLs do áudio, no fim.
 * Voz trocada pelo servidor (`degraded`) não serve ao apoio: descarta e conta como falha.
 */
function sintetiza(slug: string, texto: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const urls: string[] = [];
    let acabou = false;
    const falha = (mensagem: string) => {
      if (acabou) return;
      acabou = true;
      for (const url of urls) URL.revokeObjectURL(url);
      reject(new Error(mensagem));
    };
    const degradou = () => {
      falha('a voz do agente não atendeu');
      fala.cancela();
    };
    const fala = pedeFala(texto, slug, {
      aoMeta: (meta) => { if (meta.degraded) degradou(); },
      aoDegradou: degradou,
      aoPeaks: () => {},
      aoAudio: (_id, url) => {
        if (acabou) URL.revokeObjectURL(url);
        else urls.push(url);
      },
      aoFim: () => {
        if (acabou) return;
        if (urls.length === 0) return falha('a fala veio sem áudio');
        acabou = true;
        resolve(urls);
      },
      aoErro: falha,
    });
  });
}

/** Cabeçalho da ferramenta e aviso de erro na voz do agente. */
export function useVozDeApoio({
  slug,
  cancelaTurno,
  bloqueado,
  cabecalhoAtual,
  preparaApoio,
  aoTerminar,
}: {
  slug: string;
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
      bloqueado: () => callbacks.current.bloqueado?.() ?? false,
      cabecalhoAtual: () => callbacks.current.cabecalhoAtual(),
      preparaApoio: () => callbacks.current.preparaApoio?.() ?? true,
      aoTerminar: () => callbacks.current.aoTerminar?.(),
      cancelaTurno,
    });
  }, [slug, cancelaTurno]);

  useEffect(() => () => apoio.cala(), [apoio]);

  return apoio;
}
