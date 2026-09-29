'use client';

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

const Detalhe = createContext<string | null>(null);
const PublicaDetalhe = createContext<Dispatch<SetStateAction<string | null>> | null>(null);

export function ContextoConfiguracaoConversa({ children }: { children: ReactNode }) {
  const [detalhe, publica] = useState<string | null>(null);
  return (
    <PublicaDetalhe.Provider value={publica}>
      <Detalhe.Provider value={detalhe}>{children}</Detalhe.Provider>
    </PublicaDetalhe.Provider>
  );
}

export function useDetalheDaConversa() {
  return useContext(Detalhe);
}

export function usePublicaDetalheDaConversa(ativa: boolean, detalhe: string | null) {
  const publica = useContext(PublicaDetalhe);
  useEffect(() => {
    if (!ativa || !publica) return;
    publica(detalhe);
    return () => publica(null);
  }, [ativa, detalhe, publica]);
}
