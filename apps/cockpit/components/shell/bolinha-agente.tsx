'use client';

/**
 * A BOLINHA — a presença do agente logo acima da caixa do composer.
 *
 * Por que desenhada à mão: o runtime do Rive sozinho pesa 717 KB (medido em
 * 17/08, brotli), o Lottie 77 KB, e isto aqui é SVG e keyframes. E porque
 * nenhuma peça pronta da stack resolve o problema — `spinner` do shadcn é um
 * `Loader2Icon` girando, `skeleton` é uma div pulsando: as duas sabem dizer
 * "está carregando" e nada além disso.
 *
 * Quatro decisões que vieram do protótipo (`public/proto-bonequinho.html`) e não
 * são gosto, são requisito:
 *
 * 1. O NÚCLEO É IMPERATIVO. Piscada e olhar mexem no DOM por ref dentro de um
 *    effect. Em `useState`, cada piscada re-renderizaria o composer inteiro —
 *    e ela acontece a cada 2-6 s, para sempre.
 * 2. O ROSTO É SÓ DOIS PONTOS. Boca e sobrancelha lêem como emoji nesse
 *    tamanho; sem elas, quem diz o estado é o RITMO. A prova é a escala real:
 *    em 42 px, uma esfera lisa não diz nada que um spinner já não diga, e um
 *    rosto desenhado vira figurinha. Dois pontos é o meio que sobra.
 * 3. A PISCADA É SORTEADA, e às vezes dupla. Intervalo fixo lê como semáforo; é
 *    o irregular que separa "tem alguém aí" de "animação tocando".
 * 4. O SQUISH DO TOQUE TEM NÓ PRÓPRIO (`.ck-bolinha-toque`). Animação CSS vence
 *    `style` inline no MESMO elemento — sem esse `<g>`, tocar na bolinha
 *    enquanto ela chama por você não faria nada.
 * 5. O OLHAR TEM ENDEREÇO (expressões ditadas pelo Rica, 17/08). Vagueia só
 *    quando pensa; olha pra frente quando está parado; sobe em 45° quando há
 *    output saindo — ferramenta em voo ou texto crescendo —, porque é ACIMA
 *    dele que o feed escreve. E desligado não tem olhos: a cor é a mesma de
 *    parado, então quem separa "não tem ninguém" de "está quieto" é o rosto.
 *
 * Cor, keyframes e estados moram em `globals.css` (§ A BOLINHA): componente não
 * carrega cor, e keyframe não é território de utility do Tailwind.
 */

import { useEffect, useId, useRef, useState } from 'react';

import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';

import { ALVO_DE_TOQUE } from '../../lib/alvo-de-toque';
import { estadoDaBolinha, FALA_DA_BOLINHA, type EstadoBolinha } from './bolinha-estado';
import { IconeParar } from './icones';

/** Quanto tempo o pulinho de "terminou" fica no ar antes de voltar ao repouso.
 *  Um pouco mais que a animação (0,62 s) para o olho alcançar o fim dela. */
const DURACAO_PRONTO_MS = 900;

/** Piso de exibição do "executando". Medido na `:3008` em 17/08: entre duas
 *  ferramentas o estado durou **0,7 s** — o fim do feed troca de dono e volta.
 *  O piso não inventa estado nenhum: só segura o que realmente aconteceu pelo
 *  tempo de alguém enxergar. */
const PISO_EXECUTANDO_MS = 1100;

type Props = {
  status: AgentStatus | undefined;
  turnoVivo: boolean;
  /** Tem output saindo agora. O nome do prop guarda o do store
   *  (`escrita-viva`), que é mais estreito que o sinal virou — renomear os dois
   *  espera a Tara sair do `composer.tsx`, que é o único call site. */
  escrevendo: boolean;
  /**
   * O ■ MORA AQUI, e não no composer. Ele viveu no slot de ação da caixa até
   * 20/08, disputando lugar com o gesto de ENTRADA — e o slot só tem um alvo.
   * Com o campo vazio durante a geração o ■ vencia e comia o MICROFONE: quem
   * fala, que é o caso do Rica, ficava sem como começar a próxima mensagem.
   * A fila que o composer ganhou no mesmo dia era real e ficou inalcançável
   * por voz, que é justamente o gesto que ele mais usa.
   *
   * A régua que sai daí: o slot da caixa é do gesto de ENTRADA (microfone com
   * campo vazio, enviar com conteúdo). Parar é sobre o ESTADO DO AGENTE, e o
   * estado do agente é o que esta linha já anuncia.
   *
   * `undefined` = não há o que parar; o botão não nasce.
   */
  aoParar?: (() => void) | undefined;
  /** O toque já saiu e a resposta não voltou — evita o segundo toque. */
  parando?: boolean;
  nomeDoAgente: string;
};

export function BolinhaAgente({
  status,
  turnoVivo,
  escrevendo,
  aoParar,
  parando = false,
  nomeDoAgente,
}: Props) {
  const gradId = `ck-bolinha-${useId()}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const rostoRef = useRef<SVGGElement>(null);
  const toqueRef = useRef<SVGGElement>(null);

  const estavel = estadoDaBolinha({ status, turnoVivo, produzindo: escrevendo });
  // "Terminou" é transição, não estado: só existe para quem lembra o valor
  // anterior. O pulinho é a única coisa nesta peça que precisa de re-render —
  // duas por turno, contra as centenas que a piscada custaria.
  const [comemorando, setComemorando] = useState(false);
  const anterior = useRef(estavel);
  useEffect(() => {
    const veioDeTrabalhar =
      anterior.current === 'pensando' || anterior.current === 'executando';
    anterior.current = estavel;
    if (!veioDeTrabalhar || estavel !== 'parado') return;
    setComemorando(true);
    const id = window.setTimeout(() => setComemorando(false), DURACAO_PRONTO_MS);
    return () => window.clearTimeout(id);
  }, [estavel]);

  const [segurandoExecucao, setSegurandoExecucao] = useState(false);
  useEffect(() => {
    if (estavel !== 'executando') return;
    setSegurandoExecucao(true);
    const id = window.setTimeout(() => setSegurandoExecucao(false), PISO_EXECUTANDO_MS);
    return () => window.clearTimeout(id);
  }, [estavel]);

  // A ordem aqui é a mesma da régua: quem chama uma pessoa nunca é encoberto,
  // e o piso da execução só empresta tempo de quem ainda está no mesmo turno.
  const estado: EstadoBolinha =
    comemorando && estavel === 'parado'
      ? 'pronto'
      : segurandoExecucao && estavel === 'pensando'
        ? 'executando'
        : estavel;

  // O olhar volta pra frente no instante em que ele para de pensar. Sem isto o
  // vaguear só reagendaria em até 4 s, e o repouso ficaria com o olhar torto do
  // último sorteio — que é justamente o que "olha pra frente" desmente.
  useEffect(() => {
    if (estado !== 'pensando' && rostoRef.current) rostoRef.current.style.transform = '';
  }, [estado]);

  // Piscada, olhar e toque: DOM direto, fora do ciclo de render.
  useEffect(() => {
    const svg = svgRef.current;
    const rosto = rostoRef.current;
    if (!svg || !rosto) return;

    // A preferência é lida uma vez e depois esquecida se ficar numa const:
    // quem liga "reduzir movimento" com a tela aberta continuaria vendo tudo
    // mexer. Por isso o `change`.
    const consultaCalmo = window.matchMedia('(prefers-reduced-motion: reduce)');
    let calmo = consultaCalmo.matches;
    const trocaCalmo = (ev: MediaQueryListEvent) => {
      calmo = ev.matches;
    };
    consultaCalmo.addEventListener('change', trocaCalmo);

    const timers = new Set<number>();
    const espera = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const pisca = () => {
      if (calmo) return;
      svg.dataset.piscando = 'true';
      espera(() => {
        delete svg.dataset.piscando;
      }, 135);
      if (Math.random() < 0.22) espera(pisca, 265); // piscada dupla, como gente
    };
    const agendaPiscada = () => espera(() => {
      pisca();
      agendaPiscada();
    }, 2400 + Math.random() * 4100);
    agendaPiscada();

    // O olhar vagueia SÓ enquanto ele pensa (Rica, 17/08): parado é olhar
    // parado, olhando pra frente. Deslocamento pequeno de propósito — olho que
    // anda demais vira desenho animado.
    const vagueia = () => {
      if (!calmo && svg.dataset.estado === 'pensando') {
        const dx = (Math.random() * 2 - 1) * 2.4;
        const dy = (Math.random() * 2 - 1) * 1.4;
        rosto.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      }
      espera(vagueia, 1600 + Math.random() * 2600);
    };
    vagueia();

    // Tocar nele responde: é a micro-interação que faz parecer bicho, não
    // widget. One-shot por WAAPI — sem remover classe, sem forçar reflow, e
    // ganha da animação de estado que estiver tocando no mesmo instante.
    const responde = () => {
      if (calmo || !toqueRef.current) return;
      pisca();
      toqueRef.current.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(.92)' }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'cubic-bezier(.34,1.3,.5,1)' },
      );
    };
    svg.addEventListener('pointerdown', responde);

    return () => {
      consultaCalmo.removeEventListener('change', trocaCalmo);
      svg.removeEventListener('pointerdown', responde);
      for (const id of timers) window.clearTimeout(id);
    };
  }, []);

  return (
    <span className="mx-auto flex w-full items-center" style={{ maxWidth: 'var(--ck-w-composer)' }}>
      <svg
        ref={svgRef}
        className="ck-bolinha"
        data-estado={estado}
        viewBox="0 0 64 68"
        role="img"
        // Rótulo ESTÁVEL de propósito: `aria-label` trocando num `role="img"` não
        // é anunciado — não é live region. Quem conta a mudança é o texto abaixo.
        aria-label="estado do agente"
      >
        <defs>
          <radialGradient id={gradId} cx="34%" cy="26%" r="78%">
            <stop offset="0%" stopColor="var(--ck-bolinha-claro)" />
            <stop offset="100%" stopColor="var(--ck-bolinha-escuro)" />
          </radialGradient>
        </defs>
        <ellipse className="ck-bolinha-sombra" cx="32" cy="60" rx="15" ry="2.6" />
        <g className="ck-bolinha-voa">
          <g className="ck-bolinha-cabeca">
            <g className="ck-bolinha-toque" ref={toqueRef}>
              <g className="ck-bolinha-infla">
                <circle cx="32" cy="32" r="23.5" fill={`url(#${gradId})`} />
                <ellipse
                  className="ck-bolinha-lustro"
                  cx="24"
                  cy="20"
                  rx="7.4"
                  ry="4.9"
                  transform="rotate(-24 24 20)"
                />
                <g className="ck-bolinha-rosto" ref={rostoRef}>
                  <g className="ck-bolinha-vista">
                    <g className="ck-bolinha-olhos">
                      <circle className="ck-bolinha-olho" cx="24" cy="31" r="3.1" />
                      <circle className="ck-bolinha-olho" cx="40" cy="31" r="3.1" />
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
      <span className="sr-only" aria-live="polite">
        {FALA_DA_BOLINHA[estado]}
      </span>
      {aoParar ? (
        <button
          type="button"
          onClick={aoParar}
          disabled={parando}
          aria-label={`Parar ${nomeDoAgente}`}
          title="Parar"
          // COLADO NA BOLINHA, não na ponta da linha. Os dois são a mesma
          // frase — "ele está trabalhando" e "pare" — e lidos juntos dizem o
          // que nenhum diz sozinho. Na borda direita o ■ cairia logo acima do
          // microfone, dois discos escuros empilhados, e o dedo que mira um
          // acha o outro.
          //
          // Nada de utility de margem aqui: `ALVO_DE_TOQUE` traz `margin`
          // SHORTHAND inline, e inline vence classe — um `ml-auto` seria
          // ignorado em silêncio. Cheguei a escrever e só a bancada mostrou.
          className="flex shrink-0 items-center justify-center disabled:opacity-40"
          style={{
            ...ALVO_DE_TOQUE,
            width: '32px',
            height: '32px',
            borderRadius: 'var(--ck-radius-pill)',
            background: 'var(--ck-text-primary)',
            color: 'var(--ck-surface-canvas)',
          }}
        >
          <IconeParar />
        </button>
      ) : null}
    </span>
  );
}
