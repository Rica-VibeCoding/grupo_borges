/**
 * O Chrome do agente ao vivo, na largura da tela e na proporção do quadro.
 *
 * No controle: toque = clique na coordenada escalada; arrastar o dedo (ou a roda
 * do mouse) = rolagem, somada e mandada a cada 100 ms. Sem controle o toque não
 * vai ao Chrome, e a tela diz por quê. `touch-action: none` aqui: o dedo no quadro
 * nunca dá zoom nem rola a página.
 *
 * A moldura carrega o estado: âmbar no controle (o toque age), apagada vendo.
 * Cor nunca sozinha — a barra de estado diz a palavra.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import {
  limitaRolagem,
  pinca,
  pontoNaImagem,
  pxDaPagina,
  VISTA_INTEIRA,
  type Entrada,
  type Quadro,
  type Vista,
} from '@/lib/tela-agente';

/** Abaixo disto o dedo tocou; acima, arrastou. */
const FOLGA_DO_TOQUE_PX = 8;
const RITMO_DA_ROLAGEM_MS = 100;

type Gesto = { id: number; x0: number; y0: number; x: number; y: number; arrastando: boolean };
type Marca = { id: number; x: number; y: number };
type Pinca = { distancia: number; meio: { x: number; y: number }; vista: Vista };

export function QuadroAoVivo({
  quadro,
  noControle,
  rotulo,
  enviar,
  aoTocarSemControle,
}: {
  quadro: Quadro | null;
  noControle: boolean;
  rotulo: string;
  enviar: (entrada: Entrada) => Promise<boolean>;
  aoTocarSemControle: () => void;
}) {
  const imagem = useRef<HTMLImageElement>(null);
  const moldura = useRef<HTMLDivElement>(null);
  const gesto = useRef<Gesto | null>(null);
  // Dedos na tela agora; com dois, a pinça amplia o quadro aqui, sem ir ao Chrome.
  const dedos = useRef(new Map<number, { x: number; y: number }>());
  const pincaEmCurso = useRef<Pinca | null>(null);
  const [vista, setVista] = useState<Vista>(VISTA_INTEIRA);
  const vistaAtual = useRef(vista);
  // Assumir e devolver mudam a proporção da página: a ampliação de antes não serve mais.
  const proporcao = quadro ? `${quadro.largura}x${quadro.altura}` : null;
  useEffect(() => {
    setVista(VISTA_INTEIRA);
  }, [proporcao]);
  useEffect(() => {
    vistaAtual.current = vista;
  }, [vista]);
  const rolagem = useRef({ dx: 0, dy: 0, x: 0.5, y: 0.5, timer: 0 });
  const [marca, setMarca] = useState<Marca | null>(null);
  // O último quadro em ref: o gesto usa o id DA IMAGEM EXIBIDA, não um velho do fechamento.
  const atual = useRef(quadro);
  useEffect(() => {
    atual.current = quadro;
  }, [quadro]);

  function ponto(clienteX: number, clienteY: number) {
    const img = imagem.current;
    const q = atual.current;
    if (!img || !q) return null;
    return pontoNaImagem(clienteX, clienteY, img.getBoundingClientRect(), { largura: q.largura, altura: q.altura });
  }

  function agendaRolagem(dx: number, dy: number, onde: { x: number; y: number }) {
    const r = rolagem.current;
    r.dx += dx;
    r.dy += dy;
    r.x = onde.x;
    r.y = onde.y;
    if (r.timer) return;
    r.timer = window.setTimeout(() => {
      r.timer = 0;
      const q = atual.current;
      const delta_x = limitaRolagem(r.dx);
      const delta_y = limitaRolagem(r.dy);
      r.dx = 0;
      r.dy = 0;
      if (!q || (delta_x === 0 && delta_y === 0)) return;
      void enviar({ tipo: 'rolagem', quadro: q.id, x: r.x, y: r.y, delta_x, delta_y });
    }, RITMO_DA_ROLAGEM_MS);
  }

  // Roda do mouse: o React registra `wheel` como passivo, e sem `preventDefault` a página rola junto.
  useEffect(() => {
    const img = imagem.current;
    if (!img || !noControle) return;
    const aoRolar = (e: WheelEvent) => {
      const onde = ponto(e.clientX, e.clientY);
      if (!onde) return;
      e.preventDefault();
      const escala = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      agendaRolagem(e.deltaX * escala, e.deltaY * escala, onde);
    };
    img.addEventListener('wheel', aoRolar, { passive: false });
    return () => img.removeEventListener('wheel', aoRolar);
    // `ponto` e `agendaRolagem` leem refs: não precisam reassinar.
  }, [noControle, quadro !== null]);

  useEffect(() => () => window.clearTimeout(rolagem.current.timer), []);

  function meioEDistancia() {
    const [a, b] = [...dedos.current.values()];
    const caixa = moldura.current!.getBoundingClientRect();
    return {
      meio: { x: (a.x + b.x) / 2 - caixa.left, y: (a.y + b.y) / 2 - caixa.top },
      distancia: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  function aoDescer(e: React.PointerEvent<HTMLImageElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dedos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.current.size === 2 && moldura.current) {
      // Segundo dedo: o gesto vira pinça; nada de clique nem rolagem no Chrome.
      gesto.current = null;
      pincaEmCurso.current = { ...meioEDistancia(), vista: vistaAtual.current };
      return;
    }
    if (dedos.current.size === 1 && !pincaEmCurso.current) {
      gesto.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, arrastando: false };
    }
  }

  function aoMover(e: React.PointerEvent<HTMLImageElement>) {
    if (dedos.current.has(e.pointerId)) dedos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pincaEmCurso.current;
    if (p && dedos.current.size >= 2 && moldura.current) {
      const agora = meioEDistancia();
      const caixa = moldura.current.getBoundingClientRect();
      setVista(pinca(p.vista, p.distancia, agora.distancia, p.meio, agora.meio, { largura: caixa.width, altura: caixa.height }));
      return;
    }
    const g = gesto.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.arrastando && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > FOLGA_DO_TOQUE_PX) g.arrastando = true;
    // Só o dedo e a caneta rolam arrastando; o mouse tem a roda.
    if (g.arrastando && noControle && e.pointerType !== 'mouse') {
      const q = atual.current;
      const onde = ponto(g.x0, g.y0);
      if (q && onde && imagem.current) {
        const escala = pxDaPagina(imagem.current.getBoundingClientRect().width, q.viewport.largura);
        // Dedo sobe, página desce: o mesmo sentido do iPhone.
        agendaRolagem((g.x - e.clientX) * escala, (g.y - e.clientY) * escala, onde);
      }
    }
    g.x = e.clientX;
    g.y = e.clientY;
  }

  function aoSubir(e: React.PointerEvent<HTMLImageElement>) {
    dedos.current.delete(e.pointerId);
    // Depois da pinça, o dedo que sobra não clica: o gesto acaba quando todos saem.
    if (pincaEmCurso.current) {
      if (dedos.current.size === 0) pincaEmCurso.current = null;
      return;
    }
    const g = gesto.current;
    gesto.current = null;
    if (!g || g.id !== e.pointerId || g.arrastando) return;
    const onde = ponto(e.clientX, e.clientY);
    const q = atual.current;
    if (!onde || !q || !moldura.current) return;
    if (!noControle) return aoTocarSemControle();
    const caixa = moldura.current.getBoundingClientRect();
    setMarca({ id: Date.now(), x: e.clientX - caixa.left, y: e.clientY - caixa.top });
    void enviar({ tipo: 'clique', quadro: q.id, x: onde.x, y: onde.y });
  }

  function aoCancelar(e: React.PointerEvent<HTMLImageElement>) {
    dedos.current.delete(e.pointerId);
    if (dedos.current.size === 0) pincaEmCurso.current = null;
    gesto.current = null;
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <div
        ref={moldura}
        className="relative w-full overflow-hidden"
        style={{
          aspectRatio: quadro ? `${quadro.largura} / ${quadro.altura}` : '16 / 9',
          borderRadius: 'var(--ck-radius-frame)',
          background: 'var(--ck-surface-canvas)',
          // A moldura é o estado: 2px âmbar no controle, fio funcional vendo.
          boxShadow: noControle ? '0 0 0 2px var(--ck-state-attention)' : '0 0 0 1px var(--ck-edge-hairline)',
          transition: 'box-shadow var(--ck-dur-fast) var(--ck-ease)',
        }}
      >
        {quadro ? (
          // Quadro ao vivo em data URL, 2 por segundo: `<img>` cru, o next/image não serve.
          <img
            ref={imagem}
            src={`data:image/jpeg;base64,${quadro.jpeg}`}
            width={quadro.largura}
            height={quadro.altura}
            alt={`Tela ao vivo do ${rotulo}`}
            draggable={false}
            onPointerDown={aoDescer}
            onPointerMove={aoMover}
            onPointerUp={aoSubir}
            onPointerCancel={aoCancelar}
            onContextMenu={(e) => e.preventDefault()}
            className="block h-full w-full select-none"
            style={{
              objectFit: 'contain',
              touchAction: 'none',
              transformOrigin: '0 0',
              transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})`,
              WebkitTouchCallout: 'none',
              cursor: noControle ? 'pointer' : 'default',
            }}
          />
        ) : null}
        <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {marca ? (
            <motion.span
              key={marca.id}
              aria-hidden="true"
              className="pointer-events-none absolute"
              initial={{ opacity: 0.9, scale: 0.5 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              onAnimationComplete={() => setMarca((m) => (m?.id === marca.id ? null : m))}
              style={{
                left: marca.x - 14,
                top: marca.y - 14,
                width: 28,
                height: 28,
                borderRadius: 'var(--ck-radius-pill)',
                border: '2px solid var(--ck-state-attention)',
              }}
            />
          ) : null}
        </AnimatePresence>
        </MotionConfig>
      </div>
      {/* No dedo, a dica da pinça; ampliado, o caminho de volta. */}
      <div className="flex items-center" style={{ gap: 'var(--ck-space-3)', minHeight: 'var(--ck-touch-min)' }}>
        <p className="hidden min-w-0 flex-1 text-pretty pointer-coarse:block" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
          {vista.escala > 1 ? `Ampliado ${vista.escala.toFixed(1).replace('.', ',')}×.` : 'Dois dedos ampliam a imagem.'}
          {noControle ? ' Um dedo rola a página; um toque clica.' : ''}
        </p>
        {vista.escala > 1 ? (
          <button
            type="button"
            onClick={() => setVista(VISTA_INTEIRA)}
            className="ck-veil ck-foco-fio ml-auto shrink-0"
            style={{
              minHeight: 'var(--ck-touch-min)',
              padding: '0 var(--ck-space-4)',
              borderRadius: 'var(--ck-radius-pill)',
              border: '1px solid var(--ck-edge-functional)',
              fontSize: 'var(--ck-text-sm)',
              color: 'var(--ck-text-primary)',
            }}
          >
            Ver inteira
          </button>
        ) : null}
      </div>
    </div>
  );
}
