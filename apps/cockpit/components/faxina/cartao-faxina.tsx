'use client';

// Um doc parado. O toque é otimista: o status muda no mesmo frame e volta se o
// back recusar. Quem move o arquivo é o executor do back, a cada minuto — por
// isso "arquivar" mostra "arquivando…" e não finge que já saiu do lugar.

import { useState } from 'react';

import {
  acoesPermitidas,
  descreverParado,
  fetchFaxinaConteudo,
  postFaxinaAcao,
  rotuloStatus,
  rotuloVeredito,
  statusAposAcao,
  type FaxinaAcao,
  type FaxinaItem,
} from '@/lib/faxina';

const ROTULO_DA_ACAO: Record<FaxinaAcao, string> = {
  manter: 'Manter',
  arquivar: 'Arquivar',
  desfazer: 'Desfazer',
};

export function CartaoFaxina({ inicial, agora }: { inicial: FaxinaItem; agora: number }) {
  const [item, setItem] = useState(inicial);
  const [emVoo, setEmVoo] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  async function agir(acao: FaxinaAcao) {
    if (emVoo) return;
    const anterior = item;
    setEmVoo(true);
    setFalha(null);
    setItem({ ...item, status: statusAposAcao(acao) });
    try {
      setItem(await postFaxinaAcao(item.id, acao));
    } catch {
      setItem(anterior);
      setFalha(`não consegui ${ROTULO_DA_ACAO[acao].toLowerCase()}`);
    } finally {
      setEmVoo(false);
    }
  }

  async function alternarConteudo() {
    if (aberto) return setAberto(false);
    setAberto(true);
    if (texto !== null) return;
    try {
      setTexto((await fetchFaxinaConteudo(item.id)).texto);
    } catch {
      setTexto('');
      setFalha('não consegui abrir o arquivo');
    }
  }

  const veredito = rotuloVeredito(item);
  const status = rotuloStatus(item);
  const recomendada: FaxinaAcao | null =
    item.jev_veredito === 'manter' ? 'manter' : item.jev_veredito ? 'arquivar' : null;

  return (
    <li
      className="flex flex-col"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-3)',
        borderRadius: 'var(--ck-radius-caixa)',
        background: 'var(--ck-surface-composer)',
        borderTop: '1px solid var(--ck-edge-light)',
      }}
    >
      <div className="flex flex-col" style={{ gap: '2px' }}>
        <p
          className="break-all"
          style={{ fontFamily: 'var(--ck-font-mono)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}
        >
          {item.caminho}
        </p>
        <p className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
          {item.workspace} · {item.tipo} · {descreverParado(item, agora)}
        </p>
      </div>

      {veredito ? (
        <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
          <span style={{ color: 'var(--ck-text-primary)' }}>{veredito}</span>
          {item.jev_motivo ? ` — ${item.jev_motivo}` : null}
        </p>
      ) : null}

      {item.citado_em && item.citado_em.length > 0 ? (
        <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
          citado em {item.citado_em.join(', ')}
        </p>
      ) : null}

      {status || falha ? (
        <p
          style={{
            fontSize: 'var(--ck-text-xs)',
            color: falha || item.status === 'erro' ? 'var(--ck-state-fail)' : 'var(--ck-text-tertiary)',
          }}
        >
          {falha ?? status}
        </p>
      ) : null}

      <div className="flex flex-wrap" style={{ gap: 'var(--ck-space-2)' }}>
        <Botao rotulo={aberto ? 'Fechar' : 'Abrir'} onClick={() => void alternarConteudo()} />
        {acoesPermitidas(item.status).map((acao) => (
          <Botao
            key={acao}
            rotulo={ROTULO_DA_ACAO[acao]}
            destaque={acao === recomendada || acao === 'desfazer'}
            desabilitado={emVoo}
            onClick={() => void agir(acao)}
          />
        ))}
      </div>

      {aberto ? (
        <pre
          className="overflow-auto whitespace-pre-wrap break-words"
          style={{
            maxHeight: '50vh',
            padding: 'var(--ck-space-3)',
            borderRadius: 'var(--ck-radius-frame)',
            background: 'var(--ck-surface-canvas)',
            fontFamily: 'var(--ck-font-mono)',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          {texto === null ? 'carregando…' : texto || 'arquivo vazio ou indisponível'}
        </pre>
      ) : null}
    </li>
  );
}

function Botao({
  rotulo,
  onClick,
  destaque = false,
  desabilitado = false,
}: {
  rotulo: string;
  onClick: () => void;
  destaque?: boolean;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      style={{
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-4)',
        borderRadius: 'var(--ck-radius-pill)',
        fontSize: 'var(--ck-text-sm)',
        background: destaque ? 'var(--ck-surface-raised)' : 'transparent',
        color: destaque ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
        border: '1px solid var(--ck-edge-hairline)',
        opacity: desabilitado ? 0.5 : 1,
        transition: 'background var(--ck-dur-fast) var(--ck-ease)',
      }}
    >
      {rotulo}
    </button>
  );
}
