/**
 * A RÉGUA — o que o aparelho do Rica resolveu de verdade, medido nele.
 *
 * Ver o porquê no cabeçalho de `app/api/regua/route.ts`. Aqui fica só o COMO, e
 * ele tem três decisões que a primeira versão (a descartável de 02/08) não
 * tinha e das quais eu senti falta na hora:
 *
 * 1. **Mede latência, não só estado.** A pergunta que o Rica faz sozinho é
 *    *"está mais devagar?"*, e ela não se responde com um retrato. Um
 *    `MutationObserver` no `data-aberto` cronometra do toque até a superfície
 *    virar — foi assim que os 618ms da tropa apareceram, e é o número que
 *    denuncia regressão de latência antes de virar reclamação.
 *
 * 2. **Marca a build.** Uma leitura ruim é ambígua: pode ser o bug vivo ou uma
 *    aba que ele não recarregou. O `flexBasis` do primeiro filho da gaveta é a
 *    assinatura mais barata que existe — foi exatamente o que o conserto de
 *    02/08 mudou (`0%` velho, `auto` novo), então o marcador É a correção.
 *
 * 3. **Não pode ser o problema.** `pointer-events: none` e `z-index` acima de
 *    tudo: a régua nunca intercepta um toque nem some atrás de uma superfície.
 *
 * Só monta com `?diag=1`. Sem o parâmetro nada disto existe em tela.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

/** As superfícies que valem medir, com o nome curto que aparece na tela. Novo
 *  overlay entra aqui e ganha medição de graça. */
const SUPERFICIES = [
  { nome: 'painel', seletor: 'aside.ck-surge' },
  { nome: 'tropa ', seletor: 'aside.ck-faixa' },
] as const;

type Medida = {
  nome: string;
  aberto: string | undefined;
  vis: string;
  op: string;
  disp: string;
  rect: string;
  /** Assinatura da build — ver decisão 2 no cabeçalho. */
  base: string | null;
};

function mede(seletor: string, nome: string): Medida | null {
  const el = document.querySelector<HTMLElement>(seletor);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const filho = el.firstElementChild;
  return {
    nome,
    aberto: el.dataset.aberto,
    vis: cs.visibility,
    op: Number(cs.opacity).toFixed(2),
    disp: cs.display,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','),
    base: filho ? getComputedStyle(filho).flexBasis : null,
  };
}

export function Regua() {
  const [leitura, setLeitura] = useState<Medida[]>([]);
  const [latencia, setLatencia] = useState<string>('—');
  const ultima = useRef('');
  const tocouEm = useRef(0);

  useEffect(() => {
    const manda = (o: unknown) => {
      fetch('/api/regua', { method: 'POST', body: JSON.stringify(o), keepalive: true }).catch(
        () => {},
      );
    };

    // -- latência: do dedo até a superfície virar ---------------------------
    const aoTocar = () => {
      tocouEm.current = performance.now();
    };
    document.addEventListener('pointerdown', aoTocar, true);

    const observador = new MutationObserver((mudancas) => {
      if (!tocouEm.current) return;
      for (const m of mudancas) {
        const alvo = m.target as HTMLElement;
        const qual = SUPERFICIES.find((s) => alvo.matches(s.seletor));
        if (!qual) continue;
        const ms = Math.round(performance.now() - tocouEm.current);
        tocouEm.current = 0;
        const texto = `${qual.nome.trim()} ${alvo.dataset.aberto === 'true' ? 'abriu' : 'fechou'} em ${ms}ms`;
        setLatencia(texto);
        manda({ tipo: 'latencia', texto, ms, url: location.pathname + location.search });
      }
    });
    observador.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-aberto'],
    });

    // -- estado: retrato a cada 400ms, só manda quando MUDA -----------------
    const tick = () => {
      const medidas = SUPERFICIES.map((s) => mede(s.seletor, s.nome)).filter(
        (m): m is Medida => m !== null,
      );
      setLeitura(medidas);
      const pacote = {
        tipo: 'estado',
        url: location.pathname + location.search,
        vp: `${window.innerWidth}x${window.innerHeight}`,
        medidas,
      };
      const chave = JSON.stringify(pacote);
      if (chave !== ultima.current) {
        ultima.current = chave;
        manda(pacote);
      }
    };
    tick();
    const id = window.setInterval(tick, 400);

    return () => {
      document.removeEventListener('pointerdown', aoTocar, true);
      observador.disconnect();
      window.clearInterval(id);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        // Acima de `--ck-z-toast` (50): a régua tem de ser lida mesmo com
        // superfície aberta por cima.
        zIndex: 60,
        pointerEvents: 'none',
        background: '#000',
        color: '#0f0',
        font: '10px/1.35 ui-monospace, monospace',
        padding: '6px 8px calc(6px + env(safe-area-inset-bottom, 0px))',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {[
        `⏱ ${latencia}`,
        ...leitura.map(
          (m) => `${m.nome} ${m.aberto} vis:${m.vis} op:${m.op} base:${m.base} [${m.rect}]`,
        ),
      ].join('\n')}
    </div>
  );
}
