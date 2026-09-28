/**
 * Onde a troca que espera o agente MORA — por slug, no módulo, fora do React
 * (28/09, achado do code-review). Enquanto ela vivia no estado do `SeletorMotor`,
 * abrir outro agente desmontava o chip, o relógio morria junto e a troca nunca
 * acontecia. No celular trocar de agente é o uso comum: a espera do agente A
 * segue reenviando com o Rica olhando o B, e ao voltar o chip lê daqui.
 *
 * Refresh da página DESCARTA a espera: é memória do cliente, não do servidor.
 *
 * Relógio e agendador injetáveis, como em `convergencia-esforco.ts`.
 */
import {
  INTERVALO_DE_REENVIO_MS,
  TETO_DA_ESPERA_MS,
  esperaVenceu,
  podeReenviar,
  proximaEspera,
  type DesfechoDoPedido,
  type EsperaDaTroca,
  type PedidoDeTroca,
} from './troca-em-espera.ts';

export type EstadoDaEspera = {
  espera: EsperaDaTroca | null;
  /** O pedido cujo envio está em voo agora. */
  voando: PedidoDeTroca | null;
  /** O desfecho que o chip conta uma vez — falha da troca ou o teto vencido.
   *  Fica guardado aqui, e não num chip, porque o reenvio pode ter acontecido
   *  com o chip do agente desmontado. */
  recado: string | null;
};

/** Quem envia: não depende de chip montado (ver `executor-de-troca.ts`). */
export type Executor = (
  slug: string,
  pedido: PedidoDeTroca,
  recado: (texto: string) => void,
) => Promise<DesfechoDoPedido>;

export const TEXTO_DESISTIU = 'A troca foi cancelada: o agente não parou de trabalhar.';

type Registro = EstadoDaEspera & { ultimaTentativaMs: number; geracao: number };

export type DependenciasDasEsperas = {
  executar?: Executor;
  agora?: () => number;
  agendar?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  cancelar?: (timer: ReturnType<typeof setInterval>) => void;
  passoMs?: number;
  intervaloMs?: number;
  tetoMs?: number;
};

const VAZIO: EstadoDaEspera = { espera: null, voando: null, recado: null };

export function criaEsperasDeTroca(dep: DependenciasDasEsperas = {}) {
  const agora = dep.agora ?? Date.now;
  const agendar = dep.agendar ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
  const cancelarTimer = dep.cancelar ?? clearInterval;
  const passoMs = dep.passoMs ?? 1_000;
  const intervaloMs = dep.intervaloMs ?? INTERVALO_DE_REENVIO_MS;
  const tetoMs = dep.tetoMs ?? TETO_DA_ESPERA_MS;

  const registros = new Map<string, Registro>();
  let executor: Executor | undefined = dep.executar;
  const status = new Map<string, string | null | undefined>();
  const ouvintes = new Map<string, Set<() => void>>();
  const leituras = new Map<string, EstadoDaEspera>();
  let timer: ReturnType<typeof setInterval> | undefined;

  function registro(slug: string): Registro {
    let r = registros.get(slug);
    if (!r) {
      r = { ...VAZIO, ultimaTentativaMs: 0, geracao: 0 };
      registros.set(slug, r);
    }
    return r;
  }

  function avisar(slug: string) {
    leituras.delete(slug);
    ouvintes.get(slug)?.forEach((fn) => fn());
    armarRelogio();
  }

  function armarRelogio() {
    const algumaEspera = [...registros.values()].some((r) => r.espera !== null);
    if (algumaEspera && timer === undefined) timer = agendar(passo, passoMs);
    if (!algumaEspera && timer !== undefined) {
      cancelarTimer(timer);
      timer = undefined;
    }
  }

  async function enviar(slug: string, pedido: PedidoDeTroca, atual: EsperaDaTroca | null) {
    const r = registro(slug);
    const minha = r.geracao;
    const executar = executor;
    const guardarRecado = (texto: string) => {
      // Recado de um envio superado (cancelado, trocado) não é notícia.
      if (minha !== r.geracao) return;
      r.recado = texto;
      avisar(slug);
    };
    r.ultimaTentativaMs = agora();
    r.voando = pedido;
    avisar(slug);
    let desfecho: DesfechoDoPedido = 'falhou';
    try {
      if (executar) desfecho = await executar(slug, pedido, guardarRecado);
    } catch {
      desfecho = 'falhou';
    }
    // Cancelado ou trocado por outra escolha no meio do voo: o desfecho deste
    // envio não rearma uma espera que o Rica já largou.
    if (minha !== r.geracao) return;
    r.voando = null;
    r.espera = proximaEspera(atual, pedido, desfecho, agora());
    avisar(slug);
  }

  function passo() {
    const t = agora();
    for (const [slug, r] of registros) {
      if (!r.espera) continue;
      if (esperaVenceu(r.espera, t, tetoMs)) {
        // O envio em voo também é largado — igual ao `cancelar`: sem isto o
        // `voando` nunca voltava a null e o chip ficava em "trocando…".
        r.geracao += 1;
        r.espera = null;
        r.voando = null;
        r.recado = TEXTO_DESISTIU;
        avisar(slug);
        continue;
      }
      if (podeReenviar({
        espera: r.espera, emVoo: r.voando !== null, status: status.get(slug),
        ultimaTentativaMs: r.ultimaTentativaMs, agoraMs: t, intervaloMs,
      })) void enviar(slug, r.espera.pedido, r.espera);
    }
  }

  return {
    /** Uma troca de cada vez por agente: escolha nova substitui a anterior. */
    pedir(slug: string, pedido: PedidoDeTroca): Promise<void> {
      const r = registro(slug);
      r.geracao += 1;
      r.espera = null;
      r.recado = null;
      return enviar(slug, pedido, null);
    },
    cancelar(slug: string) {
      const r = registro(slug);
      r.geracao += 1;
      r.espera = null;
      r.voando = null;
      avisar(slug);
    },
    /** Troca o executor — só para testes e para a instância do cliente. */
    definirExecutor(executar: Executor) {
      executor = executar;
    },
    /** A frota viva alimenta o status de TODOS os agentes, aberto ou não. */
    informarStatus(slug: string, valor: string | null | undefined) {
      status.set(slug, valor);
    },
    /** O chip já mostrou o recado: ele não se repete na próxima montagem. */
    esquecerRecado(slug: string) {
      const r = registros.get(slug);
      if (r?.recado) {
        r.recado = null;
        avisar(slug);
      }
    },
    ler(slug: string): EstadoDaEspera {
      const r = registros.get(slug);
      if (!r) return VAZIO;
      // Mesma referência entre avisos: `useSyncExternalStore` exige leitura estável.
      let leitura = leituras.get(slug);
      if (!leitura) {
        leitura = { espera: r.espera, voando: r.voando, recado: r.recado };
        leituras.set(slug, leitura);
      }
      return leitura;
    },
    assinar(slug: string, fn: () => void): () => void {
      const set = ouvintes.get(slug) ?? new Set();
      set.add(fn);
      ouvintes.set(slug, set);
      return () => {
        set.delete(fn);
        if (!set.size) ouvintes.delete(slug);
      };
    },
    /** Para os testes: roda um passo do relógio agora. */
    passo,
  };
}

export type EsperasDeTroca = ReturnType<typeof criaEsperasDeTroca>;
