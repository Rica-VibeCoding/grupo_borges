'use client';

import { useMemo, useRef } from 'react';

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { chaveDe } from './chave';
import { criaChegadas } from './chegada-ao-vivo';
import { soPassoEmVoo } from './execucao-do-item';
import type { ItemDoFeed } from './grupo-ferramentas.ts';

/**
 * Quem acabou de chegar ao vivo ganha o gesto de chegada (`chegada-ao-vivo.ts`).
 * Observar no render, e não num efeito: o item tem de nascer JÁ com a classe,
 * senão pinta um quadro parado e só depois começa a subir.
 */
export function useChegadas(itens: readonly ItemDoFeed[], chaves: readonly string[], lookup?: ToolResultLookup) {
  const chegadasRef = useRef<ReturnType<typeof criaChegadas> | null>(null);
  chegadasRef.current ??= criaChegadas();
  const chegadas = chegadasRef.current;
  const observados = useMemo(
    () =>
      itens.map((item, i) => ({
        chave: chaves[i]!,
        kind: item.kind,
        // O grupo nasce do segundo passo com a chave do primeiro membro na
        // frente: a linha que já estava na tela não chega de novo.
        ...(item.kind === 'grupo-ferramentas' && item.itens[0] ? { herdaDe: chaveDe(item.itens[0]) } : {}),
      })),
    [itens, chaves],
  );
  const agoraMs = performance.now();
  chegadas.observa(observados, agoraMs, (indice) => {
    const item = itens[indice];
    return item ? soPassoEmVoo(item, lookup) : false;
  });
  return { chegadas, agoraMs };
}
