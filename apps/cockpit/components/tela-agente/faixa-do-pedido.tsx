/**
 * O pedido do agente, no topo, quando há: quem pede, o motivo e quanto falta.
 * Âmbar enquanto espera (é o Rica que ele chama); verde quando fechou.
 *
 * No controle recolhe a uma linha (quem pede e o prazo; fechado, o desfecho):
 * todo toque no quadro vai ao Chrome, então a página não rola e cada linha do
 * cartão é altura roubada do quadro. Tocar na linha abre o motivo. Recolhe também
 * quando o pedido fecha no meio do controle: crescer ali empurraria o quadro de novo.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useEffect, useState, type RefObject } from 'react';

import { IconeDescartar, IconeVisto } from '@/components/shell/icones';
import { Chevron } from '@/components/renderers/controles-da-linha';
import { textoDoPrazo, type Pedido } from '@/lib/tela-agente';

export function FaixaDoPedido({
  pedido,
  noControle,
  refDoCorpo,
}: {
  pedido: Pedido;
  noControle: boolean;
  /** O que some ao recolher: a medida do quadro desconta a altura dele (o Assumir mede com o cartão ainda inteiro). */
  refDoCorpo: RefObject<HTMLDivElement | null>;
}) {
  const [agora, setAgora] = useState(() => Date.now() / 1000);
  const [expandido, setExpandido] = useState(false);
  const aberto = pedido.status === 'aguardando' || pedido.status === 'em_atendimento';
  useEffect(() => {
    if (!aberto) return;
    const t = window.setInterval(() => setAgora(Date.now() / 1000), 1000);
    return () => window.clearInterval(t);
  }, [aberto]);
  // Cada posse começa recolhida: o que o Rica abriu da outra vez não volta aberto.
  useEffect(() => {
    if (!noControle) setExpandido(false);
  }, [noControle]);

  const recolhido = noControle && !expandido;
  const nome = pedido.agente.charAt(0).toUpperCase() + pedido.agente.slice(1);
  const fecho =
    pedido.status === 'devolvido'
      ? { texto: `Pedido fechado. O ${nome} seguiu.`, curto: `Fechado. O ${nome} seguiu.`, cor: 'var(--ck-state-ok)' }
      : pedido.status === 'expirado'
        ? { texto: 'O prazo acabou e o pedido fechou sem resposta.', curto: 'O prazo acabou', cor: 'var(--ck-state-fail)' }
        : pedido.status === 'interrompido'
          ? { texto: 'O pedido foi interrompido do lado do agente.', curto: 'Interrompido pelo agente', cor: 'var(--ck-state-fail)' }
          : null;

  const marcaDoFecho = pedido.status === 'devolvido' ? <IconeVisto tamanho={14} className="shrink-0" /> : <IconeDescartar tamanho={14} className="shrink-0" />;
  const titulo = (
    <span className="min-w-0 flex-1" style={{ color: aberto ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)' }}>
      {aberto ? `${nome} pede sua ajuda` : `Pedido do ${nome}`}
    </span>
  );
  const prazo = aberto ? (
    <span className="ck-tabular shrink-0" style={{ fontWeight: 400, color: 'var(--ck-text-secondary)' }}>
      espera {textoDoPrazo(pedido.expira_em, agora)}
    </span>
  ) : null;

  return (
    <section
      aria-label={`Pedido do ${nome}`}
      className="ck-vps flex flex-col"
      style={{
        padding: 'var(--ck-space-3) var(--ck-space-4)',
        boxShadow: aberto ? 'inset 0 0 0 1px var(--ck-state-attention)' : undefined,
      }}
    >
      <h2 className="text-balance" style={{ fontSize: 'var(--ck-text-sm)', fontWeight: 600 }}>
        {noControle ? (
          // O cartão inteiro é o alvo: 44px de altura e as bordas do cartão, sem
          // mudar a altura da linha — a medida do quadro conta com ela igual à de fora.
          // `relative`: o corpo aberto vem depois e não cobre a beirada de baixo do alvo.
          <button
            type="button"
            onClick={() => setExpandido((v) => !v)}
            aria-expanded={!recolhido}
            className="ck-veil ck-foco-fio relative flex items-center text-left"
            style={{
              gap: 'var(--ck-space-3)',
              minHeight: 'var(--ck-touch-min)',
              marginBlock: 'calc((var(--ck-touch-min) - 1lh) / -2)',
              marginInline: 'calc(var(--ck-space-4) * -1)',
              paddingInline: 'var(--ck-space-4)',
              borderRadius: 'var(--ck-radius-caixa)',
            }}
          >
            {recolhido && fecho ? (
              <span className="flex min-w-0 flex-1 items-center" style={{ gap: 'var(--ck-space-1)', fontWeight: 400, color: fecho.cor }}>
                {marcaDoFecho}
                {/* Forma curta: cabe na linha a 320px. A inteira está no corpo, a um toque. */}
                {fecho.curto}
              </span>
            ) : (
              <>
                {titulo}
                {prazo}
              </>
            )}
            <Chevron aberto={!recolhido} />
          </button>
        ) : (
          <span className="flex items-baseline" style={{ gap: 'var(--ck-space-3)' }}>
            {titulo}
            {prazo}
          </span>
        )}
      </h2>
      {recolhido ? null : (
        // O respiro mora aqui dentro: a altura medida é exatamente a que o recolher tira.
        <div
          ref={refDoCorpo}
          className="flex flex-col"
          style={{ gap: 'var(--ck-space-1)', paddingTop: 'var(--ck-space-1)' }}
        >
          <p className="text-pretty" style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-primary)' }}>
            {pedido.motivo}
          </p>
          {fecho ? (
            <p className="flex items-center" style={{ gap: 'var(--ck-space-1)', fontSize: 'var(--ck-text-sm)', color: fecho.cor }}>
              {marcaDoFecho}
              {fecho.texto}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
