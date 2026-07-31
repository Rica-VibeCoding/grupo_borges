'use client';

/**
 * A linha de ferramenta — a peça central do v2.
 *
 * Contrato: `docs/cockpit-v2-estetica.md` §7 (gramática) e §6 (micro-momentos).
 * O modelo, com o raciocínio dos sigilos e do rendimento, está em `gramatica.ts`.
 *
 * Por que esta peça e não outra: 82% do tráfego é execução e o Bash sozinho tem
 * 738 chamadas numa sessão. Quem olha o cockpit passa 80% do tempo olhando esta
 * linha repetida centenas de vezes. Card gordo por chamada torna a tela infinita
 * — densidade é o que faz parecer profissional.
 *
 * ---------------------------------------------------------------------------
 * CINCO DECISÕES QUE VALE ENTENDER ANTES DE MEXER
 *
 * 1. ALTURA CONSTANTE, SEMPRE 32px. Não é estilo, é o hotspot 6 do débito: a
 *    linha ocupa a mesma altura antes e depois de o resultado chegar, então
 *    nada empurra o scroll quando o stream avança. Rótulo ausente, rendimento
 *    ausente e falha não mudam a caixa — só o que está DENTRO dela.
 *
 * 2. SUCESSO É SILÊNCIO. Nenhuma linha concluída ganha verde. Pintar 738 checks
 *    verdes é o clichê que mata o sinal: se tudo é sucesso colorido, a falha
 *    some no meio. Cor só entra quando a máquina está trabalhando (ciano),
 *    quando falhou (coral) ou quando espera um humano (âmbar) — que é a §1 do
 *    contrato aplicada literalmente: a temperatura sobe conforme a máquina
 *    precisa de você.
 *
 * 3. TRÊS COLUNAS, NÃO QUATRO. O rótulo é prefixo do alvo, dentro da mesma
 *    célula, e não coluna própria. Com coluna própria, as 53% de linhas sem
 *    rótulo (Bash + Read) ainda pagavam o `gap` da célula vazia e o alvo delas
 *    nascia deslocado do resto — o primeiro print mostrou a coluna dançando.
 *
 * 4. SEM ANIMAÇÃO DE ENTRADA, e isso é desvio consciente do micro-momento 2.
 *    O feed é virtualizado: o virtualizador monta e desmonta linha ao rolar,
 *    então uma animação de entrada dispararia a cada rolagem e a tela inteira
 *    piscaria durante o scroll. Movimento fica só onde carrega informação e não
 *    re-dispara — o respiro do sigilo enquanto a ferramenta roda.
 *
 * 5. ALVO DE TOQUE DE 32px, e não os 44 da §3. As duas regras do contrato
 *    colidem neste elemento (§7 manda 28–32px, §3 manda 44×44) e não dá para
 *    cumprir as duas. O piso de 44 existe para alvo pequeno cercado de vazio:
 *    aqui não há vazio — linhas adjacentes cobrem cada pixel, a largura é a
 *    tela inteira, e errar por 6px abre a linha vizinha, que é reversível com
 *    outro toque. Onde há botão isolado (copiar, mostrar o resto), 44px vale.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { copyText } from '../../lib/clipboard';
import { fallbackCopy } from './copia-fallback';
import { DiffViewer } from './diff-viewer';
import { corpoDe, leExecucao, type Desfecho, type EntradaExecucao } from './gramatica.ts';

/** Reusa o vocabulário de pulso da tropa: o mesmo movimento significa a mesma
 *  coisa nas duas superfícies. `feito` e `falhou` ficam parados — parar também
 *  é informação, e movimento em tudo é decoração. */
const PULSO: Record<Desfecho, string | undefined> = {
  rodando: 'trabalhando',
  aguarda: 'aguardando',
  feito: undefined,
  falhou: undefined,
};

const COR: Record<Desfecho, string> = {
  rodando: 'var(--ck-state-running)',
  aguarda: 'var(--ck-state-attention)',
  falhou: 'var(--ck-state-fail)',
  feito: 'var(--ck-text-secondary)',
};

/** Teto do corpo mostrado de primeira. Um `stdout` de mil linhas aberto de uma
 *  vez no celular é rolagem infinita dentro de rolagem infinita. */
const LINHAS_DE_PRIMEIRA = 120;

export type LinhaExecucaoProps = EntradaExecucao & {
  /** Começa aberta. Só para a vitrine e para o bloco ativo do stream. */
  aberta?: boolean;
  /** Corpo já resolvido por quem chama — substitui o `Saida` genérico quando
   *  presente. Escolher QUAL renderer (fetch-result, agent-result, etc.) é
   *  decisão de fora, em `components/feed/corpo-do-item.tsx`; aqui só existe
   *  o encaixe, aditivo e sem tocar no caminho atual. */
  corpoRico?: ReactNode;
};

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
function Rotulo({ children }: { children: React.ReactNode }) {
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
function Cabecalho({ children, copia }: { children: React.ReactNode; copia?: { texto: string; rotulo: string } }) {
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

const CORPO_MONO: React.CSSProperties = {
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
function Saida({ corpo, falhou }: { corpo: string; falhou: boolean }) {
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

/* -------------------------------------------------------------------------- */

export function LinhaExecucao({
  aberta: abertaInicial = false,
  corpoRico,
  ...entrada
}: LinhaExecucaoProps) {
  const [aberta, setAberta] = useState(abertaInicial);
  const e = useMemo(() => leExecucao(entrada), [entrada]);

  const cor = COR[e.desfecho];
  const args = (entrada.args ?? {}) as Record<string, unknown>;
  const corpo = corpoDe(entrada.result);

  const ehEdicao =
    (entrada.toolName === 'Edit' || entrada.toolName === 'NotebookEdit') &&
    typeof args.old_string === 'string' &&
    typeof args.new_string === 'string';

  // Na edição o pedido não se repete: o caminho e o saldo já estão na linha e no
  // cabeçalho do diff. Mostrar de novo era o mesmo dado três vezes na mesma tela.
  const pedido = ehEdicao
    ? ''
    : ['command', 'query', 'prompt', 'url', 'file_path']
        .map((chave) => args[chave])
        .find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? '';

  return (
    <div
      style={{
        // O filete de estado atravessa linha E bloco: é o que costura os dois
        // como uma coisa só quando abre. Concluído e FECHADO fica transparente —
        // um fio cinza em cada linha viraria a grade que a régua existe para não
        // ser. Aberto, o hairline ancora o bloco na linha que o abriu.
        borderLeft: `2px solid ${
          e.desfecho !== 'feito' ? cor : aberta ? 'var(--ck-edge-hairline)' : 'transparent'
        }`,
      }}
    >
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="ck-veil grid w-full items-center text-left"
        style={{
          // A régua: uma coluna de 1 caractere, largura garantida pela mono. É
          // o alinhamento — e não um fio desenhado — que faz a coluna virar
          // régua; um fio vertical aqui seria a linha do tempo genérica.
          gridTemplateColumns: '1ch minmax(0, 1fr) auto',
          gap: 'var(--ck-space-2)',
          // 32px fixos: a caixa não muda quando o resultado chega (ver nota 1).
          minHeight: '32px',
          padding: 'var(--ck-space-1) var(--ck-space-3)',
          fontFamily: 'var(--ck-font-mono)',
          fontSize: 'var(--ck-text-sm)',
          lineHeight: 'var(--ck-leading-body)',
        }}
      >
        {/* O sigilo carrega o verbo E o estado. Decorativo para o leitor de tela:
            o nome da ferramenta vai por extenso logo ao lado, sempre. */}
        <span aria-hidden className="ck-pulso" data-estado={PULSO[e.desfecho]} style={{ color: cor }}>
          {e.sigilo}
        </span>

        <span className="truncate">
          <span className="sr-only">{e.nome} </span>
          {/* O rótulo só aparece onde o sigilo é ambíguo. `$` só é Bash e `<` só
              é Read — nesses a palavra seria a mesma informação duas vezes, em
              821 das 1.535 chamadas do baseline. */}
          {e.rotulo ? (
            <span aria-hidden style={{ color: 'var(--ck-text-secondary)' }}>{e.rotulo} </span>
          ) : null}
          <span style={{ color: 'var(--ck-text-primary)' }}>{e.alvo}</span>
        </span>

        {/* O rendimento ocupa o lugar que a §7 reservou para a duração. A duração
            não existe neste caminho (ver `gramatica.ts`), e o que a chamada
            PRODUZIU responde a pergunta que quem lê um log realmente faz. */}
        {e.rendimento ? (
          <span
            className="ck-tabular shrink-0"
            style={{
              color: e.desfecho === 'falhou' ? cor : 'var(--ck-text-secondary)',
              fontSize: 'var(--ck-text-xs)',
            }}
          >
            {e.rendimento.texto}
          </span>
        ) : (
          <span />
        )}
      </button>

      {aberta ? (
        <div
          // Falha NÃO pisca: a superfície perde o fio de luz e fica apagada
          // (§6, micro-momento 4). A metáfora é a mesma no sistema inteiro —
          // luz é vida.
          className={e.desfecho === 'falhou' ? undefined : 'ck-lit'}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ck-space-3)',
            margin: '0 var(--ck-space-3) var(--ck-space-2)',
            padding: 'var(--ck-space-3)',
            background: 'var(--ck-surface-raised)',
            borderRadius: 'var(--ck-radius-frame)',
          }}
        >
          {/* O nome por extenso só quando a linha o escondeu. Onde o rótulo já
              está visível, repetir aqui era eco. */}
          {e.rotulo === null ? <Rotulo>{e.nome}</Rotulo> : null}

          {/* A frase que o agente escreveu junto do comando — 738 delas no
              baseline, e o painel de hoje joga todas fora. Sans porque é
              linguagem natural; o comando logo abaixo é mono porque é máquina. */}
          {e.intencao ? (
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--ck-font-sans)',
                fontSize: 'var(--ck-text-base)',
                color: 'var(--ck-text-primary)',
              }}
            >
              {e.intencao}
            </p>
          ) : null}

          {pedido ? (
            <div className="flex min-w-0 flex-col" style={{ gap: 'var(--ck-space-1)' }}>
              <Cabecalho copia={{ texto: pedido, rotulo: 'Copiar o pedido' }}>pedido</Cabecalho>
              <pre style={CORPO_MONO}>{pedido}</pre>
            </div>
          ) : null}

          {corpoRico ? (
            corpoRico
          ) : ehEdicao ? (
            <DiffViewer
              filePath={String(args.file_path ?? '')}
              oldString={String(args.old_string)}
              newString={String(args.new_string)}
            />
          ) : corpo ? (
            <Saida corpo={corpo} falhou={e.desfecho === 'falhou'} />
          ) : e.desfecho === 'rodando' ? (
            <Rotulo>rodando</Rotulo>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
