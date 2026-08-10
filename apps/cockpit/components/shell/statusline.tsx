/**
 * Statusline — a telemetria viva de um agente: modelo · sessão · contexto.
 *
 * É a informação que o Rica mais olha, e a primeira TROPA não a tinha. Aqui ela
 * volta com a régua certa.
 *
 * O QUE MUDA EM RELAÇÃO AO COCKPIT ANTIGO — e é deliberado:
 * a barra do antigo vai de 0 a 100 sem nenhuma marca. Com isso ela mostra o
 * Vinicius em 60% como "pouco mais da metade", quando 60% é o DOBRO do teto de
 * 30% que o próprio Rica cravou (ordem de 30/07, em `ze-shared/AGENTS.md`). Uma
 * barra que não conhece a regra do dono mente sobre o único número que decide
 * `/compact`. Aqui o teto está no desenho — não como traço, e sim como cor e
 * como escala: ver `barra-de-contexto.tsx` e `medidor.ts`.
 *
 * Dono: Daniel (pele). Funções derivadas vêm do `cockpit-core` — as mesmas que o
 * cockpit antigo usa, então os dois leem o mundo pelo mesmo instrumento.
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import {
  formatDuration,
  parseModelFromPane,
  resolveContextPct,
} from '@grupo_borges/cockpit-core/cockpit-types';
import { formatCompactNumber, formatElapsedShort } from '@grupo_borges/cockpit-core/painel-format';
import {
  BarraDeContexto,
  LARGURA_NA_COLUNA,
  LARGURA_NA_LISTA,
  SemContexto,
  ValorDoContexto,
} from './barra-de-contexto';
import { TETO_PCT } from './medidor';
import { rotulaModelo } from './motor';

export function Statusline({
  agente,
  agora,
  curta = false,
  larguraDaBarra,
}: {
  agente: Agent;
  agora: number;
  /** Modo coluna (260px): sai o tempo de sessão, ficam modelo e contexto. O
   *  tempo é o dado menos acionável dos três — sem ele, "Opus 5" para de ser
   *  truncado até virar "C". */
  curta?: boolean;
  /** Largura da barra de contexto, em px. `null` = ocupa o campo inteiro — é o
   *  modo da gaveta (09/08): a barra divide a linha com modelo e sessão e
   *  estica até o percentual. Omitido, mantém a largura fixa da lista (56px) ou
   *  da coluna (40px). */
  larguraDaBarra?: number | null;
}) {
  const ehCodex = agente.executor_kind === 'codex';
  const iniciou = ehCodex ? agente.session_started_at : agente.pane_session_started_at;
  const segundos = iniciou !== null ? Math.max(0, agora - iniciou) : null;

  // O pane é a fonte VIVA: `parseModelFromPane` lê o que está rodando agora,
  // `state_model` é a última intenção salva e pode estar pendente. Mesma
  // precedência do cockpit antigo — o card reflete execução, não seleção.
  //
  // O FALLBACK usa `rotulaModelo`, não `shortModelName` — 09/08. A leitura do
  // pane é INTERMITENTE (medido no `/api/fleet`: o mesmo agente alterna entre
  // trazer e não trazer a linha da statusline do CC), e quando ela falha cai
  // aqui. `shortModelName` só conhece os IDs longos (`claude-opus-5`), mas o
  // `state_model` que o seletor grava é o ALIAS CURTO (`opus`) — o fallback
  // devolvia o valor cru do banco, e o Rica via "Opus 5" virar "opus" sozinho.
  // `rotulaModelo` já resolvia o alias para o composer (e cobre Kimi, que a
  // tabela canônica não tem), delegando o resto ao mesmo `shortModelName`. Ele
  // NÃO inventa a versão: `opus` vira "Opus", sem número, porque dizer "Opus 5"
  // com a sessão em 4.8 seria mentira de UI. Com a ficha fora da gaveta (mesma
  // data), esta linha é a única fonte do modelo lá dentro.
  const modelo =
    (ehCodex ? null : parseModelFromPane(agente.pane_excerpt)) ??
    rotulaModelo(agente.state_model ?? agente.model_default);
  const pct = resolveContextPct(agente);
  const tokens = ehCodex ? agente.codex_tokens_used : null;
  // Número que o back mediu antes desta sessão (ou parado há muito) continua na
  // tela — o que não pode é sair sem etiqueta, como se fosse leitura de agora.
  const velho = agente.context_stale;
  const idade =
    agente.context_updated_at !== null
      ? formatElapsedShort(agora - agente.context_updated_at)
      : 'em sessão anterior';

  /** Barra de largura fixa = item de lista, e lista tem coluna a manter. Barra
   *  elástica (`null`) é a gaveta: uma linha só, nada com que se alinhar. */
  const emGrade = larguraDaBarra !== null;

  /** A PALAVRA carrega o estado (§3/§9.7): número velho esmaecido ou de outra
   *  cor continuaria lendo como medição de agora. A idade completa fica no
   *  `title` — a gaveta não repete a frase (09/08: o Rica mandou retirar o texto
   *  corrido). Sai como variável porque a grade a põe antes da barra e a gaveta
   *  depois do número. */
  const etiqueta = velho ? (
    <span className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>
      antigo
    </span>
  ) : null;

  return (
    <span
      className="ck-tabular flex min-w-0 items-center"
      style={{
        gap: 'var(--ck-space-2)',
        fontFamily: 'var(--ck-font-mono)',
        fontSize: 'var(--ck-text-xs)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      {/* Modelo em SANS, não mono: é nome de produto, não dado tabular. Em mono
          o "O" de Opus fica idêntico ao zero e a primeira leitura vira "0pus". */}
      <span
        className="truncate"
        style={{
          fontFamily: 'var(--ck-font-sans)',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-primary)',
        }}
      >
        {modelo}
      </span>

      {segundos !== null && !curta ? (
        <>
          <span aria-hidden style={{ color: 'var(--ck-text-tertiary)' }}>
            ·
          </span>
          <span className="shrink-0" title="tempo de sessão">
            {formatDuration(segundos, false)}
          </span>
        </>
      ) : null}

      {/* O contexto encosta na DIREITA, e o número é a última coluna da linha.
          É o que dá à lista uma vertical em que o olho se apoia: medido antes
          desta peça, o `%` pousava onde o nome do modelo tivesse terminado —
          cinco `x` diferentes na coluna de 260px, 72px de dança entre a linha
          mais à esquerda e a mais à direita. O modelo herda de quebra todo o
          espaço à esquerda, e é o que tira `deepseek-v…` do meio da palavra.

          Some junto o `·` que separava o tempo do contexto: com o rio no meio,
          ele deixou de separar duas coisas vizinhas e passou a boiar sozinho.

          Só na GRADE. Barra elástica (`larguraDaBarra: null`) é a gaveta — uma
          linha só, sem coluna nenhuma a manter, e o layout dela o Rica aprovou
          hoje. Lá o bloco continua no fluxo, com o `·` e a ordem de sempre. */}
      {emGrade ? null : (
        <span aria-hidden style={{ color: 'var(--ck-text-tertiary)' }}>
          ·
        </span>
      )}

      {pct !== null ? (
        <span
          className="flex shrink-0 items-center"
          style={{ gap: 'var(--ck-space-1)', marginLeft: emGrade ? 'auto' : undefined }}
          title={
            velho
              ? `contexto ${pct}% medido ${idade} — não é a leitura desta sessão`
              : `contexto ${pct}% — teto da frota ${TETO_PCT}%`
          }
        >
          {/* Na grade a etiqueta vem ANTES da barra: depois do número ela o
              empurraria para dentro da linha e a coluna morreria justamente no
              agente que mais precisa ser lido junto dos outros. */}
          {emGrade ? etiqueta : null}
          <BarraDeContexto
            pct={pct}
            largura={
              larguraDaBarra !== undefined
                ? (larguraDaBarra ?? undefined) // null → campo inteiro (gaveta)
                : curta
                  ? LARGURA_NA_COLUNA
                  : LARGURA_NA_LISTA
            }
          />
          <ValorDoContexto pct={pct} />
          {emGrade ? null : etiqueta}
        </span>
      ) : tokens !== null ? (
        // Codex não expõe porcentagem de janela — mostra o que ele tem.
        <span className="shrink-0" style={{ marginLeft: emGrade ? 'auto' : undefined }}>
          {formatCompactNumber(tokens)} tk
        </span>
      ) : (
        <span style={{ marginLeft: emGrade ? 'auto' : undefined }}>
          <SemContexto />
        </span>
      )}
    </span>
  );
}
