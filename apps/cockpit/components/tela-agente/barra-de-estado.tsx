/**
 * O estado da tela em uma linha, com a ação que ele pede ao lado: vendo →
 * Assumir; no controle → Devolver; caiu → Reconectar. Um botão preenchido só (a
 * pílula clara da casa, a mesma da "Nova conversa"), 48px de alvo.
 *
 * Quatro estados, cada um com forma E palavra (o Rica tem TDA: tem de ser óbvio
 * de relance): ponto oco "Vendo ao vivo" · ponto âmbar cheio "Você está no
 * controle" · ✓ verde "Devolvido ao agente" · ✕ coral "A conexão caiu".
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { IconeDescartar, IconeVisto } from '@/components/shell/icones';
import { textoDoPrazo, type Pedido } from '@/lib/tela-agente';

import type { Fase } from './usa-sessao-da-tela';

/** Quanto o "Devolvido" fica na barra antes de voltar a "Vendo ao vivo". */
const MOSTRA_DEVOLVIDO_MS = 5000;

export function BarraDeEstado({
  fase,
  ocupado,
  devolvidoEm,
  aoAssumir,
  aoDevolver,
  aoReconectar,
}: {
  fase: Fase;
  ocupado: 'assumindo' | 'devolvendo' | null;
  devolvidoEm: number | null;
  aoAssumir: () => void;
  aoDevolver: () => void;
  aoReconectar: () => void;
}) {
  const [recente, setRecente] = useState(false);
  useEffect(() => {
    if (devolvidoEm === null) return setRecente(false);
    setRecente(true);
    const t = window.setTimeout(() => setRecente(false), Math.max(0, devolvidoEm + MOSTRA_DEVOLVIDO_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [devolvidoEm]);

  const estado =
    fase === 'caiu'
      ? { marca: <IconeDescartar tamanho={16} />, texto: 'A conexão caiu', cor: 'var(--ck-state-fail)' }
      : fase === 'controle'
        ? { marca: <Ponto cheio />, texto: 'Você está no controle', cor: 'var(--ck-state-attention)' }
        : fase === 'abrindo'
          ? { marca: <Ponto />, texto: 'Conectando…', cor: 'var(--ck-text-secondary)' }
          : recente
            ? { marca: <IconeVisto tamanho={16} />, texto: 'Devolvido ao agente', cor: 'var(--ck-state-ok)' }
            : { marca: <Ponto />, texto: 'Vendo ao vivo', cor: 'var(--ck-text-primary)' };

  const apoio =
    fase === 'controle'
      ? 'O agente espera você devolver.'
      : fase === 'vendo'
        ? 'O agente segue usando. Assuma para tocar.'
        : null;

  return (
    <div className="flex items-center" style={{ gap: 'var(--ck-space-3)', minHeight: '48px' }}>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Região viva: a troca de estado é anunciada sem tirar o foco do botão. */}
        <p role="status" className="flex items-center" style={{ gap: 'var(--ck-space-2)', fontSize: 'var(--ck-text-base)', fontWeight: 500, color: estado.cor }}>
          <span className="flex shrink-0 items-center justify-center" style={{ width: '16px' }}>
            {estado.marca}
          </span>
          <span className="min-w-0">{estado.texto}</span>
        </p>
        {apoio ? (
          <p className="text-pretty" style={{ paddingLeft: 'calc(16px + var(--ck-space-2))', fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            {apoio}
          </p>
        ) : null}
      </div>
      {fase === 'caiu' ? (
        <BotaoPrincipal aoTocar={aoReconectar}>Reconectar</BotaoPrincipal>
      ) : fase === 'controle' ? (
        <BotaoPrincipal aoTocar={aoDevolver} ocupado={ocupado === 'devolvendo'}>
          Devolver
        </BotaoPrincipal>
      ) : (
        <BotaoPrincipal aoTocar={aoAssumir} ocupado={ocupado === 'assumindo'} desligado={fase === 'abrindo'}>
          Assumir
        </BotaoPrincipal>
      )}
    </div>
  );
}

function Ponto({ cheio = false }: { cheio?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: '10px',
        height: '10px',
        borderRadius: 'var(--ck-radius-pill)',
        border: '2px solid currentColor',
        background: cheio ? 'currentColor' : 'transparent',
      }}
    />
  );
}

/** A pílula clara: a única preenchida da tela. Ocupado mantém o rótulo. */
function BotaoPrincipal({
  children,
  aoTocar,
  ocupado = false,
  desligado = false,
}: {
  children: ReactNode;
  aoTocar: () => void;
  ocupado?: boolean;
  desligado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={aoTocar}
      disabled={ocupado || desligado}
      aria-busy={ocupado || undefined}
      className="ck-foco-fio flex shrink-0 items-center justify-center"
      style={{
        minHeight: '48px',
        minWidth: '8.5rem',
        padding: '0 var(--ck-space-5)',
        borderRadius: 'var(--ck-radius-pill)',
        background: 'var(--ck-text-primary)',
        color: 'var(--ck-surface-canvas)',
        fontSize: 'var(--ck-text-md)',
        fontWeight: 600,
        opacity: desligado ? 0.4 : ocupado ? 0.7 : 1,
        cursor: desligado ? 'not-allowed' : ocupado ? 'progress' : 'pointer',
        transition: 'opacity var(--ck-dur-fast) var(--ck-ease)',
      }}
    >
      {children}
    </button>
  );
}

/**
 * O pedido do agente, no topo, quando há: quem pede, o motivo e quanto falta.
 * Âmbar enquanto espera (é o Rica que ele chama); verde quando fechou.
 */
export function FaixaDoPedido({ pedido }: { pedido: Pedido }) {
  const [agora, setAgora] = useState(() => Date.now() / 1000);
  const aberto = pedido.status === 'aguardando' || pedido.status === 'em_atendimento';
  useEffect(() => {
    if (!aberto) return;
    const t = window.setInterval(() => setAgora(Date.now() / 1000), 1000);
    return () => window.clearInterval(t);
  }, [aberto]);

  const nome = pedido.agente.charAt(0).toUpperCase() + pedido.agente.slice(1);
  const fecho =
    pedido.status === 'devolvido'
      ? { texto: `Pedido fechado. O ${nome} seguiu.`, cor: 'var(--ck-state-ok)' }
      : pedido.status === 'expirado'
        ? { texto: 'O prazo acabou e o pedido fechou sem resposta.', cor: 'var(--ck-state-fail)' }
        : pedido.status === 'interrompido'
          ? { texto: 'O pedido foi interrompido do lado do agente.', cor: 'var(--ck-state-fail)' }
          : null;

  return (
    <section
      aria-label={`Pedido do ${nome}`}
      className="ck-vps flex flex-col"
      style={{
        gap: 'var(--ck-space-1)',
        padding: 'var(--ck-space-3) var(--ck-space-4)',
        boxShadow: aberto ? 'inset 0 0 0 1px var(--ck-state-attention)' : undefined,
      }}
    >
      <div className="flex items-baseline" style={{ gap: 'var(--ck-space-3)' }}>
        <h2 className="min-w-0 flex-1" style={{ fontSize: 'var(--ck-text-sm)', fontWeight: 600, color: aberto ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)' }}>
          {aberto ? `${nome} pede sua ajuda` : `Pedido do ${nome}`}
        </h2>
        {aberto ? (
          <span className="ck-tabular shrink-0" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            espera {textoDoPrazo(pedido.expira_em, agora)}
          </span>
        ) : null}
      </div>
      <p className="text-pretty" style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-primary)' }}>
        {pedido.motivo}
      </p>
      {fecho ? (
        <p className="flex items-center" style={{ gap: 'var(--ck-space-1)', fontSize: 'var(--ck-text-sm)', color: fecho.cor }}>
          {pedido.status === 'devolvido' ? <IconeVisto tamanho={14} className="shrink-0" /> : <IconeDescartar tamanho={14} className="shrink-0" />}
          {fecho.texto}
        </p>
      ) : null}
    </section>
  );
}
