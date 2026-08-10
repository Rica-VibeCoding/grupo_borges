/**
 * A barra de contexto — o desenho, uma vez só, para as três telas.
 *
 * É o "lugar central" que o Rica pediu (09/08): statusline da tropa, linha de
 * quem dorme e gaveta do agente desenham o contexto por aqui. Antes cada uma
 * resolvia por conta — a gaveta chegava a escrever `teto 30%` à mão numa string.
 *
 * ## O que ela é, e por que não veio do registro
 *
 * `@shadcn/progress` foi consultado e recusado por duas razões, nenhuma de
 * preguiça: ele é `role="progressbar"`, e o caso aqui é MEDIDOR — a APG diz que
 * o `progressbar` mede o andamento de uma tarefa, não um nível contra um limite.
 * O `bloco-de-cota.tsx` já tinha escrito isso na casa quando desenhou a barra de
 * cota, e importar a semântica contrária a três arquivos de distância seria o
 * v2 discordando de si mesmo. A segunda razão é custo: o Progress traz o
 * `radix-ui` junto e é client component, para dez retângulos numa lista que hoje
 * renderiza no servidor.
 *
 * A forma é deliberadamente a MESMA da barra de cota (4px, pill, trilho em
 * `surface-composer`): as duas aparecem na mesma gaveta, e duas barras com
 * gramática diferente lado a lado leem como duas grandezas sem relação.
 *
 * ## O teto não é desenhado — ele é a cor
 *
 * A primeira versão marcava os 30% com um traço vertical sobre o preenchimento.
 * O Rica reprovou duas vezes, e a segunda foi definitiva: *"essa barrinha na
 * vertical é feio"*, *"passou de 30% muda de cor"*. Então **nada** é desenhado
 * por cima da barra. Quem passou do teto pinta em âmbar, quem não passou pinta
 * neutro, e é só isso.
 *
 * Isso mata de graça o defeito que derrubou a versão anterior
 * (`reference_marca_fixa_em_lista_vira_coluna`): marca em coordenada fixa dentro
 * de item repetido vira coluna vertical e o olho lê a coluna no lugar do dado. A
 * resposta dele foi eliminar a marca, não movê-la.
 *
 * Neutro de propósito — sem `'use client'`, roda dentro de Server Component.
 * Elementos são `<span>` com `display:block` porque a statusline é um `<span>`:
 * `<div>` ali dentro é HTML inválido e vira mismatch de hidratação.
 */
import { fracaoDoMedidor, passouDoTeto } from './medidor';

/** Largura na TROPA em tela cheia, em px. Curta de propósito: a barra divide a
 *  linha com o nome do agente, e quem perde a disputa por espaço vira "Tar…" no
 *  lugar de "Tara Kaur". */
export const LARGURA_NA_LISTA = 56;

/** Largura na coluna de 260px, onde sobra ainda menos. Na gaveta não há
 *  constante: a barra vai sem `largura` e ocupa o campo inteiro. */
export const LARGURA_NA_COLUNA = 40;

export function BarraDeContexto({
  pct,
  /** Largura em px. Omitida, a barra ocupa o espaço livre — é o que a gaveta
   *  quer (campo inteiro) e o que a lista não pode ter (o nome do agente perde
   *  a disputa e vira "Tar…"). */
  largura,
}: {
  pct: number;
  largura?: number;
}) {
  const alemDoTeto = passouDoTeto(pct);

  return (
    // `aria-hidden` porque o percentual sai ao lado em texto nos três usos: sem
    // isso o leitor de tela anuncia o mesmo número duas vezes seguidas.
    <span
      aria-hidden
      className={largura === undefined ? 'block flex-1 overflow-hidden' : 'block shrink-0 overflow-hidden'}
      style={{
        width: largura === undefined ? undefined : `${largura}px`,
        // Sem o piso, `flex-1` com `overflow-hidden` deixa a barra encolher até
        // zero quando o texto ao lado cresce (na gaveta, "dados antigos · lido
        // 3h"). Encolher é certo; sumir não é.
        minWidth: largura === undefined ? '56px' : undefined,
        height: '4px',
        borderRadius: 'var(--ck-radius-pill)',
        background: 'var(--ck-surface-composer)',
      }}
    >
      <span
        className="block"
        style={{
          width: `${fracaoDoMedidor(pct) * 100}%`,
          height: '100%',
          borderRadius: 'var(--ck-radius-pill)',
          background: alemDoTeto ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)',
        }}
      />
    </span>
  );
}

/** A coluna do número, medida em caracteres da PRÓPRIA mono: cabe `100%` e nada
 *  além. Em `ch` e não em px porque quem manda na largura é o glifo — trocar a
 *  fonte reajusta a coluna sozinha, em vez de desalinhar as nove linhas. */
const COLUNA_DO_VALOR = '4ch';

/**
 * O percentual — sempre a ÚLTIMA coluna da linha, sempre na mesma vertical.
 *
 * Existe porque o número sem largura reservada não faz coluna: `7%`, `18%` e
 * `100%` têm três larguras, e numa lista o olho lê a borda esquerda deles como
 * se fosse uma vertical torta. Medido antes desta peça, na coluna de 260px: o
 * `%` pousava em cinco `x` diferentes, com **72px** de dança entre a linha mais
 * à esquerda e a mais à direita. `tabular-nums` (a `ck-tabular` do pai) resolve
 * o dígito dançando dentro do número; a largura reservada resolve o número
 * dançando dentro da linha. São dois problemas, e cada um tem o seu remédio.
 *
 * O back manda float (`14.5`) e a tela mostra INTEIRO. Não é perda: 14,5% e 15%
 * mandam compactar no mesmo momento, e o teto de 30% é a única decisão que este
 * número toma. O que a casa decimal custava era caro — cinco glifos onde todo o
 * resto da coluna tem dois ou três, e a vírgula puxando o olho para o único
 * agente que não tem nada de diferente.
 */
export function ValorDoContexto({ pct }: { pct: number }) {
  const inteiro = Math.round(pct);

  return (
    <span
      className="ck-tabular shrink-0"
      style={{
        width: COLUNA_DO_VALOR,
        textAlign: 'right',
        // O teto se lê no número EXIBIDO, não no cru: com 30,4% a tela diria
        // "30%" pintado de âmbar e se contradiria na mesma linha.
        color: passouDoTeto(inteiro) ? 'var(--ck-state-attention)' : undefined,
      }}
    >
      {inteiro}%
    </span>
  );
}

/**
 * A ausência de leitura — na MESMA coluna do número, e do tamanho dela.
 *
 * Era a frase `sem contexto`, e o custo dela estava medido: doze caracteres na
 * coluna onde os outros têm dois, comendo tanta linha que o nome do agente
 * cedia primeiro — `Lucas Marchetti` precisava de 95px, tinha 80, e virava
 * `Lucas Marc…`. Quem some da tela é sempre o dado, nunca a falta dele: exatamente
 * a troca errada.
 *
 * O travessão continua **não inventando zero**, que era o motivo de a frase
 * existir. Ele só para de gritar: ausência ocupa o tamanho da ausência, a frase
 * inteira fica no `title`, e o leitor de tela recebe a palavra pelo `sr-only` —
 * a §3 proíbe cor como portadora única, e aqui o portador é a posição na coluna
 * mais o texto acessível.
 *
 * `tertiary` a 12px era furo da §2.2 (`nunca corpo`) enquanto isto era frase.
 * Como glifo de ausência é legítimo: o contrato libera `tertiary` justamente
 * para ícone e separador.
 */
export function SemContexto() {
  return (
    <span
      className="shrink-0"
      style={{
        width: COLUNA_DO_VALOR,
        textAlign: 'right',
        color: 'var(--ck-text-tertiary)',
      }}
      title="a sessão fechou sem gravar o contexto — não há leitura, e zero seria invenção"
    >
      <span aria-hidden>—</span>
      <span className="sr-only">sem contexto</span>
    </span>
  );
}
