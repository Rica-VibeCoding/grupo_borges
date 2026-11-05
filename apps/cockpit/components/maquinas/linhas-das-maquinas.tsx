/**
 * Uma linha por máquina no pé da tropa (Rica, 05/11): nome · RAM · temperatura
 * (Swap onde não há sensor) · parados. No lugar do cartão grande da VPS, nos
 * dois cockpits. O toque abre a tela Abertos na aba dela.
 *
 * A local é a que o próprio cockpit mede (`/api/vps`); as remotas vêm de
 * `/api/maquinas`. Remota com o nome da local vence (`maquinasDaCasa`): é a
 * que tem Fechar. Cor só no trecho acima do teto, a de antes do cartão.
 *
 * Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';

import { IconeMaquina } from '@/components/shell/icones';
import { maquinasDaCasa, trechosDaLocal, trechosDaRemota, type Trecho } from '@/lib/linhas-das-maquinas';

import { usaRecursosLocais } from './usa-recursos-locais';
import { usaMaquinas, usaResumoDaMaquina } from './usa-resumo-da-maquina';

export function LinhasDasMaquinas() {
  const local = usaRecursosLocais();
  const remotas = usaMaquinas();
  // Só desenha quando as duas fontes responderam: a lista entra inteira, sem
  // crescer de linha em linha. Sem máquina nenhuma, não há cartão vazio.
  if (local === null || remotas === null) return null;
  const casa = maquinasDaCasa(local.dados?.nome ?? null, remotas);
  if (casa.length === 0) return null;

  return (
    <ul
      aria-label="Uso das máquinas"
      className="ck-vps flex shrink-0 flex-col overflow-clip"
      // `margin-top: auto`: pousa no pé da coluna quando a lista é curta.
      style={{ marginTop: 'auto' }}
    >
      {casa.map((m, i) =>
        m.local && local.dados ? (
          <Linha key={m.id} id={m.id} nome={m.nome} primeira={i === 0} trechos={trechosDaLocal(local.dados, local.comSensor)} />
        ) : (
          <LinhaRemota key={m.id} id={m.id} nome={m.nome} primeira={i === 0} />
        ),
      )}
    </ul>
  );
}

function LinhaRemota({ id, nome, primeira }: { id: string; nome: string; primeira: boolean }) {
  const resumo = usaResumoDaMaquina(id);
  const trechos: Trecho[] | null = !resumo
    ? null
    : resumo.online
      ? trechosDaRemota(resumo)
      : [{ texto: 'fora do ar', alerta: false }];
  return <Linha id={id} nome={nome} primeira={primeira} trechos={trechos} />;
}

function Linha({
  id,
  nome,
  primeira,
  trechos,
}: {
  id: string;
  nome: string;
  primeira: boolean;
  /** `null` antes da 1ª leitura: a linha já ocupa a altura, sem número. */
  trechos: Trecho[] | null;
}) {
  return (
    <li style={{ borderTop: primeira ? undefined : '1px solid var(--ck-edge-hairline)' }}>
      <Link
        href={`/abertos?m=${encodeURIComponent(id)}`}
        aria-label={trechos ? `${nome}: ${trechos.map((t) => t.texto).join(', ')}` : nome}
        className="ck-maquina-mini flex items-center"
        style={{
          gap: 'var(--ck-space-2)',
          minHeight: 'var(--ck-touch-min)',
          padding: '0 var(--ck-space-4)',
          color: 'var(--ck-text-primary)',
        }}
      >
        <IconeMaquina tamanho={16} className="shrink-0" style={{ color: 'var(--ck-text-secondary)' }} />
        <span className="shrink-0" style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600 }}>
          {nome}
        </span>
        <span
          aria-hidden
          className="ck-tabular ml-auto min-w-0 truncate"
          style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
        >
          {trechos
            ? trechos.map((t, i) => (
                <span key={t.texto}>
                  {i > 0 ? ' · ' : null}
                  <span style={t.alerta ? { color: 'var(--ck-state-attention)' } : undefined}>{t.texto}</span>
                </span>
              ))
            : ' '}
        </span>
      </Link>
    </li>
  );
}
