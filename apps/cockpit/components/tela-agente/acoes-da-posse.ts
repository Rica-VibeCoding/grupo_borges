/**
 * O que o dedo pede com a sessão aberta: assumir, devolver, ajustar o tamanho e
 * mandar entrada. A vida da sessão (abrir, fluxo, queda) mora em
 * `usa-sessao-da-tela.ts`, que entrega aqui os refs e os setters dela.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';

import {
  ajustarTamanho,
  assumir as postAssumir,
  devolver as postDevolver,
  enviarEntrada,
  FalhaDaTela,
  textoDaFalha,
  type Entrada,
  type Pedido,
  type Quadro,
  type Tamanho,
} from '@/lib/tela-agente';

import type { Aviso, Fase } from './usa-sessao-da-tela';

/** Teto da espera pela imagem no tamanho novo: depois disso a fase troca mesmo assim (o back recusa toque velho com 409). */
const ESPERA_DO_AJUSTE_MS = 2500;

export type EsperaQuadroNovo = { largura: number; altura: number; pronto: () => void };

/** Ref de `useRef`: só o `current`, que serve no React 18 e no 19. */
type Ref<T> = { current: T };
type Muda<T> = Dispatch<SetStateAction<T>>;

export type ContextoDaPosse = {
  sessao: Ref<string | null>;
  controle: Ref<string | null>;
  tevePosse: Ref<boolean>;
  motivoDaPerda: Ref<string | null>;
  esperaQuadroNovo: Ref<EsperaQuadroNovo | null>;
  ultimoQuadro: Ref<Quadro | null>;
  setFase: Muda<Fase>;
  setAviso: Muda<Aviso | null>;
  setOcupado: Muda<'assumindo' | 'devolvendo' | null>;
  setDevolvidoEm: Muda<number | null>;
  setPedido: Muda<Pedido | null>;
};

const statusDe = (erro: unknown) => (erro instanceof FalhaDaTela ? erro.status : undefined);

/** Refs e setters são estáveis: os callbacks nascem uma vez. */
export function usaAcoesDaPosse(c: ContextoDaPosse) {
  /** O back respondeu que não tem a rota do ajuste: não pede de novo nesta tela. */
  const semAjuste = useRef(false);

  /** 403/410: o token não vale mais, a tela volta a só ver. */
  const perdeuAPosse = (status: number | undefined) => {
    if (status !== 403 && status !== 410) return;
    c.controle.current = null;
    c.tevePosse.current = false;
    c.setFase('vendo');
  };

  /**
   * Assumir e devolver trocam o tamanho da página: o quadro velho não vale mais
   * para tocar. Cumpre quando chega a imagem de tamanho diferente, ou no teto.
   */
  const imagemNova = () =>
    new Promise<void>((cumpre) => {
      const q = c.ultimoQuadro.current;
      if (!q) return cumpre();
      const pronto = () => {
        window.clearTimeout(teto);
        c.esperaQuadroNovo.current = null;
        cumpre();
      };
      const teto = window.setTimeout(pronto, ESPERA_DO_AJUSTE_MS);
      c.esperaQuadroNovo.current = { largura: q.largura, altura: q.altura, pronto };
    });

  const assumir = useCallback(async (tamanho?: Tamanho | null) => {
    if (!c.sessao.current) return;
    c.setOcupado('assumindo');
    c.setAviso(null);
    c.motivoDaPerda.current = null;
    try {
      const nova = imagemNova();
      const { controle: token } = await postAssumir(c.sessao.current, tamanho);
      c.controle.current = token;
      await nova;
      c.tevePosse.current = true;
      c.setDevolvidoEm(null);
      c.setFase('controle');
    } catch (erro) {
      c.setAviso({ texto: textoDaFalha('assumir', statusDe(erro), (erro as Error).message), tipo: 'erro' });
    } finally {
      c.setOcupado(null);
    }
  }, []);

  const devolver = useCallback(async () => {
    if (!c.sessao.current || !c.controle.current) return;
    c.setOcupado('devolvendo');
    c.setAviso(null);
    try {
      const nova = imagemNova();
      await postDevolver(c.sessao.current, c.controle.current);
      c.controle.current = null;
      await nova;
      c.tevePosse.current = false;
      c.setFase('vendo');
      c.setDevolvidoEm(Date.now());
      c.setPedido((p) => (p ? { ...p, status: 'devolvido' } : p));
    } catch (erro) {
      perdeuAPosse(statusDe(erro));
      c.setAviso({ texto: textoDaFalha('devolver', statusDe(erro), (erro as Error).message), tipo: 'erro' });
    } finally {
      c.setOcupado(null);
    }
  }, []);

  /** O aparelho girou com a posse tomada: a página do agente passa ao tamanho novo. */
  const ajustar = useCallback(async (tamanho: Tamanho) => {
    if (!c.sessao.current || !c.controle.current || semAjuste.current) return;
    try {
      await ajustarTamanho(c.sessao.current, c.controle.current, tamanho);
    } catch (erro) {
      const status = statusDe(erro);
      // Back sem a rota (o 404 padrão do FastAPI diz "Not Found"; aba desconhecida diz outra coisa):
      // a página fica no tamanho do Assumir, sem aviso.
      if (status === 405 || (status === 404 && (erro as Error).message === 'Not Found')) {
        semAjuste.current = true;
        return;
      }
      perdeuAPosse(status);
      // Sem a posse é erro; com ela, a página só ficou no tamanho anterior e segue usável.
      const perdeu = status === 403 || status === 410;
      c.setAviso({ texto: textoDaFalha('ajustar', status, (erro as Error).message), tipo: perdeu ? 'erro' : 'dica' });
    }
  }, []);

  /** Manda uma entrada. Devolve `false` se não foi entregue (o aviso já está na tela). */
  const enviar = useCallback(async (entrada: Entrada): Promise<boolean> => {
    if (!c.sessao.current || !c.controle.current) return false;
    try {
      await enviarEntrada(c.sessao.current, c.controle.current, entrada);
      c.setAviso(null);
      return true;
    } catch (erro) {
      perdeuAPosse(statusDe(erro));
      c.setAviso({ texto: textoDaFalha('entrada', statusDe(erro), (erro as Error).message), tipo: 'erro' });
      return false;
    }
  }, []);

  return { assumir, devolver, ajustar, enviar };
}
