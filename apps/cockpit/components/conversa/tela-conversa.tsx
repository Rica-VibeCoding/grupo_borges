'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

import { ConfiguracaoDaConversa } from './configuracao-da-conversa';
import { EsferaConversa } from './esfera-conversa';
import {
  avisoQuePedeAcao,
  falasVisiveis,
  leituraDaConversa,
  rotuloDaAcao,
  voceDisseParaLeitor,
} from './leitura-da-conversa';
import { MolduraConversa } from './moldura-conversa';
import type { Cena } from './moldura-estado';
import { pecasDoVisual } from './preferencia-visual';
import { CHAVE_FONE, CHAVE_TEXTO } from './preferencias-da-conversa';
import styles from './tela-conversa.module.css';
import { acaoDoToque, toqueConta } from './toque-da-conversa';
import { useDicaDosGestos, useGestosDaConversa } from './use-gestos-da-conversa';
import { useModoConversa } from './use-modo-conversa';
import { useChaveDaConversa, useVisualConversa } from './use-preferencias-conversa';

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

/**
 * A tela limpa: o visual ocupa tudo e a tela inteira é o botão — um toque inicia, um
 * toque para. Os botões viraram gestos: arrastar para a direita volta ao chat de texto,
 * para cima abre as configurações. No cabeçalho, só o ícone do chat (e o botão das
 * configurações, fora da vista até o teclado chegar). O texto (estado, sua fala, a
 * resposta) só aparece com "Mostrar texto"; sem ele, continua existindo para o leitor de tela.
 */
export function TelaConversa({ slug, nome }: { slug: string; nome: string }) {
  const [visual, escolheVisual] = useVisualConversa();
  const [fone, mudaFone] = useChaveDaConversa(CHAVE_FONE);
  const [texto, mudaTexto] = useChaveDaConversa(CHAVE_TEXTO);
  const modo = useModoConversa(slug, fone);
  const topoRef = useRef<HTMLElement>(null);
  const zonaRef = useRef<HTMLDivElement>(null);
  const faixaDeBaixoRef = useRef<HTMLSpanElement>(null);
  const ultimoToqueRef = useRef<number | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const router = useRouter();
  const dica = useDicaDosGestos();

  const preparacaoFalhou = modo.preparacao === 'falhou';
  const cena: Cena = modo.preparacao === 'preparando' ? 'preparando' : modo.conversa.estado;
  const acao = acaoDoToque(cena, preparacaoFalhou);
  const leitura = leituraDaConversa({
    cena,
    preparacaoFalhou,
    abrindoMicrofone: modo.abrindoMicrofone,
    falaDetectada: modo.falaDetectada,
    fone,
    motivo: modo.conversa.motivo,
  });
  const falas = falasVisiveis(cena);
  const pecas = pecasDoVisual(visual, cena);
  const segundos = useSegundosDeEspera(texto && cena === 'esperandoZe');
  const aviso = avisoQuePedeAcao({
    cena,
    preparacaoFalhou,
    motivo: modo.conversa.motivo,
    aviso: modo.aviso,
    wakeLockSuportado: modo.wakeLockSuportado,
    wakeLockFalhou: modo.wakeLockFalhou,
  });
  // Com texto, o título já diz o erro; a linha do pé não repete.
  const linhaDoAviso = texto && (cena === 'erro' || preparacaoFalhou) ? null : aviso;
  const notas = texto
    ? [
        modo.streamStatus === 'reconnecting' ? 'Reconectando ao agente…' : null,
        cena === 'parado' && modo.tempoCargaMs !== null
          ? `Detector pronto em ${(modo.tempoCargaMs / 1000).toFixed(1).replace('.', ',')} s`
          : null,
      ].filter(Boolean)
    : [];
  const voceDisse = texto ? null : voceDisseParaLeitor(cena, modo.ultimaTranscricao);

  // Sair para o chat com a conversa andando é o parar, freio incluso — já no gesto, sem
  // esperar a rota nova chegar (a saída por outro caminho para quando a tela desmonta).
  const chat = `/agente/${slug}`;
  const { parar } = modo;
  const paraAoSair = useCallback(() => {
    if (acao === 'parar') parar();
  }, [acao, parar]);
  const vaiAoChat = useCallback(() => {
    paraAoSair();
    router.push(chat);
  }, [chat, paraAoSair, router]);
  // Ctrl/Cmd-clique abre o chat em outra aba: a conversa desta segue.
  const clicaNoChat = (evento: MouseEvent<HTMLAnchorElement>) => {
    if (!evento.metaKey && !evento.ctrlKey && !evento.shiftKey) paraAoSair();
  };
  const abreConfiguracoes = useCallback(() => setConfigAberta(true), []);
  const { gestos, cliqueConta } = useGestosDaConversa({ faixaDeBaixoRef, aoChat: vaiAoChat, aoConfiguracoes: abreConfiguracoes });

  // Síncrono no clique: começar destrava áudio, microfone e Wake Lock no mesmo gesto.
  const toca = (evento: MouseEvent<HTMLButtonElement>) => {
    if (!cliqueConta(evento)) return;
    if (acao === 'nada' || !toqueConta(evento.timeStamp, ultimoToqueRef.current)) return;
    ultimoToqueRef.current = evento.timeStamp;
    if (acao === 'comecar') modo.comecar();
    else modo.parar();
  };

  return (
    <main
      className={styles.tela}
      data-estado={modo.conversa.estado}
      data-cena={cena}
      data-opcao={visual.opcao}
      data-variacao={visual.variacao}
      data-texto={texto ? 'visivel' : 'oculto'}
      {...gestos}
    >
      {pecas.moldura ? (
        <MolduraConversa
          cena={pecas.moldura.cena}
          variacao={pecas.moldura.variacao}
          leNivel={modo.leNivel}
          zonaDoTexto={texto ? zonaRef : topoRef}
        />
      ) : null}

      <div ref={zonaRef} className={styles.zona}>
        <header ref={topoRef} className={styles.topo}>
          <div className={styles.direita}>
            <span className={styles.agente}>{nome}</span>
            <ConfiguracaoDaConversa
              visual={visual}
              escolheVisual={escolheVisual}
              fone={fone}
              mudaFone={mudaFone}
              texto={texto}
              mudaTexto={mudaTexto}
              aberta={configAberta}
              mudaAberta={setConfigAberta}
            />
            <Link href={chat} className={styles.chat} aria-label={`Abrir o chat de texto com ${nome}`} onClick={clicaNoChat}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
            </Link>
          </div>
        </header>

        {pecas.esfera ? (
          <EsferaConversa cena={pecas.esfera.cena} variacao={pecas.esfera.variacao} leNivel={modo.leNivel} />
        ) : null}

        <section className={texto ? styles.leitura : 'sr-only'} aria-live="polite" aria-atomic="true">
          <div className={styles.linhaDoTitulo}>
            <h1 className={styles.titulo}>{leitura.titulo}</h1>
            {cena === 'esperandoZe' && segundos > 0 ? <span className={styles.tempo}>{segundos} s</span> : null}
          </div>
          <p className={styles.detalhe}>{leitura.detalhe}</p>
          {voceDisse ? <p>{voceDisse}</p> : null}
        </section>

        {texto ? (
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
        ) : null}

        {notas.length > 0 ? (
          <div className={styles.notas}>
            {notas.map((nota) => <p key={nota}>{nota}</p>)}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className={styles.toque}
        aria-label={rotuloDaAcao(cena, preparacaoFalhou)}
        aria-disabled={acao === 'nada' ? true : undefined}
        data-acao={acao}
        onClick={toca}
      />

      {dica ? (
        <p className={styles.dica} aria-hidden="true">
          Arraste para cima: configurações
        </p>
      ) : null}
      <span ref={faixaDeBaixoRef} className={styles.faixaDeBaixo} aria-hidden="true" />

      {linhaDoAviso ? (
        <footer className={styles.dock}>
          <p role="alert" className={styles.aviso}>{linhaDoAviso}</p>
        </footer>
      ) : null}
    </main>
  );
}
