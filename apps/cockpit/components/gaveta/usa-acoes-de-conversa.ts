'use client';

/**
 * Rede e tempo das ações do Histórico (F10). A régua mora em
 * `acoes-de-conversa.ts`; aqui só o que precisa de React, `fetch` e relógio.
 *
 * - Retomar sempre confirma (derruba a linha). Nova só confirma quando vai
 *   interromper um turno; parada, um toque basta — a de agora fica anotada.
 * - Durante a espera o `/operacao` é lido a cada 2 s. É a leitura que a API
 *   desenhou para isto (contrato, F5), e só corre enquanto há troca na tela.
 * - Ao montar, lê o `/operacao` uma vez: troca em curso volta como espera,
 *   não como botões livres.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ErroDeConversa,
  deleteConversa,
  fetchConversaOperacao,
  postConversaNova,
  postConversaRetomar,
  type RespostaDaTroca,
} from '@grupo_borges/cockpit-core/api';

import {
  ATUAL,
  SEM_CONTATO,
  explicaRecusa,
  guardaTroca,
  leOperacao,
  trocaGuardada,
  type EstadoDaAcao,
  type Leitura,
  type Troca,
} from './acoes-de-conversa';

const LEITURA_MS = 2_000;
const FALHAS_DE_LEITURA = 5;

function sessao(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function usaAcoesDeConversa({
  agentSlug,
  nome,
  aoMudarLinha,
  aoExcluir,
}: {
  agentSlug: string;
  nome: string;
  /** A linha trocou de conversa (ou pode ter trocado): reler a lista. */
  aoMudarLinha: () => void;
  aoExcluir: (id: string) => void;
}) {
  const [estado, setEstado] = useState<EstadoDaAcao>({ fase: 'livre' });
  const [agora, setAgora] = useState(() => Date.now());
  const vivo = useRef(true);
  const avisos = useRef({ aoMudarLinha, aoExcluir });
  avisos.current = { aoMudarLinha, aoExcluir };

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const fecha = useCallback(
    (leitura: Exclude<Leitura, { tipo: 'segue' }>, troca: Troca | null) => {
      if (!vivo.current) return;
      guardaTroca(sessao(), agentSlug, null);
      setEstado(
        leitura.tipo === 'erro' ? { fase: 'falhou', onde: troca?.alvo ?? ATUAL, texto: leitura.texto } : { fase: 'livre' },
      );
      avisos.current.aoMudarLinha();
    },
    [agentSlug],
  );

  // Ao montar: a troca que a tela deixou correndo volta como espera.
  useEffect(() => {
    const controlador = new AbortController();
    fetchConversaOperacao(agentSlug, controlador.signal)
      .then((op) => {
        const leitura = leOperacao(op);
        const troca = trocaGuardada(sessao(), agentSlug);
        if (leitura.tipo === 'segue') {
          setEstado({ fase: 'esperando', troca, etapa: leitura.etapa, inicio: op.desde ?? Date.now() });
        } else if (troca) {
          // A troca acabou com a tela fora: o erro ainda é desta aba; a pronta, não diz nada.
          fecha(leitura, troca);
        }
      })
      .catch(() => {
        // Sem leitura, os botões ficam como estão; a API recusa com 409 se houver troca.
      });
    return () => controlador.abort();
  }, [agentSlug, fecha]);

  // A espera: relógio de 1 s e leitura do `/operacao` a cada 2 s.
  const esperando = estado.fase === 'esperando';
  const trocaDaEspera = estado.fase === 'esperando' ? estado.troca : null;
  useEffect(() => {
    if (!esperando) return;
    let falhas = 0;
    const relogio = setInterval(() => setAgora(Date.now()), 1_000);
    const leitor = setInterval(() => {
      fetchConversaOperacao(agentSlug)
        .then((op) => {
          falhas = 0;
          const leitura = leOperacao(op);
          if (leitura.tipo === 'segue') {
            setEstado((e) => (e.fase === 'esperando' && e.etapa !== leitura.etapa ? { ...e, etapa: leitura.etapa } : e));
          } else {
            fecha(leitura, trocaDaEspera);
          }
        })
        .catch(() => {
          falhas += 1;
          if (falhas >= FALHAS_DE_LEITURA) fecha({ tipo: 'erro', texto: SEM_CONTATO }, trocaDaEspera);
        });
    }, LEITURA_MS);
    return () => {
      clearInterval(relogio);
      clearInterval(leitor);
    };
  }, [esperando, trocaDaEspera, agentSlug, fecha]);

  async function executa(troca: Troca) {
    guardaTroca(sessao(), agentSlug, troca);
    setAgora(Date.now());
    setEstado({ fase: 'esperando', troca, etapa: troca.desligado ? 'religando' : 'estacionando', inicio: Date.now() });
    let resposta: RespostaDaTroca;
    try {
      resposta =
        troca.tipo === 'nova'
          ? await postConversaNova(agentSlug, troca.forcar)
          : await postConversaRetomar(agentSlug, troca.alvo ?? '', troca.forcar);
    } catch (erro) {
      if (!vivo.current) return;
      if (!(erro instanceof ErroDeConversa)) return; // a rede caiu; a troca pode seguir, o leitor decide
      if (erro.codigo === 'operacao_em_curso') return; // já há uma: a espera acompanha a de lá
      guardaTroca(sessao(), agentSlug, null);
      if (erro.codigo === 'ocupado' && !troca.forcar) {
        setEstado({ fase: 'confirmando', troca: { ...troca, forcar: true } });
        return;
      }
      setEstado({ fase: 'falhou', onde: troca.alvo ?? ATUAL, texto: explicaRecusa(erro.codigo, nome) });
      avisos.current.aoMudarLinha();
      return;
    }
    const leitura = leOperacao(resposta);
    if (leitura.tipo !== 'segue') fecha(leitura, troca); // 202: o leitor acompanha
  }

  function pedeRetomar(id: string, { ocupado, desligado }: { ocupado: boolean; desligado: boolean }) {
    setEstado({ fase: 'confirmando', troca: { tipo: 'retomar', alvo: id, forcar: ocupado && !desligado, desligado } });
  }

  function pedeNova(ocupado: boolean) {
    const troca: Troca = { tipo: 'nova', alvo: null, forcar: ocupado, desligado: false };
    if (ocupado) setEstado({ fase: 'confirmando', troca });
    else void executa(troca);
  }

  function confirma() {
    if (estado.fase === 'confirmando') void executa(estado.troca);
    else if (estado.fase === 'confirmando-exclusao') void exclui(estado.id);
  }

  async function exclui(id: string) {
    setEstado({ fase: 'excluindo', id });
    try {
      await deleteConversa(agentSlug, id);
      if (!vivo.current) return;
      setEstado({ fase: 'livre' });
      avisos.current.aoExcluir(id);
    } catch (erro) {
      if (!vivo.current) return;
      if (erro instanceof ErroDeConversa && erro.status === 404) {
        setEstado({ fase: 'livre' }); // já não estava lá: o efeito pedido está feito
        avisos.current.aoExcluir(id);
        return;
      }
      const texto = erro instanceof ErroDeConversa ? explicaRecusa(erro.codigo, nome) : SEM_CONTATO;
      setEstado({ fase: 'falhou', onde: id, texto: `Não excluí: ${texto}` });
    }
  }

  const larga = () => setEstado((e) => (e.fase === 'esperando' || e.fase === 'excluindo' ? e : { fase: 'livre' }));

  return {
    estado,
    agora,
    pedeRetomar,
    pedeNova,
    pedeExclusao: (id: string) => setEstado({ fase: 'confirmando-exclusao', id }),
    confirma,
    /** Cancelar, fechar o erro ou abrir outra conversa: volta ao livre (nunca no meio de uma troca). */
    larga,
  };
}
