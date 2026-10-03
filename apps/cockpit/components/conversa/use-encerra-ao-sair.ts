'use client';

// Sair da página desmonta a tela: a sessão aberta encerra sem freio e os sons locais fecham.
// Saiu de `use-modo-conversa.ts` (02/10), com a ref que guarda o `encerra` da vez.
// Ir para o chat (`foraDaTela`) também encerra: voz custa, e fora da tela ninguém ouve (ordem do Rica, 03/10).
import { useEffect, useRef, type RefObject } from 'react';

import type { SonsLocais } from './sons-locais';

export function useEncerraAoSair(
  encerra: (semFreio: boolean) => void,
  sessaoAtivaRef: RefObject<boolean>,
  sonsRef: RefObject<SonsLocais | null>,
  foraDaTela: boolean,
) {
  const encerraRef = useRef(encerra);
  encerraRef.current = encerra;
  useEffect(() => {
    if (foraDaTela && sessaoAtivaRef.current) encerraRef.current(true);
  }, [foraDaTela, sessaoAtivaRef]);
  useEffect(
    () => () => {
      // Ir para outra página desmonta a tela e a voz morre junto, mas o Zé não é freado: só o toque freia.
      if (sessaoAtivaRef.current) encerraRef.current(true);
      sonsRef.current?.encerra();
    },
    [],
  );
}
