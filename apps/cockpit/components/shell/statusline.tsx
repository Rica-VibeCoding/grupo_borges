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
 * `/compact`. O traço no 30 é o instrumento inteiro desta tela: escala honesta
 * (0–100, igual ao número ao lado), julgamento visível.
 *
 * Dono: Daniel (pele). Funções derivadas vêm do `cockpit-core` — as mesmas que o
 * cockpit antigo usa, então os dois leem o mundo pelo mesmo instrumento.
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import {
  formatDuration,
  parseModelFromPane,
  resolveContextPct,
  shortModelName,
} from '@grupo_borges/cockpit-core/cockpit-types';
import { formatCompactNumber, formatElapsedShort } from '@grupo_borges/cockpit-core/painel-format';

/** Teto de contexto da frota. Não é enfeite: acima disso o agente compacta.
 *  Exportada: a `LinhaDormindo` (tropa.tsx) julga o contexto de quem dormiu
 *  pela mesma régua — teto é um só, ou o número mente diferente por linha. */
export const TETO_PCT = 30;

/** A régua do medidor: 10 células cobrindo até 50% da janela, 5% cada.
 *
 *  A escala para em 50, não em 100, porque a frota inteira vive entre 5% e 40%
 *  — numa régua até 100 todo mundo acende o mesmo toquinho à esquerda. E não
 *  vai a 60 (o dobro do teto) porque aí a zona além do limite ficava com metade
 *  do desenho para um caso raro: sobrava um bloco apagado permanente ocupando
 *  espaço que a coluna de 260px não tem de sobra.
 *
 *  A célula do teto sai DERIVADA das outras duas — mudar o teto da frota reajusta
 *  o desenho sozinho, sem ninguém precisar lembrar de mexer aqui. */
const ESCALA_PCT = 50;
const CELULAS = 10;
const PCT_POR_CELULA = ESCALA_PCT / CELULAS;
/** Índice da primeira célula que já passou do teto. */
const CELULA_DO_TETO = TETO_PCT / PCT_POR_CELULA;

/**
 * O medidor de contexto — 12 células, escala 0–60%, o teto no meio.
 *
 * A barra contínua que estava aqui foi reprovada pelo Rica (09/08): *"essa
 * barra de statusline context fica visualmente apontando para o mesmo lugar"*.
 * Ele tinha razão, e o culpado era o traço do teto: fixo em 30% da largura, ele
 * caía na MESMA coordenada em todas as nove linhas e formava uma coluna branca
 * vertical descendo a lista inteira. O olho lia a coluna, não o dado.
 *
 * A troca resolve pela estrutura, não pela cor:
 *
 * - **O teto virou respiro, não risco.** Depois da 6ª célula o vão é maior. Nada
 *   é desenhado por cima do preenchimento, então não há mais linha repetida — e
 *   o limite continua visível, porque um vão maior dentro de um ritmo regular é
 *   impossível de não ver.
 * - **Cada célula vale 5%**, então 7% acende duas e 25% acende cinco: a diferença
 *   entre dois agentes finalmente aparece na forma, não só no número. Acima de
 *   50% satura, e o percentual ao lado continua dizendo a verdade.
 * - **Célula acesa além do teto sai em âmbar**, junto com o percentual. Cor onde
 *   há decisão a tomar, e só ali.
 *
 * Nem `@shadcn/progress` nem `@shadcn/chart` entram aqui, e a razão é de peso:
 * o primeiro é a mesma barra contínua que acabou de ser reprovada, e o segundo
 * traz o Recharts inteiro para desenhar doze retângulos em nove linhas de uma
 * coluna de 260px. Célula é `<span>` com fundo — zero dependência, e roda dentro
 * do Server Component sem virar cliente.
 *
 * Herdado por quem dorme (`LinhaDormindo`): teto é um só, ou o número mente
 * diferente por linha.
 */
export function Barra({ pct }: { pct: number }) {
  const acesas = Math.min(CELULAS, Math.ceil(pct / PCT_POR_CELULA));
  return (
    <span aria-hidden className="flex shrink-0 items-center" style={{ height: '10px' }}>
      {Array.from({ length: CELULAS }, (_, i) => {
        const acesa = i < acesas;
        const passouDoTeto = i >= CELULA_DO_TETO;
        return (
          <span
            key={i}
            className="block"
            style={{
              width: '3px',
              height: '8px',
              // O respiro do teto. Vai como margem DA CÉLULA seguinte pra não
              // depender de `gap` — o vão extra tem de existir uma vez só, no
              // meio, e não somado ao gap de todos os outros pares.
              marginLeft: i === 0 ? 0 : i === CELULA_DO_TETO ? '5px' : '2px',
              borderRadius: '1px',
              background: acesa
                ? passouDoTeto
                  ? 'var(--ck-state-attention)'
                  : 'var(--ck-text-secondary)'
                : 'var(--ck-edge-hairline)',
            }}
          />
        );
      })}
    </span>
  );
}

export function Statusline({
  agente,
  agora,
  curta = false,
}: {
  agente: Agent;
  agora: number;
  /** Modo coluna (260px): sai o tempo de sessão, ficam modelo e contexto. O
   *  tempo é o dado menos acionável dos três — sem ele, "Opus 5" para de ser
   *  truncado até virar "C". */
  curta?: boolean;
}) {
  const ehCodex = agente.executor_kind === 'codex';
  const iniciou = ehCodex ? agente.session_started_at : agente.pane_session_started_at;
  const segundos = iniciou !== null ? Math.max(0, agora - iniciou) : null;

  // O pane é a fonte VIVA: `parseModelFromPane` lê o que está rodando agora,
  // `state_model` é a última intenção salva e pode estar pendente. Mesma
  // precedência do cockpit antigo — o card reflete execução, não seleção.
  const modelo =
    (ehCodex ? null : parseModelFromPane(agente.pane_excerpt)) ??
    shortModelName(agente.state_model ?? agente.model_default);
  const pct = resolveContextPct(agente);
  const tokens = ehCodex ? agente.codex_tokens_used : null;
  // Número que o back mediu antes desta sessão (ou parado há muito) continua na
  // tela — o que não pode é sair sem etiqueta, como se fosse leitura de agora.
  const velho = agente.context_stale;
  const idade =
    agente.context_updated_at !== null
      ? formatElapsedShort(agora - agente.context_updated_at)
      : 'em sessão anterior';

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

      <span aria-hidden style={{ color: 'var(--ck-text-tertiary)' }}>
        ·
      </span>

      {pct !== null ? (
        <span
          className="flex shrink-0 items-center"
          style={{ gap: 'var(--ck-space-1)' }}
          title={
            velho
              ? `contexto ${pct}% medido ${idade} — não é a leitura desta sessão`
              : `contexto ${pct}% — teto da frota ${TETO_PCT}%`
          }
        >
          <Barra pct={pct} />
          <span style={{ color: pct > TETO_PCT ? 'var(--ck-state-attention)' : undefined }}>
            {pct}%
          </span>
          {/* A PALAVRA carrega o estado (§3/§9.7): número velho esmaecido ou de
              outra cor continuaria lendo como medição de agora. Aqui não cabe a
              idade junto — ela sai por extenso na gaveta, que é o degrau
              seguinte do mesmo toque. */}
          {velho ? (
            <span className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>
              antigo
            </span>
          ) : null}
        </span>
      ) : tokens !== null ? (
        // Codex não expõe porcentagem de janela — mostra o que ele tem.
        <span className="shrink-0">{formatCompactNumber(tokens)} tk</span>
      ) : (
        <span className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>
          sem contexto
        </span>
      )}
    </span>
  );
}
