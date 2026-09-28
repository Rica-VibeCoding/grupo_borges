'use client';

/**
 * O `/pesquisa` do Canarinho, na gaveta (pedido do Rica, 28/09). Morava como
 * ícone de lupa no composer, e era o que deixava a caixa dele mais alta que a
 * dos outros. É um liga/desliga: ligado, toda mensagem nova sai com
 * `/pesquisa` na frente (`prefixaPesquisa`), até ele desligar aqui.
 *
 * Mesma régua dos botões da gaveta (borda funcional, 44px, largura cheia), e
 * a PALAVRA muda junto com a cor, nunca a cor sozinha (§3/§9.7).
 */
import { IconeBusca } from './icones';
import { alternaPesquisa } from './pesquisa-canario';
import { usaPesquisaAtiva } from './usa-pesquisa';

export function BotaoDePesquisa({ agentSlug }: { agentSlug: string }) {
  const ativa = usaPesquisaAtiva(agentSlug);

  return (
    <button
      type="button"
      onClick={() => alternaPesquisa(agentSlug)}
      aria-pressed={ativa}
      className="ck-veil flex w-full items-center justify-center overflow-hidden border"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-2)',
        borderRadius: 'var(--ck-radius-frame)',
        borderColor: ativa ? 'var(--ck-alert-warning)' : 'var(--ck-edge-functional)',
        fontSize: 'var(--ck-text-sm)',
        whiteSpace: 'nowrap',
        color: ativa ? 'var(--ck-alert-warning)' : 'var(--ck-text-primary)',
        transition: 'color var(--ck-dur-fast) var(--ck-ease)',
      }}
    >
      <IconeBusca tamanho={15} />
      {ativa ? 'Pesquisa ligada — toque para desligar' : 'Ligar pesquisa'}
    </button>
  );
}
