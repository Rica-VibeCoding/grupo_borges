// As delegações em curso, lidas do disco local — quem está trabalhando a
// pedido de qual agente, pro chat mostrar no pé do feed.
//
// Route handler do próprio Next, sem passar pelo FastAPI: a fonte é um
// diretório do /tmp DESTA máquina (`/tmp/cc-deleg/`, um `<pid>.json` por
// delegação), e o cockpit roda nela. O parsing e as réguas de descarte (PID
// morto, marca sem dono) moram no irmão `delegacoes.ts`, puro e testado.
//
// `?agente=<slug>` filtra pelo DELEGADOR — a delegação aparece no chat de
// quem pediu, não nos outros. Sem o parâmetro, devolve todas as vivas (a
// pílula do topo, quando existir, bebe daqui sem filtro).
//
// `inicio` vai cru (epoch em segundos): o decorrido é conta do cliente, com o
// relógio do navegador — sem dessincronia de fuso nem de latência.

import { DIR_PADRAO, leDelegacoes } from './delegacoes.ts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const dir = process.env.DELEG_DIR ?? DIR_PADRAO;
  const agente = new URL(req.url).searchParams.get('agente');

  const vivas = await leDelegacoes(dir);
  const delegacoes = agente ? vivas.filter((d) => d.delegador === agente) : vivas;

  return Response.json({ delegacoes });
}
