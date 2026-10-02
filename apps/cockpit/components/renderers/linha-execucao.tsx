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
import { useMemo, useState, type ReactNode } from 'react';

import { CORPO_MONO, Cabecalho, Chevron, Rotulo, SaldoDoRendimento, Saida } from './controles-da-linha';
import { DiffViewer } from './diff-viewer';
import { corpoDe, leExecucao, type Desfecho, type EntradaExecucao } from './gramatica.ts';

// Os controles (glifos, chevron, saldo, copiar, rótulo, cabeçalho, saída) moram
// em `controles-da-linha.tsx` desde 02/10; `Chevron` e `SaldoDoRendimento` saem
// daqui reexportados, porque é deste arquivo que o feed os importa.
export { Chevron, SaldoDoRendimento } from './controles-da-linha';

/** Reusa o vocabulário de pulso da tropa: o mesmo movimento significa a mesma
 *  coisa nas duas superfícies. `feito` e `falhou` ficam parados — parar também
 *  é informação, e movimento em tudo é decoração. */
const PULSO: Record<Desfecho, string | undefined> = {
  rodando: 'trabalhando',
  aguarda: 'aguardando',
  feito: undefined,
  falhou: undefined,
};

/** Em voo, o texto é o dourado do pulso — a cor do "agora" do cockpit, a mesma
 *  do filete. O azul (`--ck-state-running`) saiu do feed (02/10, §6.3). */
const COR: Record<Desfecho, string> = {
  rodando: 'var(--ck-pulso-ouro)',
  aguarda: 'var(--ck-state-attention)',
  falhou: 'var(--ck-state-fail)',
  feito: 'var(--ck-text-secondary)',
};

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

export function LinhaExecucao({
  aberta: abertaInicial = false,
  corpoRico,
  ...entrada
}: LinhaExecucaoProps) {
  const [aberta, setAberta] = useState(abertaInicial);
  // Só o corpo aberto pelo DEDO chega com `.ck-chega`. O que nasce aberto
  // (histórico, remontagem pelo virtualizador ao rolar) aparece parado —
  // animar ali seria a tela inteira se mexendo sem ninguém ter tocado.
  // Recolher segue seco: o corpo sai do DOM e a altura não se anima (§9.4).
  const [abriuNoToque, setAbriuNoToque] = useState(false);
  // `entrada` é o resto do spread — objeto novo a cada render, e memo preso a
  // ele nunca acertava. A dependência é o que `leExecucao` lê, campo a campo.
  const { toolName, args: argsCrus, result, isError, estado } = entrada;
  const e = useMemo(
    () => leExecucao({ toolName, args: argsCrus, result, isError, estado }),
    [toolName, argsCrus, result, isError, estado],
  );

  const cor = COR[e.desfecho];
  const args = (entrada.args ?? {}) as Record<string, unknown>;
  // O corpo só aparece aberto: fechada — 82% da tela —, a linha não o monta.
  const corpo = aberta ? corpoDe(entrada.result) : '';

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
        // Em voo, o fio é o dourado do pulso (28/09): o passo que está
        // acontecendo agora se acende como o resto do "agora" do cockpit.
        borderLeft: `2px solid ${
          e.desfecho !== 'feito' ? cor : aberta ? 'var(--ck-edge-hairline)' : 'transparent'
        }`,
      }}
    >
      <button
        type="button"
        onClick={() => {
          setAberta(!aberta);
          setAbriuNoToque(!aberta);
        }}
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
          {e.frase}
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
          className={
            [e.desfecho === 'falhou' ? '' : 'ck-lit', abriuNoToque ? 'ck-chega' : '']
              .filter(Boolean)
              .join(' ') || undefined
          }
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
