/**
 * A RECUSA QUE PASSA SOZINHA — o 409 que é espera, não destino.
 *
 * ── O que o Rica viveu em 15/08 ──────────────────────────────────────────
 *
 * Palavras dele: *"mandei a mensagem, dei parar. Quando fui mandar outra, o
 * composer já ficou vermelho e não foi. Tive que destravar ele no painel."*
 *
 * No log do back, a sequência: `input 200` ×3 → `interromper 200` →
 * **`input 409`** → `interromper 200` → `input 200`. A entrega seguinte, sem
 * gesto nenhum de conserto, voltou 200. Ou seja: a recusa que pintou a tela de
 * vermelho e pediu intervenção humana já não valia mais quando ele leu o aviso.
 *
 * ── Por que retentar é seguro aqui, e só aqui ────────────────────────────
 *
 * A regra que atravessa esta máquina inteira é não repetir entrega que PODE ter
 * acontecido — reenviar um texto que entrou faz o agente rodar o mesmo comando
 * duas vezes (ver o comentário longo de `tmux_delivered` em `usa-envio.ts`).
 *
 * Os dois detalhes abaixo são a exceção porque o backend AFIRMA a não-entrega,
 * e não apenas deixa de prová-la:
 *
 * - `agent_pane_unavailable` — `send_agent_input` levanta quando
 *   `_send_tmux_or_409` devolve `False`; o driver não colou nada no pane.
 * - `shared_turn_in_flight` — o TeleCodex recusa o turno antes de abri-lo,
 *   porque a conversa da Tara é compartilhada com o Telegram.
 *
 * Sem primeira cópia não há duplicata, e é isso que autoriza a máquina a
 * insistir sozinha em vez de cobrar um gesto.
 *
 * ── Os números, e o que eles NÃO são ─────────────────────────────────────
 *
 * ⚠️ 1,2 s e 3 s são **escolha de projeto, não medição**: a condição do 409 não
 * foi reproduzida (o caminho por `curl` — input, interromper, input imediato —
 * devolve 200), então não existe amostra de quanto ela dura. O que limita a
 * escolha é o teto de atenção de 10 s do NN/g: duas esperas somam 4,2 s e ainda
 * deixam folga para os POSTs em si antes de a tela ficar devendo resposta.
 *
 * Quem medir a duração real da recusa deve trocar estes números e apagar este
 * aviso — mas trocar por outro palpite não melhora nada.
 *
 * ── O que acontece quando esgota ─────────────────────────────────────────
 *
 * Exatamente o de antes: `falhou`, filete vermelho, "não saiu", e os botões de
 * destravar e tentar de novo. A recuperação automática não substitui o
 * diagnóstico — ela só para de cobrar gesto por algo que passa em segundos.
 *
 * Módulo neutro: sem React, sem DOM, sem rede.
 */

/**
 * Só recusas em que o back afirma a não-entrega. Nada aqui é chute sobre
 * semântica de HTTP: um 409 genérico continua sendo falha terminal, porque
 * "conflito" sem o detalhe do back não diz se o texto entrou.
 */
const DETALHES_TRANSITORIOS = ['agent_pane_unavailable', 'shared_turn_in_flight'] as const;

/**
 * Cada posição é a espera ANTES da tentativa daquele índice. Duas entradas =
 * duas retentativas depois da original.
 */
export const ATRASOS_DA_RETENTATIVA_MS = [1_200, 3_000] as const;

/**
 * O `detail` é a fonte; a `message` é o fallback porque o `AgentInputError`
 * nasce com o mesmo texto nos dois campos (`new AgentInputError(detail, status,
 * detail)`), e um erro montado à mão em teste costuma ter só a mensagem.
 */
export function ehRecusaTransitoria(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const bruto = erro as { status?: unknown; detail?: unknown; message?: unknown };
  if (bruto.status !== 409) return false;
  const texto =
    typeof bruto.detail === 'string'
      ? bruto.detail
      : typeof bruto.message === 'string'
        ? bruto.message
        : '';
  return DETALHES_TRANSITORIOS.some((conhecido) => texto.includes(conhecido));
}

/** Quanto esperar antes da próxima tentativa, ou `null` quando acabaram. */
export function atrasoDaRetentativa(jaTentadas: number): number | null {
  return ATRASOS_DA_RETENTATIVA_MS[jaTentadas] ?? null;
}
