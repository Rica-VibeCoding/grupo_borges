'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export function useWakeLock(sessaoAtivaRef: RefObject<boolean>) {
  const sentinelaRef = useRef<WakeLockSentinel | null>(null);
  const pedidoRef = useRef<Promise<void> | null>(null);
  const [ativo, setAtivo] = useState(false);
  const [suportado, setSuportado] = useState(true);
  const [falhou, setFalhou] = useState(false);

  const pede = useCallback(() => {
    if (!('wakeLock' in navigator)) {
      setSuportado(false);
      return;
    }
    if (sentinelaRef.current !== null || pedidoRef.current !== null) return;
    setFalhou(false);

    pedidoRef.current = navigator.wakeLock
      .request('screen')
      .then((sentinela) => {
        sentinelaRef.current = sentinela;
        setAtivo(true);
        sentinela.addEventListener('release', () => {
          if (sentinelaRef.current !== sentinela) return;
          sentinelaRef.current = null;
          setAtivo(false);
        });
      })
      .catch(() => {
        setAtivo(false);
        setFalhou(true);
      })
      .finally(() => {
        pedidoRef.current = null;
      });
  }, []);

  const solta = useCallback(() => {
    const sentinela = sentinelaRef.current;
    sentinelaRef.current = null;
    setAtivo(false);
    if (sentinela !== null) void sentinela.release().catch(() => {});
  }, []);

  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'visible' && sessaoAtivaRef.current) pede();
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }, [pede, sessaoAtivaRef]);

  useEffect(() => solta, [solta]);

  return { ativo, suportado, falhou, pede, solta };
}
