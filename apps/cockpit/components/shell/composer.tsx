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
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { aparenciaDe, emTransito, rotulaAcao, type AcaoEnvio, type FaseEnvio } from './aparencia-envio';
import { copyText } from '../../lib/clipboard';
import { usaCompact } from '../../lib/compact';
import { arquivoRetido, usaAnexo } from '../../lib/usa-anexo';
import { descartaEcoPendente, registraEcoPendente } from '../../lib/codex/eco-pendente';
import { publicaNovaConversa } from '../../lib/codex/nova-conversa';
import { usaFrota } from './frota-provider';
import { MARCA_VOZ, usaEnvio } from '../../lib/usa-envio';
import { AvisoAnexo, BotaoAnexo, PainelAnexo } from './gaveta-anexo';
import { MiniaturaAnexo } from './miniatura-anexo';
import { BarraCompact } from './barra-compact';
import { BlocoDaFila } from './bloco-da-fila';
import {
  FILA_VAZIA,
  devolveAoInicio,
  enfileira,
  proximoDaFila,
  reagiuAsFases,
  retira,
  soltaPausa,
  type ItemDaFila,
} from './fila-de-envio';
import { fallbackCopy } from '../renderers/copia-fallback';
import { type Motor } from './motor';
import { SeletorMotor } from './seletor-motor';
import { preparaEnvio } from './porta-de-envio';
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
  IconeCadeado,
  IconeCopiar,
  IconeDescartar,
  IconeEnviar,
  IconeOnda,
  IconeParar,
  IconeReenviar,
} from './icones';
import { usaCanalEntrega } from './usa-canal-entrega';

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
  const [texto, setTexto] = useState('');
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
  const [avisoDaPorta, setAvisoDaPorta] = useState<string | null>(null);
  // O SINAL DE RECUSA. A porta recusou um toque com recado — o botão de enviar
  // sacode pra o Rica sentir o "não" mesmo quando o aviso da faixa fica
  // escondido atrás do teclado do iPhone. Estado e não classe persistente:
  // `onAnimationEnd` limpa, então o próximo toque recusado re-sacode.
  const [sinalRecusa, setSinalRecusa] = useState(false);
  const anexoEmVoo = anexo.estado.fase === 'enviando';
  useEffect(() => {
    // A lista é a dos IMPEDIMENTOS, e o anexo em voo entrou nela junto com o
    // recado dele. Sem esta linha o "ainda está subindo" ficaria na tela depois
    // que o arquivo já chegou — aviso que sobrevive ao motivo vira mentira.
    if (!travaCompact && faseLocal !== 'enviando' && faseLocal !== 'aceito' && !anexoEmVoo) {
      setAvisoDaPorta(null);
    }
  }, [travaCompact, faseLocal, anexoEmVoo]);

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
  const aparencia = aparenciaDe(fase, agentName, { canalBloqueado, destravaFalhou });
  // O caminho feliz não pinta mais a borda — `enviando`/`aceito` devolvem
  // `filete: null` desde 11/08, para os seis agentes (o porquê está em
  // `aparencia-envio.ts`). O que chega aqui colorido é só insucesso.
  const fileteDoEstado = aparencia.filete;

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
      // espera corta o resumo do mesmo jeito. A recusa continua; o que muda é
      // que ela FALA — descartar áudio calado é o mesmo defeito do texto, e
      // pior, porque o áudio não tem campo onde ficar.
      const efeito = preparaEnvio({
        compactando: travaCompact,
        faseEnvio: envio.estado.fase,
        midia: 'voz',
      });
      if (!efeito.despacha) {
        setAvisoDaPorta(efeito.aviso);
        return;
      }
      setAvisoDaPorta(null);
      setFalhaDaFala(null);
      try {
        // O que o servidor ENTENDEU aparece na tela. STT erra, e o Rica precisa
        // saber o que o agente recebeu — sem isso ele descobre pela resposta
        // errada do agente, três minutos depois.
        const falado = await envio.enviarVoz(audio);
        // A MESMA BOLHA OTIMISTA DO TEXTO (ver a chamada em `despacha`), que só
        // o ramo escrito registrava. Sem ela o feed da Tara ficava mudo os ~12 s
        // do `codex exec` subindo, e o prazo do composer — que decide olhando
        // `temPendencia` — caía em âmbar dizendo que o áudio podia não ter
        // entrado, num envio que entrou.
        //
        // Registrar COM a marca é requisito, não enfeite: o rollout guarda o
        // texto marcado e `reconciliaPendentes` casa por texto exato. Sem ela a
        // pendência ficaria sem par até expirar.
        //
        // Depois do `await` porque antes dele não existe transcrição — a bolha
        // nasce no fim do STT, não no gesto. É o mais cedo possível aqui.
        if (falado !== null && ehCodex) {
          registraEcoPendente(agentSlug, `${MARCA_VOZ}${falado}`);
        }
        setTranscrito(falado);
      } catch (erro) {
        // O back só entrega DEPOIS de transcrever: falha aqui significa que
        // nada chegou ao agente. Por isso a fala tem aviso próprio em vez de
        // virar `falhou` da máquina de envio — ali "reenviar" não teria texto
        // nenhum para reenviar, e botão que não responde é o defeito da §9.
        setTranscrito(null);
        setFalhaDaFala(diagnosticaTranscricao(erro));
      }
    },
    [agentSlug, ehCodex, envio, travaCompact],
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
  async function enviar(corpo: string, retomada = false): Promise<boolean> {
    // COMANDOS DA TARA — mesmo efeito do /clear no CC. `clear`/`/clear` apaga
    // a conversa da UI e arma uma thread nova; a próxima mensagem nasce limpa.
    // Interceptado ANTES da porta: é gesto de tela, não texto pro Codex — a
    // bolha otimista nem nasce.
    if (ehCodex && COMANDOS_TARA[corpo.trim().toLowerCase().replace(/^\//, '')]) {
      await armarNovaConversaTara();
      setTexto('');
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
      texto: corpo,
      temAnexo: anexar,
      // Só trava o gesto que LEVA o arquivo. Reenviar um texto pendurado
      // enquanto uma foto sobe não duplica nada e não tem por que esperar.
      anexoEmVoo: anexar && anexoEmVoo,
      compactando: travaCompact,
      faseEnvio: faseLocal,
      // Quem decide se o campo pode esvaziar é a porta, e para decidir ela
      // precisa saber de onde veio o corpo: numa retomada ele vem da máquina,
      // e o campo guarda a mensagem NOVA que o Rica escreveu esperando.
      retomada,
    });
    setAvisoDaPorta(efeito.aviso);
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
      const item = { id: `fila-${contadorFila.current}`, texto: corpo };
      setFila((atual) => enfileira(atual, item));
      if (efeito.limpaCampo) setTexto('');
      return false;
    }
    if (!efeito.despacha) return false;
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
      if (await anexo.enviar(corpo)) {
        setTexto('');
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
    if (COMPACT_RE.test(corpo)) {
      compactPendenteRef.current = true;
      iniciarCompact();
    }
    // Esvazia no instante em que a tentativa é ACEITA, não quando ela é
    // entregue: esperar o POST voltar deixaria o texto no campo durante toda a
    // viagem de rede, e um segundo Enter ali duplica a mensagem. Daqui em
    // diante quem guarda o texto é a máquina (`estado.texto`), que precisa
    // dele para casar o eco e para oferecer novo envio se o eco não vier.
    if (efeito.limpaCampo) setTexto('');
    setTranscrito(null);
    setFalhaDaFala(null);
    // O feed da Tara pinta esta bolha no gesto: o texto dela só existe no
    // rollout 12 s depois, quando o `codex exec` sobe. Só para Codex — no
    // Claude Code o eco volta pelo stream em milissegundos, e uma pendência
    // aberta ali afrouxaria o prazo de um alarme que lá é verdadeiro.
    // Ver `lib/codex/eco-pendente.ts`.
    const idEcoPendente = ehCodex ? registraEcoPendente(agentSlug, corpo) : null;
    // Se o POST rejeitar com erro HTTP real (fase `falhou`), a máquina
    // acabou de provar que o texto não saiu — desfaz a bolha otimista em vez
    // de deixá-la contradizendo a faixa de erro por até 3 min (achado [2] da
    // auditoria, 09/08).
    await envio.enviar(
      corpo,
      idEcoPendente ? () => descartaEcoPendente(agentSlug, idEcoPendente) : undefined,
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
    void enviar(proximo.texto, true).then((saiu) => {
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
      void envio.reenviar();
      return;
    }
    void enviar(ultimoEnviado, true);
  }

  const emAndamento = emTransito(fase);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ck-space-1)' }}>
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
          // Em captura a moldura inteira assume a cor do estado — é o mesmo
          // recurso do envio, e aqui ele carrega o aviso de que soltar agora
          // descarta. Cor de estado na borda alcança a visão periférica; o
          // olho está no que está sendo falado, não no composer.
          borderColor: vozAparencia.tinta ?? fileteDoEstado ?? 'var(--ck-edge-composer)',
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
          transition: `border-color var(--ck-dur-fast) var(--ck-ease)`,
        }}
      >
        {/* A miniatura é o PRIMEIRO filho da caixa: ela empurra o campo para
            baixo em vez de flutuar sobre ele, e o composer cresce. Fica fora do
            `emCaptura` de propósito — o anexo escolhido não some porque o
            microfone abriu. Ela fica na tela do primeiro toque até a entrega,
            atravessando a subida — ver o cabeçalho de `miniatura-anexo.tsx`. */}
        <MiniaturaAnexo estado={anexo.estado} aoRemover={anexo.limpar} />

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
          onChange={(e) => setTexto(e.target.value)}
          // Com ANEXO na mão o Enter volta a enviar no touch. A quebra de linha
          // ficou pro texto puro, mas sem o envio a foto era um beco: o Shift
          // não existe no teclado virtual, e o "manda e não sai" do reporte de
          // 08/08 era o Enter virando newline com a foto retida — o único
          // gesto de enviar que o Rica tinha ali. `enterKeyHint` troca a tecla
          // do teclado virtual pra "Enviar" exatamente nesse caso, pra o toque
          // não parecer morto.
          enterKeyHint={tecladoTouch && retidoAnexo !== null ? 'send' : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && (!tecladoTouch || retidoAnexo !== null)) {
              e.preventDefault();
              enviar(texto);
            }
          }}
          // "aguarde" era a mesma promessa vazia da faixa: dizia para esperar
          // sem dizer o que aconteceria com o que ele escrevesse. Agora entra
          // na fila e sai sozinha, e o campo diz isso antes do primeiro Enter.
          placeholder={
            travaCompact ? 'compactando… pode escrever, entra na fila' : `Mensagem para ${agentName}`
          }
          className="ck-campo leading-body min-w-0 resize-none bg-transparent outline-none"
          style={{
            fontSize: 'var(--ck-text-md)', // 16px: piso do iOS contra zoom no foco
            // Teto para o crescimento: passando disto o composer comeria a
            // conversa. Rolagem interna assume, que é o que o CC faz.
            maxHeight: 'var(--ck-h-campo-max)',
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
            {emCaptura ? null : (
              <SeletorMotor agentSlug={agentSlug} agentName={agentName} motor={motor} esforcoCobrePedido={esforcoCobrePedido} />
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
            ) : texto.trim() || retidoAnexo ? (
              // A FOTO SOZINHA JÁ É GESTO. Sem `retidoAnexo` aqui, anexar sem
              // escrever legenda deixava o microfone no lugar do envio — a foto
              // na tela e nenhum botão que a mandasse.
              <button
                key="enviar"
                type="submit"
                // Habilitado mesmo quando a porta vai recusar: desabilitado ele
                // não responde ao toque e não diz por quê, que é o botão morto
                // da §9. Tocar agora devolve o motivo na faixa abaixo — e, se a
                // faixa estiver escondida atrás do teclado, o botão sacode
                // (`sinalRecusa` + `.ck-sacudir`) pra o toque não parecer morto.
                onAnimationEnd={() => setSinalRecusa(false)}
                aria-label={`Enviar para ${agentName}`}
                className={
                  'flex shrink-0 items-center justify-center disabled:opacity-40' +
                  (sinalRecusa ? ' ck-sacudir' : '')
                }
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

            O ENVIO DE TEXTO NÃO O ACENDE MAIS (Rica, 11/08): quando a mensagem
            sai, ela já está no feed, e a espera se acompanha por lá. Sobraram os
            dois casos em que o composer é a ÚNICA tela do assunto — o fio
            travado do `nao-confirmado`, e a voz.

            A TRANSCRIÇÃO REUSA O MESMO FIO, e isso é o oposto de economia: o
            STT roda no servidor e existe um tempo morto entre soltar o dedo e o
            texto existir. Nesse intervalo não há bolha nenhuma no feed — o
            texto ainda não existe —, então aqui o fio continua sendo a resposta
            a "a máquina está trabalhando?". */}
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
                faseVoz === 'transcrevendo' || faseVoz === 'pedindo' ? 'ck-fio-percorre' : ''
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
      {transcrito && (fase === 'aceito' || fase === 'nao-confirmado') ? (
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
