'use client';

/**
 * O QUE O APARELHO DO RICA RESPONDE — uma tela, um print, sem chute.
 *
 * O cockpit tem dois regimes de altura (ver `sincroniza-altura-do-viewport.tsx`)
 * e a documentação não fecha em qual deles o iPhone dele cai quando abre pelo
 * ícone salvo do Chrome. Aqui ele abre, tira um print em cada caminho — ícone,
 * Chrome, Safari — e os três viram medida.
 *
 * Página de medição, fora do fluxo: nada aqui é consumido pelo app.
 */
import { useEffect, useRef, useState } from 'react';

type Medida = { rotulo: string; valor: string };

function suporta(regra: string): string {
  return typeof CSS !== 'undefined' && CSS.supports(regra) ? 'sim' : 'NÃO';
}

export default function Diagnostico() {
  const [medidas, setMedidas] = useState<Medida[]>([]);
  const [regime, setRegime] = useState<Medida[]>([]);
  const dvh = useRef<HTMLDivElement>(null);
  const svh = useRef<HTMLDivElement>(null);
  const lvh = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const modos = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];
    const modoAtivo = modos.find((m) => window.matchMedia(`(display-mode: ${m})`).matches);
    const apple = (navigator as Navigator & { standalone?: boolean }).standalone;
    // O mesmo teste que o app usa para escolher o regime.
    const modoAplicativo = window.matchMedia('(display-mode: standalone)').matches || apple === true;

    setRegime([
      { rotulo: 'display-mode', valor: modoAtivo ?? '(nenhum)' },
      { rotulo: 'navigator.standalone', valor: String(apple) },
      { rotulo: 'o app vai', valor: modoAplicativo ? 'MEDIR a altura' : 'usar o 100dvh do CSS' },
      { rotulo: 'field-sizing', valor: suporta('field-sizing: content') },
      { rotulo: 'overflow-anchor', valor: suporta('overflow-anchor: auto') },
      { rotulo: 'scrollend', valor: 'onscrollend' in window ? 'sim' : 'NÃO' },
      { rotulo: 'pixels por ponto', valor: String(window.devicePixelRatio) },
    ]);

    const lê = () => {
      const doc = document.scrollingElement;
      const publicada =
        document.documentElement.style.getPropertyValue('--ck-viewport-altura') || '(não publicada)';
      setMedidas([
        { rotulo: 'innerHeight', valor: `${window.innerHeight}` },
        { rotulo: 'viewport visual', valor: `${Math.round(window.visualViewport?.height ?? 0)}` },
        { rotulo: 'deslocamento do visual', valor: `${Math.round(window.visualViewport?.offsetTop ?? 0)}` },
        { rotulo: '100dvh', valor: `${Math.round(dvh.current?.getBoundingClientRect().height ?? 0)}` },
        { rotulo: '100svh', valor: `${Math.round(svh.current?.getBoundingClientRect().height ?? 0)}` },
        { rotulo: '100lvh', valor: `${Math.round(lvh.current?.getBoundingClientRect().height ?? 0)}` },
        { rotulo: '--ck-viewport-altura', valor: publicada },
        { rotulo: 'rolagem sobrando', valor: `${Math.round((doc?.scrollHeight ?? 0) - (doc?.clientHeight ?? 0))}` },
        { rotulo: 'rolado em', valor: `${Math.round(window.scrollY)}` },
      ]);
    };

    lê();
    const timer = window.setInterval(lê, 250);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main
      style={{
        minHeight: '100dvh',
        padding: '16px',
        fontFamily: 'var(--ck-font-mono)',
        fontSize: '15px',
        lineHeight: 1.6,
        color: 'var(--ck-text-primary)',
        background: 'var(--ck-surface-canvas)',
      }}
    >
      {/* Réguas: existem só para serem medidas. */}
      <div ref={dvh} style={{ position: 'fixed', visibility: 'hidden', width: 1, height: '100dvh' }} />
      <div ref={svh} style={{ position: 'fixed', visibility: 'hidden', width: 1, height: '100svh' }} />
      <div ref={lvh} style={{ position: 'fixed', visibility: 'hidden', width: 1, height: '100lvh' }} />

      <h1 style={{ fontSize: '17px', fontWeight: 600, marginBottom: '4px' }}>Diagnóstico do aparelho</h1>
      <p style={{ color: 'var(--ck-text-secondary)', marginBottom: '16px' }}>
        Print desta tela em cada caminho: ícone, Chrome, Safari.
      </p>

      <Secao titulo="Regime" itens={regime} />

      <p style={{ color: 'var(--ck-text-secondary)', marginTop: '16px' }}>
        Toque no campo abaixo e tire o segundo print com o teclado aberto.
      </p>
      <textarea
        rows={2}
        placeholder="toque aqui"
        style={{
          width: '100%',
          marginTop: '8px',
          marginBottom: '16px',
          padding: '10px',
          // 16px é o piso: abaixo disso o WebKit dá zoom ao focar e falseia a medida.
          fontSize: '16px',
          fontFamily: 'var(--ck-font-sans)',
          color: 'var(--ck-text-primary)',
          background: 'var(--ck-surface-composer)',
          border: '1px solid var(--ck-edge-composer)',
          borderRadius: '10px',
        }}
      />

      <Secao titulo="Alturas, ao vivo" itens={medidas} />

      <p style={{ marginTop: '16px', color: 'var(--ck-text-secondary)', wordBreak: 'break-all' }}>
        {typeof navigator !== 'undefined' ? navigator.userAgent : ''}
      </p>
    </main>
  );
}

function Secao({ titulo, itens }: { titulo: string; itens: Medida[] }) {
  return (
    <section>
      <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{titulo}</h2>
      {itens.map((item) => (
        <div key={item.rotulo} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ color: 'var(--ck-text-secondary)' }}>{item.rotulo}</span>
          <strong style={{ fontWeight: 600 }}>{item.valor}</strong>
        </div>
      ))}
    </section>
  );
}
