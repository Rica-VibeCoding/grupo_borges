'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import styles from './esfera-conversa.module.css';
import {
  REGULADOR_INICIAL,
  alvosComEscuta,
  aproximaRitmo,
  aproximaCor,
  aproximaLugar,
  coresComEscuta,
  lugarAssentou,
  lugarNoPalco,
  regulaQuadro,
  ritmoDaEsfera,
  taxaDaTroca,
  tomDoClarao,
  type Cor,
  type EscutaNoPensar,
  type Lugar,
} from './esfera-estado';
import { FRAG_ESFERA } from './esfera-shader';
import {
  animaSozinha,
  aproxima,
  assentou,
  comPensarAoMeio,
  corDoTom,
  fatorDeAproximacao,
  ouveVolume,
  suavizaNivel,
  tomDaCena,
  type Cena,
} from './moldura-estado';
import type { VariacaoEsfera } from './preferencia-visual';
import { useMovimentoReduzido } from './use-movimento-reduzido';
import { criaPublicadorDeNivel, criaTelaWebGL, leCoresDoTema, ouveTrocaDeDpr } from './webgl-tela';

const TOKENS = {
  voce: '--ck-conversa-voce',
  ze: '--ck-conversa-ze',
  prepara: '--ck-conversa-prepara',
  erro: '--ck-conversa-erro',
  ocupado: '--ck-conversa-ocupado',
  desligado: '--ck-conversa-desligado',
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
  escuta = 'nao',
  variacao,
  leNivel,
  mini = false,
  children,
}: {
  cena: Cena;
  /** O microfone aberto com ele pensando (`esfera-estado.ts`). */
  escuta?: EscutaNoPensar;
  variacao: VariacaoEsfera;
  leNivel: () => number;
  /** O que mora no centro do palco, por cima da luz (o sinal do toque). */
  children?: ReactNode;
  /** A MESMA esfera, em miniatura, presa à própria caixa — a da linha do agora
   *  no fim do feed (Rica, 02/10: "Ctrl+C, Ctrl+V e ajustar para ficar
   *  pequenininho"). O desenho deixa de cobrir a tela e não entra na troca de
   *  vista da tela de voz. */
  mini?: boolean;
}) {
  const palcoRef = useRef<HTMLDivElement>(null);
  const cenaRef = useRef(cena);
  const escutaRef = useRef(escuta);
  const trocaRef = useRef(false);
  const tomDoClaraoRef = useRef(tomDaCena(cena));
  const acordaRef = useRef<() => void>(() => {});
  const [semWebGL, setSemWebGL] = useState(false);
  const reduzido = useMovimentoReduzido();

  useEffect(() => {
    if (cenaRef.current === cena) return;
    tomDoClaraoRef.current = tomDoClarao(cenaRef.current, cena);
    cenaRef.current = cena;
    trocaRef.current = true;
    acordaRef.current();
  }, [cena]);

  useEffect(() => {
    escutaRef.current = escuta;
    acordaRef.current();
  }, [escuta]);

  useEffect(() => {
    const palco = palcoRef.current;
    if (!palco || semWebGL) return;
    // Canvas novo a cada montagem: o contexto liberado de um canvas não volta.
    const canvas = document.createElement('canvas');
    canvas.className = mini ? styles.desenhoMini : styles.desenho;
    palco.append(canvas);
    const tela = criaTelaWebGL(canvas, FRAG_ESFERA, ESCALA, { transparente: true });
    if (!tela) {
      canvas.remove();
      setSemWebGL(true);
      return;
    }
    const { gl, u } = tela;
    const cores = comPensarAoMeio(leCoresDoTema(TOKENS));
    const coresDe = (c: Cena) => {
      const { corpo, brilho, borda } = coresComEscuta(c, escutaRef.current);
      const [r, g, b] = corDoTom(cores, corpo);
      return { corpo: [r * brilho, g * brilho, b * brilho] as Cor, borda: corDoTom(cores, borda) as Cor };
    };

    let esc = 1;
    let altura = 0;
    let alvoLugar: Lugar | null = null;
    let lugar: Lugar | null = null;
    const mede = () => {
      esc = tela.ajusta();
      // Tamanho pelo LAYOUT (`client*`), que ignora o `scale` da entrada da
      // mini; as posições do palco seguem pelo `getBoundingClientRect` — a tela
      // cheia não tem transform no caminho.
      const largura = canvas.clientWidth;
      altura = canvas.clientHeight;
      // Na miniatura, o raio é proporção da caixa: o piso de 24px da tela cheia
      // não cabe numa linha do feed. E a faixa do palco vai para BEM fora da
      // caixa: o shader apaga a luz nos últimos 48px da faixa, e a caixa inteira
      // tem 28 — com a faixa justa, a esfera sumia.
      if (mini) {
        alvoLugar = { x: largura / 2, y: altura / 2, raio: largura * 0.36, topo: -100, base: altura + 100 };
      } else {
        const caixa = canvas.getBoundingClientRect();
        const p = palco.getBoundingClientRect();
        alvoLugar = lugarNoPalco(
          { left: p.left - caixa.left, top: p.top - caixa.top, width: p.width, height: p.height },
          largura,
        );
      }
      lugar ??= alvoLugar;
    };

    let pesos = alvosComEscuta(cenaRef.current, escutaRef.current);
    let { corpo, borda } = coresDe(cenaRef.current);
    let nivel = 0, tempo = TEMPO_PARADO, clarao = 0;
    let ritmo = ritmoDaEsfera(cenaRef.current);
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
      const alvo = alvosComEscuta(c, escutaRef.current);
      const taxa = taxaDaTroca(c);
      pesos = aproxima(pesos, alvo, passoDt, taxa);
      const k = fatorDeAproximacao(passoDt, taxa);
      const alvoCor = coresDe(c);
      corpo = aproximaCor(corpo, alvoCor.corpo, k);
      borda = aproximaCor(borda, alvoCor.borda, k);
      if (lugar && alvoLugar) lugar = aproximaLugar(lugar, alvoLugar, fatorDeAproximacao(passoDt, 5));
      // A escuta aberta também ouve: o toque seu na esfera cresce com a sua voz.
      const comVoz = ouveVolume(c) || escutaRef.current === 'aberta';
      nivel = reduzido ? (comVoz ? 0.5 : 0) : suavizaNivel(nivel, comVoz ? leNivel() : 0, dt);
      // A troca de estado muda a velocidade da matéria aos poucos: nada de tranco na esfera.
      if (!reduzido) {
        ritmo = aproximaRitmo(ritmo, ritmoDaEsfera(c), dt);
        tempo += dt * ritmo;
      }
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
        gl.uniform1f(u('uApaga'), pesos.apaga);
        gl.uniform3fv(u('uCorpo'), corpo);
        gl.uniform3fv(u('uBorda'), borda);
        gl.uniform3fv(u('uCorPulso'), cores[tomDoClaraoRef.current]);
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
    const largaDpr = ouveTrocaDeDpr(aoMudar);
    mede();
    acordaRef.current();

    return () => {
      cancelAnimationFrame(quadro);
      acordaRef.current = () => {};
      observador.disconnect();
      window.visualViewport?.removeEventListener('resize', aoMudar);
      window.removeEventListener('scroll', aoMudar);
      largaDpr();
      canvas.removeEventListener('webglcontextlost', aoPerderContexto);
      tela.libera();
      canvas.remove();
    };
  }, [variacao, reduzido, leNivel, semWebGL, mini]);

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
      className={mini ? styles.palcoMini : styles.palco}
      data-visual="esfera"
      data-variacao={variacao}
      data-movimento={reduzido ? 'parado' : 'vivo'}
      data-desenho={semWebGL ? 'css' : 'webgl'}
    >
      {semWebGL ? <div className={mini ? `${styles.reserva} ${styles.reservaMini}` : styles.reserva} data-tom={tomDaCena(cena)} data-variacao={variacao} /> : null}
      {cena === 'desligado' ? <span className={styles.brasa} /> : null}
      {children}
    </div>
  );
}
