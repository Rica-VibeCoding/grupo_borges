/**
 * Repasse dos streams SSE da API com `Cache-Control: no-transform`.
 *
 * Existe por causa do `compress: true` do `next.config.ts`: o gzip do Next
 * segura os eventos pequenos no buffer do zlib, e o SSE chega em rajada ou não
 * chega (heartbeat preso). O middleware de compressão pula a resposta que traz
 * `no-transform` no `Cache-Control` — mas pelo `rewrites()` não dá para pôr o
 * cabeçalho: o proxy do Next copia por cima os cabeçalhos da API (que manda
 * `no-store`/`no-cache` sem `no-transform`), e o `headers()` do config perde.
 * Medido no `next start` de 02/10. Por isso cada rota de stream tem um route
 * handler que chama a API e devolve o corpo como veio, com o cabeçalho certo.
 *
 * Rota de stream nova na API = route handler novo em `app/api/**` usando isto;
 * sem ele, ela passa pelo rewrite e chega comprimida.
 */

const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';

/** Cabeçalhos de conexão/transporte: são deste salto, não se repassam. */
const FORA_DO_PEDIDO = ['host', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'accept-encoding'];
const FORA_DA_RESPOSTA = ['connection', 'keep-alive', 'content-length', 'transfer-encoding', 'content-encoding'];

export async function repassaSse(req: Request): Promise<Response> {
  const origem = new URL(req.url);
  const destino = `${API_BASE}${origem.pathname}${origem.search}`;

  const cabecalhos = new Headers(req.headers);
  for (const nome of FORA_DO_PEDIDO) cabecalhos.delete(nome);
  cabecalhos.set('x-forwarded-host', req.headers.get('host') ?? '');

  let resposta: Response;
  try {
    resposta = await fetch(destino, {
      method: req.method,
      headers: cabecalhos,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
      // O cliente fechou a aba → a conexão com a API cai junto, sem stream órfão.
      signal: req.signal,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return new Response('API fora do ar', { status: 502 });
  }

  const saida = new Headers(resposta.headers);
  for (const nome of FORA_DA_RESPOSTA) saida.delete(nome);
  const cache = saida.get('cache-control');
  saida.set('cache-control', cache ? `${cache}, no-transform` : 'no-cache, no-transform');

  return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers: saida });
}
