/**
 * Uma linha por máquina no pé da tropa (Rica, 05/11): nome · RAM · temperatura
 * (Swap onde não há sensor) · parados. No lugar do cartão grande da VPS, nos
 * dois cockpits. O toque abre a tela Abertos na aba dela.
 *
 * A local é a que o próprio cockpit mede (`/api/vps`); as remotas vêm de
 * `/api/maquinas`. Remota com o nome da local vence (`maquinasDaCasa`): é a
 * que tem Fechar. As que só têm Ligar/Desligar (`/api/energia`, o PC e o
 * note) entram com "ligado"/"desligado", sem número; remota desligada diz
 * "desligado" no lugar de "fora do ar". Na home não há botão de energia.
 * Cor só no trecho acima do teto, a de antes do cartão.
 *
 * Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';

import { IconeMaquina } from '@/components/shell/icones';
import { abasDaCasa, energiaDe, trechosDaEnergia, type EnergiaMaquina } from '@/lib/energia';
import { maquinasDaCasa, trechosDaLocal, trechosDaRemota, type Trecho } from '@/lib/linhas-das-maquinas';

import { usaEnergia } from './usa-energia';
import { usaRecursosLocais } from './usa-recursos-locais';
import { usaMaquinas, usaResumoDaMaquina } from './usa-resumo-da-maquina';

export function LinhasDasMaquinas() {
  const local = usaRecursosLocais();
  const remotas = usaMaquinas();
  const energia = usaEnergia();
  // Só desenha quando as três fontes responderam: a lista entra inteira, sem
  // crescer de linha em linha. Sem máquina nenhuma, não há cartão vazio.
  if (local === null || remotas === null || energia === null) return null;
  const casa = abasDaCasa(maquinasDaCasa(local.dados?.nome ?? null, remotas), energia);
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
        ) : remotas.some((r) => r.id === m.id) ? (
          <LinhaRemota key={m.id} id={m.id} nome={m.nome} primeira={i === 0} energia={energiaDe(m, energia)} />
        ) : (
          <Linha key={m.id} id={m.id} nome={m.nome} primeira={i === 0} trechos={trechosDaEnergiaOuNada(energiaDe(m, energia))} />
        ),
      )}
    </ul>
  );
}

function trechosDaEnergiaOuNada(e: EnergiaMaquina | null): Trecho[] | null {
  return e ? trechosDaEnergia(e) : null;
}

function LinhaRemota({
  id,
  nome,
  primeira,
  energia,
}: {
  id: string;
  nome: string;
  primeira: boolean;
  energia: EnergiaMaquina | null;
}) {
  const resumo = usaResumoDaMaquina(id);
  // Desligada (ou ligando/desligando), a energia diz o estado: "fora do ar" seria mentira.
  const trechos: Trecho[] | null =
    energia && (!energia.ligado || energia.em_andamento !== null)
      ? trechosDaEnergia(energia)
      : !resumo
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
