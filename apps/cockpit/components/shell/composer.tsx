'use client';

/**
 * Composer — a caixa alta, controles por dentro (§12.1/§12.2).
 *
 * A referência do Rica pediu duas coisas com todas as letras: "chat input
 * maior com modelo em baixo" e o motor a um toque de onde se escreve. As
 * decisões que traduzem isso:
 *
 * 1. **Caixa alta com respiro**, não a linha fina que o v1 tinha. Os controles
 *    moram DENTRO dela, na base — não numa barra externa acima ou abaixo.
 * 2. **Modelo é texto, esforço é controle real.** O endpoint de esforço
 *    (`PATCH /{slug}/effort`) já existe e a lista de valores permitidos vem do
 *    back — então o seletor É funcional. O de modelo (`POST /{slug}/model`)
 *    também existe, mas troca de modelo tem consequência de sessão diferente
 *    por executor (Claude troca em runtime, Codex só na próxima execução —
 *    comentário do próprio `api.ts`), e decidir esse fluxo não é a camada
 *    visual desta rodada. Um controle que finge mudar o motor e não muda é
 *    pior que não ter controle (ordem explícita do Rica) — por isso o modelo
 *    aparece como VALOR REAL, não como botão morto fingindo interatividade.
 * 3. **O único elemento sólido é o envio.** Tudo ao redor — anexo, motor,
 *    microfone — é traço ou texto. É a hierarquia que a referência desenha:
 *    uma tela inteira de contorno com UM ponto de massa.
 *
 * O FIO NA BASE é a tradução visual das seis fases da §3.1 do contrato de
 * dados — ver `aparencia-envio.ts` para a régua completa. Resumo do porquê:
 * `aceito` e `confirmado` são hoje INDISTINGUÍVEIS na tela (é o defeito que
 * gerou texto pendurado sem aviso), e a distinção aqui não depende de ler
 * palavra nenhuma — depende do fio se mover, parar, ou sumir.
 *
 * ESFORÇO É AUTOSSUFICIENTE. A página que usa o Composer não precisa buscar
 * `/painel` antes: o próprio componente busca ao montar (`fetchAgentPainel`, a
 * mesma função que `cockpit-core` já expõe) e aplica a troca via
 * `patchAgentEffort`.
 *
 * NÃO EXISTE MODO DE DEMONSTRAÇÃO AQUI. O componente fala com o agente de
 * verdade e mostra o que ele está fazendo — nada de estado forçado, nada de
 * caminho que só a tela de teste exercita.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { fetchAgentPainel, patchAgentEffort } from '@grupo_borges/cockpit-core/api';

import { aparenciaDe, emTransito, rotulaAcao, type AcaoEnvio, type FaseEnvio } from './aparencia-envio';
import { copyText } from '../../lib/clipboard';
import { usaCompact } from '../../lib/compact';
import { usaAnexo } from '../../lib/usa-anexo';
import { usaEnvio } from '../../lib/usa-envio';
import { AvisoAnexo, BotaoAnexo, PainelAnexo } from './gaveta-anexo';
import { BarraCompact } from './barra-compact';
import { fallbackCopy } from '../renderers/copia-fallback';
import { descreveMotor, rotulaEsforco, type Motor } from './motor';
import { AlvoDeTrava, PainelDeCaptura } from './captura-voz';
import { usaGravador } from './usa-gravador';
import {
  aparenciaDaVoz,
  capturando,
  diagnosticaMicrofone,
  diagnosticaTranscricao,
  type FaseVoz,
  type Impedimento,
} from './voz';
import {
  IconeCopiar,
  IconeDescartar,
  IconeEnviar,
  IconeOnda,
  IconeParar,
  IconeReenviar,
} from './icones';

export type ComposerProps = {
  agentSlug: string;
  agentName: string;
  motor: Motor;
};

const ROTULO_ICONE: Record<AcaoEnvio, (props: { tamanho: number }) => React.ReactElement> = {
  reenviar: IconeReenviar,
  copiar: IconeCopiar,
  'tentar-de-novo': IconeReenviar,
};

/** O `/compact` com argumentos (`/compact foca no deploy`) também é compact —
 *  o que não pode casar é um `/compactar` hipotético ou a palavra no meio da
 *  frase. */
const COMPACT_RE = /^\s*\/compact(?:\s|$)/;

export function Composer({
  agentSlug,
  agentName,
  motor,
}: ComposerProps) {
  const [texto, setTexto] = useState('');
  const [trocandoEsforco, setTrocandoEsforco] = useState(false);
  // A máquina de seis fases é a da `lib/envio.ts`, dirigida pelo eco do stream:
  // `confirmado` só existe quando o item `user` VOLTA do servidor. Antes disto o
  // componente cantava `aceito` no 200 do POST e parava ali — que é o mesmo
  // "enviado" mentiroso do painel antigo, só que mais bonito.
  const envio = usaEnvio(agentSlug);
  const faseLocal = envio.estado.fase;
  const ultimoEnviado = envio.estado.fase === 'ocioso' ? '' : envio.estado.texto;
  const idAnuncio = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // O ANEXO tem máquina PRÓPRIA, não a de seis fases do texto. Ali a pergunta é
  // "o agente recebeu?", respondida só pelo eco no stream; aqui o `POST /file`
  // devolve `tmux_delivered` e o próprio arquivo aparece no feed — não existe
  // eco de anexo para casar. Ver o cabeçalho de `lib/usa-anexo.ts`.
  const anexo = usaAnexo(agentSlug);
  // O `+` mora dentro da caixa e a gaveta fora dela (o `overflow: hidden` do
  // form recortaria o painel). A ref costura os dois: é por ela que o `Escape`
  // devolve o foco ao botão que abriu.
  const botaoAnexoRef = useRef<HTMLButtonElement>(null);

  // O COMPACT trava o composer. Quem manda `/compact` é este componente (o
  // texto sai por `envio.enviar` como qualquer mensagem), então é aqui que a
  // espera COMEÇA; quem avisa que ela TERMINOU é o feed (o resumo chega no
  // stream) — a máquina compartilhada mora em `lib/compact.ts`. Enquanto ela
  // espera, digitar é proibido: uma mensagem no meio do compact corta o
  // resumo ao meio, que foi exatamente o acidente que gerou esta peça.
  const { estado: estadoCompact, iniciar: iniciarCompact, cancelar: cancelarCompact } =
    usaCompact(agentSlug);
  const travaCompact =
    estadoCompact.fase === 'compactando' || estadoCompact.fase === 'concluindo';
  // O `/compact` saiu mas o compact ainda não deu sinal — é a janela em que
  // um envio FALHADO significa "o compact nunca começou" e a espera morre.
  const compactPendenteRef = useRef(false);

  useEffect(() => {
    if (estadoCompact.fase === 'concluindo' || estadoCompact.fase === 'sem-retorno') {
      compactPendenteRef.current = false;
      return;
    }
    // `falhou` é certeza (o POST não foi aceito): o compact não existe e a
    // barra não pode esperar por um resumo que nunca virá. `nao-confirmado`
    // é ambiguidade — o texto PODE ter entrado — então a espera continua.
    if (faseLocal === 'falhou' && compactPendenteRef.current) {
      compactPendenteRef.current = false;
      cancelarCompact();
    }
  }, [faseLocal, estadoCompact.fase, cancelarCompact]);

  // Busca `/painel` uma vez ao montar. Não há mais caminho "controlado": o
  // valor na tela é sempre o do agente.
  const [esforcoBuscado, setEsforcoBuscado] = useState<{
    valor: string | null;
    permitido: string[];
  } | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchAgentPainel(agentSlug)
      .then((painel) => {
        if (vivo) setEsforcoBuscado({ valor: painel.effort.value, permitido: painel.effort.allowed });
      })
      .catch(() => {
        // Painel indisponível: o controle nasce ausente, não fingido. Sem
        // lista de valores permitidos não há o que oferecer.
        if (vivo) setEsforcoBuscado({ valor: null, permitido: [] });
      });
    return () => {
      vivo = false;
    };
  }, [agentSlug]);

  const esforcoValorEfetivo = esforcoBuscado?.valor ?? null;
  const esforcoPermitidoEfetivo = esforcoBuscado?.permitido ?? [];

  async function trocarEsforcoEfetivo(valor: string) {
    const anterior = esforcoBuscado;
    setEsforcoBuscado((atual) => (atual ? { ...atual, valor } : atual));
    try {
      await patchAgentEffort(agentSlug, valor);
    } catch {
      setEsforcoBuscado(anterior); // reverte — controle que erra e finge é pior
    }
  }

  const fase = faseLocal;
  const aparencia = aparenciaDe(fase, agentName);

  // ---- voz ----------------------------------------------------------------
  // O áudio termina na MESMA máquina de seis fases do texto, e isso não é
  // economia: o back faz STT e entrega por `send-keys` no mesmo POST, então ele
  // devolve o mesmo `tmux_delivered` literal que mente pro texto. Dar à voz um
  // caminho próprio de confirmação seria reproduzir o defeito num lugar novo.
  const [transcrito, setTranscrito] = useState<string | null>(null);
  const [falhaDaFala, setFalhaDaFala] = useState<Impedimento | null>(null);

  const subirAudio = useCallback(
    async (audio: Blob) => {
      // A trava do compact vale pra voz também: uma gravação começada ANTES
      // do `/compact` termina DEPOIS dele, e soltar esse texto no meio da
      // espera corta o resumo do mesmo jeito.
      if (travaCompact) return;
      setFalhaDaFala(null);
      try {
        // O que o servidor ENTENDEU aparece na tela. STT erra, e o Rica precisa
        // saber o que o agente recebeu — sem isso ele descobre pela resposta
        // errada do agente, três minutos depois.
        setTranscrito(await envio.enviarVoz(audio));
      } catch (erro) {
        // O back só entrega DEPOIS de transcrever: falha aqui significa que
        // nada chegou ao agente. Por isso a fala tem aviso próprio em vez de
        // virar `falhou` da máquina de envio — ali "reenviar" não teria texto
        // nenhum para reenviar, e botão que não responde é o defeito da §9.
        setTranscrito(null);
        setFalhaDaFala(diagnosticaTranscricao(erro));
      }
    },
    [envio, travaCompact],
  );

  const gravador = usaGravador({ aoGravar: subirAudio });
  const faseVoz = gravador.fase;
  const segundosVoz = gravador.segundos;
  const vozAparencia = aparenciaDaVoz(faseVoz, {
    segundos: segundosVoz,
    nome: agentName,
    impedimento: gravador.impedimento ?? undefined,
  });
  const niveisVoz = gravador.niveis;
  const emCaptura = capturando(faseVoz);
  const travada = faseVoz === 'travada';
  // Dois problemas, uma linha só: microfone que não abre e transcrição que não
  // veio. São momentos diferentes do mesmo gesto e nunca coexistem — dar duas
  // faixas de aviso ensinaria dois lugares para olhar quando a fala falha.
  const avisoDaVoz =
    faseVoz === 'impedida'
      ? gravador.impedimento ?? null
      : falhaDaFala;

  async function enviar(corpo: string) {
    if (!corpo.trim() || travaCompact) return;
    // `/compact` é mensagem comum pro back, mas pra ESTA tela é também o
    // gatilho da espera: inicia a máquina ANTES do POST voltar, porque a
    // barra precisa nascer com o clique, não com o 200.
    if (COMPACT_RE.test(corpo)) {
      compactPendenteRef.current = true;
      iniciarCompact();
    }
    // O campo esvazia na hora, mas o texto não se perde: quem o guarda é a
    // máquina (`estado.texto`), que precisa dele para casar o eco e para
    // oferecer novo envio se o eco não vier.
    setTexto('');
    setTranscrito(null);
    setFalhaDaFala(null);
    await envio.enviar(corpo);
  }

  function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    enviar(texto);
  }

  function acionar(acao: AcaoEnvio) {
    if (acao === 'copiar') {
      const moderno =
        typeof navigator !== 'undefined' && navigator.clipboard
          ? navigator.clipboard.writeText.bind(navigator.clipboard)
          : undefined;
      void copyText(ultimoEnviado, { writeText: moderno, fallbackCopy });
      return;
    }
    // `nao-confirmado` tem caminho próprio na máquina — ela sabe que a tentativa
    // anterior pode ter sido entregue e conta o eco ambíguo em vez de confirmar
    // o reenvio com o eco do primeiro. `falhou` é reenvio comum.
    if (fase === 'nao-confirmado') {
      void envio.reenviar();
      return;
    }
    void enviar(ultimoEnviado);
  }

  const emAndamento = emTransito(fase);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ck-space-1)' }}>
      {/* A espera do `/compact` mora ACIMA da caixa e empurra tudo pra baixo —
          faixa fina da largura da coluna, nunca overlay nem modal. */}
      <BarraCompact estado={estadoCompact} onDispensar={cancelarCompact} />
      {/* O INVÓLUCRO DA ÂNCORA. Existe por uma razão só: dar à gaveta um
          `position: relative` que meça exatamente a caixa do composer. Se o
          `bottom: 100%` dela medisse a coluna inteira (que também tem as linhas
          de estado embaixo), a gaveta subiria alto demais e descolaria do "+".
          A largura máxima migrou para cá para que o `left` da gaveta case com a
          borda da caixa também no desktop, onde a coluna é mais larga. */}
      <div
        className="relative mx-auto w-full"
        style={{ maxWidth: 'var(--ck-w-composer)' }}
      >
      <form
        onSubmit={aoSubmeter}
        className="ck-lit ck-caixa flex w-full flex-col border"
        style={{
          padding: 'var(--ck-space-3)',
          gap: 'var(--ck-space-2)',
          background: 'var(--ck-surface-composer)',
          // Em captura a moldura inteira assume a cor do estado — é o mesmo
          // recurso do envio, e aqui ele carrega o aviso de que soltar agora
          // descarta. Cor de estado na borda alcança a visão periférica; o
          // olho está no que está sendo falado, não no composer.
          borderColor: vozAparencia.tinta ?? aparencia.filete ?? 'var(--ck-edge-functional)',
          // A borda inteira (não só um filete de 2px) muda de cor no estado
          // quente: o composer é a única superfície de INPUT da tela, e ali a
          // convenção do filete lateral (linha de execução, mensagem) compete
          // com a moldura que o campo já tem por natureza.
          borderWidth: aparencia.filete || vozAparencia.tinta ? '1.5px' : '1px',
          // Raio próprio, maior que o do resto (§adendo): a referência do Codex
          // arredonda a caixa de fala bem mais do que os blocos de conteúdo, e
          // `--ck-radius-frame` veste código/diff/thinking, onde macio demais
          // rouba leitura. Ver o comentário do token em `globals.css`.
          borderRadius: 'var(--ck-radius-caixa)',
          position: 'relative',
          overflow: 'hidden',
          transition: `border-color var(--ck-dur-fast) var(--ck-ease)`,
        }}
      >
        {emCaptura ? (
          <PainelDeCaptura
            fase={faseVoz}
            aparencia={vozAparencia}
            segundos={segundosVoz}
            niveis={niveisVoz}
          />
        ) : (
        <textarea
          ref={textareaRef}
          rows={2}
          value={texto}
          disabled={emAndamento || travaCompact}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              enviar(texto);
            }
          }}
          placeholder={travaCompact ? 'compactando… aguarde' : `Mensagem para ${agentName}`}
          className="ck-campo leading-body min-w-0 resize-none bg-transparent outline-none"
          style={{
            fontSize: 'var(--ck-text-md)', // 16px: piso do iOS contra zoom no foco
            minHeight: '48px',
          }}
        />
        )}

        {/* Base do composer: os controles moram AQUI, dentro da caixa — §12.1. */}
        <div className="flex items-end justify-between" style={{ gap: 'var(--ck-space-2)' }}>
          {emCaptura ? (
            // Durante a fala, o canto esquerdo carrega a INSTRUÇÃO do gesto.
            // É onde ela precisa estar: o polegar está na direita, e o olho
            // percorre da esquerda. Anexo e motor saem — nenhum dos dois faz
            // sentido enquanto o microfone está aberto.
            travada ? (
              <button
                type="button"
                onClick={gravador.descartarTravada}
                aria-label="Descartar áudio"
                className="ck-veil flex shrink-0 items-center"
                style={{
                  gap: '5px',
                  minHeight: 'var(--ck-touch-min)',
                  padding: '0 var(--ck-space-2)',
                  marginLeft: 'calc(var(--ck-space-2) * -1)',
                  marginBottom: 'calc(var(--ck-space-2) * -1)',
                  borderRadius: 'var(--ck-radius-chip)',
                  fontSize: 'var(--ck-text-sm)',
                  color: 'var(--ck-text-secondary)',
                }}
              >
                <IconeDescartar tamanho={15} />
                Descartar
              </button>
            ) : (
              <span
                style={{
                  fontSize: 'var(--ck-text-xs)',
                  color: vozAparencia.tinta ?? 'var(--ck-text-secondary)',
                  paddingBottom: 'var(--ck-space-1)',
                }}
              >
                {vozAparencia.instrucao}
              </span>
            )
          ) : (
          <BotaoAnexo
            estado={anexo.estado}
            alternarGaveta={anexo.alternarGaveta}
            desabilitado={travaCompact || emAndamento}
            botaoRef={botaoAnexoRef}
          />
          )}

          <div className="flex min-w-0 flex-1 items-center justify-end" style={{ gap: 'var(--ck-space-3)' }}>
            {/* O motor — modelo em texto, esforço em controle real. Nunca bold:
                a referência resolve hierarquia com espaço, não com peso.
                Some durante a captura: escolher motor no meio de uma frase
                falada não é uma decisão que alguém toma. */}
            {emCaptura ? null : (
            <div
              className="flex min-w-0 items-center"
              style={{ gap: '3px', fontSize: 'var(--ck-text-sm)' }}
              title={descreveMotor(motor)}
            >
              <span
                className="truncate"
                style={{
                  color:
                    motor.certeza === 'pode-divergir'
                      ? 'var(--ck-text-tertiary)'
                      : 'var(--ck-text-secondary)',
                }}
              >
                {motor.modelo}
              </span>
              {esforcoPermitidoEfetivo.length > 0 ? (
                <select
                  aria-label={`Esforço de ${agentName}`}
                  value={esforcoValorEfetivo ?? ''}
                  disabled={trocandoEsforco}
                  onChange={async (e) => {
                    setTrocandoEsforco(true);
                    try {
                      await trocarEsforcoEfetivo(e.target.value);
                    } finally {
                      setTrocandoEsforco(false);
                    }
                  }}
                  className="bg-transparent outline-none"
                  style={{
                    color: 'var(--ck-text-secondary)',
                    fontFamily: 'var(--ck-font-sans)',
                    fontSize: 'var(--ck-text-sm)',
                    // `appearance: none` tiraria a seta nativa; mantemos a seta
                    // do sistema — é a única pista de que isto é um `<select>`
                    // e não texto, e substituí-la por um glifo custava mais do
                    // que o problema pedia.
                  }}
                >
                  {/* O VALOR vai cru pro back (`low`…`max`, é o contrato do
                      endpoint), mas o RÓTULO é português — a referência mostra
                      "Extra alto", não "xhigh", e quem lê esta linha é o Rica.
                      O primeiro print pegou este defeito: o composer estava
                      cantando "Opus high" no meio de uma tela em português. */}
                  {esforcoPermitidoEfetivo.map((valor) => (
                    <option key={valor} value={valor}>
                      {rotulaEsforco(valor)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            )}

            {/* O ÚNICO ELEMENTO SÓLIDO, e ele troca de função — a referência é
                explícita nisso: na tela do Codex com o composer VAZIO, o botão
                de massa não é a seta, é a onda. Faz sentido literal: sem texto
                não há o que enviar, e transformar o alvo grande naquilo que
                serve é melhor que deixá-lo apagado ao lado de um microfone
                minúsculo. Foi o que matou o microfone antigo — 17px de traço
                para o gesto MAIS usado do Rica.

                `key` distinta em cada ramo NÃO é detalhe: sem ela o React muta
                o `type` do mesmo nó, e o clique que rodou o `onClick` cai no
                submit do form logo em seguida — o áudio começaria e a mensagem
                vazia sairia junto. */}
            {emCaptura || travada ? (
              travada ? (
                <button
                  key="parar"
                  type="button"
                  onClick={gravador.enviarTravada}
                  aria-label={`Enviar áudio para ${agentName}`}
                  className="flex shrink-0 items-center justify-center"
                  style={{
                    width: '32px',
                    height: '32px',
                    marginBottom: 'calc(var(--ck-space-1) * -1)',
                    borderRadius: 'var(--ck-radius-pill)',
                    background: 'var(--ck-text-primary)',
                    color: 'var(--ck-surface-canvas)',
                  }}
                >
                  <IconeParar />
                </button>
              ) : (
                <button
                  key="voz"
                  type="button"
                  {...gravador.handlers}
                  aria-label={vozAparencia.anuncio}
                  className="flex shrink-0 items-center justify-center"
                  style={{
                    width: '32px',
                    height: '32px',
                    marginBottom: 'calc(var(--ck-space-1) * -1)',
                    borderRadius: 'var(--ck-radius-pill)',
                    background: vozAparencia.tinta ?? 'var(--ck-text-primary)',
                    color: 'var(--ck-surface-canvas)',
                    // O gesto não pode virar rolagem nem seleção de texto: no
                    // iOS, segurar sem isto abre o menu de contexto no meio da
                    // fala e o `pointermove` some.
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                >
                  <IconeOnda />
                </button>
              )
            ) : texto.trim() ? (
              <button
                key="enviar"
                type="submit"
                disabled={emAndamento || travaCompact}
                aria-label={`Enviar para ${agentName}`}
                className="flex shrink-0 items-center justify-center disabled:opacity-40"
                style={{
                  width: '32px',
                  height: '32px',
                  marginBottom: 'calc(var(--ck-space-1) * -1)',
                  borderRadius: 'var(--ck-radius-pill)',
                  background: 'var(--ck-text-primary)',
                  color: 'var(--ck-surface-canvas)',
                }}
              >
                <IconeEnviar />
              </button>
            ) : (
              <button
                key="voz"
                type="button"
                disabled={emAndamento || travaCompact || faseVoz === 'transcrevendo'}
                {...gravador.handlers}
                aria-label={`Segure para falar com ${agentName}`}
                className="flex shrink-0 items-center justify-center disabled:opacity-40"
                style={{
                  width: '32px',
                  height: '32px',
                  marginBottom: 'calc(var(--ck-space-1) * -1)',
                  borderRadius: 'var(--ck-radius-pill)',
                  background: 'var(--ck-text-primary)',
                  color: 'var(--ck-surface-canvas)',
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                }}
              >
                <IconeOnda />
              </button>
            )}
          </div>
        </div>

        {/* O alvo de trava só existe DURANTE o gesto: um cadeado parado na tela
            o tempo todo seria um controle a mais para ignorar. */}
        {emCaptura && !travada ? (
          <AlvoDeTrava progresso={gravador.progresso} armado={gravador.gesto === 'travar'} />
        ) : null}

        {/* O fio — ver `aparencia-envio.ts`. Track de 2px na base, dentro da
            própria moldura (`overflow:hidden` do form recorta a ponta). Só
            `transform` anima: o compositor não recalcula layout.

            A TRANSCRIÇÃO REUSA O MESMO FIO, e isso é o oposto de economia: o
            STT roda no servidor e existe um tempo morto entre soltar o dedo e o
            texto existir. Inventar um segundo indicador pra esse intervalo
            ensinaria duas linguagens para a mesma pergunta — "a máquina está
            trabalhando?". É um fio só, do começo da fala até o agente receber. */}
        {aparencia.fio !== 'nenhum' || faseVoz === 'transcrevendo' || faseVoz === 'pedindo' ? (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '2px',
              overflow: 'hidden',
              background: 'var(--ck-edge-hairline)',
            }}
          >
            <div
              className={
                aparencia.fio === 'correndo' || faseVoz === 'transcrevendo' || faseVoz === 'pedindo'
                  ? 'ck-fio-percorre'
                  : ''
              }
              style={{
                width: '30%',
                height: '100%',
                background: vozAparencia.tinta ?? aparencia.filete ?? 'var(--ck-state-running)',
                // Travado: parado na METADE do trajeto — é a imagem literal do
                // "ficou pelo caminho", não uma barra de progresso genérica.
                transform: aparencia.fio === 'travado' ? 'translateX(120%)' : undefined,
              }}
            />
          </div>
        ) : null}
      </form>

        {/* A GAVETA. Irmã do form, dentro do invólucro ancorado — sobe a partir
            do "+" e nunca é recortada pelo `overflow` da caixa. */}
        <PainelAnexo
          estado={anexo.estado}
          // O texto digitado vira a LEGENDA do arquivo, igual ao ChatGPT: uma
          // entrega só, não duas (o arquivo e depois um texto solto).
          legenda={texto}
          fecharGaveta={anexo.fecharGaveta}
          enviar={anexo.enviar}
          aoEnviar={() => setTexto('')}
          botaoRef={botaoAnexoRef}
        />
      </div>

      {/* O ESTADO DO ANEXO — subindo, recusado, entregue. Vem antes do aviso da
          voz porque é o gesto mais recente quando existe. */}
      <AvisoAnexo estado={anexo.estado} aoDispensar={anexo.limpar} />

      {/* MICROFONE INDISPONÍVEL. Nunca um botão que não responde — o defeito
          que esta rodada consertou no envio, aqui com outra roupa. Sempre duas
          coisas: o que aconteceu e o que fazer a respeito. A saída é a parte
          que importa; "permissão negada" sozinho manda o Rica adivinhar em
          qual das telas de ajuste do iPhone ele mexe. */}
      {avisoDaVoz ? (
        <div
          className="mx-auto flex w-full items-start justify-between"
          style={{
            maxWidth: 'var(--ck-w-composer)',
            padding: '0 var(--ck-space-2)',
            gap: 'var(--ck-space-3)',
          }}
        >
          <span
            role="status"
            aria-live="assertive"
            style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}
          >
            {avisoDaVoz.resumo} — {avisoDaVoz.saida}
          </span>
          <button
            type="button"
            onClick={() => {
              setFalhaDaFala(null);
              gravador.limparImpedimento();
            }}
            aria-label="Dispensar aviso do microfone"
            className="ck-veil flex shrink-0 items-center"
            style={{
              padding: '4px',
              borderRadius: 'var(--ck-radius-chip)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            <IconeDescartar tamanho={13} />
          </button>
        </div>
      ) : null}

      {/* A VOZ FALANDO DE FORA DA CAIXA. Dois casos que a primeira versão desta
          peça deixou mudos:

          1. `transcrevendo` — o fio corre na base, mas fio sozinho não
             distingue "subindo áudio" de "enviando texto". O despacho foi
             explícito: o STT roda no servidor e a tela não pode ficar muda no
             tempo morto. Fio é ritmo; a palavra é o que diz DE QUE espera se
             trata.
          2. `travada` com áudio longo — a duração muda de cor e a moldura
             também, mas com a gravação travada o canto esquerdo é ocupado
             pelo botão Descartar e o aviso não tinha onde aparecer. Cor sem
             motivo é enfeite: quem vê o âmbar precisa saber que é o teto de
             30s do STT chegando. */}
      {vozAparencia.instrucao &&
      faseVoz !== 'impedida' &&
      (!emCaptura || (travada && vozAparencia.longa)) ? (
        <span
          role="status"
          aria-live="polite"
          className="mx-auto w-full"
          style={{
            maxWidth: 'var(--ck-w-composer)',
            padding: '0 var(--ck-space-2)',
            fontSize: 'var(--ck-text-xs)',
            color: vozAparencia.tinta ?? 'var(--ck-text-secondary)',
          }}
        >
          {vozAparencia.instrucao}
        </span>
      ) : null}

      {/* O QUE O SERVIDOR ENTENDEU. STT erra, e o texto que subiu não passa
          pelo campo — sem isto o Rica só descobre o erro pela resposta errada
          do agente, minutos depois, sem saber que a culpa foi da transcrição. */}
      {transcrito &&
      (fase === 'aceito' || fase === 'confirmado' || fase === 'nao-confirmado') ? (
        <p
          className="mx-auto w-full"
          style={{
            maxWidth: 'var(--ck-w-composer)',
            margin: 0,
            padding: '0 var(--ck-space-2)',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          🎙 {transcrito}
        </p>
      ) : null}

      {/* Frase de estado + ações. Só existe fora do `ocioso`/`confirmado` —
          sucesso é silêncio, igual à linha de ferramenta (§7). */}
      {aparencia.frase || aparencia.acoes.length > 0 ? (
        <div
          className="mx-auto flex w-full items-center justify-between"
          style={{ maxWidth: 'var(--ck-w-composer)', padding: '0 var(--ck-space-2)' }}
        >
          <span
            id={idAnuncio}
            role="status"
            aria-live={aparencia.urgencia}
            style={{
              fontSize: 'var(--ck-text-xs)',
              color: aparencia.filete ?? 'var(--ck-text-secondary)',
            }}
          >
            {aparencia.frase}
          </span>
          {aparencia.acoes.length > 0 ? (
            <div className="flex items-center" style={{ gap: 'var(--ck-space-3)' }}>
              {aparencia.acoes.map((acao) => {
                const Icone = ROTULO_ICONE[acao];
                return (
                  <button
                    key={acao}
                    type="button"
                    onClick={() => acionar(acao)}
                    className="ck-veil flex items-center"
                    style={{
                      gap: '5px',
                      padding: '4px 8px',
                      borderRadius: 'var(--ck-radius-chip)',
                      fontSize: 'var(--ck-text-xs)',
                      color: 'var(--ck-text-secondary)',
                    }}
                  >
                    <Icone tamanho={13} />
                    {rotulaAcao(acao)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        // Elemento vazio de altura fixa: reserva o espaço da linha de status
        // ANTES de ela existir, mesma regra do hotspot 6 da linha de execução —
        // sem isto o fio aparecendo empurra o composer um pixel pra cima.
        <div aria-hidden style={{ height: '17px' }} />
      )}
    </div>
  );
}
