'use client';

import {
  useMemo,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';

export type ArmazenamentoRascunho = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type ControleRascunho = {
  getSnapshot(): string;
  getServerSnapshot(): string;
  subscribe(ouvinte: () => void): () => void;
  escrever: Dispatch<SetStateAction<string>>;
};

function armazenamentoPadrao(): ArmazenamentoRascunho | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function ler(storage: ArmazenamentoRascunho | null, chave: string): string {
  try {
    return storage?.getItem(chave) ?? '';
  } catch {
    return '';
  }
}

export function createControleRascunho(
  agentSlug: string,
  storageRecebido?: ArmazenamentoRascunho | null,
): ControleRascunho {
  const storage = storageRecebido === undefined ? armazenamentoPadrao() : storageRecebido;
  const chave = `cockpit:rascunho:v1:${agentSlug}`;
  let texto = ler(storage, chave);
  const ouvintes = new Set<() => void>();

  return {
    getSnapshot: () => texto,
    getServerSnapshot: () => '',
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    escrever(proximo) {
      const valor = typeof proximo === 'function' ? proximo(texto) : proximo;
      if (valor === texto) return;
      texto = valor;
      try {
        if (valor === '') storage?.removeItem(chave);
        else storage?.setItem(chave, valor);
      } catch {
        // O campo continua sendo a cópia viva quando o armazenamento do navegador falha.
      }
      for (const ouvinte of ouvintes) ouvinte();
    },
  };
}

export function usaRascunho(agentSlug: string): [string, Dispatch<SetStateAction<string>>] {
  const controle = useMemo(() => createControleRascunho(agentSlug), [agentSlug]);
  const texto = useSyncExternalStore(
    controle.subscribe,
    controle.getSnapshot,
    controle.getServerSnapshot,
  );
  return [texto, controle.escrever];
}
