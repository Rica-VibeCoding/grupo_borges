import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as api from '@grupo_borges/cockpit-core/api';
import * as acoes from './acoes-de-conversa.ts';
import { estadoDaTroca } from './estado-da-troca.ts';
import * as chat from '../../lib/troca-em-curso.ts';
import * as marcos from '../../lib/conversa-trocada.ts';

export const drena = () => new Promise<void>((resolve) => setImmediate(resolve));
export function pendente<T>() {
  let resolve!: (valor: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
export const operacao = (id: string | null, fase: api.OperacaoDeConversa['fase']): api.RespostaDaTroca => ({
  id, fase, desde: null, detalhe: null, session_id: fase === 'pronta' ? 'destino' : null, titulo: null, nota: false,
});
// Sem DOM: callbacks tardios e desmontagem precisam ser reproduzíveis.
export function monta(arquivo: string, nome: string, rede: Partial<typeof api> = {}, argumentos?: unknown[]) {
  const valores: any[] = [];
  const efeitos: { deps?: unknown[]; limpa?: () => void }[] = [];
  const mapa = new Map<string, string>();
  const guarda = { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v), removeItem: (k: string) => void mapa.delete(k) };
  const agora = 100;
  let indice = 0;
  let depois: (() => void)[] = [];
  const memoriza = (fn: () => unknown, deps: unknown[]) => {
    const i = indice++;
    const antes = valores[i];
    if (!antes || deps.some((v, k) => !Object.is(v, antes.deps[k]))) valores[i] = { valor: fn(), deps };
    return valores[i].valor;
  };
  const react = {
    useRef: (current: unknown) => valores[indice++] ??= { current },
    useState: (inicial: any) => {
      const i = indice++;
      if (!(i in valores)) valores[i] = typeof inicial === 'function' ? inicial() : inicial;
      return [valores[i], (v: any) => { valores[i] = typeof v === 'function' ? v(valores[i]) : v; }];
    },
    useMemo: memoriza,
    useSyncExternalStore: (_assina: unknown, snapshot: () => unknown) => snapshot(),
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const i = indice++;
      const antes = efeitos[i];
      if (!antes || !deps || deps.some((v, k) => !Object.is(v, antes.deps?.[k]))) {
        depois.push(() => { antes?.limpa?.(); efeitos[i] = { deps, limpa: fn() || undefined }; });
      }
    },
  };
  const modulo = { exports: {} as any };
  const compilado = ts.transpileModule(readFileSync(new URL(arquivo, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requer = (n: string) => {
    if (n === 'react') return react;
    if (n.endsWith('cockpit-core/api')) return { ...api, fetchConversaOperacao: async () => operacao(null, null), ...rede };
    if (n.endsWith('acoes-de-conversa')) return acoes;
    if (n.endsWith('estado-da-troca')) return { estadoDaTroca };
    if (n.endsWith('usa-troca-em-curso')) return { usaTrocaEmCurso: (slug: string) => { chat.restauraTroca(slug, guarda, agora); return chat.leTroca(slug); } };
    if (n.endsWith('troca-em-curso')) return { ...chat,
      comecarTroca: (slug: string, p: chat.Troca) => chat.comecarTroca(slug, p, agora),
      postRespondeu: (slug: string, id: string, op: chat.Operacao) => chat.postRespondeu(slug, id, op, agora),
      postMorreu: (slug: string, id: string) => chat.postMorreu(slug, id, agora),
      postRecusado: (slug: string, id: string, codigo: string) => chat.postRecusado(slug, id, codigo, agora),
      confereTroca: (slug: string, prova: { atual?: string | null; sessao?: string | null }) => chat.confereTroca(slug, prova, agora),
      conversaTrocada: (slug: string, evento: marcos.ConversaTrocada) => chat.conversaTrocada(slug, evento, agora),
      sessaoDaTroca: () => guarda,
    };
    if (n.endsWith('conversa-trocada')) return marcos;
    throw new Error(`import inesperado: ${n}`);
  };
  new Function('require', 'exports', compilado)(requer, modulo.exports);
  return {
    guarda,
    render: (...args: unknown[]) => {
      indice = 0;
      depois = [];
      const resultado = modulo.exports[nome](...(args.length ? args : argumentos ?? []));
      depois.forEach((fn) => fn());
      return resultado;
    },
    desmonta: () => efeitos.forEach((e) => e?.limpa?.()),
  };
}
