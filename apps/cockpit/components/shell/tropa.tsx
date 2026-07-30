/**
 * Tropa — a lista de agentes.
 *
 * Mora aqui, e não dentro de `app/page.tsx`, porque aparece em DUAS superfícies:
 * é a rota `/` inteira no celular e é a coluna de navegação no desktop, inclusive
 * quando você já está dentro de um agente. Duplicar o markup nas duas rotas foi o
 * que fez o `page.tsx` do andaime renderizar `<Tropa>` duas vezes.
 *
 * A decisão de produto que manda no desenho: `aguardando` sobe pro topo. O
 * contrato diz que o único estado quente é o único que chama o Rica — se o âmbar
 * é o sinal, ele não pode nascer no meio de uma lista de sete. Ordenar por quem
 * precisa de humano é a mesma tese aplicada ao eixo vertical.
 *
 * Dono: Daniel (pele). As medidas vêm do esqueleto.
 */
import Link from 'next/link';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { estadoDe } from './estado';

function detalheDe(a: Agent): string | null {
  const bruto = a.lifecycle_detail ?? a.active_task_label ?? a.status_line;
  return bruto?.trim() ? bruto.trim() : null;
}

function ItemTropa({ agente, selecionado }: { agente: Agent; selecionado: boolean }) {
  const estado = estadoDe(agente.status);
  const detalhe = detalheDe(agente);
  const pct = agente.context_pct;

  // Precedência do filete, e ela é deliberada: selecionado ganha do estado.
  // Quando os dois valem, você JÁ está olhando esse agente — o âmbar continua
  // dito pela palavra na segunda linha, então nada de informação se perde.
  const filete = selecionado
    ? 'var(--ck-text-primary)'
    : agente.status === 'aguardando' || agente.status === 'trabalhando'
      ? estado.cor
      : 'transparent';

  return (
    <li>
      <Link
        href={`/agente/${agente.slug}`}
        className="ck-veil flex flex-col justify-center"
        data-selecionado={selecionado ? 'true' : 'false'}
        aria-current={selecionado ? 'page' : undefined}
        style={{
          minHeight: 'var(--ck-touch-min)',
          gap: '2px',
          padding: 'var(--ck-space-2) var(--ck-space-3)',
          borderRadius: 'var(--ck-radius-chip)',
          borderLeft: `2px solid ${filete}`,
        }}
      >
        <span className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
          {/* Largura fixa: emoji é mais largo que o `•` de quem não tem, e sem o
              slot os nomes começam em x diferente por linha. Coluna desalinhada
              numa lista de nove é o que faz a tela parecer amadora. */}
          <span
            aria-hidden
            className="shrink-0 text-center"
            style={{ width: '1.25rem', fontSize: 'var(--ck-text-base)' }}
          >
            {agente.emoji ?? '•'}
          </span>
          <span
            className="min-w-0 flex-1 truncate"
            style={{
              fontSize: 'var(--ck-text-base)',
              color: 'var(--ck-text-primary)',
              letterSpacing: 'var(--ck-track-title)',
            }}
          >
            {agente.name}
          </span>
          {pct != null ? (
            <span
              className="ck-tabular shrink-0"
              style={{
                fontSize: 'var(--ck-text-xs)',
                // Teto de 30% vale pra todos. Acima disso a cor deixa de ser
                // informação e vira aviso — e o "%" fica junto pra que o número
                // não dependa só da cor.
                color: pct > 30 ? 'var(--ck-state-attention)' : 'var(--ck-text-secondary)',
              }}
            >
              {pct}%
            </span>
          ) : null}
        </span>

        <span
          className="flex min-w-0 items-center"
          style={{ gap: 'var(--ck-space-2)', fontSize: 'var(--ck-text-xs)' }}
        >
          <span className="shrink-0" style={{ color: estado.cor }}>
            {estado.rotulo}
          </span>
          {detalhe ? (
            <>
              {/* separador decorativo: é o único lugar onde tertiary é legítimo */}
              <span aria-hidden className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>
                ·
              </span>
              <span className="min-w-0 truncate" style={{ color: 'var(--ck-text-secondary)' }}>
                {detalhe}
              </span>
            </>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function Tropa({
  agents,
  slugSelecionado,
}: {
  agents: Agent[];
  slugSelecionado?: string;
}) {
  const ordenados = [...agents].sort((a, b) => {
    const da = estadoDe(a.status).ordem;
    const db = estadoDe(b.status).ordem;
    return da !== db ? da - db : a.name.localeCompare(b.name, 'pt-BR');
  });
  const chamando = agents.filter((a) => a.status === 'aguardando').length;

  return (
    <nav
      aria-label="Tropa"
      className="flex min-h-0 flex-col"
      style={{ padding: 'var(--ck-space-2)' }}
    >
      <p
        className="flex items-baseline"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-2) var(--ck-space-3)',
          fontSize: 'var(--ck-text-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--ck-track-overline)',
          // tertiary dá 3.55:1 e o contrato o restringe a ícone/separador/texto
          // ≥20px. Overline é label de 12px, então vai de secondary (6.0:1).
          color: 'var(--ck-text-secondary)',
        }}
      >
        <span>Tropa</span>
        {chamando > 0 ? (
          <span className="ck-tabular" style={{ color: 'var(--ck-state-attention)' }}>
            {chamando} chamando
          </span>
        ) : null}
      </p>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {ordenados.map((a) => (
          <ItemTropa key={a.slug} agente={a} selecionado={a.slug === slugSelecionado} />
        ))}
      </ul>
    </nav>
  );
}
