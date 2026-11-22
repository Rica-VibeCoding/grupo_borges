/**
 * A tela do agente: o Chrome dele ao vivo, com Assumir e Devolver.
 *
 * De cima para baixo, na ordem em que o Rica precisa: o pedido do agente (quando
 * há) · o quadro · o teclado (só no controle). No controle o cabeçalho e o
 * pedido encolhem a uma linha cada: a página não rola (o toque vai ao Chrome),
 * então toda altura de cima é altura tirada do quadro. O estado e a ação (Assumir,
 * Devolver…) ficam num rodapé fixo, na zona do polegar, que não some ao rolar.
 * Mesma casca da tela Abertos (mesa, coluna centrada), mais larga porque o quadro
 * é paisagem.
 *
 * Chegando pelo link do pedido (`?pedido=`), assume sozinho na primeira imagem.
 * Com a posse, girar o aparelho reaplica o tamanho da página do agente.
 *
 * Sair da tela encerra a sessão: a posse volta ao agente, mas o pedido segue
 * aberto até o prazo (contrato) — só Devolver fecha o pedido.
 *
 * Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { IconeDescartar } from '@/components/shell/icones';
import { tamanhoDoAparelho, type Tamanho } from '@/lib/tela-agente';

import { BarraDeEstado } from './barra-de-estado';
import { FaixaDoPedido } from './faixa-do-pedido';
import { QuadroAoVivo } from './quadro-ao-vivo';
import { TecladoDaTela } from './teclado-da-tela';
import { usaSessaoDaTela } from './usa-sessao-da-tela';

/** Assumir sozinho que leva 409 (o agente ainda soltando a trava): repete antes de desistir. */
const REPETICOES_DO_ASSUMIR_SOZINHO = 3;
/** Espera o giro assentar antes de pedir o tamanho novo: a largura passa por medidas no meio. */
const ESPERA_DO_GIRO_MS = 400;
/** Campo focado num aparelho de toque: o teclado virtual está aberto e encolhe a janela. */
function tecladoAberto(): boolean {
  const campo = document.activeElement;
  const digita = campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement || (campo instanceof HTMLElement && campo.isContentEditable);
  return digita && window.matchMedia('(pointer: coarse)').matches;
}

/** Altura sem o arredondamento do `offsetHeight`: três somados erravam 1px e pediam o tamanho de novo. */
const altura = (el: HTMLElement | null) => el?.getBoundingClientRect().height ?? 0;

/** Mesma largura e até 2px de altura: não vale redesenhar a página do agente no meio do toque. */
const quaseIgual = (a: Tamanho, b: Tamanho | null) => b !== null && a.largura === b.largura && Math.abs(a.altura - b.altura) <= 2;

/** Mesma largura da coluna e do rodapé: o quadro é paisagem e pede mais que a de leitura. */
const LARGURA_DA_COLUNA = 'calc(var(--ck-read-wide) * 1.5)';

export function TelaDoAgente({
  chrome,
  rotulo,
  maquina,
  nomeDaMaquina,
  pedido: pedidoDaUrl,
}: {
  chrome: string;
  rotulo: string;
  maquina: string;
  nomeDaMaquina: string;
  pedido: string | null;
}) {
  const tela = usaSessaoDaTela(chrome, pedidoDaUrl);
  const noControle = tela.fase === 'controle';
  const areaDoQuadro = useRef<HTMLDivElement>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const rodape = useRef<HTMLElement>(null);
  const avisos = useRef<HTMLDivElement>(null);
  /** O motivo do pedido: some no controle (cartão recolhido). Nulo quando já recolheu. */
  const corpoDoPedido = useRef<HTMLDivElement>(null);
  /** No controle o link e o título dividem a linha: no Assumir, a medida desconta a linha do link. */
  const cabecalho = useRef<HTMLElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  /** O último tamanho mandado ao back: girar e voltar ao mesmo não pede de novo. */
  const ultimoTamanho = useRef<Tamanho | null>(null);
  /** Largura da área quando o tamanho foi medido: o giro durante o Assumir não se perde. */
  const larguraMedida = useRef<number | null>(null);
  const temPedido = tela.pedido !== null;
  const assumiuSozinho = useRef(false);
  /**
   * Sobe quando o Assumir sozinho foi descartado (a sessão caiu no meio): a sessão
   * nova tenta de novo — uma vez só, para um Assumir que derruba a sessão não virar ciclo.
   */
  const [refazSozinho, setRefazSozinho] = useState(0);

  // A área do quadro neste aparelho: no controle, a página do agente é desenhada
  // nesse tamanho (no iPhone, em coluna). O rodapé fixo sai da altura que sobra.
  function medida(aoAssumir = false): Tamanho | null {
    const area = areaDoQuadro.current;
    if (!area) return null;
    const janela = window.visualViewport?.height ?? window.innerHeight;
    // Topo do quadro com a página no começo: rolada, a conta pediria a janela inteira.
    // Já com o pedido recolhido e o cabeçalho numa linha: no Assumir os dois ainda
    // estão inteiros, e no controle o Rica pode ter aberto o pedido — o tamanho não muda.
    // A previsão erra para mais quando o título ganha linha ao dividir a dele (comum a
    // 320px) ou a frase do rodapé quebra: a conferência ao entrar no controle corrige.
    const linhaDoLink = aoAssumir ? altura(cabecalho.current) - altura(titulo.current) : 0;
    const recolhe = altura(corpoDoPedido.current) + Math.max(0, linhaDoLink);
    const topo = area.getBoundingClientRect().top + (rolagem.current?.scrollTop ?? 0) - recolhe;
    // O aviso do rodapé sai ao assumir: aí não desconta a altura dele. No giro ele fica.
    const rodapeFixo = (rodape.current?.offsetHeight ?? 0) - (aoAssumir ? (avisos.current?.offsetHeight ?? 0) : 0);
    larguraMedida.current = area.clientWidth;
    return tamanhoDoAparelho(area.clientWidth, topo, janela - rodapeFixo);
  }

  function assume(repetirSeRecusado = 0) {
    const t = medida(true);
    ultimoTamanho.current = t;
    return tela.assumir(t, repetirSeRecusado);
  }

  // Link do pedido: o Rica veio para resolver, então a posse vem junto com a primeira imagem.
  // Uma vez por visita: depois de devolver, perder a posse ou levar 409 em todas as
  // tentativas, quem assume é o dedo. Só a queda da sessão no meio devolve a vez.
  const pedido = tela.pedido;
  const pedidoAberto = pedido !== null && pedido.id === pedidoDaUrl && (pedido.status === 'aguardando' || pedido.status === 'em_atendimento');
  useEffect(() => {
    if (assumiuSozinho.current || !pedidoAberto || tela.fase !== 'vendo' || tela.ocupado || !tela.sessao) return;
    assumiuSozinho.current = true;
    void assume(REPETICOES_DO_ASSUMIR_SOZINHO).then((fim) => {
      if (fim !== 'descartado' || refazSozinho > 0) return;
      assumiuSozinho.current = false;
      setRefazSozinho((n) => n + 1);
    });
    // `assume` lê refs na hora: não precisa reassinar.
  }, [pedidoAberto, tela.fase, tela.ocupado, tela.sessao, refazSozinho]);

  // Girou ou mudou a janela com a posse: reaplica o tamanho. Só a largura dispara —
  // a altura varia com a barra do Safari e o teclado, e isso não é giro. Girou com
  // o teclado do celular aberto: a altura lida viria encolhida, então espera o campo soltar.
  // Ao entrar no controle confere uma vez a previsão do Assumir (cabeçalho e pedido
  // já encolhidos); o cartão do pedido que chega com a posse tomada também reaplica.
  const ajustar = tela.ajustar;
  useEffect(() => {
    const area = areaDoQuadro.current;
    if (!noControle || !area) return;
    // Compara com a largura da medida, não com a de agora: pega o giro feito durante o Assumir.
    let largura = larguraMedida.current ?? area.clientWidth;
    let espera = 0;
    let esperaOTeclado = false;
    const reaplica = () => {
      if (tecladoAberto()) {
        esperaOTeclado = true;
        return;
      }
      esperaOTeclado = false;
      const t = medida();
      if (!t || quaseIgual(t, ultimoTamanho.current)) return;
      ultimoTamanho.current = t;
      void ajustar(t);
    };
    const agenda = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(reaplica, ESPERA_DO_GIRO_MS);
    };
    // O ResizeObserver chama uma vez ao observar: o giro do meio do Assumir entra aqui.
    const observa = new ResizeObserver(() => {
      if (area.clientWidth === largura) return;
      largura = area.clientWidth;
      agenda();
    });
    const aoSoltarOCampo = () => esperaOTeclado && agenda();
    observa.observe(area);
    document.addEventListener('focusout', aoSoltarOCampo);
    // Igual à medida do Assumir (até o arredondamento) não pede de novo.
    agenda();
    return () => {
      observa.disconnect();
      document.removeEventListener('focusout', aoSoltarOCampo);
      window.clearTimeout(espera);
    };
    // `temPedido` não é lido aqui: reassinar com ele é o que confere o cartão novo.
  }, [noControle, ajustar, temPedido]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={rolagem}
        className="min-h-0 flex-1 overflow-y-auto"
        // Gutter fixo: a barra de rolagem que aparece não muda a largura e não dispara o reajuste.
        style={{ overscrollBehavior: 'contain', scrollbarGutter: 'stable both-edges' }}
      >
        <div
          className="mx-auto flex w-full flex-col"
          style={{
            maxWidth: LARGURA_DA_COLUNA,
            gap: 'var(--ck-space-4)',
            paddingTop: 'calc(var(--ck-space-4) + var(--ck-safe-top))',
            paddingRight: 'calc(var(--ck-space-3) + var(--ck-safe-right))',
            paddingBottom: 'var(--ck-space-4)',
            paddingLeft: 'calc(var(--ck-space-3) + var(--ck-safe-left))',
          }}
        >
          <header
            ref={cabecalho}
            className={noControle ? 'flex items-baseline' : 'flex flex-col'}
            style={{ gap: noControle ? 'var(--ck-space-3)' : 'var(--ck-space-2)' }}
          >
            {/* Alvo de 44px com o desenho do link da tela Abertos. */}
            <Link
              href={`/abertos?m=${encodeURIComponent(maquina)}`}
              // Em coluna não estica a linha inteira; na linha do controle segue a base do título.
              className={`ck-foco-fio inline-flex shrink-0 items-center ${noControle ? 'self-baseline' : 'self-start'}`}
              style={{
                minHeight: 'var(--ck-touch-min)',
                marginBlock: 'calc((var(--ck-touch-min) - 1lh) / -2)',
                fontSize: 'var(--ck-text-xs)',
                color: 'var(--ck-text-secondary)',
              }}
            >
              ← Abertos
            </Link>
            <h1 ref={titulo} className="flex min-w-0 flex-wrap items-baseline text-balance" style={{ columnGap: 'var(--ck-space-2)' }}>
              <span style={{ fontSize: 'var(--ck-text-lg)', fontWeight: 400, letterSpacing: 'var(--ck-track-title)', color: 'var(--ck-text-primary)' }}>
                {rotulo}
              </span>
              <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>no {nomeDaMaquina}</span>
            </h1>
          </header>

          {tela.pedido ? <FaixaDoPedido pedido={tela.pedido} noControle={noControle} refDoCorpo={corpoDoPedido} /> : null}

          <div ref={areaDoQuadro}>
            <QuadroAoVivo
              quadro={tela.quadro}
              noControle={noControle}
              rotulo={rotulo}
              enviar={tela.enviar}
              aoTocarSemControle={() => tela.avisar('Para mexer no Chrome, toque em Assumir. O agente fica esperando até você devolver.')}
            />
          </div>

          {noControle ? <TecladoDaTela sessao={tela.sessao} abaAtual={tela.quadro?.aba ?? null} enviar={tela.enviar} /> : null}
        </div>
      </div>

      <footer
        ref={rodape}
        className="shrink-0"
        style={{
          background: 'var(--ck-surface-nav)',
          borderTop: '1px solid var(--ck-edge-hairline)',
          paddingTop: 'var(--ck-space-3)',
          paddingRight: 'calc(var(--ck-space-3) + var(--ck-safe-right))',
          paddingBottom: 'calc(var(--ck-space-3) + var(--ck-safe-bottom))',
          paddingLeft: 'calc(var(--ck-space-3) + var(--ck-safe-left))',
        }}
      >
        <div className="mx-auto w-full" style={{ maxWidth: LARGURA_DA_COLUNA }}>
          {/* Sempre montadas: região viva que nasce com o texto pode não ser anunciada.
              Dica e erro em regiões separadas: o erro tem cor e ✕, a dica não.
              Junto da ação: o erro do Devolver aparece onde o dedo está. */}
          {/* Teto de altura: aviso longo em paisagem rola aqui, não empurra a ação para fora. */}
          <div
            ref={avisos}
            style={{ paddingBottom: tela.aviso ? 'var(--ck-space-2)' : 0, maxHeight: '30dvh', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            <p role="status" className="text-pretty" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
              {tela.aviso?.tipo === 'dica' ? tela.aviso.texto : null}
            </p>
            <p role="alert" className="flex items-start text-pretty" style={{ gap: 'var(--ck-space-1)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-fail)' }}>
              {tela.aviso?.tipo === 'erro' ? (
                <>
                  <IconeDescartar tamanho={14} className="shrink-0" style={{ marginTop: '0.2em' }} />
                  {tela.aviso.texto}
                </>
              ) : null}
            </p>
          </div>
          <BarraDeEstado
            fase={tela.fase}
            ocupado={tela.ocupado}
            devolvidoEm={tela.devolvidoEm}
            conectandoDesde={tela.conectandoDesde}
            aoAssumir={() => void assume()}
            aoDevolver={() => void tela.devolver()}
            aoReconectar={tela.reconectar}
            // Reabre dentro da página: o reload largaria no back a sessão do POST ainda no ar (409 na volta).
            aoRecarregar={tela.reconectar}
          />
        </div>
      </footer>
    </div>
  );
}
