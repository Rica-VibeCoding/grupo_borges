'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { Estado } from '@/lib/conversa/tipos';
import type { CanarioStreamState } from '@/lib/spike/canario-stream-controller';

import {
  chaveDaRetomada,
  gravaGuardado,
  leGuardado,
  passosDaRetomada,
  retomadaDoStream,
  type Guardado,
  type Retomada,
} from './retomada-da-conversa';
import { maiorIdDasMensagens } from './textos-do-ze';

/** `sessionStorage` pode faltar ou recusar (Safari privado, cota): a conversa segue sem retomada. */
const armazem = {
  le: (chave: string) => {
    try {
      return window.sessionStorage.getItem(chave);
    } catch {
      return null;
    }
  },
  grava: (chave: string, valor: string) => {
    try {
      window.sessionStorage.setItem(chave, valor);
    } catch {}
  },
  apaga: (chave: string) => {
    try {
      window.sessionStorage.removeItem(chave);
    } catch {}
  },
};

export type AoRetomar = {
  retomar: () => void;
  texto: (texto: string, id: number) => void;
  fecha: () => void;
};

/**
 * A conversa sobrevive à recarga (`retomada-da-conversa.ts`): guarda no aparelho até onde a voz
 * dele já tocou, e depois da recarga lê do stream o que mostrar e o que o toque retoma. A marca
 * só anda com a conversa ativa; parar (ou sair da tela) apaga.
 */
export function useRetomadaDaConversa({
  slug,
  stream,
  estado,
  sessaoAtivaRef,
}: {
  slug: string;
  stream: Pick<CanarioStreamState, 'messages' | 'isRunning' | 'status'>;
  estado: Estado;
  sessaoAtivaRef: RefObject<boolean>;
}) {
  const chave = chaveDaRetomada(slug);
  const [lido, setLido] = useState<Guardado | null>(null);
  const marcaRef = useRef<Guardado | null>(null);
  const entregueAteRef = useRef(0);
  /* O id do texto que a máquina recebe agora; `virouVoz` o consome quando ela manda falar. */
  const emMaosRef = useRef<number | null>(null);
  const mensagensRef = useRef(stream.messages);
  mensagensRef.current = stream.messages;

  // Lido depois de montar: no servidor não há `sessionStorage`.
  useEffect(() => {
    const g = leGuardado(armazem.le(chave), Date.now());
    marcaRef.current = g;
    setLido(g);
  }, [chave]);

  const grava = useCallback(
    (ouvidoAte: number) => {
      const g: Guardado = { v: 1, ouvidoAte, em: Date.now() };
      marcaRef.current = g;
      armazem.grava(chave, gravaGuardado(g));
    },
    [chave],
  );

  const apaga = useCallback(() => {
    marcaRef.current = null;
    setLido(null);
    armazem.apaga(chave);
  }, [chave]);

  /** O texto com esse id já tocou inteiro, ou nunca vai tocar (turno descartado). */
  const ouviu = useCallback(
    (id: number) => {
      if (!sessaoAtivaRef.current) return;
      if (id > (marcaRef.current?.ouvidoAte ?? 0)) grava(id);
    },
    [grava, sessaoAtivaRef],
  );

  /**
   * Cada texto dele que chega à máquina (`despacha` entrega o `textoDoZe`). Se ela não mandou falar,
   * o texto é de turno descartado: nunca vai tocar, e a marca passa por ele.
   */
  const entrega = useCallback(
    (id: number, despacha: () => void) => {
      emMaosRef.current = id;
      despacha();
      entregueAteRef.current = Math.max(entregueAteRef.current, id);
      if (emMaosRef.current !== null) ouviu(id);
      emMaosRef.current = null;
    },
    [ouviu],
  );

  /** A máquina mandou falar o texto em mãos: o id vai junto para a fila de voz. */
  const virouVoz = useCallback(() => {
    const id = emMaosRef.current;
    emMaosRef.current = null;
    return id;
  }, []);

  /** A fila foi jogada fora (fala por cima): o que chegou até aqui não toca mais. */
  const descartou = useCallback(() => ouviu(entregueAteRef.current), [ouviu]);

  /** Conversa nova: o que já estava no log não é para tocar. */
  const comeca = useCallback(() => grava(maiorIdDasMensagens(mensagensRef.current)), [grava]);

  /** O toque depois da recarga: renova a marca e executa os passos da retomada, em ordem. */
  const retoma = useCallback(
    (r: Retomada, ao: AoRetomar) => {
      // Sem marca, é conversa nova com ele no turno: como no `comeca`, o que já estava no log não toca.
      grava(marcaRef.current?.ouvidoAte ?? maiorIdDasMensagens(mensagensRef.current));
      for (const passo of passosDaRetomada(r)) {
        if (passo.tipo === 'retomar') ao.retomar();
        else if (passo.tipo === 'texto') ao.texto(passo.texto, passo.id);
        else ao.fecha();
      }
    },
    [grava],
  );

  // Só antes do toque: a máquina parada, com o replay do stream já na mão.
  const retomada = useMemo(
    () => (estado === 'parado' && stream.status === 'live' ? retomadaDoStream(lido, stream.messages, stream.isRunning) : null),
    [estado, lido, stream.isRunning, stream.messages, stream.status],
  );

  return { retomada, comeca, retoma, ouviu, entrega, virouVoz, descartou, apaga };
}
