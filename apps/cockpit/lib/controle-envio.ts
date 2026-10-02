/** O controle de um envio do composer: o POST, a retentativa da recusa que passa
 *  sozinha, o prazo do eco e a máquina (`envio.ts`) que a tela lê. O que a resposta
 *  quer dizer mora em `leitura-do-envio.ts`; o stream, em `observacao-do-eco.ts`. */

import {
  estadoInicialEnvio,
  PRAZO_ECO_MS,
  reduzEnvio,
  type EstadoEnvio,
  type EventoEnvio,
} from './envio.ts';
import { temPendencia } from './eco-pendente.ts';
import {
  leErroDoEnvio,
  leRespostaDoEnvio,
  PREFIXO_VOZ,
  respostaTemFronteira,
  type OrigemEnvio,
  type RespostaComFronteira,
} from './leitura-do-envio.ts';
import {
  criaObservacaoDoEco,
  type ConstrutorFonteEventosEnvio,
} from './observacao-do-eco.ts';

/** Com que frequência reperguntar se o rollout já entregou. Um pouco acima do
 *  tique do poll do feed (3 s), que é quem descobre. */
const REEXAME_ROLLOUT_MS = 3_500;

type Timer = ReturnType<typeof setTimeout>;

export type DependenciasEnvio = {
  postar?: (
    agentSlug: string,
    texto: string,
    origem: OrigemEnvio,
  ) => Promise<RespostaComFronteira>;
  FonteEventos?: ConstrutorFonteEventosEnvio;
  agora?: () => number;
  agendar?: (callback: () => void, atrasoMs: number) => Timer;
  cancelar?: (timer: Timer) => void;
  atrasoReconexaoMs?: number;
};

export type ControleEnvio = {
  getEstado(): EstadoEnvio;
  subscribe(ouvinte: () => void): () => void;
  /** `aoFalhar` roda só quando o POST rejeita com erro HTTP real (fase
   *  `falhou`) — é o gancho para quem registrou uma pendência otimista ANTES
   *  do envio (`registraEcoPendente`) desfazê-la, já que a máquina
   *  acabou de provar que o texto não saiu daqui. */
  enviar(texto: string, aoFalhar?: () => void, origem?: OrigemEnvio): Promise<void>;
  reenviar(aoFalhar?: () => void): Promise<void>;
  /** Recibo vindo de FORA do stream SSE, para quem prova a entrega por outro
   *  caminho (`lib/eco-pendente.ts`). Sem isto a mensagem expira o prazo e
   *  termina em âmbar, dizendo que podia não ter entrado. */
  confirmarPorEco(texto: string): void;
  dispose(): void;
};

export function createControleEnvio(
  agentSlug: string,
  dependencias: DependenciasEnvio = {},
): ControleEnvio {
  const postar =
    dependencias.postar ??
    (async (slug, texto, origem) => {
      const { postAgentInput } = await import('./acoes-no-agente.ts');
      const resposta = await postAgentInput(slug, texto, { origin: origem });
      if (!respostaTemFronteira(resposta)) {
        throw new Error('Resposta de envio sem event_boundary_id válido');
      }
      return resposta;
    });
  const FonteEventos =
    dependencias.FonteEventos ??
    (globalThis.EventSource as unknown as
      | ConstrutorFonteEventosEnvio
      | undefined);
  const agora = dependencias.agora ?? Date.now;
  const agendar = dependencias.agendar ?? setTimeout;
  const cancelar = dependencias.cancelar ?? clearTimeout;
  const atrasoReconexaoMs = dependencias.atrasoReconexaoMs ?? 1_000;

  let estado = estadoInicialEnvio;
  let descartado = false;
  let timerPrazo: Timer | undefined;
  let timerRetentativa: Timer | undefined;
  /** A tentativa corrente preserva a origem STT até o eco voltar. */
  let vozEmVoo = false;
  let origemEmVoo: OrigemEnvio = 'text';
  const ouvintes = new Set<() => void>();

  function publicar(evento: EventoEnvio): void {
    if (descartado) return;
    const proximo = reduzEnvio(estado, evento);
    if (proximo === estado) return;
    estado = proximo;
    for (const ouvinte of ouvintes) ouvinte();
  }

  function limparTimerPrazo(): void {
    if (timerPrazo === undefined) return;
    cancelar(timerPrazo);
    timerPrazo = undefined;
  }

  function limparTimerRetentativa(): void {
    if (timerRetentativa === undefined) return;
    cancelar(timerRetentativa);
    timerRetentativa = undefined;
  }

  /** Um texto do Rica voltou — pelo stream ou por recibo de fora. */
  function publicarTexto(item: { id: number; papel: 'user' | 'fila'; texto: string }): void {
    const texto = vozEmVoo ? item.texto.replace(PREFIXO_VOZ, '') : item.texto;
    publicar({ tipo: 'item-do-stream', item: { ...item, texto } });
  }

  const eco = criaObservacaoDoEco({
    agentSlug,
    FonteEventos,
    agendar,
    cancelar,
    atrasoReconexaoMs,
    descartado: () => descartado,
    aoTexto: publicarTexto,
    cumpriu: () => estado.fase === 'confirmado' && estado.fila !== true,
    aoCumprir: limparTimerPrazo,
    retomarDe: () => {
      // Confirmado pela fila também reconecta: o eco da drenagem ainda vem.
      const aguardandoEco =
        estado.fase === 'aceito' ||
        estado.fase === 'nao-confirmado' ||
        (estado.fase === 'confirmado' && estado.fila === true);
      // `'fronteira' in estado` em vez de confiar na fase: o `aguardandoEco`
      // é uma disjunção composta, e o TS não estreita o union por ela.
      return aguardandoEco && 'fronteira' in estado ? estado.fronteira : undefined;
    },
  });

  function armarPrazo(): void {
    limparTimerPrazo();
    if (estado.fase !== 'aceito') return;
    timerPrazo = agendar(() => {
      timerPrazo = undefined;
      // ENTREGA AINDA EM CURSO: os 12 s foram calibrados sobre uma amostra
      // local de 30/07 cujo pior caso era 1,434 s, e o eco real não cabe nisso
      // — medido em 15/08, são **18,9 s**. O alarme disparava sempre, e o texto
      // dele manda o Rica reenviar: é assim que se produz a duplicata que ele
      // existe para avisar.
      //
      // Daqui em diante os 12 s são só a CADÊNCIA do reexame; quem decide o
      // alarme é o teto da pendência (`PRAZO_CC_MS`, com o porquê escrito lá).
      // Expirou a pendência, o alarme volta a ser verdadeiro.
      if (temPendencia(agentSlug)) {
        armarPrazoDeRollout();
        return;
      }
      publicar({ tipo: 'tempo-passou', agoraMs: agora() });
    }, Math.max(0, estado.aceitoEmMs + PRAZO_ECO_MS - agora()));
  }

  /** Reexame curto enquanto o rollout não entrega — não é um prazo novo, é o
   *  mesmo prazo perguntando de novo. */
  function armarPrazoDeRollout(): void {
    limparTimerPrazo();
    if (estado.fase !== 'aceito') return;
    timerPrazo = agendar(() => {
      timerPrazo = undefined;
      if (temPendencia(agentSlug)) {
        armarPrazoDeRollout();
        return;
      }
      publicar({ tipo: 'tempo-passou', agoraMs: agora() });
    }, REEXAME_ROLLOUT_MS);
  }

  async function executar(
    texto: string,
    aoFalhar?: () => void,
    origem: OrigemEnvio = 'text',
  ): Promise<void> {
    if (
      descartado ||
      !texto.trim() ||
      estado.fase === 'enviando' ||
      estado.fase === 'aceito'
    ) {
      return;
    }
    origemEmVoo = origem;
    vozEmVoo = origem === 'stt';
    limparTimerPrazo();
    limparTimerRetentativa();
    eco.encerrar();
    publicar({ tipo: 'enviar', texto });
    await entregar(texto, aoFalhar, 0, origem);
  }

  /**
   * O POST em si, separado de `executar` para que a retentativa não precise
   * atravessar a guarda de entrada — que recusa `enviando`, exatamente a fase
   * em que a espera acontece.
   *
   * Ficar em `enviando` durante a espera é o ponto: a porta continua recusando
   * `envio-em-voo`, e o que o Rica escrever nesses segundos vai para a FILA, à
   * vista, em vez de bater num vermelho que já não vale. Era esse o defeito.
   */
  async function entregar(
    texto: string,
    aoFalhar: (() => void) | undefined,
    jaTentadas: number,
    origem: OrigemEnvio,
  ): Promise<void> {
    try {
      const resposta = await postar(agentSlug, texto, origem);
      if (descartado) return;
      const leitura = leRespostaDoEnvio(resposta);
      if (leitura.tipo === 'enfileirada') {
        // Sem `armarPrazo`: o recibo JÁ é a confirmação e não há eco a esperar
        // agora. Mas com `observar`, porque o eco chega quando a fila drenar —
        // minutos depois — e é ele que apaga a marca `fila`.
        publicar({ tipo: 'enfileirar', fronteira: leitura.fronteira });
        eco.observar(leitura.fronteira);
        return;
      }
      // Ausência de prova vai a `nao-confirmado`, nunca a `falhou` — o porquê
      // está em `leRespostaDoEnvio`.
      if (leitura.tipo === 'sem-prova') {
        publicar({
          tipo: 'nao-confirmar',
          erro: new Error('O backend não conseguiu provar a entrega no pane — o texto pode ter entrado'),
        });
        return;
      }
      publicar({ tipo: 'aceitar', agoraMs: agora(), fronteira: leitura.fronteira });
      eco.observar(leitura.fronteira);
      armarPrazo();
    } catch (erro) {
      if (descartado) return;
      const leitura = leErroDoEnvio(erro, jaTentadas);
      if (leitura.tipo === 'retentar') {
        timerRetentativa = agendar(() => {
          timerRetentativa = undefined;
          // A fase pode ter mudado na espera — outro envio, um dispose, uma
          // retomada. Quem saiu de `enviando` já não é esta tentativa.
          if (descartado || estado.fase !== 'enviando') return;
          void entregar(texto, aoFalhar, jaTentadas + 1, origem);
        }, leitura.atrasoMs);
        return;
      }
      // Só aqui a máquina SABE que não saiu — é o único gatilho correto para
      // desfazer uma pendência otimista registrada antes do POST. Em
      // `nao-confirmado` o texto pode ter entrado mesmo assim (ver
      // `leRespostaDoEnvio`), então a pendência segue esperando o rollout
      // confirmar ou expirar sozinha.
      if (leitura.tipo === 'falhou') aoFalhar?.();
      publicar(
        leitura.tipo === 'falhou'
          ? { tipo: 'falhar', erro }
          : { tipo: 'nao-confirmar', erro },
      );
    }
  }

  return {
    getEstado: () => estado,
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      return () => ouvintes.delete(ouvinte);
    },
    enviar: executar,
    async reenviar(aoFalhar?: () => void) {
      if (estado.fase !== 'nao-confirmado') return;
      await executar(estado.texto, aoFalhar, origemEmVoo);
    },
    confirmarPorEco(texto) {
      // Mesmo evento que o SSE publicaria — o redutor faz o resto, inclusive
      // aceitar recibo TARDIO: `nao-confirmado` está na lista de fases que o
      // eco ainda confirma. Por isso o âmbar da Tara se desfaz sozinho quando
      // o rollout entrega, em vez de exigir que o Rica reenvie.
      //
      // `Date.now()` como id: o redutor exige `item.id > fronteira.id`, e a
      // fronteira é o `event_boundary_id` do back (contador de eventos, ordens
      // de grandeza menor que um instante em ms). Não vem do stream, então não
      // pode colidir com o `cursor`.
      publicarTexto({ id: Date.now(), papel: 'user', texto });
    },
    dispose() {
      if (descartado) return;
      descartado = true;
      limparTimerPrazo();
      limparTimerRetentativa();
      eco.encerrar();
      ouvintes.clear();
    },
  };
}
