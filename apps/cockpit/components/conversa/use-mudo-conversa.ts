'use client';

import { useSyncExternalStore } from 'react';

import { CHAVE_MUDO, criaPreferenciaDoMudo } from './preferencia-do-mudo';

const preferencia = criaPreferenciaDoMudo(() => window.localStorage);
const doServidor = (): boolean | null => null;

function inscreve(aviso: () => void) {
  const sai = preferencia.inscreve(aviso);
  const deOutraAba = (evento: StorageEvent) => {
    if (evento.key === CHAVE_MUDO || evento.key === null) preferencia.avisa();
  };
  window.addEventListener('storage', deOutraAba);
  return () => {
    sai();
    window.removeEventListener('storage', deOutraAba);
  };
}

export function useMudoConversa() {
  const mudo = useSyncExternalStore<boolean | null>(inscreve, preferencia.le, doServidor);
  return { mudo: mudo ?? true, pronto: mudo !== null, mudaMudo: preferencia.muda };
}
