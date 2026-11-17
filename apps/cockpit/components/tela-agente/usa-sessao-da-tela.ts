/**
 * A vida de uma tela do agente: abre a sessão, liga o fluxo de quadros, assume,
 * devolve, manda entrada e, quando cai, reabre — nunca reaproveita token velho
 * (contrato: no `onerror`, fecha tudo e abre sessão nova).
 *
 * Fases, que são o que o Rica lê na barra: `abrindo` → `vendo` ⇄ `controle`;
 * qualquer queda → `caiu` (reabre sozinho, até 3 vezes, só com a aba visível).
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  abrirSessao,
  assumir as postAssumir,
  devolver as postDevolver,
  encerrarSessao,
  enviarEntrada,
  FalhaDaTela,
  textoDaFalha,
  urlDosQuadros,
  type Entrada,
  type EstadoDoFluxo,
  type Pedido,
  type Quadro,
} from '@/lib/tela-agente';

export type Fase = 'abrindo' | 'vendo' | 'controle' | 'caiu';

/** Dica é orientação (cinza, `status`); erro é o que deu errado (coral com ✕, `alert`). */
export type Aviso = { texto: string; tipo: 'dica' | 'erro' };

const ESPERAS_DA_RECONEXAO_MS = [1500, 4000, 10000];

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

  const sessao = useRef<string | null>(null);
  const controle = useRef<string | null>(null);
  const tentativas = useRef(0);
  const repetiu = useRef(false);
  /** Estava no controle quando caiu? Sobrevive ao `estado` que limpa o token antes da queda. */
  const tevePosse = useRef(false);
  const pedidoPendente = useRef<string | null>(pedidoDaUrl);

  // Uma geração = uma sessão. Reconectar é subir a geração.
  useEffect(() => {
    let vivo = true;
    let fonte: EventSource | null = null;
    let espera: number | undefined;

    const solta = () => {
      fonte?.close();
      fonte = null;
      controle.current = null;
      if (sessao.current) encerrarSessao(sessao.current);
      sessao.current = null;
      if (vivo) setSessaoId(null);
    };

    const cai = (texto: string | null) => {
      if (!vivo) return;
      const estavaNoControle = tevePosse.current;
      tevePosse.current = false;
      solta();
      setQuadro(null);
      setFase('caiu');
      const n = tentativas.current;
      const tenta = n < ESPERAS_DA_RECONEXAO_MS.length && !document.hidden;
      setAviso({
        tipo: 'erro',
        texto: [texto, estavaNoControle ? 'O Chrome voltou para o agente.' : null, tenta ? 'Reconectando sozinho…' : 'Toque em Reconectar.']
          .filter(Boolean)
          .join(' '),
      });
      if (tenta) {
        tentativas.current = n + 1;
        espera = window.setTimeout(() => vivo && setGeracao((g) => g + 1), ESPERAS_DA_RECONEXAO_MS[n]);
      }
    };

    setFase('abrindo');
    abrirSessao(chrome, pedidoPendente.current)
      .then((s) => {
        if (!vivo) return encerrarSessao(s.id);
        sessao.current = s.id;
        setSessaoId(s.id);
        setPedido(s.pedido);
        let primeiro = true;
        fonte = new EventSource(urlDosQuadros(s.id));
        fonte.addEventListener('quadro', (e) => {
          if (!vivo) return;
          tentativas.current = 0;
          repetiu.current = false;
          setQuadro(JSON.parse((e as MessageEvent).data) as Quadro);
          if (primeiro) {
            // Voltou depois de queda: o aviso dela sai junto.
            primeiro = false;
            setFase('vendo');
            setAviso(null);
          }
        });
        fonte.addEventListener('estado', (e) => {
          if (!vivo) return;
          const estado = JSON.parse((e as MessageEvent).data) as EstadoDoFluxo;
          setPedido(estado.pedido);
          // Perdeu a posse do lado de lá (3 min sem toque, por exemplo).
          if (!estado.assumido && controle.current) {
            controle.current = null;
            setFase('vendo');
            setAviso({ texto: 'A posse voltou para o agente: ficou 3 minutos sem toque. Assuma de novo se precisar.', tipo: 'erro' });
          }
        });
        fonte.onerror = () => cai(null);
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
        setGeracao((g) => g + 1);
      }
    };
    const aoSair = () => solta();
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('pagehide', aoSair);

    return () => {
      vivo = false;
      window.clearTimeout(espera);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('pagehide', aoSair);
      solta();
    };
  }, [chrome, geracao]);

  // O pedido segue para a próxima sessão só enquanto estiver aberto.
  useEffect(() => {
    pedidoPendente.current = pedido && (pedido.status === 'aguardando' || pedido.status === 'em_atendimento') ? pedido.id : null;
  }, [pedido]);

  const assumir = useCallback(async () => {
    if (!sessao.current) return;
    setOcupado('assumindo');
    setAviso(null);
    try {
      const { controle: token } = await postAssumir(sessao.current);
      controle.current = token;
      tevePosse.current = true;
      setDevolvidoEm(null);
      setFase('controle');
    } catch (erro) {
      setAviso({ texto: textoDaFalha('assumir', erro instanceof FalhaDaTela ? erro.status : undefined, (erro as Error).message), tipo: 'erro' });
    } finally {
      setOcupado(null);
    }
  }, []);

  const devolver = useCallback(async () => {
    if (!sessao.current || !controle.current) return;
    setOcupado('devolvendo');
    setAviso(null);
    try {
      await postDevolver(sessao.current, controle.current);
      controle.current = null;
      tevePosse.current = false;
      setFase('vendo');
      setDevolvidoEm(Date.now());
      setPedido((p) => (p ? { ...p, status: 'devolvido' } : p));
    } catch (erro) {
      const status = erro instanceof FalhaDaTela ? erro.status : undefined;
      if (status === 403 || status === 410) {
        controle.current = null;
        tevePosse.current = false;
        setFase('vendo');
      }
      setAviso({ texto: textoDaFalha('devolver', status, (erro as Error).message), tipo: 'erro' });
    } finally {
      setOcupado(null);
    }
  }, []);

  /** Manda uma entrada. Devolve `false` se não foi entregue (o aviso já está na tela). */
  const enviar = useCallback(async (entrada: Entrada): Promise<boolean> => {
    if (!sessao.current || !controle.current) return false;
    try {
      await enviarEntrada(sessao.current, controle.current, entrada);
      setAviso(null);
      return true;
    } catch (erro) {
      const status = erro instanceof FalhaDaTela ? erro.status : undefined;
      if (status === 403 || status === 410) {
        controle.current = null;
        tevePosse.current = false;
        setFase('vendo');
      }
      setAviso({ texto: textoDaFalha('entrada', status, (erro as Error).message), tipo: 'erro' });
      return false;
    }
  }, []);

  const reconectar = useCallback(() => {
    tentativas.current = 0;
    setGeracao((g) => g + 1);
  }, []);

  return {
    fase,
    quadro,
    pedido,
    aviso,
    ocupado,
    devolvidoEm,
    sessao: sessaoId,
    assumir,
    devolver,
    enviar,
    reconectar,
    avisar: (texto: string) => setAviso({ texto, tipo: 'dica' }),
  };
}
