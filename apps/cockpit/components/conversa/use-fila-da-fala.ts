'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { postAgentInput } from '@grupo_borges/cockpit-core/api';

import type { Evento } from '@/lib/conversa/tipos';

import { entregaFala } from './envio-da-conversa';
import { chaveDaFila, criaFilaDaFala, type Armazem, type Lote } from './fila-da-fala';
import type { FalaDevolvida } from './fala-devolvida';

/** `sessionStorage` pode faltar ou recusar (Safari privado, cota): a fila segue só na memória. */
const armazem: Armazem = {
  le: (chave) => {
    try {
      return window.sessionStorage.getItem(chave);
    } catch {
      return null;
    }
  },
  grava: (chave, valor) => {
    try {
      window.sessionStorage.setItem(chave, valor);
    } catch {}
  },
  apaga: (chave) => {
    try {
      window.sessionStorage.removeItem(chave);
    } catch {}
  },
};

type Props = {
  slug: string;
  /** Sobe a cada reset/troca de sessão no stream (`canario-stream-cache.ts`). */
  geracao: number;
  isRunningRef: RefObject<boolean>;
  cicloRef: RefObject<number>;
  despachaRef: RefObject<(evento: Evento) => void>;
  devolvida: FalaDevolvida;
  preparaEnvio: () => void;
};

/**
 * A fala com o Zé trabalhando espera o fim do turno dele (`fila-da-fala.ts`). Para a máquina,
 * a fala que entrou na fila já foi "enviada": ela volta a esperar pelo Zé, como antes. O lote
 * que sai depois no fim do turno não mexe na máquina — só a falha definitiva vira erro.
 */
export function useFilaDaFala(p: Props) {
  const atual = useRef(p);
  atual.current = p;
  const filaRef = useRef<{ chave: string; fila: ReturnType<typeof criaFilaDaFala> } | null>(null);
  const vooRef = useRef(0); // sobe no descarte: entrega antiga não insiste mais
  const [naFila, setNaFila] = useState(false);

  // Lida sob demanda e só no navegador: no servidor não há `sessionStorage`.
  const fila = useCallback(() => {
    const chave = chaveDaFila(atual.current.slug);
    if (filaRef.current?.chave !== chave) filaRef.current = { chave, fila: criaFilaDaFala(armazem, chave) };
    return filaRef.current.fila;
  }, []);
  const mostra = useCallback(() => setNaFila(fila().pendentes() > 0), [fila]);

  const posta = useCallback(
    (lote: Lote, daMaquina: boolean) => {
      const { slug, cicloRef, despachaRef, devolvida, preparaEnvio } = atual.current;
      const ciclo = cicloRef.current, voo = vooRef.current;
      const maquinaViva = () => ciclo === cicloRef.current;
      const pedido = devolvida.envio(lote.texto);
      preparaEnvio();
      entregaFala({
        posta: () => postAgentInput(slug, pedido.monta(), { origin: 'voz' }),
        vivo: () => voo === vooRef.current,
        enviou: () => {
          pedido.entrou();
          fila().entrou(lote);
          if (daMaquina && maquinaViva()) despachaRef.current({ tipo: 'enviou' });
        },
        falhou: (motivo) => {
          fila().falhou(lote);
          mostra();
          if (maquinaViva()) despachaRef.current({ tipo: 'falhou', motivo });
        },
      });
    },
    [fila, mostra],
  );

  const saiSeLivre = useCallback(
    (rodando: boolean) => {
      const lote = fila().tenta(rodando);
      mostra();
      if (lote) posta(lote, false);
    },
    [fila, mostra, posta],
  );

  /** A fala transcrita: sai agora ou espera o fim do turno dele. */
  const envia = useCallback(
    (texto: string) => {
      const r = fila().fala(texto, atual.current.isRunningRef.current);
      mostra();
      if (r.tipo === 'posta') posta(r.lote, true);
      else atual.current.despachaRef.current({ tipo: 'enviou' });
    },
    [fila, mostra, posta],
  );

  const abriu = useCallback(() => fila().abriu(), [fila]);
  // O `abre` de um pedido que chegou no mesmo lote do fim roda logo depois: dá a vez a ele.
  const fechou = useCallback(() => {
    fila().fechou();
    window.setTimeout(() => saiSeLivre(false), 0);
  }, [fila, saiSeLivre]);
  /** O toque que começa (depois da recarga, a fila recuperada sai se o Zé estiver livre). */
  const tenta = useCallback(() => saiSeLivre(atual.current.isRunningRef.current), [saiSeLivre]);
  const descarta = useCallback(() => {
    vooRef.current += 1;
    fila().descarta();
    mostra();
  }, [fila, mostra]);

  useEffect(mostra, [mostra, p.slug]);
  // Sessão trocada (reset ou troca no stream): a fila era da outra conversa.
  const geracaoRef = useRef(p.geracao);
  useEffect(() => {
    if (geracaoRef.current === p.geracao) return;
    geracaoRef.current = p.geracao;
    descarta();
  }, [descarta, p.geracao]);

  return useMemo(() => ({ envia, abriu, fechou, tenta, descarta, naFila }), [envia, abriu, fechou, tenta, descarta, naFila]);
}
