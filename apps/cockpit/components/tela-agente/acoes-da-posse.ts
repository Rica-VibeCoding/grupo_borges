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
/** Entre as tentativas do Assumir que levou 409 (o agente ainda soltando a trava). */
const ESPERA_DA_RECUSA_MS = 1000;

/** Como terminou o Assumir. `descartado`: a sessão de quando ele saiu não é mais a da tela. */
export type FimDoAssumir = 'assumiu' | 'recusado' | 'falhou' | 'descartado';

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
const dorme = (ms: number) => new Promise<void>((cumpre) => window.setTimeout(cumpre, ms));

/** Refs e setters são estáveis: os callbacks nascem uma vez. */
export function usaAcoesDaPosse(c: ContextoDaPosse) {
  /** O back respondeu que não tem a rota do ajuste: não pede de novo nesta tela. */
  const semAjuste = useRef(false);

  /**
   * A sessão de quando o pedido saiu ainda é a da tela? Se o fluxo caiu no meio,
   * a resposta é de sessão encerrada: gravar o token dela tomaria a sessão nova.
   */
  const mesma = (sid: string) => c.sessao.current === sid;

  /** 403/410: o token não vale mais, a tela volta a só ver. */
  const perdeuAPosse = (status: number | undefined) => {
    if (status !== 403 && status !== 410) return;
    c.controle.current = null;
    c.tevePosse.current = false;
    c.setFase('vendo');
  };

  /**
   * Assumir e devolver trocam o tamanho da página: o quadro velho não vale mais
   * para tocar. `chegou` cumpre quando chega a imagem de tamanho diferente, no
   * teto, ou em `larga` (o pedido falhou ou a sessão fechou).
   */
  const imagemNova = () => {
    const q = c.ultimoQuadro.current;
    if (!q) return { chegou: Promise.resolve(), larga: () => {} };
    let larga = () => {};
    const chegou = new Promise<void>((cumpre) => {
      const pronto = () => {
        window.clearTimeout(teto);
        if (c.esperaQuadroNovo.current?.pronto === pronto) c.esperaQuadroNovo.current = null;
        cumpre();
      };
      const teto = window.setTimeout(pronto, ESPERA_DO_AJUSTE_MS);
      c.esperaQuadroNovo.current = { largura: q.largura, altura: q.altura, pronto };
      larga = pronto;
    });
    return { chegou, larga };
  };

  /** `repetirSeRecusado`: quantas vezes repete o 409 antes de desistir (o Assumir sozinho do link do pedido). */
  const assumir = useCallback(async (tamanho?: Tamanho | null, repetirSeRecusado = 0): Promise<FimDoAssumir> => {
    const sid = c.sessao.current;
    if (!sid) return 'descartado';
    c.setOcupado('assumindo');
    c.setAviso(null);
    c.motivoDaPerda.current = null;
    try {
      for (let falta = repetirSeRecusado; ; falta -= 1) {
        const nova = imagemNova();
        try {
          const { controle: token } = await postAssumir(sid, tamanho);
          if (!mesma(sid)) return 'descartado';
          c.controle.current = token;
          await nova.chegou;
          if (!mesma(sid)) return 'descartado';
          c.tevePosse.current = true;
          c.setDevolvidoEm(null);
          c.setFase('controle');
          return 'assumiu';
        } catch (erro) {
          nova.larga();
          if (!mesma(sid)) return 'descartado';
          const status = statusDe(erro);
          if (status === 409 && falta > 0) {
            await dorme(ESPERA_DA_RECUSA_MS);
            if (!mesma(sid)) return 'descartado';
            continue;
          }
          c.setAviso({ texto: textoDaFalha('assumir', status, (erro as Error).message), tipo: 'erro' });
          return status === 409 ? 'recusado' : 'falhou';
        }
      }
    } finally {
      // Sessão trocada: quem limpou o ocupado foi a queda, e ele agora é da sessão nova.
      if (mesma(sid)) c.setOcupado(null);
    }
  }, []);

  const devolver = useCallback(async () => {
    const sid = c.sessao.current;
    const token = c.controle.current;
    if (!sid || !token) return;
    c.setOcupado('devolvendo');
    c.setAviso(null);
    try {
      const nova = imagemNova();
      try {
        await postDevolver(sid, token);
      } catch (erro) {
        nova.larga();
        throw erro;
      }
      if (!mesma(sid)) return;
      c.controle.current = null;
      await nova.chegou;
      if (!mesma(sid)) return;
      c.tevePosse.current = false;
      c.setFase('vendo');
      c.setDevolvidoEm(Date.now());
      c.setPedido((p) => (p ? { ...p, status: 'devolvido' } : p));
    } catch (erro) {
      if (!mesma(sid)) return;
      perdeuAPosse(statusDe(erro));
      c.setAviso({ texto: textoDaFalha('devolver', statusDe(erro), (erro as Error).message), tipo: 'erro' });
    } finally {
      if (mesma(sid)) c.setOcupado(null);
    }
  }, []);

  /** O aparelho girou com a posse tomada: a página do agente passa ao tamanho novo. */
  const ajustar = useCallback(async (tamanho: Tamanho) => {
    const sid = c.sessao.current;
    if (!sid || !c.controle.current || semAjuste.current) return;
    try {
      await ajustarTamanho(sid, c.controle.current, tamanho);
    } catch (erro) {
      if (!mesma(sid)) return;
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
    const sid = c.sessao.current;
    if (!sid || !c.controle.current) return false;
    try {
      await enviarEntrada(sid, c.controle.current, entrada);
      if (mesma(sid)) c.setAviso(null);
      return true;
    } catch (erro) {
      if (!mesma(sid)) return false;
      perdeuAPosse(statusDe(erro));
      c.setAviso({ texto: textoDaFalha('entrada', statusDe(erro), (erro as Error).message), tipo: 'erro' });
      return false;
    }
  }, []);

  return { assumir, devolver, ajustar, enviar };
}
