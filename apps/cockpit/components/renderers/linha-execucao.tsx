'use client';

/**
 * A linha de ferramenta — a peça central do v2.
 *
 * Contrato: `docs/cockpit-v2-estetica.md` §7 (gramática) e §6 (micro-momentos).
 * O modelo, com os verbos e o rendimento, está em `gramatica.ts`.
 *
 * 82% do tráfego é execução e o Bash sozinho tem 738 chamadas numa sessão —
 * quem olha o cockpit passa 80% do tempo olhando esta linha repetida.
 *
 * ---------------------------------------------------------------------------
 * 02/08 — A LINHA VIROU FRASE DE CHAT
 *
 * Ordem do Rica, com print do app do Claude no iOS: "o texto tem que se
 * parecer mais com esses chats" e a atividade "não como se fosse numa
 * caixinha, num componente". O que saiu da linha colapsada:
 *
 *   - o sigilo mono (a coluna de 1 caractere) — o verbo agora vai por extenso
 *     e em português: "Executou npx tsc --noEmit", não "$ npx tsc --noEmit";
 *   - a fonte monoespacada — mono só na expansão (§7.1: código e saída);
 *   - qualquer cara de caixa — sem fundo, sem borda, sem badge.
 *
 * O que ficou, porque é contrato e não decoração:
 *
 * 1. ALTURA CONSTANTE, 32px. A linha ocupa a mesma altura antes e depois de o
 *    resultado chegar — nada empurra o scroll quando o stream avança.
 *
 * 2. SUCESSO É SILÊNCIO. Linha concluída é cinza (--ck-text-secondary), sem
 *    check verde. Cor só quando a máquina trabalha (ciano), falhou (coral)
 *    ou espera humano (âmbar) — §1: a temperatura sobe conforme a máquina
 *    precisa de você. O TEMPO VERBAL carrega metade desse sinal: "Executando"
 *    é o estado, e é por isso que a cor pode ser discreta.
 *
 * 3. O DIFF É A EXCEÇÃO COLORIDA DO FEITO: `+N −M` em verde/coral mesmo na
 *    linha quieta — não é celebração de sucesso, é saldo de edição, e os
 *    tokens --ck-diff-add/--ck-diff-del existem para isso.
 *
 * 4. SEM ANIMAÇÃO DE ENTRADA. O feed é virtualizado: animar montagem
 *    dispararia a cada rolagem. Movimento fica só onde carrega informação e
 *    não re-dispara — o pulso da frase enquanto roda, o giro do chevron
 *    (transform, §9.4).
 *
 * 5. ALVO DE TOQUE DE 32px, e não os 44 da §3 — a colisão já documentada:
 *    linhas adjacentes cobrem cada pixel, errar por 6px abre a vizinha, que é
 *    reversível com outro toque. Onde há botão isolado (copiar, mostrar o
 *    resto), 44px vale.
 *
 * 6. O FILETE LATERAL só existe enquanto há estado: rodando/aguarda/falhou,
 *    ou aberto (hairline, ancorando o bloco na linha que o abriu). Fechado e
 *    feito é transparente — um fio cinza por linha viraria a grade que a
 *    régua existe para não ser.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { copyText } from '../../lib/clipboard';
import { fallbackCopy } from './copia-fallback';
import { DiffViewer } from './diff-viewer';
import { corpoDe, leExecucao, type Desfecho, type EntradaExecucao, type Rendimento } from './gramatica.ts';

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
  /** Começa aberta. Só para o bloco ativo do stream. */
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

  // G2 sub-formato "create" (matriz, 33 result + 40 tool Write): um Write de
  // arquivo NOVO não tem old_string/new_string — só file_path+content. Mesmo
  // DiffViewer da edição, oldString vazia: prepareDiff trata '' como zero
  // linhas e todo o conteúdo novo sai como 'add' — é o diff correto pra "não
  // existia, agora existe", sem precisar do tool_use_result rico (que só
  // chega depois do resultado; os args existem desde o 'rodando').
  const ehCriacao =
    entrada.toolName === 'Write' &&
    typeof args.file_path === 'string' &&
    typeof args.content === 'string';

  // Na edição e na criação o pedido não se repete: o caminho e o saldo já
  // estão na linha e no cabeçalho do diff. Mostrar de novo era o mesmo dado
  // três vezes na mesma tela.
  const pedido = ehEdicao || ehCriacao
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
        aria-label={`${e.nome}: ${e.alvo}`}
        className="ck-veil flex w-full items-center text-left"
        style={{
          gap: 'var(--ck-space-2)',
          // 32px fixos: a caixa não muda quando o resultado chega (ver nota 1).
          minHeight: '32px',
          padding: 'var(--ck-space-1) var(--ck-space-3)',
          // Sans desde 02/08: a linha é frase de chat, não terminal. A mono
          // volta na expansão — código e saída, o único lugar dela (§7.1).
          fontFamily: 'var(--ck-font-sans)',
          fontSize: 'var(--ck-text-sm)',
          lineHeight: 'var(--ck-leading-body)',
        }}
      >
        {/* A frase carrega verbo E estado: o tempo verbal ("Executando") e o
            pulso dizem "em voo" sem nenhum chrome em volta. */}
        <span
          className="ck-pulso min-w-0 flex-1 truncate"
          data-estado={PULSO[e.desfecho]}
          style={{ color: cor }}
        >
          {e.verbo} {e.alvo}
        </span>

        {e.rendimento ? (
          <SaldoDoRendimento rendimento={e.rendimento} falhou={e.desfecho === 'falhou'} />
        ) : null}

        <Chevron aberto={aberta} />
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
            background: 'var(--ck-surface-composer)',
            borderRadius: 'var(--ck-radius-frame)',
          }}
        >
          {/* O nome por extenso mora aqui desde 02/08: a frase da linha diz o
              verbo ("Executou"), não a marca ("Bash") — quem precisa do nome
              exato abriu a linha e o encontra primeiro. */}
          <Rotulo>{e.nome}</Rotulo>

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
          ) : ehCriacao ? (
            <DiffViewer filePath={String(args.file_path)} oldString="" newString={String(args.content)} />
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
