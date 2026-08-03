'use client';

// O CARTÃO DO RESUMO do `/compact` — onde a mensagem-resumo para de se fingir
// de fala do Rica e vira o que é: um evento da máquina.
//
// A gramática é a das linhas cinzas de execução (grupo-ferramentas.tsx): uma
// linha discreta, filete à esquerda, chevron à direita, fechada por padrão
// SEMPRE — o resumo tem dezenas de linhas e quem quer lê-lo toca em
// "ver resumo". Foi o dump desse texto no feed, como se fosse mensagem
// digitada, que gerou esta peça (incidente de 02/08).
//
// Duas linhas de detalhe, as duas OMITIDAS quando o dado não existe — nunca
// placeholder feio:
//
// - a duração medida ("2m12s") só aparece no resumo que ESTA aba concluiu
//   (o `ultimoConcluido` da máquina casa pelo uuid). Num replay de histórico
//   o número não existe e a linha some — inventá-lo seria mentira.
// - "222k → 13k tokens" só quando o `compactMetadata` chega na mensagem —
//   hoje o back filtra `type=system` e quase nunca passa.

import { useId, useState } from 'react';

import type { CompactMeta } from '@grupo_borges/cockpit-core/chat-payload-classifier';
import { formataTokens, rotuloCronometroCompact } from '@grupo_borges/cockpit-core/compact-eta';

import { usaCompact } from '../../lib/compact';
import { Chevron } from '../renderers/linha-execucao';

type Props = {
  /** O resumo inteiro — é o que o "ver resumo" expande. */
  texto: string;
  /** uuid da mensagem-resumo: a duração medida casa por ele. */
  uuid: string;
  compactMeta?: CompactMeta;
  /** Sem slug (teste) o cartão é estático: sem duração, sem store. */
  agentSlug?: string;
};

export function CartaoCompact(props: Props) {
  if (props.agentSlug) {
    return <CartaoCompactConectado {...props} agentSlug={props.agentSlug} />;
  }
  return <CartaoCompactView texto={props.texto} compactMeta={props.compactMeta} />;
}

function CartaoCompactConectado(props: Props & { agentSlug: string }) {
  const { estado } = usaCompact(props.agentSlug);
  const duracaoMs =
    estado.ultimoConcluido?.uuid === props.uuid
      ? estado.ultimoConcluido.duracaoMs
      : undefined;
  return (
    <CartaoCompactView
      texto={props.texto}
      compactMeta={props.compactMeta}
      duracaoMs={duracaoMs}
    />
  );
}

function CartaoCompactView({
  texto,
  compactMeta,
  duracaoMs,
}: {
  texto: string;
  compactMeta?: CompactMeta;
  duracaoMs?: number;
}) {
  const [aberto, setAberto] = useState(false);
  const idCorpo = useId();

  const tokens =
    compactMeta?.preTokens !== undefined && compactMeta?.postTokens !== undefined
      ? `${formataTokens(compactMeta.preTokens)} → ${formataTokens(compactMeta.postTokens)} tokens`
      : undefined;

  return (
    <div
      style={{
        // Mesma régua do grupo de ferramentas: filete existe só quando aberto.
        borderLeft: `2px solid ${aberto ? 'var(--ck-edge-hairline)' : 'transparent'}`,
      }}
    >
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        aria-expanded={aberto}
        aria-controls={idCorpo}
        className="ck-veil flex w-full items-center text-left"
        style={{
          gap: 'var(--ck-space-2)',
          minHeight: '32px',
          padding: 'var(--ck-space-1) var(--ck-space-3)',
          fontFamily: 'var(--ck-font-sans)',
          fontSize: 'var(--ck-text-sm)',
          lineHeight: 'var(--ck-leading-body)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        <span aria-hidden>📦</span>
        <span className="min-w-0 flex-1 truncate">Conversa compactada</span>

        {duracaoMs !== undefined ? (
          <span style={{ fontFamily: 'var(--ck-font-mono)', fontSize: 'var(--ck-text-xs)' }}>
            {rotuloCronometroCompact(duracaoMs)}
          </span>
        ) : null}
        {tokens ? (
          <span style={{ fontFamily: 'var(--ck-font-mono)', fontSize: 'var(--ck-text-xs)' }}>
            {tokens}
          </span>
        ) : null}

        <span style={{ fontSize: 'var(--ck-text-xs)' }}>
          {aberto ? 'fechar' : 'ver resumo'}
        </span>
        <Chevron aberto={aberto} />
      </button>

      {aberto ? (
        <div
          id={idCorpo}
          style={{
            padding: '0 var(--ck-space-3) var(--ck-space-2)',
            // Resumo longo não empurra o feed inteiro: lê-se numa janela com
            // rolagem própria, como o corpo expandido de uma execução.
            maxHeight: '240px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            fontSize: 'var(--ck-text-sm)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          {texto}
        </div>
      ) : null}
    </div>
  );
}
