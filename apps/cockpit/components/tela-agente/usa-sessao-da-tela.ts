/**
 * A vida de uma tela do agente: abre a sessão, liga o fluxo de quadros, assume,
 * devolve, manda entrada e, quando cai, reabre — nunca reaproveita token velho
 * (contrato: no `onerror`, fecha tudo e abre sessão nova).
 *
 * Fases, que são o que o Rica lê na barra: `abrindo` → `vendo` ⇄ `controle`;
 * qualquer queda → `caiu` (reabre sozinho, até 3 vezes, só com a aba visível).
 * `abrindo` tem prazo: o fluxo manda `estado` a cada 2 s, então sem quadro o
 * `onerror` nunca vem — 5 s sem imagem reabre calado, e na terceira vez cai.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  abrirSessao,
  encerrarSessao,
  FalhaDaTela,
  textoDaFalha,
  urlDosQuadros,
  type EstadoDoFluxo,
  type Pedido,
  type Quadro,
} from '@/lib/tela-agente';

import { usaAcoesDaPosse, type EsperaQuadroNovo } from './acoes-da-posse';

export type Fase = 'abrindo' | 'vendo' | 'controle' | 'caiu';

/** Dica é orientação (cinza, `status`); erro é o que deu errado (coral com ✕, `alert`). */
export type Aviso = { texto: string; tipo: 'dica' | 'erro' };

const ESPERAS_DA_RECONEXAO_MS = [1500, 4000, 10000];
const PRAZO_DA_PRIMEIRA_IMAGEM_MS = 5000;
/** Reaberturas caladas por falta de imagem antes de dizer que caiu. */
const REABERTURAS_CALADAS = 2;

export function usaSessaoDaTela(chrome: string, pedidoDaUrl: string | null) {
  const [fase, setFase] = useState<Fase>('abrindo');
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ocupado, setOcupado] = useState<'assumindo' | 'devolvendo' | null>(null);
  /** Momento do último Devolver: a barra diz "Devolvido" por alguns segundos. */
  const [devolvidoEm, setDevolvidoEm] = useState<number | null>(null);
  const [geracao, setGeracao] = useState(0);
  const [sessaoId, setSessaoId] = useState<string | null>(null);
  /** Desde quando a tela espera a primeira imagem, somando as reaberturas caladas. */
  const [conectandoDesde, setConectandoDesde] = useState<number | null>(null);

  const sessao = useRef<string | null>(null);
  const controle = useRef<string | null>(null);
  const tentativas = useRef(0);
  const reaberturas = useRef(0);
  const repetiu = useRef(false);
  /** Estava no controle quando caiu? Sobrevive ao `estado` que limpa o token antes da queda. */
  const tevePosse = useRef(false);
  /** Por que a posse voltou ao agente. O back fecha a sessão logo depois; o motivo sobrevive à reconexão. */
  const motivoDaPerda = useRef<string | null>(null);
  /**
   * Assumir e devolver trocam o tamanho da página: o quadro velho não vale mais
   * para tocar. O botão fica ocupado até chegar a imagem de tamanho diferente (ou,
   * se o tamanho não mudou, até um respiro) — só então a fase troca.
   */
  const esperaQuadroNovo = useRef<EsperaQuadroNovo | null>(null);
  const ultimoQuadro = useRef<Quadro | null>(null);
  const pedidoPendente = useRef<string | null>(pedidoDaUrl);

  // Uma geração = uma sessão. Reconectar é subir a geração.
  useEffect(() => {
    let vivo = true;
    let fonte: EventSource | null = null;
    let espera: number | undefined;
    let prazo: number | undefined;
    let primeiro = true;

    /** Fecha o fluxo e a sessão; cumpre quando o back soltou o Chrome. */
    const solta = () => {
      fonte?.close();
      fonte = null;
      controle.current = null;
      const fim = sessao.current ? encerrarSessao(sessao.current) : Promise.resolve();
      sessao.current = null;
      if (vivo) setSessaoId(null);
      return fim;
    };

    const cai = (texto: string | null) => {
      if (!vivo) return;
      window.clearTimeout(prazo);
      setConectandoDesde(null);
      const estavaNoControle = tevePosse.current;
      tevePosse.current = false;
      void solta();
      setQuadro(null);
      setFase('caiu');
      const n = tentativas.current;
      const tenta = n < ESPERAS_DA_RECONEXAO_MS.length && !document.hidden;
      setAviso({
        tipo: 'erro',
        texto: [motivoDaPerda.current ?? texto, estavaNoControle && !motivoDaPerda.current ? 'O Chrome voltou para o agente.' : null, tenta ? 'Reconectando sozinho…' : 'Toque em Reconectar.']
          .filter(Boolean)
          .join(' '),
      });
      if (tenta) {
        tentativas.current = n + 1;
        espera = window.setTimeout(() => vivo && setGeracao((g) => g + 1), ESPERAS_DA_RECONEXAO_MS[n]);
      }
    };

    setFase('abrindo');
    setConectandoDesde((d) => d ?? Date.now());
    /** Conta do fluxo ligado: a latência do POST não come o prazo da imagem. */
    const armaPrazo = () => {
      prazo = window.setTimeout(() => {
        if (!vivo || !primeiro) return;
        // Aba escondida: solta e espera; o `visibilitychange` reabre na volta.
        if (document.hidden) return void solta();
        if (reaberturas.current < REABERTURAS_CALADAS) {
          reaberturas.current += 1;
          // Reabre só depois que o back soltou a sessão velha: antes disso o POST leva 409.
          return void solta().then(() => vivo && setGeracao((g) => g + 1));
        }
        cai('O Chrome não mandou imagem.');
      }, PRAZO_DA_PRIMEIRA_IMAGEM_MS);
    };
    abrirSessao(chrome, pedidoPendente.current)
      .then((s) => {
        if (!vivo) return encerrarSessao(s.id);
        sessao.current = s.id;
        setSessaoId(s.id);
        setPedido(s.pedido);
        fonte = new EventSource(urlDosQuadros(s.id));
        fonte.addEventListener('quadro', (e) => {
          if (!vivo) return;
          tentativas.current = 0;
          repetiu.current = false;
          const novo = JSON.parse((e as MessageEvent).data) as Quadro;
          const espera = esperaQuadroNovo.current;
          if (espera && (novo.largura !== espera.largura || novo.altura !== espera.altura)) espera.pronto();
          ultimoQuadro.current = novo;
          setQuadro(novo);
          if (primeiro) {
            // Voltou depois de queda: o aviso dela sai junto, menos o motivo de ter perdido a posse.
            primeiro = false;
            window.clearTimeout(prazo);
            reaberturas.current = 0;
            setConectandoDesde(null);
            setFase('vendo');
            setAviso(motivoDaPerda.current ? { texto: motivoDaPerda.current, tipo: 'erro' } : null);
            motivoDaPerda.current = null;
          }
        });
        fonte.addEventListener('estado', (e) => {
          if (!vivo) return;
          const estado = JSON.parse((e as MessageEvent).data) as EstadoDoFluxo;
          setPedido(estado.pedido);
          // Perdeu a posse do lado de lá (3 min sem toque, por exemplo).
          // Durante o Assumir, um `estado` emitido antes dele ainda pode chegar: não conta.
          if (!estado.assumido && controle.current && !esperaQuadroNovo.current) {
            controle.current = null;
            tevePosse.current = false;
            motivoDaPerda.current = 'O Chrome voltou para o agente: 3 minutos sem toque, ou a tela foi fechada em outro lugar. Assuma de novo se precisar.';
            setFase('vendo');
            setAviso({ texto: motivoDaPerda.current, tipo: 'erro' });
          }
        });
        fonte.onerror = () => cai(null);
        armaPrazo();
      })
      .catch(async (erro: unknown) => {
        const status = erro instanceof FalhaDaTela ? erro.status : undefined;
        // Link de pedido já resolvido: abre a tela mesmo assim, sem o pedido.
        if (status === 409 && pedidoPendente.current) {
          pedidoPendente.current = null;
          if (vivo) setGeracao((g) => g + 1);
          return;
        }
        // A tela anterior (recarga, aba que acabou de fechar) ainda está saindo: uma
        // segunda tentativa calada antes de dizer que caiu.
        if (status === 409 && !repetiu.current) {
          repetiu.current = true;
          espera = window.setTimeout(() => vivo && setGeracao((g) => g + 1), 1200);
          return;
        }
        cai(textoDaFalha('abrir', status, (erro as Error).message));
      });

    const aoVoltar = () => {
      if (!document.hidden && sessao.current === null && vivo) {
        tentativas.current = 0;
        reaberturas.current = 0;
        setConectandoDesde(null);
        setGeracao((g) => g + 1);
      }
    };
    const aoSair = () => void solta();
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('pagehide', aoSair);

    return () => {
      vivo = false;
      window.clearTimeout(espera);
      window.clearTimeout(prazo);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('pagehide', aoSair);
      void solta();
    };
  }, [chrome, geracao]);

  // O pedido segue para a próxima sessão só enquanto estiver aberto.
  useEffect(() => {
    pedidoPendente.current = pedido && (pedido.status === 'aguardando' || pedido.status === 'em_atendimento') ? pedido.id : null;
  }, [pedido]);

  const { assumir, devolver, ajustar, enviar } = usaAcoesDaPosse({
    sessao,
    controle,
    tevePosse,
    motivoDaPerda,
    esperaQuadroNovo,
    ultimoQuadro,
    setFase,
    setAviso,
    setOcupado,
    setDevolvidoEm,
    setPedido,
  });

  const reconectar = useCallback(() => {
    tentativas.current = 0;
    reaberturas.current = 0;
    setConectandoDesde(null);
    setGeracao((g) => g + 1);
  }, []);

  return {
    fase,
    quadro,
    pedido,
    aviso,
    ocupado,
    devolvidoEm,
    conectandoDesde,
    sessao: sessaoId,
    assumir,
    ajustar,
    devolver,
    enviar,
    reconectar,
    avisar: (texto: string) => setAviso({ texto, tipo: 'dica' }),
  };
}
