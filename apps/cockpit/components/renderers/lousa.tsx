'use client';

/**
 * A LOUSA — o bloco emoldurado do Ted desenhado como quadro verde com letra de
 * giz (Rica, 18/11, para o Daniel). O critério mora em `lib/lousa.ts`; quem
 * liga é o perfil do agente (`lib/perfil-do-agente.ts`), entregue pelo feed
 * por contexto — o markdown não sabe de quem é o texto.
 *
 * O ALINHAMENTO É O DESENHO. A moldura `┌ ─ ┐ │ └ ┘` só fecha com a fonte
 * monoespaçada e sem quebra de linha, então a letra ENCOLHE para a linha mais
 * larga caber na largura do quadro (unidade de contêiner `cqi`), com teto no
 * tamanho de leitura. Em 390px uma lousa de 32 colunas sai com ~15px. Se mesmo
 * assim não couber, rola de lado — nunca quebra a caixa.
 *
 * Para leitor de tela o desenho é ruído ("box drawings light down and right"):
 * o `pre` sai da árvore e entra o texto sem moldura.
 */
import { createContext, useContext } from 'react';

import { colunasDaLousa } from '../../lib/lousa';
export { textoDoPre } from '../../lib/lousa';

/** Ligado pelo feed quando o perfil do agente pede lousa. */
export const LousaLigada = createContext(false);

export function useLousaLigada(): boolean {
  return useContext(LousaLigada);
}

/** Largura de um caractere monoespaçado em `em` (Geist Mono e SF Mono: 0,6),
 *  com folga para o arredondamento do navegador não estourar a última coluna. */
const AVANCO_EM = 0.62;

function semMoldura(texto: string): string {
  return texto
    .split('\n')
    .map((linha) => linha.replace(/[┌┐└┘─│├┤┬┴┼]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((linha) => linha !== '')
    .join('\n');
}

export function Lousa({ texto }: { texto: string }) {
  const colunas = Math.max(colunasDaLousa(texto), 1);
  return (
    <figure
      className="max-w-full overflow-hidden"
      style={{
        // Sem `margin` aqui: o respiro entre blocos é o `space-y` do markdown.
        // Raio de fora 14 = raio de dentro 8 + a moldura de 6 (raio concêntrico).
        borderRadius: 'calc(var(--ck-radius-frame) + 6px)',
        border: '6px solid var(--ck-lousa-moldura)',
        background: 'var(--ck-lousa-fundo)',
      }}
    >
      <div style={{ containerType: 'inline-size', padding: 'var(--ck-space-3)' }}>
        <pre
          aria-hidden
          className="max-w-full overflow-x-auto"
          style={{
            margin: 0,
            whiteSpace: 'pre',
            fontFamily: 'var(--ck-font-mono)',
            fontSize: `min(var(--ck-text-md), calc(100cqi / ${(colunas * AVANCO_EM).toFixed(2)}))`,
            lineHeight: 'var(--ck-leading-body)',
            fontWeight: 500,
            letterSpacing: 0,
            color: 'var(--ck-lousa-giz)',
            // O borrado do giz: luz da própria letra, não sombra de profundidade.
            textShadow: '0 0 1px var(--ck-lousa-poeira), 0 0 3px var(--ck-lousa-poeira)',
          }}
        >
          {texto.replace(/^\n+|\n+$/g, '')}
        </pre>
        <p className="sr-only">{semMoldura(texto)}</p>
      </div>
    </figure>
  );
}
