'use client';

/**
 * Os slots da base da caixa — estado (■), entrada (voz ou fim do áudio), a
 * porta da conversa por voz e o despacho. Saíram de `composer.tsx` (02/10) com
 * os comentários e a `key` de cada ramo; a ordem entre eles é a da base.
 */
import Link from 'next/link';
import { ALVO_DE_TOQUE, MARGEM_INFERIOR_DA_BASE } from '../../lib/alvo-de-toque';
import { InputGroupButton } from '../ui/input-group';
import { IconeEnviar, IconeMicrofoneConversa, IconeOnda, IconeParar } from './icones';
import { emCaptura, type ModoDaFala } from './modo-da-fala';
import type { Gravador } from './usa-gravador';
import type { AparenciaVoz, FaseVoz } from './voz';

export function SlotDeEstado({
  interromper,
  parando,
  agentName,
  pararEmCena,
}: {
  interromper: () => Promise<void>;
  parando: boolean;
  agentName: string;
  pararEmCena: boolean;
}) {
  return (
    /* SLOT DE ESTADO. O ■ voltou para dentro da caixa em 21/08 —
        *"precisamos reposicionar o componente parar, que está
        erradamente ao lado do mascote"*. Ele passou 20/08 colado na
        bolinha porque o slot da caixa era um só e ele comia o
        microfone; com três slots, um assunto cada, o beco não reabre:
        este alvo nunca é o do gesto de entrada nem o do despacho.

        Fora de cena ele fica no DOM mas NÃO COBRA LARGURA. O irmão do
        despacho cobra — ele guarda os 44px e a fileira desliza por cima
        —, e aqui isso não serve: a fileira já vive no limite em 390px,
        e 44px permanentes a menos deixavam o rótulo do motor em
        *"extra a"* mesmo com o agente parado. Medido no estágio antes
        de trocar. A margem negativa some com o espaço; em cena ela
        volta a zero e os chips cedem lugar.

        O TEMPO DA MARGEM É O TRUQUE DO `visibility`, não uma animação
        de largura (§9.4 continua valendo — nada interpola quadro a
        quadro): ela vira em `0s` na entrada, para o botão nascer no
        lugar dele, e na saída espera o fade inteiro, para os chips só
        reclamarem o espaço depois que ele apagou.

        Não pinta, não recebe toque, não é anunciado, não tabula: fora
        de cena não é botão morto, é botão que não está lá. */
    <InputGroupButton
      key="parar"
      variant="default"
      onClick={() => void interromper()}
      disabled={parando}
      aria-label={`Parar ${agentName}`}
      aria-hidden={!pararEmCena}
      tabIndex={pararEmCena ? undefined : -1}
      title="Parar"
      className="disabled:opacity-40"
      style={{
        ...ALVO_DE_TOQUE,
        marginBottom: MARGEM_INFERIOR_DA_BASE,
        borderRadius: 'var(--ck-radius-pill)',
        opacity: pararEmCena ? 1 : 0,
        pointerEvents: pararEmCena ? undefined : 'none',
        // Longhand DEPOIS do spread, como o `marginBottom` acima: o
        // `margin` shorthand de `ALVO_DE_TOQUE` apagaria isto se viesse
        // por último. Cancela os 32px do disco mais o gap da fileira.
        marginInlineEnd: pararEmCena
          ? undefined
          : 'calc((var(--ck-touch-min) - 32px) / -2 - 32px - var(--ck-space-3))',
        transition: pararEmCena
          ? 'opacity var(--ck-dur-enter, 200ms) var(--ck-ease), margin-inline-end 0s'
          : 'opacity var(--ck-dur-enter, 200ms) var(--ck-ease-exit), margin-inline-end 0s linear var(--ck-dur-enter, 200ms)',
      }}
    >
      <IconeParar />
    </InputGroupButton>
  );
}

export function SlotDeEntrada({
  modo,
  gravador,
  faseVoz,
  vozAparencia,
  agentName,
  temConteudo,
  pararEmCena,
}: {
  modo: ModoDaFala;
  gravador: Gravador;
  faseVoz: FaseVoz;
  vozAparencia: AparenciaVoz;
  agentName: string;
  temConteudo: boolean;
  pararEmCena: boolean;
}) {
  /* SLOT DE ENTRADA. Nunca some, nunca cede lugar. Em `travada` o
      gesto acabou e a gravação não: o mesmo pixel que abriu é o que
      fecha e despacha o áudio. */
  return modo === 'travada' ? (
    <InputGroupButton
      key="enviar-audio"
      variant="default"
      onClick={gravador.enviarTravada}
      aria-label={`Enviar áudio para ${agentName}`}
      style={{
        ...ALVO_DE_TOQUE,
        marginBottom: MARGEM_INFERIOR_DA_BASE,
        borderRadius: 'var(--ck-radius-pill)',
      }}
    >
      <IconeParar />
    </InputGroupButton>
  ) : (
    <InputGroupButton
      key="voz"
      disabled={faseVoz === 'transcrevendo'}
      {...gravador.handlers}
      // Os DOIS gestos no rótulo, porque agora são dois: toque curto
      // grava sem segurar, segurar é push-to-talk. React Aria manda
      // anunciar a pressão longa a quem não vê a tela
      // (`accessibilityDescription`, em `useLongPress`) — sem isso o
      // arrastar-para-cancelar não existe para o leitor de tela.
      aria-label={
        emCaptura(modo)
          ? vozAparencia.anuncio
          : `Segure para falar com ${agentName}, ou toque para gravar sem segurar`
      }
      className="disabled:opacity-40"
      style={{
        ...ALVO_DE_TOQUE,
        marginBottom: MARGEM_INFERIOR_DA_BASE,
        borderRadius: 'var(--ck-radius-pill)',
        // DOIS DISCOS CHEIOS LADO A LADO é o defeito que o ■ já
        // evitou uma vez ("o dedo que mira um acha o outro"). Com
        // qualquer vizinho de massa em cena — o despacho à direita ou
        // o ■ à esquerda — o microfone recua para contorno: continua
        // com os 44px de alvo, perde só a tinta.
        // `backgroundColor`, NUNCA o atalho `background`: o
        // atalho reescreve a família inteira e devolve
        // `background-clip` ao inicial, apagando o `content-box` que
        // veio no `ALVO_DE_TOQUE` — o disco voltava a pintar 44px só
        // aqui, e só na tinta. Mesmo pisão do `margin` que a nota do
        // `alvo-de-toque.ts` já conta, em outra família.
        backgroundColor: emCaptura(modo)
          ? vozAparencia.tinta ?? 'var(--ck-state-running)'
          : temConteudo || pararEmCena
            ? 'transparent'
            : 'var(--ck-text-primary)',
        color:
          emCaptura(modo) || !(temConteudo || pararEmCena)
            ? 'var(--ck-surface-canvas)'
            : 'var(--ck-text-secondary)',
        // A tinta troca no tempo da casa, não de estalo: o disco
        // claro virando ciano é a mudança mais visível do ciclo
        // inteiro. `background` e `color` não custam layout — a
        // proibição §9.4 é sobre `width`/`height`/`top`/`left`, e a
        // borda da caixa aqui do lado já transiciona assim.
        transition:
          'background-color var(--ck-dur-enter, 200ms) var(--ck-ease), color var(--ck-dur-enter, 200ms) var(--ck-ease)',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <IconeOnda />
    </InputGroupButton>
  );
}

export function SlotDaConversa({
  agentSlug,
  agentName,
  modo,
}: {
  agentSlug: string;
  agentName: string;
  modo: ModoDaFala;
}) {
  return (
    /* SLOT DA CONVERSA POR VOZ. Pedido do Rica em 29/09, no desktop: o
        primeiro botão da direita leva à tela de voz, que no celular se
        alcança pelo deslize e ali não tinha porta à vista. Fica ANTES do
        despacho, não depois: o despacho fora de cena sai pela borda
        com a fileira (`.ck-fileira-acoes`), e o que viesse depois dele
        sairia junto. O clique não navega — o `PagerDoAgente` captura o
        link de `/conversa/{slug}` e rola para a voz.

        Disco de véu, não de massa: ao lado da onda cheia, dois discos
        cheios são o "o dedo que mira um acha o outro". Só com mouse
        (`.ck-porta-da-voz`), porque em 390px a fileira já vive no limite.
        Durante a captura ele recua: sair da tela no meio da gravação
        perderia o áudio. */
    <Link
      href={`/conversa/${agentSlug}`}
      aria-label={`Conversar por voz com ${agentName}`}
      aria-disabled={emCaptura(modo) || modo === 'travada' ? true : undefined}
      tabIndex={emCaptura(modo) || modo === 'travada' ? -1 : undefined}
      title="Conversa por voz"
      className="ck-porta-da-voz shrink-0 items-center justify-center"
      style={{
        ...ALVO_DE_TOQUE,
        width: '32px',
        height: '32px',
        marginBottom: MARGEM_INFERIOR_DA_BASE,
        borderRadius: 'var(--ck-radius-pill)',
        color: 'var(--ck-text-primary)',
        opacity: emCaptura(modo) || modo === 'travada' ? 0.35 : 1,
        pointerEvents: emCaptura(modo) || modo === 'travada' ? 'none' : undefined,
      }}
    >
      <IconeMicrofoneConversa />
    </Link>
  );
}

export function SlotDeDespacho({
  despachoEmCena,
  sinalRecusa,
  setSinalRecusa,
  agentName,
}: {
  despachoEmCena: boolean;
  sinalRecusa: boolean;
  setSinalRecusa: (sinal: boolean) => void;
  agentName: string;
}) {
  return (
    /* SLOT DE DESPACHO. Nunca é buraco: quando não há o que mandar,
        quem some é ELE, saindo pela borda com a fileira — e não um vão
        reservado no meio da barra. Um alvo visível e mudo aqui também
        não serviria: `vazio` é a única recusa sem recado no módulo da
        porta, e botão que não responde nem diz por quê é a §9. */
    <InputGroupButton
      key="enviar"
      type="submit"
      variant="default"
      // Habilitado mesmo quando a porta vai recusar: desabilitado ele
      // não responde ao toque e não diz por quê, que é o botão morto
      // da §9. Tocar agora devolve o motivo na faixa abaixo — e, se a
      // faixa estiver escondida atrás do teclado, o botão sacode
      // (`sinalRecusa` + `.ck-sacudir`) pra o toque não parecer morto.
      //
      // FORA DE CENA ele não é botão morto: não pinta, não recebe
      // toque, não é anunciado e não entra na ordem de tabulação — não
      // é um alvo que ignora o dedo, é um alvo que não está lá. Fica no
      // DOM porque é a largura dele que a fileira desliza, e porque um
      // botão que nasce e morre a cada tecla não teria o que animar.
      onAnimationEnd={() => setSinalRecusa(false)}
      aria-label={`Enviar para ${agentName}`}
      aria-hidden={!despachoEmCena}
      tabIndex={despachoEmCena ? undefined : -1}
      className={sinalRecusa ? 'ck-sacudir' : undefined}
      style={{
        ...ALVO_DE_TOQUE,
        marginBottom: MARGEM_INFERIOR_DA_BASE,
        borderRadius: 'var(--ck-radius-pill)',
        opacity: despachoEmCena ? 1 : 0,
        pointerEvents: despachoEmCena ? undefined : 'none',
        transition: 'opacity var(--ck-dur-enter, 200ms) var(--ck-ease)',
      }}
    >
      {/* O aperto vai no ÍCONE, não no botão: o botão já carrega o
          `transform` da sacudida de recusa, e as duas regras
          disputariam a mesma propriedade — a que chegasse por último
          apagaria a outra no meio do gesto. */}
      <IconeEnviar className="ck-aperta-miolo" />
    </InputGroupButton>
  );
}
