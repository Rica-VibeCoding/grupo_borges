'use client';

/**
 * A caixa: o invólucro da âncora, o `form` com a miniatura e o fio do estado,
 * e a gaveta do anexo. Saiu de `composer.tsx` (02/10); o campo e a base chegam
 * como filhos, entre a miniatura e o fio — a mesma ordem de antes.
 */
import type { FormEvent, ReactNode, RefObject } from 'react';
import { motion } from 'motion/react';
import type { usaAnexo } from '../../lib/usa-anexo';
import type { AparenciaEnvio } from './aparencia-envio';
import { PainelAnexo } from './gaveta-anexo';
import { MiniaturaAnexo } from './miniatura-anexo';
import { podePesquisar } from './pesquisa-canario';
import { TROCA_DE_FILEIRA } from './troca-de-fileira';

export type CaixaDoComposerProps = {
  agentSlug: string;
  pesquisaAtiva: boolean;
  formaDaCaixa: string;
  umaLinha: boolean;
  aparencia: AparenciaEnvio;
  anexo: ReturnType<typeof usaAnexo>;
  miniaturaRecolhida: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  quadroAnexoRef: RefObject<HTMLDivElement | null>;
  botaoAnexoRef: RefObject<HTMLButtonElement | null>;
  aoSubmeter: (e: FormEvent) => void;
  /** O campo e a base, nesta ordem. */
  children: ReactNode;
};

export function CaixaDoComposer({
  agentSlug, pesquisaAtiva, formaDaCaixa, umaLinha, aparencia, anexo, miniaturaRecolhida,
  textareaRef, quadroAnexoRef, botaoAnexoRef, aoSubmeter, children,
}: CaixaDoComposerProps) {
  // O caminho feliz não pinta mais a borda — `enviando`/`aceito` devolvem
  // `filete: null` desde 11/08, para os seis agentes (o porquê está em
  // `aparencia-envio.ts`). O que chega aqui colorido é só insucesso.
  const fileteDoEstado = aparencia.filete;
  // O iPhone pinta o cursor numa camada própria e não o arrasta quando o campo
  // anda por `transform`: ele ficava fora da caixa (Rica, print de 30/09). Some
  // durante a troca e, no fim, a seleção é regravada — é mudança de seleção
  // que faz o iOS repintá-lo no lugar.
  const escondeCursor = () => {
    const campo = textareaRef.current;
    if (campo) campo.style.caretColor = 'transparent';
  };
  const devolveCursor = () => {
    const campo = textareaRef.current;
    if (!campo) return;
    campo.style.caretColor = '';
    if (document.activeElement !== campo) return;
    const { selectionStart, selectionEnd, selectionDirection } = campo;
    campo.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
  };

  return (
    /* O INVÓLUCRO DA ÂNCORA. Existe por uma razão só: dar à gaveta um
        `position: relative` que meça exatamente a caixa do composer. Se o
        `bottom: 100%` dela medisse a coluna inteira (que também tem as linhas
        de estado embaixo), a gaveta subiria alto demais e descolaria do "+".
        A largura máxima migrou para cá para que o `left` da gaveta case com a
        borda da caixa também no desktop, onde a coluna é mais larga. */
    <div
      className="relative mx-auto w-full"
      style={{ maxWidth: 'var(--ck-w-composer)' }}
    >
    <motion.form
      // A TROCA DE FILEIRA (vazio ↔ com texto) vira o `flex-direction` da
      // caixa, e CSS não anima isso. A Motion mede antes e depois e anima só
      // com `transform` (§9.4 da estética): o layout muda uma vez, o feed
      // recalcula uma vez. Os filhos com `layout` desfazem a escala da mãe e
      // andam até o lugar novo em vez de pular.
      layout
      layoutDependency={formaDaCaixa}
      transition={{ layout: TROCA_DE_FILEIRA }}
      onLayoutAnimationStart={escondeCursor}
      onLayoutAnimationComplete={devolveCursor}
      onSubmit={aoSubmeter}
      className="ck-lit ck-caixa flex w-full flex-col border"
      data-linha={umaLinha ? 'uma' : 'varias'}
      // Pesquisa ligada na gaveta: a borda fica âmbar (regra no globals.css),
      // pra ele não mandar com `/pesquisa` sem saber.
      data-pesquisa={podePesquisar(agentSlug) && pesquisaAtiva ? 'ligada' : undefined}
      style={{
        padding: 'var(--ck-space-3)',
        gap: 'var(--ck-space-2)',
        // A CAIXA É MATERIAL, não superfície opaca. Ela não tem
        // `backdrop-filter` próprio de propósito: o véu atrás já desfocou o
        // feed, e um segundo desfoque aqui só custaria GPU para borrar o que
        // já está borrado. O que ela faz é somar um degrau de luz sobre o
        // resultado — é assim que a referência distingue a pílula da faixa
        // sem opacar nenhuma das duas, e é por isso que o texto do feed
        // atravessa POR DENTRO dela. Ver §8 da estética.
        background: 'var(--ck-surface-composer-material)',
        borderColor: fileteDoEstado ?? 'var(--ck-edge-composer)',
        // A borda inteira (não só um filete de 2px) muda de cor no estado
        // quente: o composer é a única superfície de INPUT da tela, e ali a
        // convenção do filete lateral (linha de execução, mensagem) compete
        // com a moldura que o campo já tem por natureza. Quem sinaliza é a
        // COR, e só ela: o 1.5px do estado saiu em 08/08, quando o Rica pediu
        // "borda fininha, igual nós temos no CC" — engrossar era um segundo
        // portador para o mesmo recado, e o que ele nota é a espessura.
        borderWidth: '1px',
        // Raio próprio, maior que o do resto (§adendo): a referência
        // arredonda a caixa de fala bem mais do que os blocos de conteúdo, e
        // `--ck-radius-frame` veste código/diff/thinking, onde macio demais
        // rouba leitura. Ver o comentário do token em `globals.css`.
        borderRadius: 'var(--ck-radius-caixa)',
        position: 'relative',
        overflow: 'hidden',
        // O mesmo slow do resto da troca. Em `--ck-dur-fast` (120ms) a
        // moldura chegava na cor nova antes de o microfone chegar na dele, e
        // a caixa mudava em duas etapas — o estado da fala é UM, e muda como
        // um só gesto.
        transition: `border-color var(--ck-dur-enter, 200ms) var(--ck-ease)`,
      }}
    >
      {/* A miniatura é o PRIMEIRO filho da caixa: ela empurra o campo para
          baixo em vez de flutuar sobre ele, e o composer cresce. O anexo
          escolhido não some porque o microfone abriu. Foto e vídeo saem
          dela no envio, voando para a bolha do feed; volta no erro — ver
          `miniatura-anexo.tsx`. */}
      <MiniaturaAnexo
        estado={anexo.estado}
        aoRemover={anexo.limpar}
        recolhida={miniaturaRecolhida}
        refQuadro={quadroAnexoRef}
      />

      {children}

      {/* O fio — ver `aparencia-envio.ts`. Track de 2px na base, dentro da
          própria moldura (`overflow:hidden` do form recorta a ponta). Só
          `transform` anima: o compositor não recalcula layout.

          O ENVIO DE TEXTO NÃO O ACENDE MAIS (Rica, 11/08): quando a mensagem
          sai, ela já está no feed, e a espera se acompanha por lá.

          E A VOZ TAMBÉM NÃO O ACENDE MAIS (Rica, 20/08): *"esse raio azul que
          passa embaixo do composer eu queria tirar de todo mundo"*. O fio
          corria a cada fala, e o que ele anunciava — "o STT está trabalhando"
          — a fala ao vivo tornou visível de um jeito melhor: as palavras
          entram no rascunho enquanto ele fala. Quando o canal ao vivo não
          entrega e o arquivo assume, quem responde "estou trabalhando" é a
          frase `transcrevendo…` ali em cima, que diz DE QUE se espera — coisa
          que um fio correndo nunca disse.

          Sobrou o único caso em que o composer é a ÚNICA tela do assunto: o
          fio TRAVADO do `nao-confirmado`, que é âmbar, é estático e existe
          pra ser visto. */}
      {aparencia.fio !== 'nenhum' ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '2px',
            overflow: 'hidden',
            background: 'var(--ck-edge-hairline)',
          }}
        >
          <div
            style={{
              width: '30%',
              height: '100%',
              background: aparencia.filete ?? 'var(--ck-state-attention)',
              // Travado: parado na METADE do trajeto — é a imagem literal do
              // "ficou pelo caminho", não uma barra de progresso genérica.
              transform: aparencia.fio === 'travado' ? 'translateX(120%)' : undefined,
            }}
          />
        </div>
      ) : null}
    </motion.form>

      {/* A GAVETA. Irmã do form, dentro do invólucro ancorado — sobe a partir
          do "+" e nunca é recortada pelo `overflow` da caixa. */}
      <PainelAnexo
        estado={anexo.estado}
        fecharGaveta={anexo.fecharGaveta}
        escolher={anexo.escolher}
        botaoRef={botaoAnexoRef}
      />
    </div>
  );
}
