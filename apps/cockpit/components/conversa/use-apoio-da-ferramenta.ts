'use client';

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import { estaTocando } from '../feed/reprodutor-unico';
import type { Conversa, Evento } from '../../lib/conversa/tipos';
import { criaRelogioDoApoio } from './apoio-da-espera';
import { cabecalhoDaFerramenta } from './cabecalho-da-ferramenta';
import { useVozDeApoio } from './use-voz-de-apoio';

type Props = {
  slug: string;
  cancelaTurno(): void;
  preparaApoio(): boolean;
  conversaRef: RefObject<Conversa>;
  sessaoAtivaRef: RefObject<boolean>;
  despachaRef: RefObject<(evento: Evento) => void>;
  mensagens: readonly MessagePayload[];
};

export function useApoioDaFerramenta(p: Props) {
  const relogio = useMemo(criaRelogioDoApoio, []);
  const fronteiraRef = useRef(0);
  const atual = useRef(p);
  atual.current = p;
  const bloqueado = () => {
    // A uma fala aberta pelo botão, sem fone: a frase no alto-falante voltaria pelo microfone (eco).
    const c = p.conversaRef.current as Conversa & { capturando?: boolean; segurando?: boolean; umaFala?: boolean };
    return !p.sessaoAtivaRef.current || Boolean(c.capturando || c.segurando || c.umaFala) ||
      c.estado === 'transcrevendo' || c.estado === 'interrompendo';
  };
  const cabecalhoAtual = () => cabecalhoDaFerramenta(atual.current.mensagens.filter((mensagem) => mensagem.id > fronteiraRef.current));
  const apoio = useVozDeApoio({
    slug: p.slug, cancelaTurno: p.cancelaTurno, preparaApoio: p.preparaApoio,
    bloqueado, cabecalhoAtual, aoTerminar: () => relogio.falou(performance.now()),
  });
  const apoioRef = useRef(apoio);
  apoioRef.current = apoio;
  const bloqueioRef = useRef(bloqueado);
  bloqueioRef.current = bloqueado;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (atual.current.conversaRef.current.estado === 'interrompendo') atual.current.despachaRef.current({ tipo: 'tique' });
      if (!relogio.tique(performance.now(), bloqueioRef.current() || estaTocando())) return;
      const texto = cabecalhoAtual();
      if (texto !== null) apoioRef.current.cabecalho(texto);
    }, 250);
    return () => { window.clearInterval(timer); relogio.encerra(); apoioRef.current.cala(); };
  }, [relogio, p.slug]);

  return {
    erro: apoio.erro,
    cala: apoio.cala,
    preparaEnvio() {
      fronteiraRef.current = atual.current.mensagens.reduce((maior, mensagem) => Math.max(maior, mensagem.id), 0);
      relogio.encerra();
      apoio.cala();
    },
    inicia() { if (p.sessaoAtivaRef.current) relogio.inicia(performance.now()); },
    silenciou() { relogio.falou(performance.now()); },
    encerra() { relogio.encerra(); apoio.cala(); },
    evento(evento: Evento) {
      if (evento.tipo === 'enviou' || evento.tipo === 'retomar') relogio.inicia(performance.now());
      if (evento.tipo === 'falaIniciou' || evento.tipo === 'abrirUmaFala' || (evento.tipo === 'segurou' && evento.ligado)) apoio.cala();
      if (evento.tipo === 'microfoneMudo') apoio.desiste();
      if (evento.tipo === 'parar' || evento.tipo === 'interromper' || evento.tipo === 'zeTerminou' || evento.tipo === 'capturaCaiu' || evento.tipo === 'falhou') {
        relogio.encerra();
        apoio.cala();
      }
    },
  };
}
