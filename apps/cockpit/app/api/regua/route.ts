/**
 * Sumidouro da régua — as medidas que o aparelho do Rica manda.
 *
 * POR QUE ISTO EXISTE, e por que voltou depois de eu ter apagado a primeira
 * versão em 02/08: o Rica é o único da equipe com iPhone, e a classe de bug que
 * a gaveta de 0px inaugurou (divergência de layout do WebKit) é **invisível pra
 * mim**. Não tenho Safari: o `playwright install webkit` baixa o binário, mas
 * ele pede ~20 bibliotecas de sistema que exigem `sudo apt`. Três rodadas de
 * hipótese erraram o alvo naquele bug porque eu só conseguia raciocinar sobre
 * o Chrome. Meia hora de sonda resolveu o que três rodadas de palpite não
 * resolveram — e a lição foi: quando o defeito não reproduz no ambiente que eu
 * controlo, a próxima peça a escrever não é o conserto, é o instrumento.
 *
 * Ele mesmo perguntou se valia manter durante a implementação, e vale — desde
 * que seja instrumento e não entulho. O que separa uma coisa da outra:
 *
 * - **Não existe sem `?diag=1`.** Nenhuma rota normal monta a régua, então o
 *   custo em produção é zero e nenhum usuário vê nada.
 * - **O arquivo não cresce pra sempre**: rotaciona em `TETO_BYTES`.
 * - **Data de morte escrita**: morre com a Fase 1. Se a Fase 2 (kanban) começar
 *   e isto ainda estiver aqui sem ninguém ter usado no mês, apagar sem dó.
 */
import { appendFile, rename, stat } from 'node:fs/promises';

const ARQUIVO = '/tmp/cockpit-regua.log';
/** ~2 MB. Uma sessão de teste inteira cabe folgada; o que isto evita é o
 *  arquivo esquecido enchendo o /tmp da máquina. */
const TETO_BYTES = 2_000_000;

async function rotacionaSePreciso() {
  try {
    const info = await stat(ARQUIVO);
    if (info.size > TETO_BYTES) await rename(ARQUIVO, `${ARQUIVO}.1`);
  } catch {
    // Arquivo ainda não existe — nada a rotacionar.
  }
}

export async function POST(req: Request) {
  const corpo = await req.text();
  await rotacionaSePreciso();
  const linha = JSON.stringify({
    t: new Date().toISOString(),
    ua: req.headers.get('user-agent'),
    corpo: corpo.slice(0, 8000),
  });
  await appendFile(ARQUIVO, `${linha}\n`, 'utf8');
  return new Response(null, { status: 204 });
}
