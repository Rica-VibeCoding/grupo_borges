/**
 * A tela do agente: o Chrome dele ao vivo, com Assumir e Devolver.
 *
 * De cima para baixo, na ordem em que o Rica precisa: o pedido do agente (quando
 * há) · o estado e a ação · o quadro · o teclado (só no controle). Mesma casca da
 * tela Abertos (mesa, coluna centrada), mais larga porque o quadro é paisagem.
 *
 * Sair da tela encerra a sessão: a posse volta ao agente, mas o pedido segue
 * aberto até o prazo (contrato) — só Devolver fecha o pedido.
 *
 * Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';
import { useRef } from 'react';

import { IconeDescartar } from '@/components/shell/icones';
import { tamanhoDoAparelho } from '@/lib/tela-agente';

import { BarraDeEstado, FaixaDoPedido } from './barra-de-estado';
import { QuadroAoVivo } from './quadro-ao-vivo';
import { TecladoDaTela } from './teclado-da-tela';
import { usaSessaoDaTela } from './usa-sessao-da-tela';

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

  // Assumir manda a área do quadro neste aparelho: a página do agente passa a ser
  // desenhada nesse tamanho (no iPhone, em coluna) e volta ao devolver.
  function assume() {
    const area = areaDoQuadro.current;
    const altura = window.visualViewport?.height ?? window.innerHeight;
    // Topo do quadro com a página no começo: rolada, a conta pediria a janela inteira.
    const topo = area ? area.getBoundingClientRect().top + (rolagem.current?.scrollTop ?? 0) : 0;
    void tela.assumir(area ? tamanhoDoAparelho(area.clientWidth, topo, altura) : null);
  }

  return (
    <div ref={rolagem} className="min-h-0 flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
      <div
        className="mx-auto flex w-full flex-col"
        style={{
          // O quadro é paisagem: no note ele pede mais largura que a coluna de leitura.
          maxWidth: 'calc(var(--ck-read-wide) * 1.5)',
          gap: 'var(--ck-space-4)',
          paddingTop: 'calc(var(--ck-space-4) + var(--ck-safe-top))',
          paddingRight: 'calc(var(--ck-space-3) + var(--ck-safe-right))',
          paddingBottom: 'calc(var(--ck-space-6) + var(--ck-safe-bottom))',
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

        <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
          <BarraDeEstado
            fase={tela.fase}
            ocupado={tela.ocupado}
            devolvidoEm={tela.devolvidoEm}
            aoAssumir={assume}
            aoDevolver={() => void tela.devolver()}
            aoReconectar={tela.reconectar}
          />
          {/* Sempre montadas: região viva que nasce com o texto pode não ser anunciada.
              Dica e erro em regiões separadas: o erro tem cor e ✕, a dica não. */}
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
  );
}
