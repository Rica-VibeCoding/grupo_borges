'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './esfera-conversa.module.css';
import {
  REGULADOR_INICIAL,
  alvosDaEsfera,
  aproximaCor,
  aproximaLugar,
  coresDaEsfera,
  lugarAssentou,
  lugarNoPalco,
  regulaQuadro,
  ritmoDaEsfera,
  type Cor,
  type Lugar,
} from './esfera-estado';
import { FRAG_ESFERA } from './esfera-shader';
import {
  animaSozinha,
  aproxima,
  assentou,
  fatorDeAproximacao,
  ouveVolume,
  suavizaNivel,
  tomDaCena,
  type Cena,
} from './moldura-estado';
import type { VariacaoEsfera } from './preferencia-visual';
import { useMovimentoReduzido } from './use-movimento-reduzido';
import { criaPublicadorDeNivel, criaTelaWebGL, leCoresDoTema } from './webgl-tela';

const TOKENS = {
  voce: '--ck-conversa-voce',
  ze: '--ck-conversa-ze',
  pensa: '--ck-conversa-pensa',
  prepara: '--ck-conversa-prepara',
  erro: '--ck-conversa-erro',
  fundo: '--ck-surface-canvas',
} as const;
/** A esfera pede mais definição que a Moldura: 0,75 da resolução. */
const ESCALA = 0.75;
/** Quadro fixo do movimento reduzido: o mesmo instante do ruído sempre. */
const TEMPO_PARADO = 1.3;

const iguais = (a: Cor, b: Cor) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 0.01;

/**
 * A Esfera: ocupa o palco entre o cabeçalho e as palavras, mas o desenho cobre
 * a tela inteira, atrás de tudo — assim ela desliza quando o palco muda sem ser
 * cortada, e a Moldura (na combinação) aparece por trás. Nenhum `setState` por
 * quadro; roda a 30 quadros por segundo quando o aparelho não aguenta 60.
 */
export function EsferaConversa({
  cena,
  variacao,
  leNivel,
}: {
  cena: Cena;
  variacao: VariacaoEsfera;
  leNivel: () => number;
}) {
  const palcoRef = useRef<HTMLDivElement>(null);
  const cenaRef = useRef(cena);
  const trocaRef = useRef(false);
  const acordaRef = useRef<() => void>(() => {});
  const [semWebGL, setSemWebGL] = useState(false);
  const reduzido = useMovimentoReduzido();

  useEffect(() => {
    if (cenaRef.current === cena) return;
    cenaRef.current = cena;
    trocaRef.current = true;
    acordaRef.current();
  }, [cena]);

  useEffect(() => {
    const palco = palcoRef.current;
    if (!palco || semWebGL) return;
    // Canvas novo a cada montagem: o contexto liberado de um canvas não volta.
    const canvas = document.createElement('canvas');
    canvas.className = styles.desenho;
    palco.append(canvas);
    const tela = criaTelaWebGL(canvas, FRAG_ESFERA, ESCALA, { transparente: true });
    if (!tela) {
      canvas.remove();
      setSemWebGL(true);
      return;
    }
    const { gl, u } = tela;
    const cores = leCoresDoTema(TOKENS);
    const coresDe = (c: Cena) => {
      const { corpo, brilho, borda } = coresDaEsfera(c);
      const [r, g, b] = cores[corpo];
      return { corpo: [r * brilho, g * brilho, b * brilho] as Cor, borda: cores[borda] as Cor };
    };

    let esc = 1;
    let altura = 0;
    let alvoLugar: Lugar | null = null;
    let lugar: Lugar | null = null;
    const mede = () => {
      esc = tela.ajusta();
      const caixa = canvas.getBoundingClientRect();
      const p = palco.getBoundingClientRect();
      altura = caixa.height;
      alvoLugar = lugarNoPalco(
        { left: p.left - caixa.left, top: p.top - caixa.top, width: p.width, height: p.height },
        caixa.width,
      );
      lugar ??= alvoLugar;
    };

    let pesos = alvosDaEsfera(cenaRef.current);
    let { corpo, borda } = coresDe(cenaRef.current);
    let nivel = 0, tempo = TEMPO_PARADO, clarao = 0;
    let quadro = 0, antes = 0;
    let regulador = REGULADOR_INICIAL;
    const publicaNivel = criaPublicadorDeNivel(palco);

    const passo = (agora: number) => {
      quadro = 0;
      const intervalo = antes ? agora - antes : 1000 / 60;
      const dt = Math.min(0.05, intervalo / 1000);
      antes = agora;
      const c = cenaRef.current;
      if (trocaRef.current) {
        trocaRef.current = false;
        clarao = reduzido ? 0 : 1;
      }
      const passoDt = reduzido ? Number.POSITIVE_INFINITY : dt;
      const alvo = alvosDaEsfera(c);
      pesos = aproxima(pesos, alvo, passoDt, 6);
      const k = fatorDeAproximacao(passoDt, 6);
      const alvoCor = coresDe(c);
      corpo = aproximaCor(corpo, alvoCor.corpo, k);
      borda = aproximaCor(borda, alvoCor.borda, k);
      if (lugar && alvoLugar) lugar = aproximaLugar(lugar, alvoLugar, fatorDeAproximacao(passoDt, 5));
      const comVoz = ouveVolume(c);
      nivel = reduzido ? (comVoz ? 0.5 : 0) : suavizaNivel(nivel, comVoz ? leNivel() : 0, dt);
      if (!reduzido) tempo += dt * ritmoDaEsfera(c);
      clarao = Math.max(0, clarao - dt * 1.8);

      const assentado =
        assentou(pesos, alvo) &&
        iguais(corpo, alvoCor.corpo) &&
        iguais(borda, alvoCor.borda) &&
        (!lugar || !alvoLugar || lugarAssentou(lugar, alvoLugar));
      const continua = !reduzido && (animaSozinha(c) || !assentado || clarao > 0.001);
      regulador = regulaQuadro(regulador, agora, intervalo);

      // Último quadro antes de dormir sai sempre, mesmo que o teto de 30 o pulasse.
      if (lugar && (regulador.desenha || !continua)) {
        gl.uniform2f(u('uCentro'), lugar.x, altura - lugar.y);
        gl.uniform1f(u('uEsc'), esc);
        gl.uniform1f(u('uRaio'), lugar.raio);
        gl.uniform1f(u('uFaixaBaixo'), altura - lugar.base);
        gl.uniform1f(u('uFaixaAlto'), altura - lugar.topo);
        gl.uniform1f(u('uT'), tempo);
        gl.uniform1f(u('uNivel'), nivel);
        gl.uniform1f(u('uVidro'), variacao === 'vidro' ? 1 : 0);
        gl.uniform1f(u('uProg'), reduzido ? 0.6 : 0.5 - 0.5 * Math.cos(tempo * 1.8));
        gl.uniform1f(u('uPulso'), clarao * clarao);
        gl.uniform1f(u('uVoce'), pesos.voce);
        gl.uniform1f(u('uZe'), pesos.ze);
        gl.uniform1f(u('uCalma'), pesos.calma);
        gl.uniform1f(u('uCristal'), pesos.cristal);
        gl.uniform1f(u('uColapso'), pesos.colapso);
        gl.uniform1f(u('uEnche'), pesos.enche);
        gl.uniform3fv(u('uCorpo'), corpo);
        gl.uniform3fv(u('uBorda'), borda);
        gl.uniform3fv(u('uCorPulso'), cores[tomDaCena(c)]);
        gl.uniform3fv(u('uFundo'), cores.fundo);
        tela.desenha();
      }

      publicaNivel(nivel, agora);
      if (continua) quadro = requestAnimationFrame(passo);
      else antes = 0;
    };

    acordaRef.current = () => {
      if (!quadro) quadro = requestAnimationFrame(passo);
    };
    const aoMudar = () => {
      mede();
      acordaRef.current();
    };
    const aoPerderContexto = (evento: Event) => {
      evento.preventDefault();
      setSemWebGL(true);
    };
    const observador = new ResizeObserver(aoMudar);
    observador.observe(palco);
    observador.observe(canvas);
    window.visualViewport?.addEventListener('resize', aoMudar);
    window.addEventListener('scroll', aoMudar, { passive: true });
    canvas.addEventListener('webglcontextlost', aoPerderContexto);
    mede();
    acordaRef.current();

    return () => {
      cancelAnimationFrame(quadro);
      acordaRef.current = () => {};
      observador.disconnect();
      window.visualViewport?.removeEventListener('resize', aoMudar);
      window.removeEventListener('scroll', aoMudar);
      canvas.removeEventListener('webglcontextlost', aoPerderContexto);
      tela.libera();
      canvas.remove();
    };
  }, [variacao, reduzido, leNivel, semWebGL]);

  // Reserva sem WebGL: um círculo em CSS que ainda cresce com a voz, por uma
  // variável escrita direto no elemento (nenhum render de React).
  useEffect(() => {
    const palco = palcoRef.current;
    if (!semWebGL || !palco || reduzido) return;
    const publicaNivel = criaPublicadorDeNivel(palco);
    let quadro = 0;
    let antes = 0;
    let nivel = 0;
    const passo = (agora: number) => {
      const dt = antes ? Math.min(0.05, (agora - antes) / 1000) : 1 / 60;
      antes = agora;
      nivel = suavizaNivel(nivel, ouveVolume(cenaRef.current) ? leNivel() : 0, dt);
      palco.style.setProperty('--nivel-da-voz', nivel.toFixed(3));
      publicaNivel(nivel, agora);
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [semWebGL, reduzido, leNivel]);

  return (
    <div
      ref={palcoRef}
      aria-hidden="true"
      className={styles.palco}
      data-visual="esfera"
      data-variacao={variacao}
      data-movimento={reduzido ? 'parado' : 'vivo'}
      data-desenho={semWebGL ? 'css' : 'webgl'}
    >
      {semWebGL ? <div className={styles.reserva} data-tom={tomDaCena(cena)} data-variacao={variacao} /> : null}
    </div>
  );
}
