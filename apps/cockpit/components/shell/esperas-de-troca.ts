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
  /** O teto venceu sem o agente parar — o chip conta isso uma vez. */
  desistiu: boolean;
};

type Executor = (pedido: PedidoDeTroca) => Promise<DesfechoDoPedido>;

type Registro = EstadoDaEspera & { ultimaTentativaMs: number; geracao: number };

export type DependenciasDasEsperas = {
  agora?: () => number;
  agendar?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  cancelar?: (timer: ReturnType<typeof setInterval>) => void;
  passoMs?: number;
  intervaloMs?: number;
  tetoMs?: number;
};

const VAZIO: EstadoDaEspera = { espera: null, voando: null, desistiu: false };

export function criaEsperasDeTroca(dep: DependenciasDasEsperas = {}) {
  const agora = dep.agora ?? Date.now;
  const agendar = dep.agendar ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
  const cancelarTimer = dep.cancelar ?? clearInterval;
  const passoMs = dep.passoMs ?? 1_000;
  const intervaloMs = dep.intervaloMs ?? INTERVALO_DE_REENVIO_MS;
  const tetoMs = dep.tetoMs ?? TETO_DA_ESPERA_MS;

  const registros = new Map<string, Registro>();
  const executores = new Map<string, Executor>();
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
    const executar = executores.get(slug);
    r.ultimaTentativaMs = agora();
    r.voando = pedido;
    avisar(slug);
    let desfecho: DesfechoDoPedido = 'falhou';
    try {
      if (executar) desfecho = await executar(pedido);
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
        r.geracao += 1;
        r.espera = null;
        r.desistiu = true;
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
      r.desistiu = false;
      return enviar(slug, pedido, null);
    },
    cancelar(slug: string) {
      const r = registro(slug);
      r.geracao += 1;
      r.espera = null;
      r.voando = null;
      avisar(slug);
    },
    /** Quem executa é o chip montado mais recente do agente — e o último fica
     *  valendo depois do desmonte: ele só fala com a rede e com a própria store. */
    registrarExecutor(slug: string, executar: Executor) {
      executores.set(slug, executar);
    },
    /** A frota viva alimenta o status de TODOS os agentes, aberto ou não. */
    informarStatus(slug: string, valor: string | null | undefined) {
      status.set(slug, valor);
    },
    esquecerDesistencia(slug: string) {
      const r = registros.get(slug);
      if (r?.desistiu) {
        r.desistiu = false;
        avisar(slug);
      }
    },
    ler(slug: string): EstadoDaEspera {
      const r = registros.get(slug);
      if (!r) return VAZIO;
      // Mesma referência entre avisos: `useSyncExternalStore` exige leitura estável.
      let leitura = leituras.get(slug);
      if (!leitura) {
        leitura = { espera: r.espera, voando: r.voando, desistiu: r.desistiu };
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

/** A instância do cliente — uma por aba, viva entre as rotas. */
export const esperasDeTroca = criaEsperasDeTroca();
