/**
 * Uma linha por máquina no pé da tropa (Rica, 05/11): o nome à esquerda e CPU ·
 * RAM · temperatura à direita, em colunas iguais nas quatro, numa linha só. Sem
 * sensor a coluna da temperatura fica vazia. Na tropa estreita do chat os
 * números perdem o rótulo, que sobe para um cabeçalho (`.ck-maquinas-lista`). No lugar do cartão grande da VPS, nos dois cockpits.
 * O toque abre a tela Abertos na aba dela.
 *
 * A local é a que o próprio cockpit mede (`/api/vps`); as remotas vêm de
 * `/api/maquinas`. Remota com o nome da local vence (`maquinasDaCasa`): é a
 * que tem Fechar. As que só têm Ligar/Desligar (`/api/energia`) entram com
 * "ligado"/"desligado", sem número; remota desligada diz "desligado" no lugar
 * de "fora do ar". Na home não há botão de energia. Cor só no trecho acima do
 * teto; disco cheio e swap em troca aparecem entre o nome e os números, só em
 * alerta.
 *
 * Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';

import { IconeMaquina } from '@/components/shell/icones';
import { abasDaCasa, energiaDe, trechosDaEnergia, type EnergiaMaquina } from '@/lib/energia';
import {
  leituraDaLocal,
  leituraDaRemota,
  leituraDeEstado,
  maquinasDaCasa,
  type Leitura,
  type Trecho,
} from '@/lib/linhas-das-maquinas';

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
      className="ck-vps ck-maquinas-lista flex shrink-0 flex-col overflow-clip"
      // `margin-top: auto`: pousa no pé da coluna quando a lista é curta.
      style={{ marginTop: 'auto' }}
    >
      <Cabecalho />
      {casa.map((m, i) =>
        m.local && local.dados ? (
          <Linha key={m.id} id={m.id} nome={m.nome} primeira={i === 0} leitura={leituraDaLocal(local.dados, local.comSensor)} />
        ) : remotas.some((r) => r.id === m.id) ? (
          <LinhaRemota key={m.id} id={m.id} nome={m.nome} primeira={i === 0} energia={energiaDe(m, energia)} />
        ) : (
          <Linha key={m.id} id={m.id} nome={m.nome} primeira={i === 0} leitura={leituraDaEnergia(energiaDe(m, energia))} />
        ),
      )}
    </ul>
  );
}

function leituraDaEnergia(e: EnergiaMaquina | null): Leitura | null {
  return e ? leituraDeEstado(trechosDaEnergia(e)) : null;
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
  const leitura: Leitura | null =
    energia && (!energia.ligado || energia.em_andamento !== null)
      ? leituraDaEnergia(energia)
      : !resumo
        ? null
        : resumo.online
          ? leituraDaRemota(resumo)
          : leituraDeEstado([{ texto: 'fora do ar', alerta: false }]);
  return <Linha id={id} nome={nome} primeira={primeira} leitura={leitura} />;
}

const corDo = (t: Trecho) => (t.alerta ? { color: 'var(--ck-state-attention)' } : undefined);

/** Escreve o trecho inteiro na lista larga e o curto na estreita (o CSS escolhe). */
function Texto({ t }: { t: Trecho }) {
  if (t.curto === undefined) return <>{t.texto}</>;
  return (
    <>
      <span className="ck-maquina-longo">{t.texto}</span>
      <span className="ck-maquina-curto">{t.curto}</span>
    </>
  );
}

/**
 * Só na lista estreita, quando os números perdem o rótulo: CPU, RAM e °C uma
 * vez, sobre as colunas. Fora da árvore de acessibilidade: cada linha já diz
 * tudo no nome acessível.
 */
function Cabecalho() {
  return (
    <li
      aria-hidden
      className="ck-maquina-cabecalho justify-end"
      style={{ paddingTop: 'var(--ck-space-2)', fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
    >
      <span className="ck-maquina-medidas">
        <span>CPU</span>
        <span>RAM</span>
        <span className="ck-maquina-cab-temp">°C</span>
      </span>
    </li>
  );
}

function Linha({
  id,
  nome,
  primeira,
  leitura,
}: {
  id: string;
  nome: string;
  primeira: boolean;
  /** `null` antes da 1ª leitura: a linha já ocupa a altura, sem número. */
  leitura: Leitura | null;
}) {
  const falado = leitura ? [...leitura.medidas, ...leitura.avisos].map((t) => t.falado ?? t.texto).join(', ') : null;
  return (
    <li style={{ borderTop: primeira ? undefined : '1px solid var(--ck-edge-hairline)' }}>
      <Link
        href={`/abertos?m=${encodeURIComponent(id)}`}
        aria-label={falado ? `${nome}: ${falado}` : nome}
        // No estreito o número vira "!" e o rótulo sobe ao cabeçalho: o
        // detalhe aparece ao passar o mouse.
        title={falado ? `${nome}: ${falado}` : undefined}
        className="ck-maquina-mini flex items-center"
        style={{
          gap: 'var(--ck-space-2)',
          minHeight: 'var(--ck-touch-min)',
          color: 'var(--ck-text-primary)',
        }}
      >
        <IconeMaquina tamanho={16} className="ck-maquina-icone shrink-0" style={{ color: 'var(--ck-text-secondary)' }} />
        <span className="min-w-0 truncate" style={{ flex: '0 1 auto', fontSize: 'var(--ck-text-base)', fontWeight: 600 }}>
          {nome}
        </span>
        {/* Disco cheio e swap em troca: só em alerta, no vão entre o nome e os
            números. Cede espaço antes do nome. */}
        <span
          aria-hidden
          className="ck-tabular min-w-0 truncate"
          style={{ flex: '1 1 0%', fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}
        >
          {leitura?.avisos.length ? (
            <>
              <span className="ck-maquina-longo">{leitura.avisos.map((t) => t.texto).join(' ')}</span>
              <span className="ck-maquina-curto">!</span>
            </>
          ) : null}
        </span>
        <span
          aria-hidden
          className="ck-maquina-medidas ck-tabular shrink-0"
          style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
        >
          {leitura
            ? leitura.medidas.map((t, i) => (
                // A 3ª medida é sempre a temperatura (o estado único não tem 3ª).
                <span key={t.texto} className={i === 2 ? 'ck-maquina-temp' : undefined} style={corDo(t)}>
                  <Texto t={t} />
                </span>
              ))
            : '\u00a0'}
        </span>
      </Link>
    </li>
  );
}
