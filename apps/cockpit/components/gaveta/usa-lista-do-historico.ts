'use client';

/**
 * Os dados do Histórico: a lista de *Todas* (que também serve o filtro ⭐) e a
 * de *Concluídas*, que a API só manda pedida à parte (F14) e por isso é lida na
 * primeira vez que o filtro abre. As mudanças feitas na leitura (⭐, Concluída,
 * Renomear, 🗑) entram nas duas listas no ato; a régua do filtro decide onde
 * cada conversa aparece.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchConversas, type Conversa, type ConversasResponse, type FiltroDaApi } from '@grupo_borges/cockpit-core/api';

export type Carga = { fase: 'carregando' } | { fase: 'falhou'; motivo: string } | { fase: 'pronto'; dados: ConversasResponse; lidaEm: number };

const motivo = (e: unknown) => (e instanceof Error ? e.message : String(e));

function mudaNa(carga: Carga, muda: (lista: Conversa[]) => Conversa[]): Carga {
  return carga.fase === 'pronto' ? { ...carga, dados: { ...carga.dados, conversas: muda(carga.dados.conversas) } } : carga;
}

/** Junta a conversa na lista que ainda não a tem, na ordem da mais recente. */
function junta(lista: Conversa[], conversa: Conversa): Conversa[] {
  if (lista.some((c) => c.id === conversa.id)) return lista;
  return [...lista, conversa].sort((a, b) => b.atualizada_em - a.atualizada_em);
}

export function usaListaDoHistorico(agentSlug: string) {
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [concluidas, setConcluidas] = useState<Carga | null>(null);

  /** `quieto`: relê sem trocar a lista pelo esqueleto (depois de uma troca).
   *  Leitura pedida antes da que já entrou não vale: lenta, desfaria a troca. */
  const leituras = useRef({ pedida: 0, aplicada: 0 });
  const ler = useCallback(
    (signal?: AbortSignal, quieto = false) => {
      if (!quieto) setCarga({ fase: 'carregando' });
      const esta = ++leituras.current.pedida;
      fetchConversas(agentSlug, signal)
        .then((dados) => {
          if (signal?.aborted || esta < leituras.current.aplicada) return;
          leituras.current.aplicada = esta;
          setCarga({ fase: 'pronto', dados, lidaEm: Date.now() });
        })
        .catch((e: unknown) => {
          if (signal?.aborted || quieto) return;
          setCarga({ fase: 'falhou', motivo: motivo(e) });
        });
    },
    [agentSlug],
  );

  useEffect(() => {
    const controlador = new AbortController();
    ler(controlador.signal);
    return () => controlador.abort();
  }, [ler]);

  const lerConcluidas = useCallback(() => {
    const filtro: FiltroDaApi = 'concluidas';
    setConcluidas((c) => (c?.fase === 'pronto' ? c : { fase: 'carregando' }));
    fetchConversas(agentSlug, undefined, filtro)
      .then((dados) => setConcluidas({ fase: 'pronto', dados, lidaEm: Date.now() }))
      .catch((e: unknown) => setConcluidas((c) => (c?.fase === 'pronto' ? c : { fase: 'falhou', motivo: motivo(e) })));
  }, [agentSlug]);

  /** Muda campos de uma conversa onde ela estiver. Concluída e Reabrir também
   *  a levam para a outra lista (se ela já foi lida). */
  const muda = useCallback((conversa: Conversa, campos: Partial<Conversa>) => {
    const nova = { ...conversa, ...campos };
    const aplica = (lista: Conversa[]) => lista.map((c) => (c.id === conversa.id ? { ...c, ...campos } : c));
    setCarga((c) => mudaNa(c, (l) => (campos.concluida === false ? junta(aplica(l), nova) : aplica(l))));
    setConcluidas((c) => (c ? mudaNa(c, (l) => (campos.concluida === true ? junta(aplica(l), nova) : aplica(l))) : c));
  }, []);

  const tira = useCallback((id: string) => {
    const sem = (lista: Conversa[]) => lista.filter((c) => c.id !== id);
    setCarga((c) => mudaNa(c, sem));
    setConcluidas((c) => (c ? mudaNa(c, sem) : c));
  }, []);

  return { carga, concluidas, ler, lerConcluidas, muda, tira };
}
