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
 * 2. **Modelo e esforço são controles reais.** O seletor abre um menu ancorado e
 *    recebe do painel somente as opções que o servidor autoriza. Para Claude
 *    Code, a troca de modelo acontece na sessão viva; se o agente estiver
 *    trabalhando, o servidor exige a confirmação explícita antes de forçar.
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
 * O SELETOR É AUTOSSUFICIENTE. A página que usa o Composer não precisa buscar
 * `/painel` antes: ele lê as opções ao montar e aplica as trocas pela API.
 *
 * NÃO EXISTE MODO DE DEMONSTRAÇÃO AQUI. O componente fala com o agente de
 * verdade e mostra o que ele está fazendo — nada de estado forçado, nada de
 * caminho que só a tela de teste exercita.
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { ALVO_DE_TOQUE, MARGEM_INFERIOR_DA_BASE } from '../../lib/alvo-de-toque';
import { aparenciaDe, rotulaAcao, type AcaoEnvio, type FaseEnvio } from './aparencia-envio';
import { copyText } from '../../lib/clipboard';
import { usaCompact } from '../../lib/compact';
import { arquivoRetido, usaAnexo } from '../../lib/usa-anexo';
import { usaRascunho } from '../../lib/usa-rascunho';
import {
  descartaEcoPendente,
  registraEcoPendente,
  PRAZO_CC_MS,
  PRAZO_CODEX_MS,
} from '../../lib/codex/eco-pendente';
import { publicaNovaConversa } from '../../lib/codex/nova-conversa';
import { assinaTurnoVivo, leTurnoVivo } from '../../lib/turno-vivo';
import { assinaEscritaViva, leEscritaViva } from '../../lib/escrita-viva';
import { usaFrota } from './frota-provider';
import { MARCA_VOZ, usaEnvio, type OrigemEnvio } from '../../lib/usa-envio';
import { AvisoAnexo, BotaoAnexo, PainelAnexo } from './gaveta-anexo';
import { MiniaturaAnexo } from './miniatura-anexo';
import { PilulaDeTokens } from './pilula-de-tokens';
import { BarraCompact } from './barra-compact';
import { BlocoDaFila } from './bloco-da-fila';
import { BolinhaAgente } from './bolinha-agente';
import {
  FILA_VAZIA,
  devolveAoInicio,
  enfileira,
  proximoDaFila,
  reagiuAsFases,
  retira,
  soltaPausa,
} from './fila-de-envio';
import { fallbackCopy } from '../renderers/copia-fallback';
import { type Motor } from './motor';
import { SeletorMotor } from './seletor-motor';
import { type MotivoRecusa, preparaEnvio, recusaPersiste } from './porta-de-envio';
import { prefixaPesquisa } from './pesquisa-canario';
import { usaFalaAoVivo } from './usa-fala-ao-vivo';
import { usaGravador } from './usa-gravador';
import {
  aparenciaDaVoz,
  diagnosticaMicrofone,
  diagnosticaTranscricao,
  mesclaTranscricao,
  origemDepoisDaEdicao,
  type FaseVoz,
  type Impedimento,
} from './voz';
import { emCaptura, modoDaFala } from './modo-da-fala';
import {
  IconeBusca,
  IconeCadeado,
  IconeCopiar,
  IconeDescartar,
  IconeEnviar,
  IconeOnda,
  IconeParar,
  IconeReenviar,
} from './icones';
import { usaCanalEntrega } from './usa-canal-entrega';
import { BolhaDeComandos } from './bolha-de-comandos';

export type ComposerProps = {
  agentSlug: string;
  agentName: string;
  motor: Motor;
  /** Repasse direto para o SeletorMotor: Kimi/Codex têm `requested` no painel,
   *  o Claude não (ver `contratoSeparaPedido` em motor.ts). */
  esforcoCobrePedido: boolean;
};

const ROTULO_ICONE: Record<AcaoEnvio, (props: { tamanho: number }) => React.ReactElement> = {
  reenviar: IconeReenviar,
  copiar: IconeCopiar,
  'tentar-de-novo': IconeReenviar,
  destravar: IconeCadeado,
};

function OndaCompacta({ niveis, tinta }: { niveis: number[]; tinta: string }) {
  return (
    <div
      aria-hidden
      className="flex min-w-0 flex-1 items-center justify-end overflow-hidden"
      style={{ gap: '3px', height: '24px' }}
    >
      {niveis.map((nivel, indice) => (
        <span
          key={indice}
          style={{
            width: '2px',
            flex: '0 0 2px',
            height: `${Math.max(2, Math.round((nivel / 100) * 20))}px`,
            borderRadius: '1px',
            background: tinta,
            opacity: 0.45 + (nivel / 100) * 0.55,
          }}
        />
      ))}
    </div>
  );
}

/** O `/compact` com argumentos (`/compact foca no deploy`) também é compact —
 *  o que não pode casar é um `/compactar` hipotético ou a palavra no meio da
 *  frase. */
const COMPACT_RE = /^\s*\/compact(?:\s|$)/;

/** Comandos da TARA no composer — mesmo vocabulário do CC. `clear`/`/clear`
 *  apaga a conversa da UI e arma uma thread nova (o botão "Nova conversa" da
 *  gaveta faz o mesmo). Interceptado ANTES da porta: não é mensagem pro Codex,
 *  é gesto de tela. */
const COMANDOS_TARA: Record<string, 'nova-conversa'> = {
  clear: 'nova-conversa',
};

// Teclado físico tem Shift previsível; teclado virtual (touch) não — o Enter dele é
// a única tecla de "concluir campo", então usá-la pra enviar rouba a quebra de
// linha. `pointer: coarse` é o sinal recomendado pela doc do MDN pra detectar touch,
// mais confiável que sniffar user-agent (ex: iPad com teclado físico continua coarse,
// mas aí o Shift+Enter já resolve).
function usaTecladoTouch(): boolean {
  const [touch, setTouch] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const consulta = window.matchMedia('(pointer: coarse)');
    const aoMudar = () => setTouch(consulta.matches);
    consulta.addEventListener('change', aoMudar);
    return () => consulta.removeEventListener('change', aoMudar);
  }, []);

  return touch;
}

export function Composer({
  agentSlug,
  agentName,
  motor,
  esforcoCobrePedido,
}: ComposerProps) {
  // O campo é PERSISTIDO por agente: recarregar a página (no iPhone, puxar a
  // tela pra baixo) não pode apagar o que ele escreveu e não mandou. Ver
  // `lib/usa-rascunho.ts`.
  const [texto, setTexto, origemDoRascunho, setOrigemDoRascunho] = usaRascunho(agentSlug);
  const textoAtualRef = useRef(texto);
  textoAtualRef.current = texto;
  const substituicaoIntegralRef = useRef(false);
  const origemDoUltimoEnvio = useRef<OrigemEnvio>('text');
  const [pesquisaAtiva, setPesquisaAtiva] = useState(false);
  const podePesquisar = agentSlug === 'canarinho';
  // A máquina de seis fases é a da `lib/envio.ts`, dirigida pelo eco do stream:
  // `confirmado` só existe quando o item `user` VOLTA do servidor. Antes disto o
  // componente cantava `aceito` no 200 do POST e parava ali — que é o mesmo
  // "enviado" mentiroso do painel antigo, só que mais bonito.
  // Quem entrega por rollout (Codex) e quem entrega por stream (Claude Code)
  // têm ecos com ordens de grandeza diferentes — 12 s contra milissegundos.
  // A frota já está montada acima (o feed a lê pelo mesmo hook); ler daqui
  // evita prop nova em `app/agente/[slug]/page.tsx`.
  const { agents } = usaFrota();
  const ehCodex = agents.some(
    (a) => a.slug === agentSlug && (a.executor_kind === 'codex' || a.cli_default === 'codex'),
  );
  // Positivo, não `!ehCodex`: com a frota ainda não carregada os dois são
  // falsos, e a porta continua segurando — errar fechado aqui devolve o
  // comportamento de ontem, errar aberto manda um POST que o TeleCodex recusa.
  const motorEnfileiraSozinho = agents.some(
    (a) => a.slug === agentSlug && (a.executor_kind ?? a.cli_default) === 'claude_code',
  );
  // O AGENTE ESTÁ GERANDO? Duas fontes, e escolher as duas certas levou três
  // rodadas em 15/08. O histórico, porque cada uma caiu por um motivo diferente:
  //
  // 1. `lifecycle_status` sozinho, que era o original. Ele é alimentado por hook
  //    e por vigia de JSONL, e chega no tempo do PAINEL: com um agente Claude
  //    Code ocioso recebendo mensagem, **o ■ não apareceu na tela em 100 s**.
  //    O freio não existia durante o turno inteiro.
  // 2. `lifecycle_status` com guarda de `status !== 'offline'`. Pegou os cinco
  //    agentes MORTOS que o `/api/fleet` jurava estarem `trabalhando`, e não
  //    pegou os VIVOS E OCIOSOS: o canarinho ficou `status=ocioso` com
  //    `lifecycle=trabalhando` preso, e o ■ pendurado no repouso — comendo o
  //    lugar do microfone no chat que o Rica mais usa. Achado do Daniel.
  //
  // O que os dois casos têm em comum: `lifecycle_status` é histórico de EVENTO e
  // não expira. Turno que morre sem despedida limpa — agente desligado, limite
  // de uso, sessão derrubada — deixa `trabalhando` para sempre. Ele serve para
  // pintar card; não serve para decidir se um controle existe.
  //
  // Então a fonte lenta passou a ser o `status`, que cruza sessão e processo e
  // sabe dizer `offline` e `ocioso`; e a fonte RÁPIDA é o `isRunning` do stream,
  // publicado pelo feed em `lib/turno-vivo.ts` — o mesmo booleano que acende o
  // "Pensando há 12 s" três centímetros acima. Uma cobre o que a outra atrasa, e
  // nenhuma das duas herda o campo que não expira.
  const daFrota = agents.find((a) => a.slug === agentSlug);
  const vivo = daFrota !== undefined && daFrota.status !== 'offline';
  const trabalhando = vivo && daFrota.status === 'trabalhando';
  const sessaoCodexProcessando = ehCodex && daFrota?.codex_session_processing === true;
  const assinaTurno = useMemo(() => (fn: () => void) => assinaTurnoVivo(agentSlug, fn), [agentSlug]);
  const leTurno = useMemo(() => () => leTurnoVivo(agentSlug), [agentSlug]);
  // No servidor não há turno nenhum: o valor nasce de um stream do browser.
  const turnoVivo = useSyncExternalStore(assinaTurno, leTurno, () => false);
  // O segundo sinal do feed, só para a bolinha: pensar e responder têm caras
  // diferentes, e é a troca de cara que a faz valer sozinha.
  const assinaEscrita = useMemo(() => (fn: () => void) => assinaEscritaViva(agentSlug, fn), [agentSlug]);
  const leEscrita = useMemo(() => () => leEscritaViva(agentSlug), [agentSlug]);
  const escrevendo = useSyncExternalStore(assinaEscrita, leEscrita, () => false);
  const [parando, setParando] = useState(false);
  // O ■ SOME NO TOQUE, não quando o painel concorda. `lifecycle_status` é
  // alimentado por evento (JSONL no Claude Code, rollout no Codex) e chega
  // atrasado — no Codex ele ainda OSCILA entre um poll e o seguinte. Botão que
  // continua oferecendo uma ação já executada é a mentira de UI da §9, e aqui
  // ela convida a um segundo toque num agente que já parou.
  const [interrompido, setInterrompido] = useState(false);
  const gerando =
    !interrompido && (sessaoCodexProcessando || (vivo && (trabalhando || turnoVivo)));

  /** O `■`. Não pede confirmação: interromper é reversível — o texto continua no
   *  feed e mandar de novo recomeça — e um modal entre o dedo e o botão, no meio
   *  de uma geração que já desandou, é obstáculo, não proteção. */
  async function interromper(): Promise<void> {
    setParando(true);
    try {
      const { postAgentInterromper } = await import('@grupo_borges/cockpit-core/api');
      await postAgentInterromper(agentSlug);
      setInterrompido(true);
    } catch {
      // Sem recibo: o sinal honesto é o próprio agente parando de trabalhar, que
      // o `lifecycle_status` já reporta. Uma faixa de erro aqui competiria com
      // ele e envelheceria sozinha.
    } finally {
      setParando(false);
    }
  }
  // Mesma condição que decide `aberta` dentro de `BolhaDeComandos` — duplicada
  // aqui porque o Popover vive num Portal (subárvore separada do textarea) e
  // nunca recebe o Enter que o campo despacha. Sem este espelho, digitar `/`
  // e apertar Enter mandava o `/` sozinho como mensagem pro agente.
  const bolhaComandosAberta = !ehCodex && texto === '/';
  const envio = usaEnvio(agentSlug);
  const faseLocal = envio.estado.fase;
  const ultimoEnviado = envio.estado.fase === 'ocioso' ? '' : envio.estado.texto;
  const idAnuncio = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tecladoTouch = usaTecladoTouch();

  // O ANEXO tem máquina PRÓPRIA, não a de seis fases do texto. Ali a pergunta é
  // "o agente recebeu?", respondida só pelo eco no stream; aqui o `POST /file`
  // devolve `tmux_delivered` e o próprio arquivo aparece no feed — não existe
  // eco de anexo para casar. Ver o cabeçalho de `lib/usa-anexo.ts`.
  const anexo = usaAnexo(agentSlug);
  // O arquivo na mão atravessa três fases (`escolhido`, `enviando` e o `erro`
  // de upload) — por isso a pergunta não se responde por uma fase só.
  const retidoAnexo = arquivoRetido(anexo.estado);
  // HÁ GESTO PARA DESPACHAR? A foto sozinha já é um — sem `retidoAnexo` aqui,
  // anexar sem escrever legenda deixava a imagem na tela e nenhum botão que a
  // mandasse. Vale para os dois slots, e é a única pergunta que ambos fazem.
  const temConteudo = texto.trim() !== '' || retidoAnexo !== null;
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

  // A FILA DA ESPERA. O texto recusado pelo compact não fica no campo: ele sai
  // das mãos, fica pendurado à vista e é despachado sozinho quando a espera
  // termina — a régua de quem sai e quando mora em `fila-de-envio.ts`.
  const [fila, setFila] = useState(FILA_VAZIA);
  const contadorFila = useRef(0);

  // Por que a recusa não foi despachada. Não tem botão de dispensar de
  // propósito: ela descreve um impedimento do INSTANTE, não um erro a ser
  // reconhecido — quando o motivo passa, o aviso vai junto.
  //
  // O que fica guardado é o GESTO recusado — motivo e recado, como nasceram.
  // Se ele ainda descreve o instante é pergunta de render, logo abaixo.
  const [recusa, setRecusa] = useState<{ motivo: MotivoRecusa; aviso: string } | null>(null);
  // O SINAL DE RECUSA. A porta recusou um toque com recado — o botão de enviar
  // sacode pra o Rica sentir o "não" mesmo quando o aviso da faixa fica
  // escondido atrás do teclado do iPhone. Estado e não classe persistente:
  // `onAnimationEnd` limpa, então o próximo toque recusado re-sacode.
  const [sinalRecusa, setSinalRecusa] = useState(false);
  const anexoEmVoo = anexo.estado.fase === 'enviando';
  // O AVISO É CALCULADO, não guardado. Aviso que sobrevive ao motivo vira
  // mentira na tela, e até 20/08 quem o apagava era um efeito que listava
  // quatro impedimentos à mão. A lista tinha buraco: `longo-demais` não estava
  // nela e nenhuma daquelas quatro flags muda quando o Rica apaga texto, então
  // o "texto longo demais" ficava preso com o campo já curto.
  //
  // Agora a pergunta é refeita à mesma porta, com as condições de agora. Não há
  // lista para manter em dia, e o efeito — que a documentação nomeia como
  // anti-padrão (`react.dev/learn/you-might-not-need-an-effect`, "Adjusting
  // state on prop change in an Effect") — deixa de existir.
  const avisoDaPorta =
    recusa &&
    recusaPersiste(recusa.motivo, {
      texto,
      temAnexo: retidoAnexo !== null,
      anexoEmVoo,
      turnoEmVoo: gerando,
      motorEnfileiraSozinho,
      compactando: travaCompact,
      faseEnvio: faseLocal,
    })
      ? recusa.aviso
      : null;

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

  // A CAIXA CRESCE COM O QUE ESTÁ ESCRITO. Efeito e não `onChange` porque o
  // campo tem três autores: o Rica digitando, a fila devolvendo um item ao
  // campo (`editarDaFila`) e o envio esvaziando. Preso ao `onChange`, a caixa
  // ficaria alta depois de mandar a mensagem e baixa depois de editar da fila.
  //
  // `height = 'auto'` antes de ler `scrollHeight` não é ritual: sem zerar, o
  // `scrollHeight` nunca desce, porque ele mede o conteúdo contra a altura já
  // aplicada. É o que faz a caixa encolher ao apagar linha.
  useEffect(() => {
    const campo = textareaRef.current;
    if (!campo) return;
    campo.style.height = 'auto';
    campo.style.height = `${campo.scrollHeight}px`;
  }, [texto]);

  const fase = faseLocal;
  // Só os dois estados de insucesso perguntam ao back por quê. No caminho
  // normal ninguém faz essa pergunta, e o `/painel` não é consultado.
  const { canalBloqueado, destravaFalhou, destravar } = usaCanalEntrega(
    agentSlug,
    fase === 'nao-confirmado' || fase === 'falhou',
  );
  const aparencia = aparenciaDe(fase, agentName, {
    canalBloqueado,
    destravaFalhou,
    emFila: envio.estado.fase === 'confirmado' && envio.estado.fila === true,
  });
  // O caminho feliz não pinta mais a borda — `enviando`/`aceito` devolvem
  // `filete: null` desde 11/08, para os seis agentes (o porquê está em
  // `aparencia-envio.ts`). O que chega aqui colorido é só insucesso.
  const fileteDoEstado = aparencia.filete;

  // ---- voz ----------------------------------------------------------------
  const [falhaDaFala, setFalhaDaFala] = useState<Impedimento | null>(null);

  const subirAudio = useCallback(
    async (audio: Blob) => {
      setRecusa(null);
      setFalhaDaFala(null);
      try {
        const { postAgentTranscription } = await import('@grupo_borges/cockpit-core/api');
        const { text: falado } = await postAgentTranscription(agentSlug, audio);
        setTexto((atual) => mesclaTranscricao(atual, falado));
        setOrigemDoRascunho('stt');
        requestAnimationFrame(() => {
          const campo = textareaRef.current;
          if (!campo) return;
          campo.focus();
          campo.setSelectionRange(campo.value.length, campo.value.length);
        });
      } catch (erro) {
        setFalhaDaFala(diagnosticaTranscricao(erro));
      }
    },
    [agentSlug, setOrigemDoRascunho, setTexto],
  );

  // ---- fala ao vivo (F3) ---------------------------------------------------
  // O texto chega palavra por palavra e é REMONTADO a cada pedaço a partir do
  // que já estava escrito. Remontar da base em vez de ir acrescentando é o que
  // deixa o final (que vem revisado, com pontuação) simplesmente substituir o
  // provisório, sem sobra na tela e sem diff de texto.
  const baseDaFalaRef = useRef('');
  const textoRef = useRef(texto);
  useEffect(() => {
    textoRef.current = texto;
  }, [texto]);

  const aoComecarFala = useCallback(() => {
    baseDaFalaRef.current = textoRef.current;
  }, []);

  const aoTextoAoVivo = useCallback(
    (falado: string) => {
      setRecusa(null);
      setFalhaDaFala(null);
      setTexto(mesclaTranscricao(baseDaFalaRef.current, falado));
      setOrigemDoRascunho('stt');
    },
    [setOrigemDoRascunho, setTexto],
  );

  const falaAoVivo = usaFalaAoVivo({
    agentSlug,
    aoComecar: aoComecarFala,
    aoTexto: aoTextoAoVivo,
  });

  const gravador = usaGravador({ aoGravar: subirAudio, aoVivo: falaAoVivo });
  const faseVoz = gravador.fase;
  const segundosVoz = gravador.segundos;
  const vozAparencia = aparenciaDaVoz(faseVoz, {
    segundos: segundosVoz,
    nome: agentName,
    impedimento: gravador.impedimento ?? undefined,
  });
  const niveisVoz = gravador.niveis;
  // Dois problemas, uma linha só: microfone que não abre e transcrição que não
  // veio. São momentos diferentes do mesmo gesto e nunca coexistem — dar duas
  // faixas de aviso ensinaria dois lugares para olhar quando a fala falha.
  const avisoDaVoz =
    faseVoz === 'impedida'
      ? gravador.impedimento ?? null
      : falhaDaFala;

  // O MODO DA FALA — um valor calculado, em vez dos cinco predicados que o JSX
  // recombinava à mão em dez pontos. Equivalente exato ao que os ternários
  // montavam: `emCaptura(modo)` = `capturando(faseVoz)`, e `modo === 'travada'`
  // = `faseVoz === 'travada'`.
  //
  // Só a fala: `compactando` e `enviando` CONVIVEM com o microfone aberto, e
  // enum é para estado que se exclui — eles seguem em eixo próprio, com as
  // funções de aparência que o repo já usa. `gerando` fica de fora em qualquer
  // hipótese: é estado do AGENTE e mora na linha da bolinha.
  const modo = modoDaFala({ faseVoz, falaFalhou: avisoDaVoz !== null });
  // O ÚNICO recado da voz que ainda se vê. Gravação travada passando de 20s é
  // o teto de 30s do STT chegando: a moldura vira âmbar, e cor sem motivo
  // escrito é enfeite. O resto do que `aparenciaDaVoz` diz virou narração de
  // fase e não aparece mais — ver a linha da voz, abaixo.
  const avisoDoTetoDoStt = modo === 'travada' && vozAparencia.longa;
  // O SLOT DE DESPACHO ESTÁ EM CENA? Em `travada` o gesto que fecha é o do
  // áudio, no slot de entrada — não há texto a mandar enquanto a gravação
  // espera. Fora daí, quem manda o botão existir é haver o que despachar.
  const despachoEmCena = temConteudo && modo !== 'travada';
  // O ■ SOME DURANTE A CAPTURA. Em `travada` o slot de entrada já mostra um ■
  // — encerrar a gravação e mandar o áudio — e dois quadrados brancos na mesma
  // fileira são dois recados diferentes com o mesmo desenho. Enquanto o dedo
  // está numa gravação a base da caixa é do gesto de voz, como já é dos chips,
  // que dão lugar à onda.
  const pararEmCena = gerando && !emCaptura(modo);

  /** "Clear"/"Nova conversa" da Tara: arma `codex_next_fresh` no back e zera o
   *  feed local NA HORA (mesmo efeito do /clear do CC). Falha do POST é
   *  silenciosa — o campo esvaziou, e o próximo turno continua a thread atual
   *  sem drama. */
  async function armarNovaConversaTara(): Promise<void> {
    try {
      const { patchAgentCodexNewThread } = await import('@grupo_borges/cockpit-core/api');
      await patchAgentCodexNewThread(agentSlug, true);
      publicaNovaConversa(agentSlug);
    } catch {
      // sem recibo — segue quieto.
    }
  }

  /**
   * `retomada` é o "Reenviar"/"Tentar de novo" da linha de estado: ali o gesto é
   * o TEXTO que ficou pendurado, e nunca o anexo — a foto na mão não é o que
   * falhou, e mandá-la com a legenda de outra mensagem seria despachar algo que
   * o Rica não pediu.
   */
  async function enviar(
    corpo: string,
    retomada = false,
    origemRetomada: OrigemEnvio = 'text',
  ): Promise<boolean> {
    const origem: OrigemEnvio = retomada
      ? origemRetomada
      : origemDoRascunho;
    // O toggle altera só o gesto que nasceu AGORA no campo. O corpo de uma
    // retomada já foi decidido quando entrou na fila ou na máquina de envio;
    // prefixá-lo aqui de novo mudaria a tentativa que o Rica está reabrindo.
    const corpoParaEnviar = prefixaPesquisa(corpo, podePesquisar && pesquisaAtiva, retomada);
    // COMANDOS DA TARA — mesmo efeito do /clear no CC. `clear`/`/clear` apaga
    // a conversa da UI e arma uma thread nova; a próxima mensagem nasce limpa.
    // Interceptado ANTES da porta: é gesto de tela, não texto pro Codex — a
    // bolha otimista nem nasce.
    if (ehCodex && COMANDOS_TARA[corpoParaEnviar.trim().toLowerCase().replace(/^\//, '')]) {
      await armarNovaConversaTara();
      setTexto('');
      setOrigemDoRascunho('text');
      return true;
    }
    // A PORTA decide, e o campo só esvazia se ela liberar. Era o contrário:
    // três `return` mudos recusavam DEPOIS de `setTexto('')` já ter rodado, e
    // em 05/08 uma mensagem do Rica morreu assim — sem requisição, sem aviso,
    // sem sobrar em lugar nenhum. Ver `porta-de-envio.ts`.
    //
    // O ANEXO PASSA POR AQUI, e é o que fecha o último buraco: antes ele subia
    // pela gaveta, sem porta nenhuma, então foto durante o `/compact` cortava o
    // resumo ao meio — exatamente o que a porta impede para o texto.
    const anexar = retidoAnexo !== null && !retomada;
    const efeito = preparaEnvio({
      texto: corpoParaEnviar,
      temAnexo: anexar,
      // Só trava o gesto que LEVA o arquivo. Reenviar um texto pendurado
      // enquanto uma foto sobe não duplica nada e não tem por que esperar.
      anexoEmVoo: anexar && anexoEmVoo,
      turnoEmVoo: gerando,
      motorEnfileiraSozinho,
      compactando: travaCompact,
      faseEnvio: faseLocal,
      // Quem decide se o campo pode esvaziar é a porta, e para decidir ela
      // precisa saber de onde veio o corpo: numa retomada ele vem da máquina,
      // e o campo guarda a mensagem NOVA que o Rica escreveu esperando.
      retomada,
    });
    setRecusa(
      efeito.aviso !== null && efeito.motivo !== null
        ? { motivo: efeito.motivo, aviso: efeito.aviso }
        : null,
    );
    // A recusa com recado é um toque que não saiu. O aviso da faixa pode ficar
    // atrás do teclado no iPhone — quem sente é o botão, sacudindo. Só o toque
    // DIRETO (`!retomada`): o despacho da fila já mostra o recuo no bloco, e o
    // "Reenviar" é o usuário pedindo de novo — nenhum dos dois é gesto mudo.
    if (!retomada && !efeito.despacha && efeito.aviso !== null) {
      setSinalRecusa(true);
    }
    // A FILA. O único caminho em que o campo esvazia sem despacho — e não é
    // descarte: o texto sai do campo e aparece inteiro no bloco logo acima,
    // com o controle de trazê-lo de volta. O despacho é do efeito abaixo,
    // quando a espera terminar.
    if (efeito.enfileira) {
      contadorFila.current += 1;
      const item = { id: `fila-${contadorFila.current}`, texto: corpoParaEnviar, origem };
      setFila((atual) => enfileira(atual, item));
      if (efeito.limpaCampo) {
        setTexto('');
        setOrigemDoRascunho('text');
      }
      return false;
    }
    if (!efeito.despacha) return false;
    // A marca de "eu mandei parar" morre AQUI, no gesto que inequivocamente
    // abre um turno novo — e não num efeito que observa `trabalhando` cair.
    // Aquela versão tinha corrida: no Codex a fase pisca entre dois polls, a
    // marca era apagada no vale e o ■ ressuscitava sobre um agente já parado.
    setInterrompido(false);
    // UM GESTO, UMA ENTREGA: o arquivo sobe com o texto como legenda, no mesmo
    // multipart. Não existe mensagem de texto separada — duas requisições dariam
    // duas entregas ao tmux, e o agente veria a legenda antes ou depois do
    // arquivo sem ordem garantida.
    if (anexar) {
      // Aqui o campo esvazia na ENTREGA, não no aceite. `limpaCampo` é do texto
      // puro, onde esperar o POST deixaria o campo cheio durante a viagem e um
      // segundo Enter duplicaria a mensagem; no anexo quem barra o segundo toque
      // é a porta (`anexo-em-voo`), então esperar não custa nada — e num 422 a
      // legenda continua escrita, que é a metade do "nada evapora" que o arquivo
      // sozinho não cobre.
      if (await anexo.enviar(corpoParaEnviar, (resposta) => {
        if (!ehCodex || resposta.kind !== 'image') return;
        const legenda = corpoParaEnviar.trim();
        const envelope =
          `Imagem enviada via cockpit:\n${resposta.path}` +
          (legenda ? `\nCaption: ${legenda}` : '');
        registraEcoPendente(
          agentSlug,
          legenda || 'Veja a imagem anexa.',
          PRAZO_CODEX_MS,
          envelope,
        );
      })) {
        if (textoAtualRef.current === corpoParaEnviar) {
          setTexto('');
          setOrigemDoRascunho('text');
        }
      } else {
        // A entrega falhou DEPOIS do POST (recusa do tmux, 4xx/5xx, rede). A
        // porta não cobre este caso — ela só vê o gesto ANTES de subir —, então
        // quem responde ao toque é este sinal, a mesma resposta física da
        // recusa de porta. O motivo fica na miniatura, acima do teclado.
        setSinalRecusa(true);
      }
      return true;
    }
    // `/compact` é mensagem comum pro back, mas pra ESTA tela é também o
    // gatilho da espera: inicia a máquina ANTES do POST voltar, porque a
    // barra precisa nascer com o clique, não com o 200.
    if (!ehCodex && COMPACT_RE.test(corpoParaEnviar)) {
      compactPendenteRef.current = true;
      iniciarCompact();
    }
    // Esvazia no instante em que a tentativa é ACEITA, não quando ela é
    // entregue: esperar o POST voltar deixaria o texto no campo durante toda a
    // viagem de rede, e um segundo Enter ali duplica a mensagem. Daqui em
    // diante quem guarda o texto é a máquina (`estado.texto`), que precisa
    // dele para casar o eco e para oferecer novo envio se o eco não vier.
    if (efeito.limpaCampo) {
      setTexto('');
      setOrigemDoRascunho('text');
    }
    setFalhaDaFala(null);
    // O feed pinta esta bolha no GESTO, nos dois motores. Até 15/08 só a Tara
    // tinha isto, com a justificativa de que *"no Claude Code o eco volta pelo
    // stream em milissegundos"* — premissa nunca medida. Medida naquele dia no
    // `:3008`, com o agente ocioso: **18,9 s** entre o Enter e a bolha, contra
    // 0,1 s do campo esvaziando. Dezoito segundos de tela muda são o "engoliu a
    // mensagem" que o Rica reporta desde sempre, e são quase o dobro dos 10 s
    // que a NN/g dá como limite de atenção.
    //
    // A mesma pendência conserta o alarme: `PRAZO_ECO_MS` são 12 s calibrados
    // sobre um pior caso de 1,434 s, então ele estourava ANTES do eco real e
    // toda mensagem para agente ocioso terminava em "não consegui confirmar se
    // entrou". Ver `lib/codex/eco-pendente.ts` e o ramo do CC em
    // `app/agente/[slug]/feed-da-conversa.tsx`.
    const idEcoPendente = registraEcoPendente(
      agentSlug,
      origem === 'stt' ? `${MARCA_VOZ}${corpoParaEnviar}` : corpoParaEnviar,
      // O teto é o tempo que ele fica com a mensagem na tela sem ninguém dizer
      // se entrou — a pendência segura o prazo do alarme. Herdar os 3 min do
      // Codex aqui trocaria um aviso falso aos 12 s por silêncio de três
      // minutos, e silêncio é a queixa original.
      ehCodex ? PRAZO_CODEX_MS : PRAZO_CC_MS,
      origem === 'stt' ? corpoParaEnviar : undefined,
    );
    // Se o POST rejeitar com erro HTTP real (fase `falhou`), a máquina
    // acabou de provar que o texto não saiu — desfaz a bolha otimista em vez
    // de deixá-la contradizendo a faixa de erro por até 3 min (achado [2] da
    // auditoria, 09/08).
    origemDoUltimoEnvio.current = origem;
    await envio.enviar(
      corpoParaEnviar,
      idEcoPendente ? () => descartaEcoPendente(agentSlug, idEcoPendente) : undefined,
      origem,
    );
    return true;
  }

  /**
   * A FILA ANDANDO. Effect Event porque o despacho precisa LER a fila sem
   * DEPENDER dela como reação: o que dispara é a espera mudando de estado.
   *
   * A guarda de `ref` que se costuma escrever aqui não serviria — a doc do
   * React nomeia esse recurso como "a common pitfall" e diz com todas as letras
   * que ele "doesn't fix the bug", só esconde o duplo disparo do StrictMode em
   * desenvolvimento.
   *
   * `reagiuAsFases` devolve o MESMO objeto quando nada muda, então o `setFila`
   * de um tick sem novidade não re-renderiza e o efeito não gira em falso.
   */
  const drenarFila = useEffectEvent(() => {
    const fases = { compact: estadoCompact.fase, envio: faseLocal };
    const atualizado = reagiuAsFases(fila, fases);
    const proximo = proximoDaFila(atualizado, fases);
    if (!proximo) {
      setFila(atualizado);
      return;
    }
    setFila(retira(atualizado, proximo.id).estado);
    // `retomada: true`: o corpo não veio do campo. É o que impede a fila de
    // comer o que ele escreveu DEPOIS — e o que impede a foto retida de sair
    // de carona numa mensagem que não é dela.
    void enviar(proximo.texto, true, proximo.origem).then((saiu) => {
      if (!saiu) setFila((atual) => devolveAoInicio(atual, proximo));
    });
  });

  // A fila entra nas dependências de propósito, e não é ela que dispara o
  // despacho: é ela que faz a DRENAGEM CONTINUAR. Cada item que sai encolhe a
  // fila, o efeito roda de novo e o seguinte espera o eco do anterior — a
  // serialização sai da porta (`envio-em-voo`), não de um laço aqui. É também o
  // que faz o botão "enviar mesmo assim" despachar sem um caminho próprio: ele
  // só apaga a pausa.
  useEffect(() => {
    drenarFila();
  }, [estadoCompact.fase, faseLocal, fila]);

  /** Tira da fila e devolve ao campo — cancelar e editar são o mesmo gesto, e
   *  nada que saia da fila evapora. O que já estava escrito fica embaixo: o
   *  campo é do Rica, e sobrescrevê-lo seria o descarte pela porta dos fundos. */
  function editarDaFila(id: string) {
    const { estado, item } = retira(fila, id);
    if (!item) return;
    setFila(estado);
    setTexto((atual) => (atual.trim() ? `${item.texto}\n${atual}` : item.texto));
    setOrigemDoRascunho((atual) => (atual === 'stt' || item.origem === 'stt' ? 'stt' : 'text'));
    textareaRef.current?.focus();
  }

  function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    enviar(texto);
  }

  function acionar(acao: AcaoEnvio) {
    // Destravar não reenvia nada: abre o canal e devolve a faixa ao estado
    // genérico, onde o botão de mandar de novo volta a existir. Juntar os dois
    // gestos num toque mandaria o texto por um canal cuja abertura ainda não
    // foi confirmada — que é o defeito, não o conserto.
    if (acao === 'destravar') {
      void destravar();
      return;
    }
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
      const origem = origemDoUltimoEnvio.current;
      const idEcoPendente = ehCodex
        ? registraEcoPendente(
            agentSlug,
            origem === 'stt' ? `${MARCA_VOZ}${ultimoEnviado}` : ultimoEnviado,
            PRAZO_CODEX_MS,
            origem === 'stt' ? ultimoEnviado : undefined,
          )
        : null;
      void envio.reenviar(
        idEcoPendente
          ? () => descartaEcoPendente(agentSlug, idEcoPendente)
          : undefined,
      );
      return;
    }
    void enviar(ultimoEnviado, true, origemDoUltimoEnvio.current);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ck-space-1)' }}>
      {/* A BOLINHA — a presença do agente, no alto de tudo que o composer
          empilha. Ela não repete o "Pensando há 12 s" da linha viva: aquilo é
          texto no feed, isto é alguém do outro lado. Presença e nada mais: o ■
          que morava colado nela desceu para a base da caixa em 21/08. */}
      <BolinhaAgente
        status={daFrota?.status}
        turnoVivo={turnoVivo}
        escrevendo={escrevendo}
      />
      {/* A espera do `/compact` mora ACIMA da caixa e empurra tudo pra baixo —
          faixa fina da largura da coluna, nunca overlay nem modal. */}
      <BarraCompact estado={estadoCompact} onDispensar={cancelarCompact} />
      {/* A FILA DA ESPERA — entre o indicador de trabalho e a caixa, nunca
          dentro dela: o campo é o que está sendo escrito agora, a fila é o que
          já saiu das mãos. */}
      <BlocoDaFila
        estado={fila}
        aoEditar={editarDaFila}
        aoForcar={() => setFila(soltaPausa(fila))}
      />
      {/* A LINHA DA VOZ — sempre no layout, inclusive quando não há nada a
          dizer. As duas mensagens daqui montavam e desmontavam várias vezes por
          gesto (existem em `pedindo` e `transcrevendo`, somem em `gravando`), e
          como o composer está ancorado embaixo cada troca subia e descia 22,6px
          de TUDO que está acima. É o solavanco que o Rica sente ao SOLTAR o
          dedo — medido em `docs/cockpit-v2-medicao/faixa-da-voz-nao-empurra.py`,
          que reprova o build sem esta reserva.

          E ela mora ACIMA da caixa, não embaixo, embora fale do botão que está
          embaixo. Debaixo da caixa o orçamento já está fechado e é contado:
          `palco-da-conversa.tsx` desconta 21px do `safe-bottom` porque sabe que
          o reservador da linha de status está ali, e a conta existe para a
          caixa terminar a 34px do fundo — a barra de gestos do iPhone, régua
          que o Rica mandou em 13/08. Uma reserva permanente a mais ali empurra
          a caixa para cima do fundo da tela e nenhum padding traz de volta
          (`folga-embaixo-do-composer.py` reprova em 57px). Acima da caixa não
          há orçamento nenhum: quem cede o espaço é a conversa, que rola.

          `visibility: hidden` reservaria o espaço, mas some da árvore de
          acessibilidade — e esta linha existe justamente para AVISAR. Altura
          fixa também não serve: o aviso do microfone traz botão de dispensar e
          pode passar de uma linha. Daí `minHeight`, que é piso e não teto. O
          `flex-col` está aqui por causa do strut: em bloco comum a linha vazia
          herdaria o corpo de 16px e ficaria mais alta que o texto de 12px que
          ela reserva.

          DEPOIS DE 20/08 a reserva guarda MENOS gente: a narração de fase
          virou `sr-only` e não ocupa mais espaço nenhum. Quem ainda monta e
          desmonta aqui é o aviso do microfone e o teto de 30s do STT — ambos
          raros, ambos com botão ou moldura junto, e é para eles que a linha
          continua reservada. */}
      <div
        className="mx-auto flex w-full flex-col"
        style={{
          maxWidth: 'var(--ck-w-composer)',
          padding: '0 var(--ck-space-2)',
          minHeight: 'calc(var(--ck-text-xs) * var(--ck-leading-body))',
        }}
      >
        {/* MICROFONE INDISPONÍVEL. Nunca um botão que não responde — o defeito
            que esta rodada consertou no envio, aqui com outra roupa. Sempre duas
            coisas: o que aconteceu e o que fazer a respeito. A saída é a parte
            que importa; "permissão negada" sozinho manda o Rica adivinhar em
            qual das telas de ajuste do iPhone ele mexe. */}
        {avisoDaVoz ? (
          <div
            className="flex w-full items-start justify-between"
            style={{ gap: 'var(--ck-space-3)' }}
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

        {/* A VOZ FALANDO DE FORA DA CAIXA — agora só quando tem RECADO, nunca
            para narrar a fase. Rica, 20/08, vendo o ciclo gravado: *"na hora
            que eu clico aparece tipo umas frases em cima do composer, eu acho
            que não precisaria ter essa UI"*.

            Ele está certo sobre a narração: `liberando o microfone…` passa num
            quadro e ninguém lê, e `transcrevendo…` repete o que o fio na base
            da caixa já está dizendo com o próprio movimento. Duas peças para o
            mesmo recado, e a de cima é a que empurra a conversa.

            SOME DOS OLHOS, NÃO DA ÁRVORE DE ACESSIBILIDADE. Quem não enxerga o
            fio depende desta linha para saber que existe um tempo morto de STT
            — é literalmente o motivo pelo qual `visibility: hidden` foi
            recusado na reserva acima. `sr-only` mantém o nó no lugar e o
            `aria-live` falando; o que ele tira é a tinta.

            O ÚNICO que continua à vista é `travada` com áudio longo: ali a
            moldura vira âmbar, e cor sem motivo escrito é enfeite — quem vê o
            âmbar precisa saber que é o teto de 30s do STT chegando. Não é
            fase passando, é aviso, e aviso se lê. */}
        {vozAparencia.instrucao && faseVoz !== 'impedida' ? (
          <span
            role="status"
            aria-live="polite"
            // O punho da bancada. Há outras regiões `status` na tela (a bolinha
            // do agente é uma), e `troca-da-fala-nao-e-de-estalo.py` precisa
            // pegar ESTA para provar que ela ficou muda aos olhos e viva no
            // leitor de tela.
            data-linha="voz"
            className={avisoDoTetoDoStt ? undefined : 'sr-only'}
            style={
              avisoDoTetoDoStt
                ? {
                    fontSize: 'var(--ck-text-xs)',
                    color: vozAparencia.tinta ?? 'var(--ck-text-secondary)',
                  }
                : undefined
            }
          >
            {vozAparencia.instrucao}
          </span>
        ) : null}
      </div>
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
          // A CAIXA É MATERIAL, não superfície opaca. Ela não tem
          // `backdrop-filter` próprio de propósito: o véu atrás já desfocou o
          // feed, e um segundo desfoque aqui só custaria GPU para borrar o que
          // já está borrado. O que ela faz é somar um degrau de luz sobre o
          // resultado — é assim que a referência distingue a pílula da faixa
          // sem opacar nenhuma das duas, e é por isso que o texto do feed
          // atravessa POR DENTRO dela. Ver §18 da estética.
          background: 'var(--ck-surface-composer-material)',
          borderColor: fileteDoEstado ?? 'var(--ck-edge-composer)',
          // A borda inteira (não só um filete de 2px) muda de cor no estado
          // quente: o composer é a única superfície de INPUT da tela, e ali a
          // convenção do filete lateral (linha de execução, mensagem) compete
          // com a moldura que o campo já tem por natureza. Quem sinaliza é a
          // COR, e só ela: o 1.5px do estado saiu em 08/08, quando o Rica pediu
          // "borda fininha, igual nós temos no CC" — engrossar era um segundo
          // portador para o mesmo recado, e o que ele nota é a espessura.
          borderWidth: '1px',
          // Raio próprio, maior que o do resto (§adendo): a referência do Codex
          // arredonda a caixa de fala bem mais do que os blocos de conteúdo, e
          // `--ck-radius-frame` veste código/diff/thinking, onde macio demais
          // rouba leitura. Ver o comentário do token em `globals.css`.
          borderRadius: 'var(--ck-radius-caixa)',
          position: 'relative',
          overflow: 'hidden',
          // O mesmo slow do resto da troca. Em `--ck-dur-fast` (120ms) a
          // moldura chegava na cor nova antes de o microfone chegar na dele, e
          // a caixa mudava em duas etapas — o estado da fala é UM, e muda como
          // um só gesto.
          transition: `border-color var(--ck-dur-enter, 200ms) var(--ck-ease)`,
        }}
      >
        {/* A miniatura é o PRIMEIRO filho da caixa: ela empurra o campo para
            baixo em vez de flutuar sobre ele, e o composer cresce. O anexo
            escolhido não some porque o microfone abriu. Ela fica na tela do
            primeiro toque até a entrega — ver `miniatura-anexo.tsx`. */}
        <MiniaturaAnexo estado={anexo.estado} aoRemover={anexo.limpar} />

        <BolhaDeComandos
          agentSlug={agentSlug}
          texto={texto}
          aoSelecionar={(valor) => {
            setTexto(valor);
            setOrigemDoRascunho('text');
          }}
          campoRef={textareaRef}
          ativa={!ehCodex}
        >
          <textarea
              ref={textareaRef}
              // UMA LINHA que cresce digitando — ordem do Rica em 08/08, olhando a
              // referência: "queria que o input de texto tivesse uma linha só,
              // igual a do CC, e não duas linhas … conforme eu vou digitando e
              // pulando linha, ela vai aumentando na altura". Revoga a §12 da
              // estética, que mandava caixa alta; os controles continuam dentro.
              rows={1}
              value={texto}
              // SEM `disabled`, de propósito. A doc do React descreve `disabled`
              // como "will not be interactive and will appear dimmed": o elemento
              // sai do alcance do foco, e no iPhone isso fecha o teclado no meio
              // da digitação. Quem bloqueia é a PORTA, no submit — o campo segue
              // editável, ele escreve durante a espera e manda com um toque quando
              // ela passa. É o que garante que o texto nunca evapora.
              readOnly={emCaptura(modo)}
              onChange={(e) => {
                setTexto(e.target.value);
                setOrigemDoRascunho((atual) =>
                  origemDepoisDaEdicao(
                    atual,
                    e.target.value,
                    substituicaoIntegralRef.current,
                  ),
                );
                substituicaoIntegralRef.current = false;
              }}
              onBeforeInput={(e) => {
                const campo = e.currentTarget;
                substituicaoIntegralRef.current =
                  campo.selectionStart === 0 && campo.selectionEnd === campo.value.length;
              }}
              // COLAR IMAGEM. No iPhone, "copiar" numa foto e colar no campo é
              // o gesto natural — e até 15/08 não fazia nada, nem erro: o
              // clipboard trazia o arquivo e ninguém o pegava. Cai na MESMA
              // máquina do botão de anexar, então a foto vira miniatura com o
              // controle de remover e quem decide se ela parte continua sendo a
              // porta. Print de tela chega sem nome; o `File` do clipboard já
              // vem com um sintético do navegador, e a máquina de anexo lida
              // com isso desde sempre.
              onPaste={(e) => {
                const arquivo = [...e.clipboardData.items]
                  .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
                  ?.getAsFile();
                if (!arquivo) return; // texto colado segue o caminho normal
                e.preventDefault();
                anexo.escolher(arquivo);
              }}
              // Com ANEXO na mão o Enter volta a enviar no touch. A quebra de linha
              // ficou pro texto puro, mas sem o envio a foto era um beco: o Shift
              // não existe no teclado virtual, e o "manda e não sai" do reporte de
              // 08/08 era o Enter virando newline com a foto retida — o único
              // gesto de enviar que o Rica tinha ali. `enterKeyHint` troca a tecla
              // do teclado virtual pra "Enviar" exatamente nesse caso, pra o toque
              // não parecer morto.
              enterKeyHint={tecladoTouch && retidoAnexo !== null ? 'send' : undefined}
              onKeyDown={(e) => {
                // A ACENTUAÇÃO não pode virar envio. Segurar a tecla no iPhone
                // para escolher "ã"/"ç" — ou usar tecla morta no teclado físico
                // — abre uma sessão de composição, e o Enter que confirma a
                // escolha chega aqui como um Enter comum. Sem guarda, escrever
                // "não" ou "ação" despacha a mensagem no meio da palavra; em
                // português isso não é caso de borda, é quase toda frase.
                //
                // O TESTE É DUPLO, e a segunda metade não é redundância: a MDN
                // é explícita em que `isComposing` vale `false` no PRIMEIRO e no
                // ÚLTIMO caractere da composição — "compositionstart may fire
                // after keydown… In these cases, isComposing is false even when
                // the event is part of composition". A receita publicada lá é
                // literalmente `if (event.isComposing || event.keyCode === 229)
                // return;`, e o 229 é normativo: o W3C UI Events (§7.2.1) manda
                // "If an Input Method Editor is processing key input and the
                // event is keydown, return 229". Minha primeira versão checava
                // só `isComposing` e deixava passar exatamente as duas bordas.
                const compondo = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
                if (
                  e.key === 'Enter' &&
                  !compondo &&
                  !e.shiftKey &&
                  (!tecladoTouch || retidoAnexo !== null)
                ) {
                  e.preventDefault();
                  // Bolha aberta: Enter não é "enviar `/`", é ainda estar
                  // escolhendo. Sem esta guarda o único jeito de sair do
                  // gesto de digitar `/` e apertar Enter era mandar um `/`
                  // sozinho pro agente.
                  if (bolhaComandosAberta) return;
                  enviar(texto);
                }
              }}
              // "aguarde" era a mesma promessa vazia da faixa: dizia para esperar
              // sem dizer o que aconteceria com o que ele escrevesse. Agora entra
              // na fila e sai sozinha, e o campo diz isso antes do primeiro Enter.
              aria-label={`Mensagem para ${agentName}`}
              placeholder={
                emCaptura(modo)
                  ? 'Ouvindo…'
                  : travaCompact
                    ? 'compactando… pode escrever, entra na fila'
                    : undefined
              }
              className="ck-campo leading-body min-w-0 resize-none bg-transparent outline-none"
              style={{
                fontSize: 'var(--ck-text-md)', // 16px: piso do iOS contra zoom no foco
                // Teto para o crescimento: passando disto o composer comeria a
                // conversa. Rolagem interna assume, que é o que o CC faz.
                maxHeight: 'var(--ck-h-campo-max)',
              }}
          />
        </BolhaDeComandos>

        {/* Base do composer: os controles moram AQUI, dentro da caixa — §12.1.
            O piso é a altura que a fileira de botões produz de fato: alvo de
            44px menos os 4px com que `MARGEM_INFERIOR_DA_BASE` encosta os
            controles na linha do texto. Com o piso 4px abaixo disso a linha
            encolhia toda vez que a onda entrava no lugar dos botões — a caixa
            perdia 4px na captura e a conversa andava junto. */}
        <div
          className="flex items-end justify-between"
          style={{
            gap: 'var(--ck-space-2)',
            minHeight: 'calc(var(--ck-touch-min) - var(--ck-space-1))',
          }}
        >
          {modo === 'travada' ? (
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
          ) : emCaptura(modo) ? null : (
            <BotaoAnexo
              estado={anexo.estado}
              alternarGaveta={anexo.alternarGaveta}
              // `emAndamento` SAIU daqui (15/08). Abrir a gaveta e escolher um
              // arquivo é gesto LOCAL: nada sobe, o arquivo fica retido na
              // miniatura e quem decide se ele pode partir continua sendo a
              // porta, no toque de enviar. Desabilitar por causa do envio
              // ANTERIOR fazia o `+` morrer nos segundos em que o Rica mais o
              // usa — enquanto lê a resposta e quer mandar a foto do assunto —
              // e botão morto não responde nem diz por quê, que é o defeito da
              // §9 que este composer inteiro existe para não cometer. É a mesma
              // razão pela qual o botão de ENVIAR fica habilitado mesmo quando
              // a porta vai recusar.
              desabilitado={travaCompact}
              botaoRef={botaoAnexoRef}
            />
          )}

          <div
            // O DESLOCAMENTO. Sem despacho em cena a fileira desliza para a
            // direita pela largura do slot: o microfone encosta na borda e o
            // botão sai pela beirada, onde o `overflow: hidden` da caixa o
            // recorta. Digitar traz a fileira de volta e o botão aparece no
            // lugar que abriu — o movimento em vez do buraco (Rica, 20/08:
            // *"parecendo uma boca com um dente a menos"*). Regra em
            // `.ck-fileira-acoes`.
            className="ck-fileira-acoes flex min-w-0 flex-1 items-center justify-end"
            data-despacho={despachoEmCena ? 'em-cena' : 'oculto'}
            style={{ gap: 'var(--ck-space-3)' }}
          >
            {/* A TROCA DA FALA. Rica, 20/08, no mesmo vídeo: *"a transição
                entre uma coisa e outra tem que respeitar um certo slow, que é
                o que a gente tem na hora que a gente abre o painel, senão fica
                duro"*. A onda entrava e saía de estalo porque isto era um
                ternário — e saída não se anima com o elemento sendo REMOVIDO
                do DOM, que é a regra que fez a gaveta virar `data-aberto` em
                vez de desmontar.

                Agora os dois lados ficam montados, empilhados na mesma célula
                de grade, e quem troca é o `data-onda`. A fileira não muda de
                largura nem de altura na passagem, quem anima é só `opacity`
                (§9.4), e fora de cena é `visibility` — não pinta, não recebe
                toque, não entra em leitor de tela. Regra em
                `.ck-troca-da-fala`. */}
            <div
              className="ck-troca-da-fala"
              data-onda={emCaptura(modo) ? 'true' : 'false'}
            >
              <div className="ck-troca-da-fala-face" data-face="onda">
                <OndaCompacta
                  niveis={niveisVoz}
                  tinta={vozAparencia.tinta ?? 'var(--ck-state-running)'}
                />
              </div>
              <div className="ck-troca-da-fala-face" data-face="acoes">
                {podePesquisar ? (
                  <button
                    type="button"
                    onClick={() => setPesquisaAtiva((ativa) => !ativa)}
                    aria-pressed={pesquisaAtiva}
                    aria-label={pesquisaAtiva ? 'Desativar pesquisa do Canarinho' : 'Ativar pesquisa do Canarinho'}
                    title={pesquisaAtiva ? 'Desativar pesquisa' : 'Ativar pesquisa'}
                    data-selecionado={pesquisaAtiva ? 'true' : 'false'}
                    className="ck-veil flex shrink-0 items-center justify-center"
                    style={{
                      minWidth: 'var(--ck-touch-min)',
                      minHeight: 'var(--ck-touch-min)',
                      marginBottom: 'calc(var(--ck-space-1) * -1)',
                      borderRadius: 'var(--ck-radius-chip)',
                      color: pesquisaAtiva ? 'var(--ck-alert-warning)' : 'var(--ck-text-secondary)',
                    }}
                  >
                    <IconeBusca tamanho={17} />
                  </button>
                ) : null}
                <PilulaDeTokens agentSlug={agentSlug} />
                <SeletorMotor
                  agentSlug={agentSlug}
                  agentName={agentName}
                  motor={motor}
                  esforcoCobrePedido={esforcoCobrePedido}
                />
              </div>
            </div>
            {/* TRÊS SLOTS, UM ASSUNTO CADA. Até 20/08 havia um só, com quatro
                donos em cascata, e a cascata é que produzia os becos: o ■ comeu
                o microfone de madrugada (`678f598`), e antes disso o microfone
                tinha comido o envio (15/08). Cada conserto empurrava o defeito
                para o vizinho porque o lugar era um e os assuntos, três.

                Agora a posição na árvore é a identidade — a documentação
                oferece as duas formas de separar estado, `key` explícita ou
                posições diferentes, e esta fase escolhe a segunda
                (`react.dev/learn/preserving-and-resetting-state`). A `key` de
                cada ramo continua onde estava: dentro de um slot ela ainda
                impede o React de mutar o `type` do mesmo nó, que é o que fazia
                o clique do microfone cair no submit logo em seguida.

                O que ISTO destrava, e não era o objetivo: com o microfone em
                lugar próprio, dá para falar com texto já escrito no campo. Não
                dava — o botão de voz só existia quando o campo estava vazio, e
                `mesclaTranscricao` já sabia costurar a fala no que havia antes.
                A tela é que não deixava chegar lá. */}

            {/* SLOT DE ESTADO. O ■ voltou para dentro da caixa em 21/08 —
                *"precisamos reposicionar o componente parar, que está
                erradamente ao lado do mascote"*. Ele passou 20/08 colado na
                bolinha porque o slot da caixa era um só e ele comia o
                microfone; com três slots, um assunto cada, o beco não reabre:
                este alvo nunca é o do gesto de entrada nem o do despacho.

                Fora de cena ele fica no DOM mas NÃO COBRA LARGURA. O irmão do
                despacho cobra — ele guarda os 44px e a fileira desliza por cima
                —, e aqui isso não serve: a fileira já vive no limite em 390px,
                e 44px permanentes a menos deixavam o rótulo do motor em
                *"extra a"* mesmo com o agente parado. Medido no estágio antes
                de trocar. A margem negativa some com o espaço; em cena ela
                volta a zero e os chips cedem lugar.

                O TEMPO DA MARGEM É O TRUQUE DO `visibility`, não uma animação
                de largura (§9.4 continua valendo — nada interpola quadro a
                quadro): ela vira em `0s` na entrada, para o botão nascer no
                lugar dele, e na saída espera o fade inteiro, para os chips só
                reclamarem o espaço depois que ele apagou.

                Não pinta, não recebe toque, não é anunciado, não tabula: fora
                de cena não é botão morto, é botão que não está lá. */}
            <button
              key="parar"
              type="button"
              onClick={() => void interromper()}
              disabled={parando}
              aria-label={`Parar ${agentName}`}
              aria-hidden={!pararEmCena}
              tabIndex={pararEmCena ? undefined : -1}
              title="Parar"
              className="flex shrink-0 items-center justify-center disabled:opacity-40"
              style={{
                ...ALVO_DE_TOQUE,
                width: '32px',
                height: '32px',
                marginBottom: MARGEM_INFERIOR_DA_BASE,
                borderRadius: 'var(--ck-radius-pill)',
                background: 'var(--ck-text-primary)',
                color: 'var(--ck-surface-canvas)',
                opacity: pararEmCena ? 1 : 0,
                pointerEvents: pararEmCena ? undefined : 'none',
                // Longhand DEPOIS do spread, como o `marginBottom` acima: o
                // `margin` shorthand de `ALVO_DE_TOQUE` apagaria isto se viesse
                // por último. Cancela os 32px do disco mais o gap da fileira.
                marginInlineEnd: pararEmCena
                  ? undefined
                  : 'calc((var(--ck-touch-min) - 32px) / -2 - 32px - var(--ck-space-3))',
                transition: pararEmCena
                  ? 'opacity var(--ck-dur-enter, 200ms) var(--ck-ease), margin-inline-end 0s'
                  : 'opacity var(--ck-dur-enter, 200ms) var(--ck-ease-exit), margin-inline-end 0s linear var(--ck-dur-enter, 200ms)',
              }}
            >
              <IconeParar />
            </button>

            {/* SLOT DE ENTRADA. Nunca some, nunca cede lugar. Em `travada` o
                gesto acabou e a gravação não: o mesmo pixel que abriu é o que
                fecha e despacha o áudio. */}
            {modo === 'travada' ? (
              <button
                key="enviar-audio"
                type="button"
                onClick={gravador.enviarTravada}
                aria-label={`Enviar áudio para ${agentName}`}
                className="flex shrink-0 items-center justify-center"
                style={{
                  ...ALVO_DE_TOQUE,
                  width: '32px',
                  height: '32px',
                  marginBottom: MARGEM_INFERIOR_DA_BASE,
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
                disabled={faseVoz === 'transcrevendo'}
                {...gravador.handlers}
                // Os DOIS gestos no rótulo, porque agora são dois: toque curto
                // grava sem segurar, segurar é push-to-talk. React Aria manda
                // anunciar a pressão longa a quem não vê a tela
                // (`accessibilityDescription`, em `useLongPress`) — sem isso o
                // arrastar-para-cancelar não existe para o leitor de tela.
                aria-label={
                  emCaptura(modo)
                    ? vozAparencia.anuncio
                    : `Segure para falar com ${agentName}, ou toque para gravar sem segurar`
                }
                className="flex shrink-0 items-center justify-center disabled:opacity-40"
                style={{
                  ...ALVO_DE_TOQUE,
                  width: '32px',
                  height: '32px',
                  marginBottom: MARGEM_INFERIOR_DA_BASE,
                  borderRadius: 'var(--ck-radius-pill)',
                  // DOIS DISCOS CHEIOS LADO A LADO é o defeito que o ■ já
                  // evitou uma vez ("o dedo que mira um acha o outro"). Com
                  // qualquer vizinho de massa em cena — o despacho à direita ou
                  // o ■ à esquerda — o microfone recua para contorno: continua
                  // com os 44px de alvo, perde só a tinta.
                  background: emCaptura(modo)
                    ? vozAparencia.tinta ?? 'var(--ck-state-running)'
                    : temConteudo || pararEmCena
                      ? 'transparent'
                      : 'var(--ck-text-primary)',
                  color:
                    emCaptura(modo) || !(temConteudo || pararEmCena)
                      ? 'var(--ck-surface-canvas)'
                      : 'var(--ck-text-secondary)',
                  // A tinta troca no tempo da casa, não de estalo: o disco
                  // claro virando ciano é a mudança mais visível do ciclo
                  // inteiro. `background` e `color` não custam layout — a
                  // proibição §9.4 é sobre `width`/`height`/`top`/`left`, e a
                  // borda da caixa aqui do lado já transiciona assim.
                  transition:
                    'background var(--ck-dur-enter, 200ms) var(--ck-ease), color var(--ck-dur-enter, 200ms) var(--ck-ease)',
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  WebkitTouchCallout: 'none',
                }}
              >
                <IconeOnda />
              </button>
            )}

            {/* SLOT DE DESPACHO. Nunca é buraco: quando não há o que mandar,
                quem some é ELE, saindo pela borda com a fileira — e não um vão
                reservado no meio da barra. Um alvo visível e mudo aqui também
                não serviria: `vazio` é a única recusa sem recado no módulo da
                porta, e botão que não responde nem diz por quê é a §9. */}
            <button
              key="enviar"
              type="submit"
              // Habilitado mesmo quando a porta vai recusar: desabilitado ele
              // não responde ao toque e não diz por quê, que é o botão morto
              // da §9. Tocar agora devolve o motivo na faixa abaixo — e, se a
              // faixa estiver escondida atrás do teclado, o botão sacode
              // (`sinalRecusa` + `.ck-sacudir`) pra o toque não parecer morto.
              //
              // FORA DE CENA ele não é botão morto: não pinta, não recebe
              // toque, não é anunciado e não entra na ordem de tabulação — não
              // é um alvo que ignora o dedo, é um alvo que não está lá. Fica no
              // DOM porque é a largura dele que a fileira desliza, e porque um
              // botão que nasce e morre a cada tecla não teria o que animar.
              onAnimationEnd={() => setSinalRecusa(false)}
              aria-label={`Enviar para ${agentName}`}
              aria-hidden={!despachoEmCena}
              tabIndex={despachoEmCena ? undefined : -1}
              className={
                'flex shrink-0 items-center justify-center' +
                (sinalRecusa ? ' ck-sacudir' : '')
              }
              style={{
                ...ALVO_DE_TOQUE,
                width: '32px',
                height: '32px',
                marginBottom: MARGEM_INFERIOR_DA_BASE,
                borderRadius: 'var(--ck-radius-pill)',
                background: 'var(--ck-text-primary)',
                color: 'var(--ck-surface-canvas)',
                opacity: despachoEmCena ? 1 : 0,
                pointerEvents: despachoEmCena ? undefined : 'none',
                transition: 'opacity var(--ck-dur-enter, 200ms) var(--ck-ease)',
              }}
            >
              <IconeEnviar />
            </button>
          </div>
        </div>

        {/* O fio — ver `aparencia-envio.ts`. Track de 2px na base, dentro da
            própria moldura (`overflow:hidden` do form recorta a ponta). Só
            `transform` anima: o compositor não recalcula layout.

            O ENVIO DE TEXTO NÃO O ACENDE MAIS (Rica, 11/08): quando a mensagem
            sai, ela já está no feed, e a espera se acompanha por lá.

            E A VOZ TAMBÉM NÃO O ACENDE MAIS (Rica, 20/08): *"esse raio azul que
            passa embaixo do composer eu queria tirar de todo mundo"*. O fio
            corria a cada fala, e o que ele anunciava — "o STT está trabalhando"
            — a fala ao vivo tornou visível de um jeito melhor: as palavras
            entram no rascunho enquanto ele fala. Quando o canal ao vivo não
            entrega e o arquivo assume, quem responde "estou trabalhando" é a
            frase `transcrevendo…` ali em cima, que diz DE QUE se espera — coisa
            que um fio correndo nunca disse.

            Sobrou o único caso em que o composer é a ÚNICA tela do assunto: o
            fio TRAVADO do `nao-confirmado`, que é âmbar, é estático e existe
            pra ser visto. */}
        {aparencia.fio !== 'nenhum' ? (
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
              style={{
                width: '30%',
                height: '100%',
                background: aparencia.filete ?? 'var(--ck-state-attention)',
                // Travado: parado na METADE do trajeto — é a imagem literal do
                // "ficou pelo caminho", não uma barra de progresso genérica.
                transform: aparencia.fio === 'travado' ? 'translateX(120%)' : undefined,
              }}
            />
          </div>
        ) : null}
      </form>

        {/* O RODAPÉ DE VIDRO. Ancorado na base da caixa (`top: 100%`) e descendo
            além do fim da tela — quem recorta é o `overflow: hidden` do palco,
            e é por isso que este elemento não precisa conhecer o padding do
            wrapper que o Pavan escolheu. O tint é na cor do CANVAS: some quando
            não há nada atrás (que é o estado do fim da rolagem, o mais comum de
            todos) e continua apagando quando há texto passando, porque quem faz
            esse trabalho é o desfoque. Ver §18 da estética.
            `aria-hidden` porque não há nada a anunciar, e sem eventos para não
            roubar o toque de quem mira o fim do feed. */}
        <div
          aria-hidden
          className="ck-rodape-vidro pointer-events-none absolute"
          style={{ top: '100%', left: '-50vw', right: '-50vw', height: '50vh' }}
        />

        {/* A GAVETA. Irmã do form, dentro do invólucro ancorado — sobe a partir
            do "+" e nunca é recortada pelo `overflow` da caixa. */}
        <PainelAnexo
          estado={anexo.estado}
          fecharGaveta={anexo.fecharGaveta}
          escolher={anexo.escolher}
          botaoRef={botaoAnexoRef}
        />
      </div>

      {/* O ESTADO DO ANEXO — subindo, recusado, entregue. Vem antes do aviso da
          voz porque é o gesto mais recente quando existe. */}
      <AvisoAnexo estado={anexo.estado} aoDispensar={anexo.dispensarAviso} />

      {/* POR QUE NÃO SAIU. Antes desta faixa a recusa era um `return` mudo: o
          Rica tocava Enter, o campo esvaziava e a mensagem não existia mais em
          lugar nenhum. Sem botão de dispensar — o aviso morre quando o motivo
          morre.

          A recusa do COMPACT não passa mais por aqui: ela virou fila, e quem
          fala por ela é o bloco lá em cima, com o texto à vista. O que sobra
          nesta faixa são as esperas de segundos (envio e anexo em voo) — para
          essas, esperar é mesmo a única coisa a fazer. */}
      {avisoDaPorta ? (
        <span
          role="status"
          aria-live="polite"
          className="mx-auto w-full"
          style={{
            maxWidth: 'var(--ck-w-composer)',
            padding: '0 var(--ck-space-2)',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-state-attention)',
          }}
        >
          {avisoDaPorta}
        </span>
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
