'use client';

/**
 * A fiação da voz que toca sozinha (o modelo e as três portas estão em
 * `fala-sozinha.ts`). Aqui moram o aparelho (a chave lembrada), o gesto que
 * arma e destrava, e a fala em si — que passa pelo MESMO elemento de áudio das
 * bolhas (`reprodutor-unico.ts`), o único que o iPhone deixa tocar sem toque
 * depois de destravado.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { perfilDoAgente } from '../../lib/perfil-do-agente';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import {
  ESPERA_DO_FIM_MS,
  chaveDaFala,
  criaVigiaDaFala,
  gravaFalaLigada,
  leFalaLigada,
} from './fala-sozinha.ts';
import { destravaNoGesto, estaTocando, iniciaSequencia } from './reprodutor-unico.ts';
import { pedeFala } from './stream-voz.ts';

const ouvintes = new Set<() => void>();
/** Houve gesto nesta abertura da página — a porta 2. */
let armado = false;
/** A fala automática em curso — o que a chave cala na hora (WCAG 1.4.2). */
let emCurso: { para(): void } | null = null;

/** Desligar a chave cala JÁ: o trecho que está tocando para, e o que ainda
 *  vinha do servidor é cancelado. Bolha tocada pelo Daniel não é tocada aqui. */
export function calaFalaSozinha(): void {
  emCurso?.para();
  emCurso = null;
}

function leDoAparelho(slug: string): boolean {
  try {
    return leFalaLigada(localStorage.getItem(chaveDaFala(slug)));
  } catch {
    return true;
  }
}

export function useFalaLigada(slug: string): [boolean, (ligada: boolean) => void] {
  const ligada = useSyncExternalStore(
    (avisa) => {
      ouvintes.add(avisa);
      window.addEventListener('storage', avisa);
      return () => {
        ouvintes.delete(avisa);
        window.removeEventListener('storage', avisa);
      };
    },
    () => leDoAparelho(slug),
    () => true,
  );
  const muda = (nova: boolean) => {
    if (!nova) calaFalaSozinha();
    try {
      localStorage.setItem(chaveDaFala(slug), gravaFalaLigada(nova));
    } catch {
      // Aba privada sem armazenamento: vale só nesta abertura.
    }
    for (const avisa of ouvintes) avisa();
  };
  return [ligada, muda];
}

/**
 * Chamar SÍNCRONO no gesto (enviar, tocar no microfone, ligar a chave), antes
 * de qualquer `await`. Só age no agente que fala sozinho e com a chave ligada:
 * na frota e para Fred e Sofia não muda nada — nem para o áudio que toca.
 */
export function destravaFalaSozinha(slug: string): void {
  if (!perfilDoAgente(slug).falaSozinha || !leDoAparelho(slug)) return;
  armado = true;
  destravaNoGesto();
}

function fala(texto: string, slug: string): void {
  // Uma bolha tocada pelo Daniel manda: a fala automática não passa por cima.
  if (estaTocando()) return;
  const sequencia = iniciaSequencia({
    aoProgredir: () => {},
    aoTerminar: () => {},
    // Recusa do navegador: fica calado. A bolha segue ali para o toque.
    aoFalhar: () => {},
  });
  const pedido = pedeFala(texto, slug, {
    aoMeta: () => {},
    aoPeaks: () => {},
    aoAudio: (_id, url) => sequencia.enfileira(url),
    aoFim: () => sequencia.fecha(),
    aoErro: () => sequencia.para(),
  });
  emCurso = {
    para: () => {
      pedido.cancela();
      sequencia.para();
    },
  };
}

export function usaFalaSozinha(
  itens: readonly ItemDoFeed[],
  chaves: readonly string[],
  slug: string | undefined,
  turnoVivo: boolean,
): void {
  const ligado = slug !== undefined && perfilDoAgente(slug).falaSozinha;
  const vigiaRef = useRef<ReturnType<typeof criaVigiaDaFala> | null>(null);
  vigiaRef.current ??= criaVigiaDaFala();
  const vigia = vigiaRef.current;

  useEffect(() => {
    if (!ligado || slug === undefined) return;
    vigia.observa(
      itens.map((item, i) => ({ chave: chaves[i]!, kind: item.kind })),
      armado,
    );
    if (turnoVivo || !vigia.temPendente()) return;
    const espera = window.setTimeout(() => {
      const porChave = new Map(itens.map((item, i) => [chaves[i]!, item]));
      const trecho = vigia.colhe((chave) => {
        const item = porChave.get(chave);
        return item?.kind === 'assistant'
          ? item.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
          : undefined;
      });
      // Chave desligada ou aba escondida: a fala é descartada, não adiada —
      // religar mais tarde não pode desenterrar resposta velha.
      if (trecho === null || !leDoAparelho(slug) || document.hidden) return;
      fala(trecho, slug);
    }, ESPERA_DO_FIM_MS);
    return () => window.clearTimeout(espera);
  }, [ligado, slug, itens, chaves, turnoVivo, vigia]);
}
