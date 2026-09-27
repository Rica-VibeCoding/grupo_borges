'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import styles from './moldura-conversa.module.css';
import {
  alvosDaMoldura,
  animaSozinha,
  aproxima,
  assentou,
  caudaDaEspera,
  ouveVolume,
  suavizaNivel,
  tomDaCena,
  velocidadeDaOrbita,
  type Cena,
  type Pesos,
} from './moldura-estado';
import { FRAG_MOLDURA } from './moldura-shader';
import type { VariacaoMoldura } from './preferencia-visual';
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
/** Canto da tela de um iPhone moderno, em px CSS. */
const RAIO = 55;
/** O brilho é macio: 0,6 da resolução basta e poupa a GPU. */
const ESCALA = 0.6;

function leMargensSeguras(dentro: HTMLElement) {
  const sonda = document.createElement('div');
  sonda.style.cssText =
    'position:absolute;visibility:hidden;padding:0 var(--ck-safe-right) var(--ck-safe-bottom) var(--ck-safe-left)';
  dentro.append(sonda);
  const estilo = getComputedStyle(sonda);
  const margens = {
    pe: parseFloat(estilo.paddingBottom) || 0,
    lado: Math.max(parseFloat(estilo.paddingLeft) || 0, parseFloat(estilo.paddingRight) || 0),
  };
  sonda.remove();
  return margens;
}

/**
 * A borda da tela como indicador. Nenhum `setState` por quadro: o volume vem de
 * `leNivel()` (uma ref) e o desenho roda no `requestAnimationFrame`, que dorme
 * nas cenas paradas. `data-nivel` (10 Hz) existe para o E2E medir o volume.
 */
export function MolduraConversa({
  cena,
  variacao,
  leNivel,
  zonaDoTexto,
}: {
  cena: Cena;
  variacao: VariacaoMoldura;
  leNivel: () => number;
  zonaDoTexto: RefObject<HTMLElement | null>;
}) {
  const raizRef = useRef<HTMLDivElement>(null);
  const cenaRef = useRef(cena);
  const trocaRef = useRef({ desde: 0, clarao: false });
  const acordaRef = useRef<() => void>(() => {});
  const [semWebGL, setSemWebGL] = useState(false);
  const reduzido = useMovimentoReduzido();

  useEffect(() => {
    if (cenaRef.current === cena) return;
    cenaRef.current = cena;
    trocaRef.current = { desde: performance.now(), clarao: true };
    acordaRef.current();
  }, [cena]);

  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz || semWebGL) return;
    // Canvas novo a cada montagem: o contexto liberado de um canvas não volta,
    // e reaproveitar o mesmo elemento (StrictMode, troca de variação) o deixaria morto.
    const canvas = document.createElement('canvas');
    raiz.append(canvas);
    const tela = criaTelaWebGL(canvas, FRAG_MOLDURA, ESCALA);
    if (!tela) {
      canvas.remove();
      setSemWebGL(true);
      return;
    }
    const { gl, u } = tela;
    const cores = leCoresDoTema(TOKENS);
    let esc = 1;
    let margens = { pe: 0, lado: 0 };
    let zona = { topo: 0, base: 0 };
    const mede = () => {
      esc = tela.ajusta();
      margens = leMargensSeguras(raiz);
      const caixa = zonaDoTexto.current?.getBoundingClientRect();
      const topo = canvas.getBoundingClientRect().top;
      zona = caixa ? { topo: caixa.top - topo - 48, base: caixa.bottom - topo + 48 } : { topo: 0, base: 0 };
    };

    let pesos: Pesos = alvosDaMoldura(cenaRef.current);
    let nivel = 0, tempo = 0, orbita = 0, prog = 0, clarao = 0;
    let quadro = 0, antes = 0;
    const publicaNivel = criaPublicadorDeNivel(raiz);

    const passo = (agora: number) => {
      quadro = 0;
      const dt = antes ? Math.min(0.05, (agora - antes) / 1000) : 1 / 60;
      antes = agora;
      const c = cenaRef.current;
      if (trocaRef.current.clarao) {
        trocaRef.current.clarao = false;
        clarao = reduzido ? 0 : 1;
      }
      const alvo = alvosDaMoldura(c);
      pesos = aproxima(pesos, alvo, reduzido ? Number.POSITIVE_INFINITY : dt);
      const comVoz = ouveVolume(c);
      nivel = reduzido ? (comVoz ? 0.5 : 0) : suavizaNivel(nivel, comVoz ? leNivel() : 0, dt);
      if (!reduzido) {
        tempo += dt;
        orbita = (orbita + dt * velocidadeDaOrbita(c)) % (Math.PI * 2);
        prog = (prog + dt * 0.35) % 1;
      }
      clarao = Math.max(0, clarao - dt * 1.8);
      const naCena = trocaRef.current.desde ? (agora - trocaRef.current.desde) / 1000 : 0;

      gl.uniform2f(u('uRes'), canvas.width, canvas.height);
      gl.uniform1f(u('uEsc'), esc);
      gl.uniform1f(u('uRaio'), RAIO);
      gl.uniform1f(u('uPe'), margens.pe);
      gl.uniform1f(u('uLado'), margens.lado);
      gl.uniform1f(u('uZonaTopo'), zona.topo);
      gl.uniform1f(u('uZonaBase'), zona.base);
      gl.uniform1f(u('uT'), tempo);
      gl.uniform1f(u('uNivel'), nivel);
      gl.uniform1f(u('uProg'), prog);
      gl.uniform1f(u('uJanela'), reduzido ? 1 : 0.3);
      gl.uniform1f(u('uOrbita'), reduzido ? 1.2 : orbita);
      gl.uniform1f(u('uCauda'), caudaDaEspera(c, naCena));
      gl.uniform1f(u('uPulso'), clarao * clarao);
      gl.uniform1f(u('uAurora'), variacao === 'aurora' ? 1 : 0);
      gl.uniform4f(u('uA'), pesos.voce, pesos.ze, pesos.pensa, pesos.prepara);
      gl.uniform4f(u('uB'), pesos.erro, pesos.gelo, pesos.parado, 0);
      gl.uniform3fv(u('uFundo'), cores.fundo);
      gl.uniform3fv(u('uVoce'), cores.voce);
      gl.uniform3fv(u('uZe'), cores.ze);
      gl.uniform3fv(u('uPensa'), cores.pensa);
      gl.uniform3fv(u('uPrepara'), cores.prepara);
      gl.uniform3fv(u('uErro'), cores.erro);
      gl.uniform3fv(u('uCorPulso'), cores[tomDaCena(c)]);
      tela.desenha();

      publicaNivel(nivel, agora);
      const continua = !reduzido && (animaSozinha(c) || !assentou(pesos, alvo) || clarao > 0.001);
      if (continua) quadro = requestAnimationFrame(passo);
      else antes = 0;
    };

    acordaRef.current = () => {
      if (!quadro) quadro = requestAnimationFrame(passo);
    };
    const aoMudarTamanho = () => {
      mede();
      acordaRef.current();
    };
    const aoPerderContexto = (evento: Event) => {
      evento.preventDefault();
      setSemWebGL(true);
    };
    const observador = new ResizeObserver(aoMudarTamanho);
    observador.observe(raiz);
    if (zonaDoTexto.current) observador.observe(zonaDoTexto.current);
    window.visualViewport?.addEventListener('resize', aoMudarTamanho);
    canvas.addEventListener('webglcontextlost', aoPerderContexto);
    mede();
    acordaRef.current();

    return () => {
      cancelAnimationFrame(quadro);
      acordaRef.current = () => {};
      observador.disconnect();
      window.visualViewport?.removeEventListener('resize', aoMudarTamanho);
      canvas.removeEventListener('webglcontextlost', aoPerderContexto);
      tela.libera();
      canvas.remove();
    };
  }, [variacao, reduzido, leNivel, zonaDoTexto, semWebGL]);

  // Reserva sem WebGL: o gradiente em CSS ainda acompanha o volume, por uma
  // variável escrita direto no elemento (nenhum render de React).
  useEffect(() => {
    const raiz = raizRef.current;
    if (!semWebGL || !raiz || reduzido) return;
    const publicaNivel = criaPublicadorDeNivel(raiz);
    let quadro = 0;
    let antes = 0;
    let nivel = 0;
    const passo = (agora: number) => {
      const dt = antes ? Math.min(0.05, (agora - antes) / 1000) : 1 / 60;
      antes = agora;
      nivel = suavizaNivel(nivel, ouveVolume(cenaRef.current) ? leNivel() : 0, dt);
      raiz.style.setProperty('--nivel-da-voz', nivel.toFixed(3));
      publicaNivel(nivel, agora);
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [semWebGL, reduzido, leNivel]);

  return (
    <div
      ref={raizRef}
      aria-hidden="true"
      className={styles.raiz}
      data-visual="moldura"
      data-variacao={variacao}
      data-movimento={reduzido ? 'parado' : 'vivo'}
      data-desenho={semWebGL ? 'css' : 'webgl'}
    >
      {semWebGL ? <div className={styles.reserva} data-tom={tomDaCena(cena)} /> : null}
    </div>
  );
}
