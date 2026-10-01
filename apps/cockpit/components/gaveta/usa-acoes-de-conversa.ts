'use client';

/**
 * Rede e tempo das ações do Histórico (F10). A régua mora em
 * `acoes-de-conversa.ts`; aqui só o que precisa de React, `fetch` e relógio.
 *
 * - Trocar não confirma (rodada 2): parado, um toque troca — a de agora fica
 *   anotada no Histórico. Ocupado, o botão já vem âmbar e o toque interrompe.
 *   Se a frota dizia parado e a API responde 409 `ocupado`, o botão vira âmbar
 *   e espera o segundo toque: interromper nunca acontece sem o Rica ver.
 * - Durante a espera o `/operacao` é lido a cada 2 s. É a leitura que a API
 *   desenhou para isto (contrato, F5), e só corre enquanto há troca na tela.
 * - Ao montar, lê o `/operacao` uma vez: troca em curso volta como espera,
 *   não como botões livres.
 * - Fim na API não é fim na tela: a espera segue relendo a lista até o cartão
 *   mostrar a troca (régua em `depoisDaTroca`/`fimDaConferencia`).
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
  depoisDaTroca,
  explicaRecusa,
  fimDaConferencia,
  guardaTroca,
  leOperacao,
  trocaGuardada,
  type EstadoDaAcao,
  type Leitura,
  type Troca,
} from './acoes-de-conversa';
import { assumeTroca, leTrocaNoChat, publicaTrocaNoChat } from '../../lib/troca-em-curso';

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
  atual,
  releLista,
  aoMudarLinha,
  aoExcluir,
  tituloDe,
}: {
  agentSlug: string;
  nome: string;
  /** Id da conversa no cartão "Em uso agora"; `undefined` = lista não lida. */
  atual: string | null | undefined;
  /** Releitura só da lista, para a conferência. */
  releLista: () => void;
  /** A linha trocou de conversa (ou pode ter trocado): reler a lista. */
  aoMudarLinha: () => void;
  aoExcluir: (id: string) => void;
  /** Título de uma conversa da lista, para o chat dizer para onde está indo. */
  tituloDe: (id: string) => string | null;
}) {
  const [estado, setEstado] = useState<EstadoDaAcao>({ fase: 'livre' });
  const [agora, setAgora] = useState(() => Date.now());
  const [trocouAgora, setTrocouAgora] = useState<Troca['tipo'] | null>(null);
  const vivo = useRef(true);
  const avisos = useRef({ aoMudarLinha, aoExcluir, releLista, atual });
  avisos.current = { aoMudarLinha, aoExcluir, releLista, atual };

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
      const agora = Date.now();
      // O fim chega duas vezes (leitor e resposta do POST): a segunda não reabre a conferência.
      setEstado((e) => (e.fase === 'conferindo' ? e : depoisDaTroca(leitura, troca, e.fase === 'esperando' ? e.inicio : agora, agora)));
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

  // A espera: leitura do `/operacao` a cada 2 s.
  const esperando = estado.fase === 'esperando';
  const trocaDaEspera = estado.fase === 'esperando' ? estado.troca : null;
  useEffect(() => {
    if (!esperando) return;
    let falhas = 0;
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
    return () => clearInterval(leitor);
  }, [esperando, trocaDaEspera, agentSlug, fecha]);

  // A conferência: relê a lista a cada 2 s até ela mostrar a troca ou o prazo vencer.
  const conferindo = estado.fase === 'conferindo';
  useEffect(() => {
    if (!conferindo) return;
    const relogio = setInterval(() => setAgora(Date.now()), 1_000);
    const leitor = setInterval(() => avisos.current.releLista(), LEITURA_MS);
    return () => {
      clearInterval(relogio);
      clearInterval(leitor);
    };
  }, [conferindo]);

  useEffect(() => {
    if (estado.fase !== 'conferindo') return;
    const fim = fimDaConferencia(estado, atual, agora);
    if (!fim) return;
    setEstado(fim);
    if (fim.fase === 'falhou') avisos.current.aoMudarLinha();
  }, [estado, atual, agora]);

  // O CHAT ACOMPANHA (F13): a troca daqui aparece no fim do chat, que apaga a
  // conversa que vai sair. Enquanto este hook está montado, é ele quem conduz.
  useEffect(() => assumeTroca(agentSlug), [agentSlug]);
  const titulos = useRef(tituloDe);
  titulos.current = tituloDe;
  const anterior = useRef<EstadoDaAcao>(estado);
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = estado;
    const vinhaTrocando = antes.fase === 'esperando' || antes.fase === 'conferindo';
    if (vinhaTrocando && estado.fase === 'livre') setTrocouAgora(antes.troca?.tipo ?? 'retomar');
    const noChat = leTrocaNoChat(agentSlug);
    if (estado.fase === 'esperando' || estado.fase === 'conferindo') {
      const troca = estado.troca;
      publicaTrocaNoChat(agentSlug, {
        fase: 'trocando',
        tipo: troca?.tipo ?? 'retomar',
        alvoTitulo: troca?.alvo ? titulos.current(troca.alvo) : null,
        etapa: estado.fase === 'esperando' ? estado.etapa : 'religando',
        inicio: estado.inicio,
        desligado: troca?.desligado ?? false,
        forcar: troca?.forcar ?? false,
      });
      setTrocouAgora(null);
    } else if (noChat?.fase === 'trocando') {
      if (estado.fase === 'falhou') {
        publicaTrocaNoChat(agentSlug, { fase: 'falhou', texto: estado.texto });
      } else {
        publicaTrocaNoChat(agentSlug, { fase: 'pronta', emMs: Date.now() });
      }
    }
  }, [agentSlug, estado]);

  async function executa(pedida: Troca) {
    const troca: Troca = pedida.tipo === 'nova' ? { ...pedida, antes: avisos.current.atual ?? null } : pedida;
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
        setEstado({ fase: 'ocupado', troca: { ...troca, forcar: true } });
        return;
      }
      setEstado({ fase: 'falhou', onde: troca.alvo ?? ATUAL, texto: explicaRecusa(erro.codigo, nome) });
      avisos.current.aoMudarLinha();
      return;
    }
    const leitura = leOperacao(resposta);
    if (leitura.tipo !== 'segue') fecha(leitura, troca); // 202: o leitor acompanha
  }

  /** `ocupado` é o que a tela mostrou: o botão âmbar já disse que interrompe.
   *  Depois de um 409, o âmbar vem da máquina e vale o mesmo. */
  function pedeRetomar(id: string, { ocupado, desligado }: { ocupado: boolean; desligado: boolean }) {
    const recusada = estado.fase === 'ocupado' && estado.troca.alvo === id;
    void executa({ tipo: 'retomar', alvo: id, forcar: !desligado && (ocupado || recusada), desligado });
  }

  function confirma() {
    if (estado.fase === 'confirmando-exclusao') void exclui(estado.id);
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

  const larga = () =>
    setEstado((e) => (e.fase === 'esperando' || e.fase === 'conferindo' || e.fase === 'excluindo' ? e : { fase: 'livre' }));

  return {
    estado,
    pedeRetomar,
    pedeExclusao: (id: string) => setEstado({ fase: 'confirmando-exclusao', id }),
    confirma,
    /** Cancelar, fechar o erro ou abrir outra conversa: volta ao livre (nunca no meio de uma troca). */
    larga,
    /** A troca que acabou de dar certo, enquanto o Histórico seguir aberto. */
    trocouAgora,
  };
}
