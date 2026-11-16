'use client';

/**
 * Rede e tempo das ações do Histórico (F10). A apresentação mora em
 * `acoes-de-conversa.ts`; o acompanhamento único, em `troca-em-curso.ts`.
 *
 * - Trocar não confirma (rodada 2): parado, um toque troca — a de agora fica
 *   anotada no Histórico. Ocupado, o botão já vem âmbar e o toque interrompe.
 *   Se a frota dizia parado e a API responde 409 `ocupado`, o botão vira âmbar
 *   e espera o segundo toque: interromper nunca acontece sem o Rica ver.
 * - Durante a espera o `/operacao` é lido a cada 2 s. É a leitura que a API
 *   desenhou para isto (contrato, F5), e é compartilhada com o chat e o atalho.
 * - Ao montar, lê o `/operacao` uma vez: troca em curso volta como espera,
 *   não como botões livres.
 * - Fim na API não é fim na tela: a espera segue relendo a lista até o cartão
 *   mostrar a troca (régua em `regua-da-troca.ts`).
 */
import { useEffect, useRef, useState } from 'react';
import { ErroDeConversa, deleteConversa, postConversaNova, postConversaRetomar } from '@grupo_borges/cockpit-core/api';
import { SEM_CONTATO, explicaRecusa, type EstadoDaAcao, type Troca } from './acoes-de-conversa';
import { estadoDaTroca } from './estado-da-troca';
import { usaTrocaEmCurso } from '../../lib/usa-troca-em-curso';
import { comecarTroca, dispensaTroca, leTroca, postMorreu, postRecusado, postRespondeu, trocaBloqueia } from '../../lib/troca-em-curso';

export function usaAcoesDeConversa({ agentSlug, nome, atual, aoMudarLinha, aoExcluir, tituloDe }: {
  agentSlug: string;
  nome: string;
  /** Id da conversa no cartão "Em uso agora"; undefined = lista não lida. */
  atual: string | null | undefined;
  aoMudarLinha: () => void;
  aoExcluir: (id: string) => void;
  tituloDe: (id: string) => string | null;
}) {
  const troca = usaTrocaEmCurso(agentSlug, true);
  const [estado, setEstado] = useState<EstadoDaAcao>({ fase: 'livre' });
  const [trocouAgora, setTrocouAgora] = useState<Troca['tipo'] | null>(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const avisos = useRef({ aoMudarLinha, aoExcluir });
  avisos.current = { aoMudarLinha, aoExcluir };
  const mostrado = estadoDaTroca(troca, nome) ?? estado;

  const anterior = useRef(troca);
  useEffect(() => () => {
    if (anterior.current) dispensaTroca(agentSlug, anterior.current.clienteId);
  }, [agentSlug]);
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = troca;
    if (antes === troca) return;
    if (troca?.fase === 'concluida' || troca?.conferencia?.listaConferida) {
      if (!troca.adotada || (troca.tipo === 'retomar' && troca.entrou === troca.alvo)) setTrocouAgora(troca.tipo);
      avisos.current.aoMudarLinha();
    } else if (troca?.fase === 'conferindo' || troca?.fase === 'falhou' || troca?.fase === 'recusada') {
      avisos.current.aoMudarLinha();
    } else if (troca?.fase === 'esperando') setTrocouAgora(null);
  }, [troca?.clienteId, troca?.fase, troca?.tipo, troca?.conferencia?.listaConferida]);

  async function executa(pedida: Troca) {
    const corrente = leTroca(agentSlug);
    if (trocaBloqueia(corrente)) return;
    const pedido = { ...pedida, alvoTitulo: pedida.alvo ? tituloDe(pedida.alvo) : null,
      ...(pedida.tipo === 'nova' ? { antes: atual ?? null } : {}) };
    setEstado({ fase: 'livre' });
    const id = comecarTroca(agentSlug, pedido);
    try {
      const resposta = pedido.tipo === 'nova'
        ? await postConversaNova(agentSlug, pedido.forcar, id)
        : await postConversaRetomar(agentSlug, pedido.alvo ?? '', pedido.forcar, id);
      postRespondeu(agentSlug, id, resposta);
    } catch (erro) {
      if (erro instanceof ErroDeConversa && [400, 404, 409].includes(erro.status)) postRecusado(agentSlug, id, erro.codigo);
      else postMorreu(agentSlug, id);
    }
  }
  /** `ocupado` é o que a tela mostrou: o botão âmbar já disse que interrompe.
   *  Depois de um 409, o âmbar vem da máquina e vale o mesmo. */
  function pedeRetomar(id: string, { ocupado, desligado }: { ocupado: boolean; desligado: boolean }) {
    const recusada = mostrado.fase === 'ocupado' && mostrado.troca.alvo === id;
    void executa({ tipo: 'retomar', alvo: id, forcar: !desligado && (ocupado || recusada), desligado });
  }
  function confirma() {
    if (estado.fase === 'confirmando-exclusao') void exclui(estado.id);
  }
  async function exclui(id: string) {
    dispensaTroca(agentSlug);
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
  const larga = () => {
    dispensaTroca(agentSlug);
    setEstado((e) => (e.fase === 'excluindo' ? e : { fase: 'livre' }));
  };
  return {
    estado: mostrado,
    pedeRetomar,
    pedeExclusao: (id: string) => { dispensaTroca(agentSlug); setEstado({ fase: 'confirmando-exclusao', id }); },
    confirma,
    /** Cancelar, fechar o erro ou abrir outra conversa: volta ao livre (nunca no meio de uma troca). */
    larga,
    /** A troca que acabou de dar certo, enquanto o Histórico seguir aberto. */
    trocouAgora,
  };
}
