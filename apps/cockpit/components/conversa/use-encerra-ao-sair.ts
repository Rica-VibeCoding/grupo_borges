'use client';

// Sair da página desmonta a tela: a sessão aberta encerra sem freio e os sons locais fecham.
// Saiu de `use-modo-conversa.ts` (02/10), com a ref que guarda o `encerra` da vez.
import { useEffect, useRef, type RefObject } from 'react';

import type { SonsLocais } from './sons-locais';

export function useEncerraAoSair(
  encerra: (semFreio: boolean) => void,
  sessaoAtivaRef: RefObject<boolean>,
  sonsRef: RefObject<SonsLocais | null>,
) {
  const encerraRef = useRef(encerra);
  encerraRef.current = encerra;
  useEffect(
    () => () => {
      // Ir para outra página desmonta a tela e a voz morre junto, mas o Zé não é freado: só o toque freia.
      if (sessaoAtivaRef.current) encerraRef.current(true);
      sonsRef.current?.encerra();
    },
    [],
  );
}
