'use client';

// A troca de conversa no feed (F13).
//
// - Trocando: sem filete (o azul saiu em 02/10, ordem do Rica) — "Trocando
//   para “X”" pulsando e o passo em curso com o tempo. A conversa que vai sair fica acima, apagada (`.ck-feed-saindo`).
// - Trocou (Retomar): o filete vira verde e fecha o histórico retomado — o
//   título, a nota e o briefing de retorno, recolhido. A Nova não desenha
//   marco desde 02/10 (`poeMarco`): o chat abre no vazio do produto.
// - Pedido do cockpit: uma linha cinza que abre no lugar. Nunca a bolha do Rica.
//
// Cor só por token; nenhum hex aqui.

import { useEffect, useState, type ReactNode } from 'react';

import { textosDoMarco, type ConversaTrocada } from '@/lib/conversa-trocada.ts';
import { publicaTrocaNoChat, type TrocaNoChat } from '@/lib/troca-em-curso.ts';
import { Chevron } from '../renderers/linha-execucao';
import { formataDataHora } from './data-hora';
import type { PedidoDoCockpit } from './grupo-ferramentas.ts';
import { rotuloDoTempo } from './linha-viva.ts';
import { textoDoPedido, textosDaTroca } from './troca-no-feed.ts';

const TEXTO_SM = { fontSize: 'var(--ck-text-sm)', lineHeight: 'var(--ck-leading-body)' } as const;

/** Sem `cor`, sem filete: a troca em andamento não desenha linha (ordem do Rica, 02/10). */
function Filete({ cor, children }: { cor?: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 'var(--ck-space-1)',
        ...(cor ? { borderLeft: `2px solid ${cor}`, padding: 'var(--ck-space-2) var(--ck-space-3)' } : { padding: 'var(--ck-space-2) 0' }),
      }}
    >
      {children}
    </div>
  );
}

function Recolhido({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="ck-veil flex items-center self-start"
        style={{ gap: 'var(--ck-space-1)', minHeight: 'var(--ck-touch-min)', borderRadius: 'var(--ck-radius-chip)', ...TEXTO_SM, color: 'var(--ck-text-secondary)' }}
      >
        <Chevron aberto={aberto} />
        {rotulo}
      </button>
      {aberto ? children : null}
    </div>
  );
}

export function MarcoDaTrocaView({ troca }: { troca: ConversaTrocada }) {
  const t = textosDoMarco(troca);
  const quando = troca.emMs === null ? null : formataDataHora(troca.emMs)?.slice(-5);
  return (
    <section aria-label={t.cabeca} className="ck-marco-troca" style={{ margin: 'var(--ck-space-3) 0' }}>
      <Filete cor="var(--ck-state-ok)">
        <p className="flex items-baseline" style={{ margin: 0, gap: 'var(--ck-space-2)', ...TEXTO_SM, color: 'var(--ck-state-ok)', fontWeight: 500 }}>
          <span className="min-w-0 flex-1">{t.cabeca}</span>
          {quando ? (
            <span className="ck-tabular shrink-0" style={{ fontSize: 'var(--ck-text-xs)', fontWeight: 400, color: 'var(--ck-text-secondary)' }}>
              {quando}
            </span>
          ) : null}
        </p>
        {t.titulo ? (
          <p style={{ margin: 0, fontSize: 'var(--ck-text-md)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>{t.titulo}</p>
        ) : null}
        {t.nota ? <p style={{ margin: 0, ...TEXTO_SM, color: 'var(--ck-text-secondary)' }}>{t.nota}</p> : null}
        {troca.briefing ? (
          <Recolhido rotulo="O que mudou enquanto ela estava parada">
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...TEXTO_SM, color: 'var(--ck-text-secondary)' }}>
              {troca.briefing}
            </p>
          </Recolhido>
        ) : null}
      </Filete>
    </section>
  );
}

export function TrocaEmAndamentoView({ troca, agentSlug }: { troca: TrocaNoChat; agentSlug?: string }) {
  const [agora, setAgora] = useState(() => Date.now());
  const correndo = troca.fase === 'trocando';
  useEffect(() => {
    if (!correndo) return;
    const relogio = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(relogio);
  }, [correndo]);

  const t = textosDaTroca(troca);
  // Em voo, o dourado do "agora" — o azul saiu do feed (02/10, §6.3).
  const cor = t.alerta ? 'var(--ck-state-attention)' : 'var(--ck-pulso-ouro)';
  const tempo = troca.fase === 'trocando' ? rotuloDoTempo(agora - troca.inicio).replace(/^há /, '') : null;
  return (
    <div className="ck-troca-em-andamento" role={t.alerta ? 'alert' : 'status'} style={{ margin: 'var(--ck-space-3) 0' }}>
      <Filete>
        <p className={t.alerta ? undefined : 'ck-pulso'} data-estado={t.alerta ? undefined : 'trabalhando'} style={{ margin: 0, ...TEXTO_SM, fontWeight: 500, color: cor }}>
          {t.titulo}
        </p>
        {t.passo ? (
          <p style={{ margin: 0, ...TEXTO_SM, color: 'var(--ck-text-secondary)' }}>
            {t.passo}
            {tempo ? <span className="ck-tabular">{` · ${tempo}`}</span> : null}
          </p>
        ) : null}
        {t.alerta && agentSlug ? (
          <button
            type="button"
            onClick={() => publicaTrocaNoChat(agentSlug, null)}
            className="ck-veil self-start"
            style={{ minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-3)', marginLeft: 'calc(var(--ck-space-3) * -1)', borderRadius: 'var(--ck-radius-chip)', ...TEXTO_SM, color: 'var(--ck-text-primary)' }}
          >
            Entendi
          </button>
        ) : null}
      </Filete>
    </div>
  );
}

/** O turno do cockpit, fechado numa linha. Aberto, o pedido aparece como texto
 *  de máquina (não balão) e o resto do turno no desenho de sempre. */
export function PedidoDoCockpitView({ pedido, renderiza }: { pedido: PedidoDoCockpit; renderiza: (item: PedidoDoCockpit['itens'][number]) => ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const texto = textoDoPedido(pedido);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="ck-veil flex items-center self-start"
        style={{ gap: 'var(--ck-space-2)', minHeight: 'var(--ck-touch-min)', borderRadius: 'var(--ck-radius-chip)', ...TEXTO_SM, color: 'var(--ck-text-secondary)', textAlign: 'left' }}
      >
        <Chevron aberto={aberto} />
        Cockpit pediu para anotar onde parou
      </button>
      {aberto ? (
        <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)', borderLeft: '1px solid var(--ck-edge-light)', padding: 'var(--ck-space-1) 0 var(--ck-space-2) var(--ck-space-3)' }}>
          {texto ? (
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...TEXTO_SM, color: 'var(--ck-text-secondary)' }}>{texto}</p>
          ) : null}
          {pedido.itens.filter((m) => m.kind !== 'user').map((m, i) => (
            <div key={i}>{renderiza(m)}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
