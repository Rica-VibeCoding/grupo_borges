'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { usaFrota } from '../shell/frota-provider';
import { LinkAbrePainel } from '../shell/superficie-otimista';

import { BotaoLigar } from './botao-ligar';
import { BotaoMudo } from './botao-mudo';
import { useMudoConversa } from './use-mudo-conversa';
import { usePublicaDetalheDaConversa } from './contexto-configuracao-conversa';
import { conviteDaTela } from './direcao-da-voz';
import { EsferaConversa } from './esfera-conversa';
import type { EscutaNoPensar } from './esfera-estado';
import { cenaVisivel } from './estado-da-vez';
import { legendaDaVez } from './legenda-da-voz';
import { avisoDaTela, leituraDaConversa, rotuloDaAcao, voceDisseParaLeitor } from './leitura-da-conversa';
import { MolduraConversa } from './moldura-conversa';
import type { Cena } from './moldura-estado';
import { pecasDoVisual } from './preferencia-visual';
import { PilulaDoAgente } from './retrato-da-voz';
import { CHAVE_FONE, CHAVE_TEXTO } from './preferencias-da-conversa';
import styles from './tela-conversa.module.css';
import { ConviteDaVoz, LegendaDaVoz, SinalDoToque } from './texto-da-voz';
import { acaoDoToque, toqueConta } from './toque-da-conversa';
import { useGestosDaConversa } from './use-gestos-da-conversa';
import { useModoConversa } from './use-modo-conversa';
import { falaNaEspera } from '@/lib/conversa/maquina';
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

/**
 * A tela limpa: o visual ocupa tudo e a tela inteira é o botão — um toque inicia; no turno
 * do Zé, um toque o interrompe; fora dele, um toque para; na vez do Rica, o dedo parado segura a vez. Os botões viraram gestos: arrastar
 * para a direita volta ao chat de texto (é a rolagem do pager); para cima está livre. No alto, a foto do agente com o nome e o estado, numa pílula,
 * abre a gaveta do agente, com as configurações. O
 * estado é a palavra ao lado do nome, na cor da vez. Parada, a tela escreve uma linha pequena
 * e o aro pulsa; andando, a legenda (sua fala, a resposta) mora logo abaixo da animação, só
 * com "Mostrar texto". O que pede ação vai no cartão do pé. O título e a frase explicativa
 * saíram da tela e ficaram para o leitor de tela.
 *
 * Mora no painel da direita do pager (`pager-do-agente.tsx`), montada também fora da tela.
 * `visivel` é o painel com algum pedaço à vista: só então o visual liga o WebGL. `ativa` é o
 * painel assentado: sair dele fecha o microfone e deixa o Zé seguir — sem freio, a voz tocando.
 */
export function TelaConversa({
  slug,
  nome,
  ativa,
  visivel,
}: {
  slug: string;
  nome: string;
  ativa: boolean;
  visivel: boolean;
}) {
  const [visual] = useVisualConversa();
  const [fone] = useChaveDaConversa(CHAVE_FONE);
  const [texto] = useChaveDaConversa(CHAVE_TEXTO);
  const { mudo, pronto, mudaMudo } = useMudoConversa();
  const modo = useModoConversa(slug, fone, !pronto || mudo, !ativa);
  const topoRef = useRef<HTMLElement>(null);
  const zonaRef = useRef<HTMLDivElement>(null);
  const faixaDeBaixoRef = useRef<HTMLSpanElement>(null);
  const ultimoToqueRef = useRef<number | null>(null);
  // Desligado pelo painel (o mesmo `offline` que o card e o composer leem): vence qualquer cena.
  // Agente ainda não carregado na frota não conta — a esfera não pisca apagada na abertura.
  const { agents } = usaFrota();
  const desligado = agents.find((a) => a.slug === slug)?.status === 'offline';

  const preparacaoFalhou = modo.preparacao === 'falhou';
  const cena: Cena = desligado ? 'desligado' : modo.preparacao === 'preparando' ? 'preparando' : modo.conversa.estado;
  // O visual e a palavra do estado mostram a verdade do turno dele: pensando, trabalhando ou
  // falando — este só com som saindo; e o agente ocupado, na cor própria em vez da do erro.
  // Toque, leitura e legenda seguem a cena da conversa. Voltando da recarga com a conversa aberta,
  // antes do toque que retoma, o visual já mostra a verdade lida do stream: pensando, trabalhando
  // ou a resposta pronta (`retomada-da-conversa.ts`).
  const retomando = !desligado && modo.retomada !== null;
  // Falando por cima do pensar dele, o visual segue no turno dele; a fala é só a mistura na esfera.
  const falaPorCima = cena === 'ouvindo' && falaNaEspera(modo.conversa);
  const vista = desligado
    ? cena
    : modo.retomada
    ? cenaVisivel({ cena: modo.retomada.cena, tocando: false, ferramenta: modo.ferramenta })
    : cenaVisivel({ cena: falaPorCima ? 'esperandoZe' : cena, tocando: modo.tocando, ferramenta: modo.ferramenta, motivo: modo.conversa.motivo });
  const acao = acaoDoToque(cena, preparacaoFalhou, modo.rodando);
  // Com ele pensando e fone, o microfone está aberto e a fala entra na fila dele: a esfera mostra isso
  // (`esfera-estado.ts`) — só com a tela à vista e sem mudo, que é quando ouvir é verdade.
  const ouveDeVerdade = ativa && pronto && !mudo && !retomando && fone;
  const escuta: EscutaNoPensar = !ouveDeVerdade
    ? 'nao'
    : cena === 'esperandoZe'
      ? 'aberta'
      : falaPorCima
        ? 'falando'
        : 'nao';
  const leitura = leituraDaConversa({
    cena: desligado ? cena : (modo.retomada?.cena ?? cena), // voltando da recarga, o leitor de tela diz o mesmo que o visual
    preparacaoFalhou,
    abrindoMicrofone: modo.abrindoMicrofone,
    falaDetectada: modo.falaDetectada,
    fone,
    motivo: modo.conversa.motivo,
  });
  const primeiroNome = nome.split(' ')[0] || nome;
  const convite = conviteDaTela(cena, preparacaoFalhou, retomando);
  const pecas = pecasDoVisual(visual, vista);
  const segundos = useSegundosDeEspera(texto && cena === 'esperandoZe');
  const aviso = avisoDaTela(
    {
      cena,
      preparacaoFalhou,
      motivo: modo.conversa.motivo,
      aviso: modo.aviso,
      wakeLockSuportado: modo.wakeLockSuportado,
      wakeLockFalhou: modo.wakeLockFalhou,
    },
    texto,
  );
  const notas = texto && modo.streamStatus === 'reconnecting' ? ['Reconectando ao agente…'] : [];
  // O número técnico foi para as configurações (a gaveta do agente): a tela principal só convida.
  const detalheTecnico =
    modo.tempoCargaMs !== null ? `Detector pronto em ${(modo.tempoCargaMs / 1000).toFixed(1).replace('.', ',')} s` : null;
  usePublicaDetalheDaConversa(ativa, detalheTecnico);
  const voceDisse = texto ? null : voceDisseParaLeitor(cena, modo.fala.firme);
  const legenda = legendaDaVez({ cena, texto, fala: modo.fala, falaDoZe: modo.falaDoZe, naFila: modo.naFila });
  // O pulso que chama o toque, preso à animação de fora: a esfera ou o aro solto.
  const sinal = cena === 'parado' && !preparacaoFalhou;

  // Sair para o chat (o pager assenta nele, pelo dedo ou pelo voltar do navegador) nunca freia o
  // Zé: só o toque freia. No turno dele, o microfone fecha (`fora` em `useModoConversa`), a voz
  // segue tocando no chat e, na volta, a conversa continua de onde está. Só ouvindo, sem turno
  // dele, não há o que seguir: a conversa para. Transcrevendo, a fala recém-dita segue para ele.
  // A saída para outra página para quando a tela desmonta.
  const pararAoSairRef = useRef(() => {});
  pararAoSairRef.current = () => {
    if (acao === 'parar' && cena === 'ouvindo') modo.parar();
    else if (retomando) modo.descartaRetomada(); // sair da tela sem retomar também encerra
  };
  useEffect(() => {
    if (!ativa) pararAoSairRef.current();
  }, [ativa]);
  // Desligaram o agente com a conversa aberta: o microfone fecha e a conversa encerra — não há
  // quem ouça. Religado, ela volta parada, esperando o toque.
  const encerrarAoDesligarRef = useRef(() => {});
  encerrarAoDesligarRef.current = () => {
    if (modo.conversa.estado !== 'parado') modo.parar();
    else if (modo.retomada) modo.descartaRetomada();
  };
  useEffect(() => {
    if (desligado) encerrarAoDesligarRef.current();
  }, [desligado]);
  // Dedo parado 500 ms na vez do Rica segura a vez: a contagem do silêncio para até soltar.
  const cenaRef = useRef(cena);
  cenaRef.current = cena;
  const { segura } = modo;
  const { gestos, cliqueConta } = useGestosDaConversa({
    faixaDeBaixoRef,
    leCena: () => cenaRef.current,
    aoSegurar: () => segura(true),
    aoSoltar: () => segura(false),
  });

  // Síncrono no clique: começar destrava áudio, microfone e Wake Lock no mesmo gesto.
  const toca = (evento: MouseEvent<HTMLButtonElement>) => {
    if (!cliqueConta(evento)) return;
    if (acao === 'nada' || !toqueConta(evento.timeStamp, ultimoToqueRef.current)) return;
    ultimoToqueRef.current = evento.timeStamp;
    if (acao === 'comecar') modo.comecar();
    else if (acao === 'interromper') modo.interromper();
    else modo.parar();
  };

  return (
    <main
      className={styles.tela}
      data-estado={modo.conversa.estado}
      data-cena={cena}
      data-vista={vista}
      data-retomada={retomando ? '' : undefined}
      data-opcao={visual.opcao}
      data-variacao={visual.variacao}
      data-texto={texto ? 'visivel' : 'oculto'}
      data-visivel={visivel ? '' : undefined}
      data-segurando={modo.segurando ? 'sim' : undefined}
      {...gestos}
    >
      {pecas.moldura && visivel ? (
        <MolduraConversa
          cena={pecas.moldura.cena}
          variacao={pecas.moldura.variacao}
          leNivel={modo.leNivel}
          zonaDoTexto={texto ? zonaRef : topoRef}
        />
      ) : null}

      <div ref={zonaRef} className={styles.zona}>
        <header
          ref={topoRef}
          className={styles.topo}
          onClick={(evento) => evento.stopPropagation()}
          onPointerDown={(evento) => evento.stopPropagation()}
          onPointerUp={(evento) => evento.stopPropagation()}
        >
          <LinkAbrePainel
            href={`/agente/${encodeURIComponent(slug)}?painel=detalhes`}
            rotulo={`configurações de ${nome}`}
            className={styles.abrePainel}
          >
            <PilulaDoAgente slug={slug} nome={nome} cena={vista} segundos={segundos} />
          </LinkAbrePainel>
        </header>

        {pecas.esfera && visivel ? (
          <EsferaConversa cena={pecas.esfera.cena} escuta={escuta} variacao={pecas.esfera.variacao} leNivel={modo.leNivel}>
            {sinal ? <SinalDoToque forma="esfera" /> : null}
          </EsferaConversa>
        ) : (
          // Fora da vista a esfera não desenha, mas o palco guarda o tamanho dela: nada pula ao entrar.
          <div className={styles.palco} data-palco={pecas.esfera ? 'esfera' : 'solto'}>
            {sinal && !pecas.esfera ? <SinalDoToque forma="solto" /> : null}
          </div>
        )}

        <div className={styles.rodape} data-rodape="">
          {desligado ? (
            <BotaoLigar slug={slug} />
          ) : convite ? (
            <ConviteDaVoz linha={convite} pulsa={cena === 'parado'} />
          ) : (
            <LegendaDaVoz trechos={legenda} nome={primeiroNome} />
          )}
        </div>

        <section className="sr-only" aria-live="polite" aria-atomic="true">
          <p>{leitura.titulo}</p>
          <p>{leitura.detalhe}</p>
          {voceDisse ? <p>{voceDisse}</p> : null}
        </section>

        {notas.length > 0 ? (
          <div className={styles.notas}>
            {notas.map((nota) => <p key={nota}>{nota}</p>)}
          </div>
        ) : null}
      </div>

      <BotaoMudo mudo={mudo} aoMudar={mudaMudo} ativo={ativa && pronto} />
      <button
        type="button"
        className={styles.toque}
        aria-label={acao === 'interromper' ? 'Interromper o agente' : rotuloDaAcao(cena, preparacaoFalhou, retomando)}
        aria-disabled={acao === 'nada' ? true : undefined}
        data-acao={acao}
        onClick={toca}
      />

      <span ref={faixaDeBaixoRef} className={styles.faixaDeBaixo} aria-hidden="true" />

      {aviso ? (
        <footer className={styles.dock}>
          <p role="alert" className={styles.aviso}>
            <span>
              {aviso.linha}
              {aviso.detalhe ? <small>{aviso.detalhe}</small> : null}
            </span>
          </p>
        </footer>
      ) : null}
    </main>
  );
}
