'use client';

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Conversa, Evento } from '../../lib/conversa/tipos';
import { criaPermissaoDaCaptura } from './permissao-da-captura';

type Props = {
  mudo: boolean;
  fone: boolean;
  conversaRef: RefObject<Conversa>;
  sessaoAtivaRef: RefObject<boolean>;
  emudece(): void;
  liga(): void;
  despacha(evento: Evento): void;
};

export function useMudoDaCaptura(p: Props) {
  const permissao = useMemo(criaPermissaoDaCaptura, []);
  permissao.muda(p.mudo);
  const atual = useRef(p);
  atual.current = p;
  useEffect(() => {
    const c = atual.current;
    if (c.mudo) {
      c.emudece();
      c.despacha({ tipo: 'microfoneMudo' });
      return;
    }
    const estado = c.conversaRef.current.estado;
    if (c.sessaoAtivaRef.current && (estado === 'ouvindo' || (estado === 'falando' && c.fone))) c.liga();
  }, [p.mudo]);
  return permissao;
}
