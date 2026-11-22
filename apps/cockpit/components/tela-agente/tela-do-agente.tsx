/**
 * A tela do agente: o Chrome dele ao vivo, com Assumir e Devolver.
 *
 * De cima para baixo, na ordem em que o Rica precisa: o pedido do agente (quando
 * há) · o quadro · o teclado (só no controle). O estado e a ação (Assumir,
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
import { useEffect, useRef } from 'react';

import { IconeDescartar } from '@/components/shell/icones';
import { tamanhoDoAparelho, type Tamanho } from '@/lib/tela-agente';

import { BarraDeEstado, FaixaDoPedido } from './barra-de-estado';
import { QuadroAoVivo } from './quadro-ao-vivo';
import { TecladoDaTela } from './teclado-da-tela';
import { usaSessaoDaTela } from './usa-sessao-da-tela';

/** Espera o giro assentar antes de pedir o tamanho novo: a largura passa por medidas no meio. */
const ESPERA_DO_GIRO_MS = 400;
/** Campo focado num aparelho de toque: o teclado virtual está aberto e encolhe a janela. */
function tecladoAberto(): boolean {
  const campo = document.activeElement;
  const digita = campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement || (campo instanceof HTMLElement && campo.isContentEditable);
  return digita && window.matchMedia('(pointer: coarse)').matches;
}

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
  /** O último tamanho mandado ao back: girar e voltar ao mesmo não pede de novo. */
  const ultimoTamanho = useRef<string | null>(null);
  /** Largura da área quando o tamanho foi medido: o giro durante o Assumir não se perde. */
  const larguraMedida = useRef<number | null>(null);
  const assumiuSozinho = useRef(false);

  // A área do quadro neste aparelho: no controle, a página do agente é desenhada
  // nesse tamanho (no iPhone, em coluna). O rodapé fixo sai da altura que sobra.
  function medida(aoAssumir = false): Tamanho | null {
    const area = areaDoQuadro.current;
    if (!area) return null;
    const janela = window.visualViewport?.height ?? window.innerHeight;
    // Topo do quadro com a página no começo: rolada, a conta pediria a janela inteira.
    const topo = area.getBoundingClientRect().top + (rolagem.current?.scrollTop ?? 0);
    // O aviso do rodapé sai ao assumir: aí não desconta a altura dele. No giro ele fica.
    const rodapeFixo = (rodape.current?.offsetHeight ?? 0) - (aoAssumir ? (avisos.current?.offsetHeight ?? 0) : 0);
    larguraMedida.current = area.clientWidth;
    return tamanhoDoAparelho(area.clientWidth, topo, janela - rodapeFixo);
  }

  function assume() {
    const t = medida(true);
    ultimoTamanho.current = t ? `${t.largura}x${t.altura}` : null;
    void tela.assumir(t);
  }

  // Link do pedido: o Rica veio para resolver, então a posse vem junto com a primeira imagem.
  // Uma vez por visita: depois de devolver ou perder a posse, quem assume é o dedo.
  const pedido = tela.pedido;
  const pedidoAberto = pedido !== null && pedido.id === pedidoDaUrl && (pedido.status === 'aguardando' || pedido.status === 'em_atendimento');
  useEffect(() => {
    if (assumiuSozinho.current || !pedidoAberto || tela.fase !== 'vendo' || tela.ocupado) return;
    assumiuSozinho.current = true;
    assume();
    // `assume` lê refs na hora: não precisa reassinar.
  }, [pedidoAberto, tela.fase, tela.ocupado]);

  // Girou ou mudou a janela com a posse: reaplica o tamanho. Só a largura dispara —
  // a altura varia com a barra do Safari e o teclado, e isso não é giro. Girou com
  // o teclado do celular aberto: a altura lida viria encolhida, então espera o campo soltar.
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
      const chave = t ? `${t.largura}x${t.altura}` : null;
      if (!t || chave === ultimoTamanho.current) return;
      ultimoTamanho.current = chave;
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
    return () => {
      observa.disconnect();
      document.removeEventListener('focusout', aoSoltarOCampo);
      window.clearTimeout(espera);
    };
  }, [noControle, ajustar]);

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
          <header className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
            {/* Alvo de 44px com o desenho do link da tela Abertos. */}
            <Link
              href={`/abertos?m=${encodeURIComponent(maquina)}`}
              className="ck-foco-fio inline-flex items-center self-start"
              style={{
                minHeight: 'var(--ck-touch-min)',
                marginBlock: 'calc((var(--ck-touch-min) - 1lh) / -2)',
                fontSize: 'var(--ck-text-xs)',
                color: 'var(--ck-text-secondary)',
              }}
            >
              ← Abertos
            </Link>
            <h1 className="flex flex-wrap items-baseline text-balance" style={{ columnGap: 'var(--ck-space-2)' }}>
              <span style={{ fontSize: 'var(--ck-text-lg)', fontWeight: 400, letterSpacing: 'var(--ck-track-title)', color: 'var(--ck-text-primary)' }}>
                {rotulo}
              </span>
              <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>no {nomeDaMaquina}</span>
            </h1>
          </header>

          {tela.pedido ? <FaixaDoPedido pedido={tela.pedido} /> : null}

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
            aoAssumir={assume}
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
