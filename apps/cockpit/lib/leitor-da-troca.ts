/** Um leitor por agente, compartilhado pelos consumidores montados. */
import { fetchConversaOperacao, fetchConversas } from '@grupo_borges/cockpit-core/api';
import { terminouTroca } from './regua-da-troca.ts';
import { ESPERA_DO_STREAM_MS, assinaTrocaNoChat, carimboDaLeitura, confereTroca, leTroca, leituraMorreu, operacaoLida, restauraTroca } from './troca-em-curso.ts';

const leitores = new Map<string, { usuarios: number; conferir: () => void; parar: () => void }>();
export type RedeDaTroca = { operacao: typeof fetchConversaOperacao; lista: typeof fetchConversas };
const redePadrao: RedeDaTroca = { operacao: fetchConversaOperacao, lista: fetchConversas };

export function acompanhaTroca(slug: string, rede = redePadrao, conferirAoMontar = false): () => void {
  restauraTroca(slug);
  let leitor = leitores.get(slug);
  if (!leitor) {
    let vivo = true;
    let controlador: AbortController | null = null;
    let lendo = false;
    let carimbo = carimboDaLeitura(slug);
    let primeira = true;
    let conferirDepois = false;
    let relogio: ReturnType<typeof setInterval> | null = null;
    let intervalo: ReturnType<typeof setInterval> | null = null;
    let prazoDoChat: ReturnType<typeof setTimeout> | null = null;
    async function comTeto<T>(consulta: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const c = new AbortController();
      controlador = c;
      // Cada request tem seu teto; a lista não herda o tempo gasto em /operacao.
      const corte = new Promise<never>((_resolve, reject) => {
        c.signal.addEventListener('abort', () => reject(new Error('Leitura interrompida')), { once: true });
      });
      const teto = setTimeout(() => c.abort(), 5_000);
      try { return await Promise.race([consulta(c.signal), corte]); }
      finally {
        clearTimeout(teto);
        if (controlador === c) controlador = null;
      }
    }
    async function ler() {
      if (!vivo || lendo) return;
      const t = leTroca(slug);
      const emCurso = t && !terminouTroca(t);
      if (!emCurso && !primeira) return;
      // API velha não identifica o resultado anterior; dá tempo de o POST começar.
      if (emCurso && Date.now() - t.inicio < 2_000) return;
      primeira = false;
      lendo = true;
      const marca = carimboDaLeitura(slug);
      const vale = () => vivo && carimboDaLeitura(slug) === marca;
      let leuOperacao = false;
      try {
        try {
          const op = await comTeto((s) => rede.operacao(slug, s));
          leuOperacao = true;
          if (vale()) operacaoLida(slug, marca, op);
        } catch {
          if (vale()) {
            leituraMorreu(slug, marca);
            confereTroca(slug, { listaFalhou: true, listaLidaEm: Date.now() });
          }
        }
        if (leuOperacao && vale() && leTroca(slug)?.fase === 'conferindo') {
          const listaLidaEm = Date.now();
          try {
            const lista = await comTeto((s) => rede.lista(slug, s));
            if (vale()) confereTroca(slug, { atual: lista.conversas.find((item) => item.atual)?.id ?? null, listaLidaEm });
          } catch {
            if (vale()) confereTroca(slug, { listaLidaEm, listaFalhou: true });
          }
        }
      } finally {
        lendo = false;
        // Uma leitura anterior ao clique ou ao 409 não vale para o novo carimbo.
        if (vivo && conferirDepois) {
          conferirDepois = false;
          primeira = true;
          void ler();
        } else if (vivo && marca !== carimboDaLeitura(slug)) void ler();
      }
    }
    function ajustaTimers() {
      if (prazoDoChat !== null) clearTimeout(prazoDoChat);
      prazoDoChat = null;
      const t = leTroca(slug);
      if (t && !terminouTroca(t)) {
        relogio ??= setInterval(() => confereTroca(slug), 250);
        intervalo ??= setInterval(() => void ler(), 2_000);
        if (t.fase === 'conferindo' && t.conferencia && !t.conferencia.erro) {
          const falta = t.conferencia.desde + ESPERA_DO_STREAM_MS - Date.now();
          if (falta > 0) prazoDoChat = setTimeout(() => confereTroca(slug), falta);
        }
      } else {
        if (relogio !== null) clearInterval(relogio);
        if (intervalo !== null) clearInterval(intervalo);
        relogio = intervalo = null;
      }
    }
    const solta = assinaTrocaNoChat(slug, () => {
      ajustaTimers();
      const novo = carimboDaLeitura(slug);
      if (novo === carimbo) return;
      carimbo = novo;
      controlador?.abort();
      // O finally da leitura abortada transfere a vez sem sobrepor requests.
      if (!lendo) void ler();
    });
    ajustaTimers();
    leitor = { usuarios: 0, conferir: () => {
      if (lendo) { conferirDepois = true; return; }
      primeira = true;
      void ler();
    }, parar: () => {
      vivo = false;
      solta();
      controlador?.abort();
      if (prazoDoChat !== null) clearTimeout(prazoDoChat);
      if (relogio !== null) clearInterval(relogio);
      if (intervalo !== null) clearInterval(intervalo);
    } };
    leitores.set(slug, leitor);
    void ler();
  } else if (conferirAoMontar) leitor.conferir();
  leitor.usuarios++;
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    if (--leitor.usuarios === 0) {
      leitor.parar();
      leitores.delete(slug);
    }
  };
}
