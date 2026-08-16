'use client';

/**
 * A pílula de tokens — o tamanho do contexto da sessão, na faixa do composer.
 *
 * O NÚMERO É O TAMANHO, NÃO A FRAÇÃO (Rica, 16/08: *"sem teto, só tokens"*).
 * Ela não muda de cor aos 30%, não desenha barra e não compara com nada: a
 * leitura contra o teto já existe na tropa e na gaveta, em percentual, e repetir
 * aquele julgamento aqui embaixo seria dizer a mesma coisa duas vezes com peso
 * diferente. Aqui é só quanto contexto está em pé agora.
 *
 * Milhares, três casas, sem sufixo — o pedido foi literal ("tipo 155, só 3 casas
 * e nada mais"). Não trunco em 999: passar disso exige a janela de 1M cheia, e
 * mostrar 999 no lugar de 1000 seria trocar um dígito a mais por um número
 * falso.
 *
 * `ck-tabular` não é enfeite: o valor troca a cada turno e sem largura fixa de
 * dígito ele dança na horizontal ao lado do seletor de motor.
 *
 * Bebe da frota VIVA (`usaFrota`), não de prop do servidor — o composer não
 * remonta a cada turno, e o número do retrato de navegação congelaria no valor
 * de quando a página abriu. É o mesmo motivo da `statusline-ao-vivo.tsx`.
 */
import { resolveContextTokens } from '@grupo_borges/cockpit-core/cockpit-types';

import { usaFrota } from './frota-provider';

export function PilulaDeTokens({ agentSlug }: { agentSlug: string }) {
  const { agents } = usaFrota();
  const agente = agents.find((a) => a.slug === agentSlug);
  const tokens = agente ? resolveContextTokens(agente) : null;
  // Sem medida a pílula não aparece. Zero aqui seria afirmar "contexto vazio"
  // num agente que só não respondeu ainda. `typeof` e não `=== null`: a API
  // reinicia depois do front, e nessa janela o campo chega AUSENTE — o `null`
  // sozinho deixava passar `undefined` e derrubava a página inteira em 500.
  if (typeof tokens !== 'number') return null;

  return (
    <span
      className="ck-tabular shrink-0"
      title={`${tokens.toLocaleString('pt-BR')} tokens no contexto da sessão`}
      style={{
        padding: '2px 8px',
        borderRadius: 'var(--ck-radius-pill)',
        border: '1px solid var(--ck-edge-hairline)',
        fontFamily: 'var(--ck-font-mono)',
        fontSize: 'var(--ck-text-xs)',
        color: 'var(--ck-text-secondary)',
        lineHeight: 1.4,
      }}
    >
      {Math.round(tokens / 1000)}
    </span>
  );
}
