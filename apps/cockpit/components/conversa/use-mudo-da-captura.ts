'use client';

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { ouveNoEstado } from '../../lib/conversa/maquina';
import type { Conversa, Evento } from '../../lib/conversa/tipos';
import { criaPermissaoDaCaptura } from './permissao-da-captura';

type Props = {
  mudo: boolean;
  /** A tela de voz saiu de vista (o Rica foi para o chat): o microfone fecha como no mudo, mas o
   *  Zé segue — sem freio, a voz tocando — e a fala que já transcrevia segue para ele. */
  fora: boolean;
  fone: boolean;
  conversaRef: RefObject<Conversa>;
  sessaoAtivaRef: RefObject<boolean>;
  emudece(): void;
  liga(): void;
  despacha(evento: Evento): void;
};

export function useMudoDaCaptura(p: Props) {
  // A permissão (a validade da transcrição em voo) só muda com o mudo; o detector trava com os dois.
  const permissao = useMemo(criaPermissaoDaCaptura, []);
  permissao.muda(p.mudo);
  const bloqueadoRef = useRef(true);
  bloqueadoRef.current = p.mudo || p.fora;
  const atual = useRef(p);
  atual.current = p;
  const bloqueado = p.mudo || p.fora;
  useEffect(() => {
    const c = atual.current;
    const estado = c.conversaRef.current.estado;
    if (c.mudo || c.fora) {
      c.emudece();
      if (c.mudo || estado !== 'transcrevendo') c.despacha({ tipo: 'microfoneMudo' });
      return;
    }
    if (c.sessaoAtivaRef.current && ouveNoEstado(estado, c.fone)) c.liga();
  }, [bloqueado]);
  return { ...permissao, bloqueadoRef };
}
