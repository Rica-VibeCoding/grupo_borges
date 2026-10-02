'use client';

/**
 * Os controles da linha de execução — glifos, chevron, saldo, copiar, rótulo,
 * cabeçalho de seção e a saída do bloco aberto. Saiu de `linha-execucao.tsx`
 * (02/10) para o arquivo caber no teto de 300 linhas; `Chevron` e
 * `SaldoDoRendimento` continuam saindo de lá, reexportados.
 */
import { useCallback, useMemo, useState } from 'react';

import { copyText } from '../../lib/clipboard';
import { fallbackCopy } from './copia-fallback';
import type { Rendimento } from './gramatica.ts';

/** Teto do corpo mostrado de primeira. Um `stdout` de mil linhas aberto de uma
 *  vez no celular é rolagem infinita dentro de rolagem infinita. */
const LINHAS_DE_PRIMEIRA = 120;

/* -------------------------------------------------------------------------- */
/* Controles                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Traço fino, contorno aberto, nunca preenchido — a calibragem que veio da
 * referência que o Rica mandou em 30/07. Na tela inteira dele não há um único
 * ícone sólido, e as ações de mensagem são uma fileira sem moldura, sem fundo e
 * sem borda: elas não competem com o conteúdo, só existem quando o olho procura.
 *
 * `currentColor` de propósito — o ícone herda a cor de quem o hospeda em vez de
 * declarar a própria, que é o que o §9.1 chama de hex cru em componente.
 */
function Glifo({ desenho }: { desenho: 'copiar' | 'copiado' }) {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {desenho === 'copiar' ? (
        <>
          <rect x="5.75" y="5.75" width="8" height="8" rx="2.25" />
          <path d="M10.25 3.5A2 2 0 0 0 8.25 1.5h-4a2.75 2.75 0 0 0-2.75 2.75v4a2 2 0 0 0 2 2" />
        </>
      ) : (
        <path d="M2.75 8.5 6.25 12 13.25 4.5" />
      )}
    </svg>
  );
}

/** O chevron da linha — gira ao abrir. Junto do pulso, é o único movimento da
 *  peça: transform, nunca layout (§9.4). `currentColor` de propósito, como
 *  todo glifo daqui — herda de quem hospeda em vez de declarar cor (§9.1). */
export function Chevron({ aberto }: { aberto: boolean }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        color: 'var(--ck-text-tertiary)',
        transform: aberto ? 'rotate(90deg)' : 'none',
        transition: 'transform 160ms ease',
      }}
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/** O rendimento à direita — da linha E do grupo (que soma os dos membros).
 *  Saldo de diff sai em partes coloridas (+ verde, − coral) mesmo na linha
 *  quieta: não é celebração de sucesso, é saldo de edição. O resto é um
 *  número quieto em secondary, `erro` em coral. */
export function SaldoDoRendimento({ rendimento, falhou }: { rendimento: Rendimento; falhou: boolean }) {
  if (rendimento.adicoes !== undefined) {
    return (
      <span
        className="ck-tabular shrink-0"
        style={{ fontSize: 'var(--ck-text-xs)', whiteSpace: 'nowrap' }}
      >
        <span style={{ color: 'var(--ck-diff-add)' }}>+{rendimento.adicoes}</span>
        {rendimento.remocoes !== undefined ? (
          <>
            {' '}
            <span style={{ color: 'var(--ck-diff-del)' }}>−{rendimento.remocoes}</span>
          </>
        ) : null}
      </span>
    );
  }
  return (
    <span
      className="ck-tabular shrink-0"
      style={{
        color: falhou ? 'var(--ck-state-fail)' : 'var(--ck-text-secondary)',
        fontSize: 'var(--ck-text-xs)',
      }}
    >
      {rendimento.texto}
    </span>
  );
}

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = useCallback(() => {
    const moderno = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined;
    void copyText(texto, { writeText: moderno, fallbackCopy }).then((r) => {
      setCopiado(r !== 'failed');
      window.setTimeout(() => setCopiado(false), 1800);
    });
  }, [texto]);

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={rotulo}
      // Botão isolado: aqui os 44px da §3 valem inteiros, mesmo com o ícone de
      // 15px. A área grande é invisível; o desenho é discreto.
      className="ck-veil flex shrink-0 items-center justify-center"
      style={{
        minHeight: 'var(--ck-touch-min)',
        minWidth: 'var(--ck-touch-min)',
        marginBlock: 'calc(var(--ck-space-2) * -1)',
        borderRadius: 'var(--ck-radius-chip)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      <Glifo desenho={copiado ? 'copiado' : 'copiar'} />
      <span className="sr-only" aria-live="polite">
        {copiado ? 'copiado' : rotulo}
      </span>
    </button>
  );
}

/** Overline de seção dentro do bloco: sans, caixa alta, tracking do contrato.
 *  Peso regular — na referência quase nada é bold, e o espaço faz o trabalho. */
export function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shrink-0"
      style={{
        fontFamily: 'var(--ck-font-sans)',
        fontSize: 'var(--ck-text-xs)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--ck-track-overline)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      {children}
    </span>
  );
}

/** Rótulo + fio + ação, o cabeçalho de cada seção do bloco aberto. */
export function Cabecalho({ children, copia }: { children: React.ReactNode; copia?: { texto: string; rotulo: string } }) {
  return (
    <div className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
      <Rotulo>{children}</Rotulo>
      <span
        aria-hidden
        className="min-w-0 flex-1"
        style={{ height: '1px', background: 'var(--ck-edge-hairline)' }}
      />
      {copia ? <Copiar texto={copia.texto} rotulo={copia.rotulo} /> : null}
    </div>
  );
}

export const CORPO_MONO: React.CSSProperties = {
  margin: 0,
  // Quebra em vez de rolar na horizontal: o pane é de 80 colunas e a tela tem
  // 390px — com rolagem lateral o FIM de cada linha some, e num log o fim da
  // linha é justamente onde está o resultado.
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'var(--ck-font-mono)',
  fontSize: 'var(--ck-text-sm)',
  lineHeight: 'var(--ck-leading-body)',
  color: 'var(--ck-text-primary)',
};

/**
 * O corpo do resultado. Uma cor só e zero highlighter (§7.1): de 3.080 eventos,
 * 1.417 são shell e saída de shell — texto plano, sem gramática a colorir. E o
 * que um log precisa distinguir não é `if` de `for`.
 */
export function Saida({ corpo, falhou }: { corpo: string; falhou: boolean }) {
  const [tudo, setTudo] = useState(false);
  const linhas = useMemo(() => corpo.replace(/\n+$/, '').split('\n'), [corpo]);
  const excedente = linhas.length - LINHAS_DE_PRIMEIRA;
  const visivel = tudo || excedente <= 0 ? corpo : linhas.slice(0, LINHAS_DE_PRIMEIRA).join('\n');

  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 'var(--ck-space-1)' }}>
      <Cabecalho copia={{ texto: corpo, rotulo: 'Copiar a saída' }}>
        {falhou ? 'erro' : 'saída'}
      </Cabecalho>

      {/* stdout e stderr na MESMA cor de propósito: quando um build falha, o
          texto mais importante da tela está no stderr. Esmaecer seria errado. */}
      <pre style={CORPO_MONO}>{visivel}</pre>

      {excedente > 0 && !tudo ? (
        <button
          type="button"
          onClick={() => setTudo(true)}
          className="ck-veil self-start"
          style={{
            minHeight: 'var(--ck-touch-min)',
            padding: '0 var(--ck-space-3)',
            marginLeft: 'calc(var(--ck-space-3) * -1)',
            borderRadius: 'var(--ck-radius-chip)',
            fontFamily: 'var(--ck-font-sans)',
            fontSize: 'var(--ck-text-sm)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          mostrar as outras {excedente}
        </button>
      ) : null}
    </div>
  );
}
