'use client';

import { useEffect, useRef } from 'react';

import styles from './retrato-da-voz.module.css';
import { animaSozinha, ouveVolume, suavizaNivel, tomDaCena, velocidadeDaOrbita, type Cena } from './moldura-estado';
import { useMovimentoReduzido } from './use-movimento-reduzido';

const TRACOS = 96;

/** Ruído determinístico: o mesmo quadro sai igual toda vez (e na captura). */
function ruido(x: number) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Comprimento (px) e opacidade de cada traço. Parado, o anel só marca as horas; ouvindo, acende
 * pela metade de baixo (a sua voz sobe do pé, como na moldura); falando, acende inteiro; pensando,
 * um trecho claro gira em volta.
 */
function traco(cena: Cena, k: number, t: number, nivel: number): [number, number] {
  const a = (k / TRACOS) * Math.PI * 2;
  const baixo = (1 - Math.cos(a)) / 2;
  const marca = k % 8 === 0;
  if (cena === 'ouvindo' || cena === 'interrompendo') {
    const v = (ruido(k + Math.floor(t * 12)) * 0.7 + 0.3 * Math.sin(k * 0.5 + t * 6) ** 2) * (0.35 + nivel * 0.9);
    return [6 + Math.pow(baixo, 1.6) * 24 * v, 0.15 + 0.85 * Math.pow(baixo, 1.2)];
  }
  if (cena === 'falando') {
    const v = (ruido(k * 3 + Math.floor(t * 10)) * 0.6 + 0.4 * Math.abs(Math.sin(k * 0.26 + t * 5))) * (0.4 + nivel * 0.8);
    return [7 + 20 * v, 0.45 + 0.55 * Math.min(1, v)];
  }
  if (cena === 'transcrevendo' || cena === 'esperandoZe') {
    const giro = (t * velocidadeDaOrbita(cena)) % (Math.PI * 2);
    const perto = Math.max(0, Math.cos(a - giro)) ** 6;
    return [6 + 8 * perto, 0.16 + 0.7 * perto];
  }
  return [marca ? 8 : 5, marca ? 0.35 : 0.14];
}

/**
 * O medidor da voz em volta da foto (direção Eclipse). Canvas 2D, um laço só enquanto a cena se
 * mexe; parado e erro são um quadro fixo. A cor vem do CSS (`color` do próprio canvas), então o
 * tom continua morando no `globals.css`.
 */
export function AnelDaVoz({ cena, raio, leNivel }: { cena: Cena; raio: number; leNivel: () => number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduzido = useMovimentoReduzido();
  const lado = (raio + 34) * 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = lado * dpr;
    canvas.height = lado * dpr;
    const cor = getComputedStyle(canvas).color;
    let nivel = 0;
    let quadro = 0;
    let antes = performance.now();
    const inicio = antes;

    const desenha = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, lado, lado);
      ctx.strokeStyle = cor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let k = 0; k < TRACOS; k++) {
        const [comprimento, opacidade] = traco(cena, k, t, nivel);
        const a = (k / TRACOS) * Math.PI * 2;
        const sen = Math.sin(a);
        const cos = -Math.cos(a);
        ctx.globalAlpha = opacidade;
        ctx.beginPath();
        ctx.moveTo(lado / 2 + sen * raio, lado / 2 + cos * raio);
        ctx.lineTo(lado / 2 + sen * (raio + comprimento), lado / 2 + cos * (raio + comprimento));
        ctx.stroke();
      }
    };

    if (reduzido || !animaSozinha(cena)) {
      nivel = ouveVolume(cena) ? 0.5 : 0;
      desenha(0.35);
      return;
    }
    const passo = (agora: number) => {
      const dt = (agora - antes) / 1000;
      antes = agora;
      nivel = suavizaNivel(nivel, ouveVolume(cena) ? leNivel() : 0, dt);
      desenha((agora - inicio) / 1000);
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [cena, lado, reduzido, leNivel]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.anel}
      data-tom={tomDaCena(cena)}
      style={{ width: lado, height: lado, margin: -lado / 2 }}
      aria-hidden="true"
    />
  );
}
