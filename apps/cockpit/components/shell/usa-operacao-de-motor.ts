'use client';

/**
 * O estado da operação única, para quem desenha pixel. O store é global por
 * agente (`operacao-de-motor.ts`) porque a mesma operação é disparada de dois
 * lugares — a gaveta do painel e a do composer — e travada nos dois.
 */
import { useEffect, useState } from 'react';

import { assinarOperacao, leiaOperacao, type EstadoDaOperacao } from './operacao-de-motor.ts';

export function usaOperacaoDeMotor(slug: string): EstadoDaOperacao {
  const [estado, setEstado] = useState<EstadoDaOperacao>(() => leiaOperacao(slug));
  useEffect(() => {
    // A leitura de novo aqui não é redundante: entre o `useState` inicial e a
    // assinatura o estado pode ter mudado (troca de agente no mesmo componente).
    setEstado(leiaOperacao(slug));
    return assinarOperacao(slug, setEstado);
  }, [slug]);
  return estado;
}
