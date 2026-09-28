'use client';

import { useEffect, useState } from 'react';

/** A gaveta do motor muda de desenho abaixo de 640px — extraído de
 *  `SeletorMotor` (teto de 300 linhas). */
export function usaTelaEstreita() {
  const [estreita, setEstreita] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const atualizar = () => setEstreita(media.matches);
    atualizar();
    media.addEventListener('change', atualizar);
    return () => media.removeEventListener('change', atualizar);
  }, []);
  return estreita;
}
