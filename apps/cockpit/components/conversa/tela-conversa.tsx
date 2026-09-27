'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { ChaveDeVisual } from './chave-de-visual';
import { EsferaConversa } from './esfera-conversa';
import { falasVisiveis, leituraDaConversa, rotuloDaAcao } from './leitura-da-conversa';
import { MolduraConversa } from './moldura-conversa';
import type { Cena } from './moldura-estado';
import { pecasDoVisual } from './preferencia-visual';
import styles from './tela-conversa.module.css';
import { useModoConversa } from './use-modo-conversa';
import { useVisualConversa } from './use-visual-conversa';

/** Segundos de espera pelo Zé, uma atualização por segundo (não por quadro). */
function useSegundosDeEspera(esperando: boolean) {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    if (!esperando) return;
    const inicio = performance.now();
    const relogio = window.setInterval(() => setSegundos(Math.floor((performance.now() - inicio) / 1000)), 1000);
    return () => {
      window.clearInterval(relogio);
      setSegundos(0);
    };
  }, [esperando]);
  return segundos;
}

function Reticencias() {
  return (
    <span className={styles.reticencias} aria-label="transcrevendo">
      <span>•</span>
      <span>•</span>
      <span>•</span>
    </span>
  );
}

export function TelaConversa({ slug, nome }: { slug: string; nome: string }) {
  const modo = useModoConversa(slug);
  const [visual, escolheVisual] = useVisualConversa();
  const zonaRef = useRef<HTMLDivElement>(null);

  const preparacaoFalhou = modo.preparacao === 'falhou';
  const cena: Cena = modo.preparacao === 'preparando' ? 'preparando' : modo.conversa.estado;
  const ativa = cena !== 'parado' && cena !== 'erro' && cena !== 'preparando';
  const leitura = leituraDaConversa({
    cena,
    preparacaoFalhou,
    abrindoMicrofone: modo.abrindoMicrofone,
    falaDetectada: modo.falaDetectada,
    fone: modo.fone,
    motivo: modo.conversa.motivo,
  });
  const falas = falasVisiveis(cena);
  const pecas = pecasDoVisual(visual, cena);
  const segundos = useSegundosDeEspera(cena === 'esperandoZe');
  const aviso = [modo.aviso, preparacaoFalhou ? modo.erroPreparacao : null]
    .find((texto) => texto && texto !== leitura.detalhe);
  const notas = [
    modo.streamStatus === 'reconnecting' ? 'Reconectando ao agente…' : null,
    ativa && !modo.wakeLockSuportado ? 'Este navegador não mantém a tela acesa.' : null,
    ativa && modo.wakeLockFalhou ? 'Não consegui manter a tela acesa.' : null,
    cena === 'parado' && modo.tempoCargaMs !== null
      ? `Detector pronto em ${(modo.tempoCargaMs / 1000).toFixed(1).replace('.', ',')} s`
      : null,
  ].filter(Boolean);

  return (
    <main
      className={styles.tela}
      data-estado={modo.conversa.estado}
      data-cena={cena}
      data-opcao={visual.opcao}
      data-variacao={visual.variacao}
    >
      {pecas.moldura ? (
        <MolduraConversa
          cena={pecas.moldura.cena}
          variacao={pecas.moldura.variacao}
          leNivel={modo.leNivel}
          zonaDoTexto={zonaRef}
        />
      ) : null}

      <div ref={zonaRef} className={styles.zona}>
        <header className={styles.topo}>
          <Link href={`/agente/${slug}`} className={styles.voltar}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Voltar
          </Link>
          <div className={styles.direita}>
            <span className={styles.agente}>{nome}</span>
            <ChaveDeVisual visual={visual} escolhe={escolheVisual} />
          </div>
        </header>

        {pecas.esfera ? (
          <EsferaConversa cena={pecas.esfera.cena} variacao={pecas.esfera.variacao} leNivel={modo.leNivel} />
        ) : null}

        <section className={styles.leitura} aria-live="polite" aria-atomic="true">
          <div className={styles.linhaDoTitulo}>
            <h1 className={styles.titulo}>{leitura.titulo}</h1>
            {cena === 'esperandoZe' && segundos > 0 ? <span className={styles.tempo}>{segundos} s</span> : null}
          </div>
          <p className={styles.detalhe}>{leitura.detalhe}</p>
        </section>

        <section className={styles.falas}>
          {falas.voce && (cena === 'transcrevendo' || modo.ultimaTranscricao) ? (
            <div className={styles.fala} data-fala="voce" data-forma={cena === 'transcrevendo' ? 'cheia' : falas.voce}>
              <span className={styles.quem}>Você disse</span>
              <p>{cena === 'transcrevendo' ? <Reticencias /> : `“${modo.ultimaTranscricao}”`}</p>
            </div>
          ) : null}
          {falas.ze && modo.respostaDoZe ? (
            <div className={styles.fala} data-fala="ze" data-forma={cena === 'interrompendo' ? 'pausada' : 'cheia'}>
              <span className={styles.quem}>{nome}</span>
              <p>{modo.respostaDoZe}</p>
            </div>
          ) : null}
        </section>

        {aviso || notas.length > 0 ? (
          <div className={styles.notas}>
            {aviso ? <p role="alert" className={styles.alerta}>{aviso}</p> : null}
            {notas.map((nota) => <p key={nota}>{nota}</p>)}
          </div>
        ) : null}
      </div>

      <footer className={styles.dock}>
        <div className={styles.fone}>
          <label className={styles.chaveFone}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
              <path d="M21 16a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3zM3 16a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H3z" />
            </svg>
            Estou de fone
            <input
              type="checkbox"
              role="switch"
              className={styles.interruptor}
              checked={modo.fone}
              onChange={(evento) => modo.mudarFone(evento.target.checked)}
            />
            <span className={styles.trilho} aria-hidden="true" />
          </label>
          <p className={styles.dica}>
            {modo.fone ? 'Falar por cima interrompe a resposta.' : 'Espero a resposta terminar para ouvir.'}
          </p>
        </div>

        {ativa ? (
          <button type="button" onClick={modo.parar} className={styles.acao}>
            Encerrar conversa
          </button>
        ) : (
          <button
            type="button"
            onClick={modo.comecar}
            disabled={modo.preparacao !== 'pronto'}
            className={styles.acao}
            data-primaria=""
          >
            {rotuloDaAcao(cena, preparacaoFalhou)}
          </button>
        )}
      </footer>
    </main>
  );
}
